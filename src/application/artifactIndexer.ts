/**
 * artifactIndexer — turns one artifact into one ArtifactSearchIndexRecord.
 *
 * Three passes per document, all optional so any single failure leaves the
 * previous index intact rather than half-written:
 *
 *   1. split the body into sections (pure, local, no API)
 *   2. generate Q&A per section-window  -> /api/search-index/generate-qa
 *   3. embed sections, then embed Q&A    -> /api/search-index/embed
 *
 * A 200 KiB document is ~110 sections, so both LLM and embedding calls are
 * windowed: the QA route accepts at most 12 sections / 20,000 chars, the embed
 * route at most 80 strings. Nothing here touches ProjectSnapshot or Firestore
 * (LAW 2) — the record goes straight to IndexedDB.
 *
 * Sequential by design: this runs against a free-tier Gemini key, and a
 * parallel fan-out gets you rate-limited mid-project with no resume.
 */
import type { UniversalArtifactDocument } from '../domains/01-artifact-document';
import {
  DEFAULT_MAX_SECTION_CHARS,
  computeArtifactContentHash,
  sectionEmbeddingText,
  splitArtifactIntoSections,
  type DocSection,
} from '../utils/sectionChunker';
import { l2Normalize } from '../domains/search/draftSearchEngine';
import {
  saveArtifactSearchIndex,
  searchIndexKey,
  type ArtifactSearchIndexRecord,
  type GeneratedQaPair,
} from '../services/searchIndexStore';
import { embedTexts, generateArtifactQa } from '../gateway/api';

/** The QA route's own ceiling — kept in sync with server/routes/searchIndex.ts. */
const QA_WINDOW_MAX_SECTIONS = 12;
const QA_WINDOW_MAX_CHARS = 15000;
/** The embed route accepts 80; 50 leaves headroom and keeps responses small. */
const EMBED_BATCH = 50;
const INTER_BATCH_MS = 150;
const INTER_ARTIFACT_MS = 250;

export interface IndexAbortSignal {
  aborted: boolean;
}

export interface IndexProjectOptions {
  /** Rebuild even records whose contentHash still matches. */
  force?: boolean;
  onProgress?: (done: number, total: number, stage: string) => void;
  signal?: IndexAbortSignal;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function parseJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // non-JSON error body — keep the status
    }
    throw new Error(`${what}: ${detail}`);
  }
  return (await res.json()) as T;
}

