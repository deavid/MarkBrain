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
/**
 * The embed route accepts 80 strings per request. We were sending 50 "to leave
 * headroom", which just meant 37.5% more requests — and requests are the ONLY
 * thing the free tier meters (1,000/day). Pack to the cap.
 */
const EMBED_BATCH = 80;
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
      const body = (await res.json()) as {
        error?: string;
        quota?: { message?: string; hint?: string };
      };
      // Prefer the server's human explanation over the raw SDK dump. A 429
      // means one of TWO different budgets — say which, or the user just sees
      // a counter that refuses to move.
      if (body?.quota?.message) {
        // Self-describing: no `embed:` prefix in front of a sentence that
        // already says which budget ran out.
        const full = `${body.quota.message}${body.quota.hint ? ` — ${body.quota.hint}` : ''}`;
        throw new Error(full);
      }
      if (body?.error) detail = body.error;
    } catch (e) {
      if (e instanceof Error && /quota exhausted/i.test(e.message)) throw e;
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
  signal?: IndexAbortSignal,
  /**
   * The record this note already has, if any. When its contentHash still
   * matches, the stages it completed are REUSED and only the missing ones are
   * bought. With a 1,000-request/day embed quota, re-paying for vectors we
   * already have is the difference between finishing a library and not.
   */
  prior?: ArtifactSearchIndexRecord
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

    // Only a record for THIS exact text is worth resuming from. Anything else
    // is a fresh start, because the vectors are for a different document.
    const resumable =
      prior && prior.contentHash === contentHash ? prior : undefined;
    const had = resumable ? recordStages(resumable) : null;
    if (had) {
      report(
        `Resuming — already have ` +
          [
            had.sectionsEmbedded ? 'section vectors' : null,
            had.qaGenerated ? 'Q&A' : null,
            had.qaEmbedded ? 'Q&A vectors' : null,
          ]
            .filter(Boolean)
            .join(', ')
      );
    }

    const base = {
      key: searchIndexKey(projectId, art.id),
      projectId,
      artifactId: art.id,
      contentHash,
      updatedAt: Date.now(),
      sectionIds: sections.map((s) => s.id),
      sectionHeadings: sections.map((s) => s.heading),
      sectionSnippets: sections.map((s) => s.text.replace(/\s+/g, ' ').trim().slice(0, 220)),
    };

    // Persist after EVERY stage. A run that dies at 40% must leave 40% behind —
    // throwing it away is what made a 24-note library cost 1,000 embed requests.
    const save = (patch: Partial<ArtifactSearchIndexRecord>): Promise<ArtifactSearchIndexRecord> => {
      const record: ArtifactSearchIndexRecord = {
        qaPairs: [],
        sectionVectors: [],
        qaVectors: [],
        stages: {
          sectionsEmbedded: false,
          qaGenerated: false,
          qaEmbedded: false,
          ...(resumable?.stages ?? {}),
        },
        ...base,
        ...patch,
      };
      record.updatedAt = Date.now();
      return saveArtifactSearchIndex(record).then(() => record);
    };

    // --- Q&A and section vectors, overlapped, each skipping what is done -----
    // A window's Q&A does not need the section vectors and vice versa: different
    // endpoints, no shared input. Overlapping is the latency win; skipping is
    // the quota win.
    const windows = qaWindows(sections);
    const sectionTexts = sections.map((s) =>
      sectionEmbeddingText(art.title, s, s.id === 'sec-meta')
    );
    const needQa = !had?.qaGenerated;
    const needSections = !had?.sectionsEmbedded;

    const [windowQa, sectionVectors] = await Promise.all([
      needQa
        ? mapLimit(
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
          )
        : Promise.resolve([]),
      needSections
        ? (async () => {
            report(`Embedding ${sections.length} sections…`);
            return embedAll(sectionTexts, art.title, 'sections', report, signal);
          })()
        : Promise.resolve(resumable!.sectionVectors),
    ]);

    // Renumber AFTER the fan-out. The route numbers within one window only, and
    // ids must stay unique and in document order when windows are concatenated.
    const qaPairs: GeneratedQaPair[] = needQa
      ? (() => {
          const out: GeneratedQaPair[] = [];
          for (const list of windowQa as GeneratedQaPair[][]) {
            for (const qa of list) out.push({ ...qa, id: `qa-${out.length}` });
          }
          return out;
        })()
      : resumable!.qaPairs;

    const afterQa = await save({
      qaPairs,
      sectionVectors,
      qaVectors: resumable?.qaVectors ?? [],
      stages: {
        sectionsEmbedded: !needSections || sectionVectors.length > 0,
        qaGenerated: !needQa,
        qaEmbedded: resumable?.stages?.qaEmbedded ?? false,
      },
    });
    report(`Saved progress (Q&A ${afterQa.qaPairs.length}, sections ${afterQa.sectionVectors.length})`);
    checkAbort();

    // --- Q&A vectors ----------------------------------------------------------
    const needQaVec = !had?.qaEmbedded && qaPairs.length > 0;
    let qaVectors: Float32Array[] = resumable?.qaVectors ?? [];
    if (needQaVec) {
      report(`Embedding ${qaPairs.length} Q&A pairs…`);
      const qaTexts = qaPairs.map(
        (qa) =>
          `${art.title} (${qa.sectionHeading}) — Q: ${qa.question}\n` +
          `A: ${qa.answer}\nKeywords: ${qa.keywords.join(', ')}`
      );
      qaVectors = await embedAll(qaTexts, art.title, 'Q&A pairs', report, signal);
    }
    checkAbort();

    const record = await save({
      qaPairs,
      sectionVectors,
      qaVectors,
      stages: {
        sectionsEmbedded: true,
        qaGenerated: true,
        qaEmbedded: qaPairs.length === 0 || qaVectors.length > 0,
      },
    });
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
  if (record.contentHash !== computeArtifactContentHash(art)) return true;
  // A record that only got halfway IS stale — but stale to RESUME, not to
  // restart. Leaving it fresh-looking would strand the embedded vectors with no
  // Q&A forever; leaving it absent made every attempt repay the whole embed
  // budget, which is what burned 1,000 requests on 24 notes.
  return !recordStages(record).complete;
}

/**
 * Which stages of a record have actually landed.
 *
 * Absent = a legacy record written before stages existed, and those were always
 * written only on full success — so treat them as complete.
 */
export function recordStages(rec: ArtifactSearchIndexRecord): {
  sectionsEmbedded: boolean;
  qaGenerated: boolean;
  qaEmbedded: boolean;
  complete: boolean;
} {
  const s = rec.stages ?? {
    sectionsEmbedded: rec.sectionVectors.length > 0,
    qaGenerated: rec.qaPairs.length > 0,
    qaEmbedded: rec.qaVectors.length > 0,
  };
  return { ...s, complete: s.sectionsEmbedded && s.qaGenerated && s.qaEmbedded };
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
        signal,
        indexMap.get(art.id)
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
