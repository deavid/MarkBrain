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
const INTER_ARTIFACT_MS = 250;

export interface IndexAbortSignal {
  aborted: boolean;
}

export interface IndexProjectOptions {
  /** Rebuild even records whose contentHash still matches. */
  force?: boolean;
  onProgress?: (done: number, total: number, stage: string) => void;
  /**
   * Fired after EACH document is saved. The run used to publish the map only at
   * the very end, so "Indexed: 8/24" and the ranking both froze for the whole
   * job — and never moved at all if the run failed. One document, one publish.
   */
  onIndexed?: (record: ArtifactSearchIndexRecord) => void;
  /**
   * Fired when a document could not be indexed. This used to be folded into the
   * progress string and overwritten one line later by '— done', so the reason a
   * note did not index was invisible: the counter simply sat there and the only
   * sane conclusion was "it isn't saving". Failures are first-class now.
   */
  onFailure?: (title: string, message: string) => void;
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

/**
 * How many API calls ONE document may have in flight.
 *
 * Documents stay strictly sequential (see the header — that is the free-tier
 * rate-limit law). The parallelism is INSIDE a document, where the steps do not
 * depend on each other: generating Q&A for a window and embedding sections are
 * different endpoints and can overlap.
 *
 * 3 is deliberately small. The goal is to hide round-trip latency, not to fan
 * out: a burst gets a free-tier key throttled, and a 429 mid-document leaves no
 * record at all. Raise it only with evidence from the rate-limit response
 * headers.
 */
const MAX_INFLIGHT_PER_DOC = 3;

/**
 * Map with a hard cap on concurrent work, preserving input order in the result.
 * Abort is checked before each item starts; an in-flight call is not cancelled
 * (the fetch layer has no per-call abort here) but nothing new is started.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
  signal?: IndexAbortSignal
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  // A failure must stop the SIBLINGS, not just reject the aggregate. Otherwise
  // an orphaned worker keeps calling back into progress long after the run has
  // been reported complete — which is what left the UI stuck on "16/16" after it
  // had already gone back to normal.
  let failure: unknown = null;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      if (failure) throw failure;
      if (signal?.aborted) throw new Error('Indexing stopped');
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        failure = e;
        throw e;
      }
    }
  });
  await Promise.all(workers);
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
  // Once this document has returned (saved or thrown), any straggler callback
  // from an overlapping step is dropped. Without this a late embed response can
  // repaint the progress line for a run the user has already been told is over.
  let closed = false;
  const report = (stage: string) => {
    if (!closed) onProgress?.(stage);
  };
  const checkAbort = () => {
    if (signal?.aborted) throw new Error('Indexing stopped');
  };

  try {
    const contentHash = computeArtifactContentHash(art);
    const sections = splitArtifactIntoSections(art, DEFAULT_MAX_SECTION_CHARS);
    checkAbort();

    // --- 1 + 2, overlapped ----------------------------------------------------
    // A window's Q&A does not need the section vectors, and the section vectors
    // do not need the Q&A — they are different endpoints with no shared input.
    // Overlapping them is the main latency win on a many-window document; the two
    // lists are each built by mapLimit at MAX_INFLIGHT_PER_DOC, so the document
    // as a whole stays within the same cap.
    const windows = qaWindows(sections);
    const sectionTexts = sections.map((s) =>
      sectionEmbeddingText(art.title, s, s.id === 'sec-meta')
    );
    const [windowQa, sectionVectors] = await Promise.all([
      mapLimit(
        windows,
        MAX_INFLIGHT_PER_DOC,
        async (window, i) => {
          report(`Generating Q&A (window ${i + 1}/${windows.length})…`);
          const res = await generateArtifactQa({
            title: art.title,
            subtitle: art.current?.subtitle,
            sections: window.map((s) => ({ id: s.id, heading: s.heading, text: s.text })),
          });
          const data = await parseJson<{ qaPairs?: GeneratedQaPair[] }>(res, 'generate-qa');
          return data.qaPairs || [];
        },
        signal
      ),
      (async () => {
        report(`Embedding ${sections.length} sections…`);
        return embedAll(sectionTexts, art.title, 'sections', report, signal);
      })(),
    ]);

    // Renumber AFTER the fan-out. The route numbers within one window only, and
    // ids must stay unique and in document order when windows are concatenated.
    const qaPairs: GeneratedQaPair[] = [];
    for (const list of windowQa) {
      for (const qa of list) qaPairs.push({ ...qa, id: `qa-${qaPairs.length}` });
    }
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
    } finally {
      // Every exit counts: a thrown pipeline must still silence its stragglers.
      closed = true;
    }
  }

async function embedAll(
  texts: string[],
  artTitle: string,
  what: string,
  report: (stage: string) => void,
  signal?: IndexAbortSignal
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const batches = chunk(texts, EMBED_BATCH);
  // Batches run at MAX_INFLIGHT_PER_DOC wide; mapLimit keeps them in ORDER, so
  // a vector list stays aligned with the text list it came from.
  const perBatch = await mapLimit(
    batches,
    MAX_INFLIGHT_PER_DOC,
    async (batch, i) => {
      report(`Embedding ${what} (${i + 1}/${batches.length})…`);
      const res = await embedTexts({
        texts: batch,
        taskType: 'RETRIEVAL_DOCUMENT',
        title: artTitle,
      });
      const data = await parseJson<{ embeddings?: number[][] }>(res, 'embed');
      const got = data.embeddings || [];
      if (got.length !== batch.length) {
        throw new Error(
          `embed: expected ${batch.length} vectors, got ${got.length} — refusing to store a misaligned index`
        );
      }
      // LAW 6. The route already normalizes, but the offline path and any future
      // provider change must not be able to slip an ununit vector past us.
      return got.map((v) => new Float32Array(l2Normalize(v)));
    },
    signal
  );
  return perBatch.flat();
}

/**
 * True when there is no record, or the artifact text moved since it was built.
 *
 * NOTE: an empty `qaPairs` is NOT stale. A note with no body legitimately
 * produces zero Q&A pairs, and treating that as "needs indexing" meant such a
 * note could never count as indexed — the counter was permanently short and no
 * amount of re-running would fix it.
 */
export function isIndexStale(
  indexMap: Map<string, ArtifactSearchIndexRecord>,
  projectId: string,
  art: UniversalArtifactDocument
): boolean {
  void projectId;
  const record = indexMap.get(art.id);
  if (!record) return true;
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
  const { force = false, onProgress, onIndexed, onFailure, signal } = opts;
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
    let failed = false;
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
      onIndexed?.(record);
    } catch (err) {
      // One bad document must not abort the project: report and continue so a
      // single oversized note or a transient 429 leaves the rest indexed.
      if (signal?.aborted) {
        onProgress?.(done, total, 'Stopped');
        return indexMap;
      }
      const message = err instanceof Error ? err.message : String(err);
      failed = true;
      onFailure?.(art.title, message);
      // Do NOT follow this with '— done'. It used to, one line later, which
      // overwrote the only clue the user had about why the count was stuck.
      onProgress?.(done + 1, total, `${art.title} — failed: ${message}`);
    }
    done += 1;
    if (!failed) onProgress?.(done, total, `${art.title} — done`);
    if (done < total) await delay(INTER_ARTIFACT_MS);
  }
  return indexMap;
}