/** Group sections into QA windows that fit the route's section and char caps. */
function qaWindows(sections: DocSection[]): DocSection[][] {
  const windows: DocSection[][] = [];
  let current: DocSection[] = [];
  let chars = 0;
  for (const s of sections) {
    const len = s.text.length;
    if (
      current.length > 0 &&
      (current.length >= QA_WINDOW_MAX_SECTIONS || chars + len > QA_WINDOW_MAX_CHARS)
    ) {
      windows.push(current);
      current = [];
      chars = 0;
    }
    current.push(s);
    chars += len;
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

/**
 * A document with no body still gets a record: the metadata section exists, so
 * section FTS and section vectors both have something to score. Empty section
 * and QA vector lists are legal — `draftSearchEngine` skips a method whose
 * vector list is empty rather than treating absence as a miss.
 */
export async function indexSingleArtifact(
  projectId: string,
  art: UniversalArtifactDocument,
  onProgress?: (stage: string) => void,
  signal?: IndexAbortSignal
): Promise<ArtifactSearchIndexRecord> {
  const report = (stage: string) => {
    onProgress?.(stage);
  };
  const checkAbort = () => {
    if (signal?.aborted) throw new Error('Indexing stopped');
  };

  const contentHash = computeArtifactContentHash(art);
  const sections = splitArtifactIntoSections(art, DEFAULT_MAX_SECTION_CHARS);
  checkAbort();

  // --- 1. Q&A, window by window -------------------------------------------
  const windows = qaWindows(sections);
  const qaPairs: GeneratedQaPair[] = [];
  for (let i = 0; i < windows.length; i++) {
    checkAbort();
    report(`Generating Q&A (window ${i + 1}/${windows.length})…`);
    const res = await generateArtifactQa({
      title: art.title,
      subtitle: art.current?.subtitle,
      sections: windows[i].map((s) => ({ id: s.id, heading: s.heading, text: s.text })),
    });
    const data = await parseJson<{ qaPairs?: GeneratedQaPair[] }>(res, 'generate-qa');
    for (const qa of data.qaPairs || []) {
      // The route numbers within one window only; renumber across the document
      // so ids stay unique when four windows are concatenated.
      qaPairs.push({ ...qa, id: `qa-${qaPairs.length}` });
    }
    if (i + 1 < windows.length) await delay(INTER_BATCH_MS);
  }
  checkAbort();

  // --- 2. Section vectors ---------------------------------------------------
  report(`Embedding ${sections.length} sections…`);
  const sectionTexts = sections.map((s) =>
    sectionEmbeddingText(art.title, s, s.id === 'sec-meta')
  );
  const sectionVectors = await embedAll(sectionTexts, art.title, 'sections', report, signal);
  checkAbort();

  // --- 3. Q&A vectors --------------------------------------------------------
  let qaVectors: Float32Array[] = [];
  if (qaPairs.length > 0) {
    report(`Embedding ${qaPairs.length} Q&A pairs…`);
    const qaTexts = qaPairs.map(
      (qa) =>
        `${art.title} (${qa.sectionHeading}) — Q: ${qa.question}\n` +
        `A: ${qa.answer}\nKeywords: ${qa.keywords.join(', ')}`
    );
    qaVectors = await embedAll(qaTexts, art.title, 'Q&A pairs', report, signal);
  }
  checkAbort();

  const record: ArtifactSearchIndexRecord = {
    key: searchIndexKey(projectId, art.id),
    projectId,
    artifactId: art.id,
    contentHash,
    updatedAt: Date.now(),
    qaPairs,
    sectionIds: sections.map((s) => s.id),
    sectionHeadings: sections.map((s) => s.heading),
    sectionSnippets: sections.map((s) => s.text.replace(/\s+/g, ' ').trim().slice(0, 220)),
    sectionVectors,
    qaVectors,
  };
  await saveArtifactSearchIndex(record);
  report('Saved');
  return record;
}

async function embedAll(
  texts: string[],
  artTitle: string,
  what: string,
  report: (stage: string) => void,
  signal?: IndexAbortSignal
): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  if (texts.length === 0) return out;
  const batches = chunk(texts, EMBED_BATCH);
  for (let i = 0; i < batches.length; i++) {
    if (signal?.aborted) throw new Error('Indexing stopped');
    report(`Embedding ${what} (${i + 1}/${batches.length})…`);
    const res = await embedTexts({
      texts: batches[i],
      taskType: 'RETRIEVAL_DOCUMENT',
      title: artTitle,
    });
    const data = await parseJson<{ embeddings?: number[][] }>(res, 'embed');
    const got = data.embeddings || [];
    if (got.length !== batches[i].length) {
      throw new Error(
        `embed: expected ${batches[i].length} vectors, got ${got.length} — refusing to store a misaligned index`
      );
    }
    // LAW 6. The route already normalizes, but the offline path and any future
    // provider change must not be able to slip an ununit vector past us.
    for (const v of got) out.push(new Float32Array(l2Normalize(v)));
    if (i + 1 < batches.length) await delay(INTER_BATCH_MS);
  }
  return out;
}

/** True when there is no record, it has no Q&A, or the artifact text moved. */
export function isIndexStale(
  indexMap: Map<string, ArtifactSearchIndexRecord>,
  projectId: string,
  art: UniversalArtifactDocument
): boolean {
  void projectId;
  const record = indexMap.get(art.id);
  if (!record) return true;
  if (record.qaPairs.length === 0) return true;
  return record.contentHash !== computeArtifactContentHash(art);
}

/**
 * Index every artifact in the project, one at a time, skipping fresh records
 * unless `force`. Returns the UPDATED map (same Map instance, mutated in
 * place) so the caller can hand it straight to the scoring memo.
 */
export async function indexProjectArtifacts(
  projectId: string,
  artifacts: UniversalArtifactDocument[],
  indexMap: Map<string, ArtifactSearchIndexRecord>,
  opts: IndexProjectOptions = {}
): Promise<Map<string, ArtifactSearchIndexRecord>> {
  const { force = false, onProgress, signal } = opts;
  const pending = artifacts.filter(
    (art) => force || isIndexStale(indexMap, projectId, art)
  );
  const total = pending.length;
  if (total === 0) {
    onProgress?.(0, 0, 'Everything already indexed');
    return indexMap;
  }

  let done = 0;
  for (const art of pending) {
    if (signal?.aborted) {
      onProgress?.(done, total, 'Stopped');
      return indexMap;
    }
    try {
      const record = await indexSingleArtifact(
        projectId,
        art,
        (stage) => onProgress?.(done, total, `${art.title} — ${stage}`),
        signal
      );
      indexMap.set(art.id, record);
    } catch (err) {
      // One bad document must not abort the project: report and continue so a
      // single oversized note or a transient 429 leaves the rest indexed.
      if (signal?.aborted) {
        onProgress?.(done, total, 'Stopped');
        return indexMap;
      }
      const message = err instanceof Error ? err.message : String(err);
      onProgress?.(done, total, `${art.title} — failed: ${message}`);
    }
    done += 1;
    onProgress?.(done, total, `${art.title} — done`);
    if (done < total) await delay(INTER_ARTIFACT_MS);
  }
  return indexMap;
}
