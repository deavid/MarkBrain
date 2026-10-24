/**
 * draftSearchEngine — the pure scoring core of the draft-proximity testbed.
 *
 * This module never touches the network, IndexedDB, React, or the clock. Given
 * a draft, some artifacts, the cached index records and the live flags, it
 * returns one diagnostic-rich result per artifact so the badge, the folder
 * highlight and the Proximity lens all read from the same numbers.
 *
 * Two questions it exists to answer:
 *   1. "Is the model missing info for this?" — unattached artifacts above
 *      threshold count toward the [+ Attach] badge.
 *   2. "Which retrieval method is actually better here?" — every method's score
 *      and the exact section/Q&A that hit are reported per artifact so David
 *      can flip a flag and watch the ranking move on his own documents.
 */
import type { UniversalArtifactDocument } from '../01-artifact-document';
import { isArtifactArchived } from '../01-artifact-document';
import type { ArtifactSearchIndexRecord, GeneratedQaPair } from '../../services/searchIndexStore';
import type { SearchTestbedConfig } from './searchConfig';
import { DEFAULT_MODEL_SLOTS, getModelForSlot } from '../../data/modelConfig';

/** The embed model legacy (unstamped) records are assumed to have used. */
const DEFAULT_EMBED_MODEL = DEFAULT_MODEL_SLOTS.embed;
import {
  splitArtifactIntoSections,
  sectionSearchText,
  sectionSnippet,
  computeArtifactContentHash,
} from '../../utils/sectionChunker';

export interface ArtifactMatchResult {
  artifactId: string;
  title: string;
  /** Already in this thread's payload (staged OR committed) — never in the badge. */
  isAlreadyAttached: boolean;
  bestScore: number;
  aboveThreshold: boolean;
  winningMethod: MatchMethod | null;
  methodScores: Partial<Record<MatchMethod, number>>;
  matchedSectionHeading?: string;
  matchedSnippet?: string;
  matchedQa?: { question: string; answer: string; sectionHeading: string };
  indexStatus: 'missing' | 'stale' | 'ready';
}

export type MatchMethod = 'ftsSections' | 'ftsQa' | 'vecSections' | 'vecQa';

export interface DraftSearchInput {
  draftText: string;
  /** L2-normalized query vectors, one per clause. Null when no vec flag needs them. */
  clauseVectors: Float32Array[] | null;
  artifacts: UniversalArtifactDocument[];
  indexMap: Map<string, ArtifactSearchIndexRecord>;
  attachedArtifactIds: Set<string>;
  config: SearchTestbedConfig;
}

/* ------------------------------------------------------------------ tokens */

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','else','of','to','in','on','at','for','with','by',
  'from','as','is','are','was','were','be','been','being','it','its','this','that','these','those',
  'i','me','my','we','our','you','your','he','she','they','them','their','what','which','who',
  'whom','whose','when','where','why','how','do','does','did','done','can','could','would',
  'should','shall','will','may','might','must','have','has','had','not','no','yes','some','any',
  'all','more','most','other','into','about','than','too','very','just','also','there','here',
  'so','up','out','over','under','again','further','once','wait','think','want','need','like',
  'get','got','make','made','really','actually','maybe','okay','ok','right','well','thing','things',
]);

const SUFFIXES = ['ing', 'ed', 'es', 'ly', 'tion', 's'];

/**
 * Lowercase, split so `v0.3` survives intact, drop conversational glue, apply a
 * light suffix stemmer so `fluids`~`fluid` and `lighting`~`light`. No porter
 * implementation needed at this corpus size — and none may be imported.
 */
export function tokenizeForFts(text: string): string[] {
  if (!text) return [];
  const raw = text.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
  const out: string[] = [];
  for (const token of raw) {
    if (STOPWORDS.has(token)) continue;
    if (/^\d+(\.\d+)*$/.test(token)) {
      out.push(token);
      continue;
    }
    let stem = token;
    if (token.length >= 5) {
      for (const suffix of SUFFIXES) {
        if (token.length - suffix.length >= 3 && token.endsWith(suffix)) {
          stem = token.slice(0, token.length - suffix.length);
          break;
        }
      }
    }
    out.push(stem);
  }
  return out;
}

/* ------------------------------------------------------------------ clauses */

/**
 * A chat draft is prose, not a query. "…anyway what colour is the spray? and
 * also the fluid thing" has three topics; scoring it as one blob averages them
 * into mush. So we split on sentence/conjunction boundaries, always keep the
 * full draft as a candidate, and the engine takes the max score over clauses.
 */
export function splitDraftIntoClauses(draftText: string, splitClauses: boolean): string[] {
  const trimmed = (draftText || '').trim();
  if (!trimmed) return [];
  if (!splitClauses) return [trimmed];

  const pieces = trimmed
    .split(/[.?!;\n]+|,\s+(?:and|but|also|plus)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const p of pieces) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  unique.push(trimmed);
  return unique.slice(0, 6);
}

/* ------------------------------------------------------------------ BM25 */

const K1 = 1.2;
const B = 0.75;
/**
 * Raw BM25 is divided by (raw + BM25_SCALE) to land in [0,1]. Calibrated so a
 * rare two-term hit clears the 0.55 default while a lone common word does not.
 */
const BM25_SCALE = 3;

export interface Bm25Corpus {
  docFreq: Map<string, number>;
  avgDocLen: number;
  docCount: number;
}

interface TermStats {
  tokens: string[];
  len: number;
  idf(term: string): number;
}

function idfFor(docCount: number, docFreq: number): number {
  // Standard Robertson/Sparck-Jones idf, floored so an unseen-in-corpus term
  // never produces a negative score.
  return Math.log(1 + (docCount - docFreq + 0.5) / (docFreq + 0.5));
}

/**
 * Raw BM25 for one query against one document. Unbounded by design — the
 * caller normalizes, because an unbounded score cannot be compared with a
 * cosine similarity or shown against a 0.55 threshold.
 */
export function scoreBm25(
  queryTokens: string[],
  docStats: TermStats,
  corpus: Bm25Corpus
): { raw: number; matchedTerms: string[]; coverage: number } {
  if (queryTokens.length === 0) return { raw: 0, matchedTerms: [], coverage: 0 };

  const tf = new Map<string, number>();
  for (const t of docStats.tokens) tf.set(t, (tf.get(t) || 0) + 1);

  const uniqueQuery = new Set(queryTokens);
  const matchedTerms: string[] = [];
  let raw = 0;

  for (const q of uniqueQuery) {
    const f = tf.get(q) || 0;
    if (f === 0) continue;
    matchedTerms.push(q);
    const idf = docStats.idf(q);
    const denom = f + K1 * (1 - B + (B * docStats.len) / Math.max(1, corpus.avgDocLen));
    raw += idf * ((f * (K1 + 1)) / denom);
  }

  // Coverage is a PLAIN fraction of query terms that hit — deliberately not
  // IDF-weighted. In a within-artifact corpus a term that is ABSENT scores the
  // highest possible idf (df=0), so weighting the denominator by idf lets the
  // MISSING words dominate and crushes coverage for every partial match.
  const coverage = uniqueQuery.size > 0 ? matchedTerms.length / uniqueQuery.size : 0;
  return { raw, matchedTerms, coverage };
}

/**
 * Map raw BM25 into [0,1] so one threshold can gate lexical and vector scores:
 *   saturation * (0.6 + 0.4 * coverage)
 *
 * Saturation carries the rarity weighting (idf lives inside `raw`); coverage is
 * the plain share of query terms that hit. MULTIPLYING rather than adding is
 * the point: the old `0.55*coverage + 0.45*saturation` made coverage a floor,
 * so a one-term query that hit a single weak word reached coverage=1.0 and
 * cleared the 0.55 threshold on saturation alone.
 *
 * Tests pin this behaviourally: a lone common word lands near 0.10 (below the
 * 0.55 default); two rare query words in one passage land 0.57–0.84 (above it).
 */
export function normalizeBm25(raw: number, coverage: number): number {
  const saturation = raw / (raw + BM25_SCALE);
  const score = saturation * (0.6 + 0.4 * coverage);
  return Math.max(0, Math.min(1, score));
}

/* ------------------------------------------------------------------ vectors */

export function l2Normalize(v: number[] | Float32Array): number[] {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
  const norm = Math.sqrt(sumSq);
  if (norm < 1e-12) return Array.from(v);
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** Both inputs must already be L2-normalized (LAW 6); result clamped to [0,1]. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return Math.max(0, Math.min(1, dot));
}

/* ------------------------------------------------------------------ engine */

/** Sections are re-split on every call otherwise; this is per keystroke. */
const sectionCache = new Map<string, { hash: string; sections: ReturnType<typeof splitArtifactIntoSections> }>();

function cachedSections(art: UniversalArtifactDocument) {
  const hash = computeArtifactContentHash(art);
  const hit = sectionCache.get(art.id);
  if (hit && hit.hash === hash) return hit.sections;
  const sections = splitArtifactIntoSections(art);
  sectionCache.set(art.id, { hash, sections });
  return sections;
}

export function indexStatusFor(
  art: UniversalArtifactDocument,
  indexMap: Map<string, ArtifactSearchIndexRecord>,
  currentEmbedModel?: string
): 'missing' | 'stale' | 'ready' {
  const record = indexMap.get(art.id);
  if (!record || !record.qaPairs.length) return 'missing';
  if (record.contentHash !== computeArtifactContentHash(art)) return 'stale';
  // §3.4: vectors only compare within one embedding model. A record built by a
  // different model is stale, not ready — no quiet cross-model scoring.
  const want = currentEmbedModel ?? DEFAULT_EMBED_MODEL;
  const have = record.embedModel ?? DEFAULT_EMBED_MODEL;
  if (have !== want) return 'stale';
  return 'ready';
}

interface Passage {
  heading: string;
  tokens: string[];
  len: number;
  /** For Q&A passages: the pair itself, so the X-Ray line can print question/answer. */
  qa?: GeneratedQaPair;
  /** For section passages: the snippet to display. */
  snippet: string;
}

function buildCorpus(passages: Passage[]): Bm25Corpus {
  const docFreq = new Map<string, number>();
  let totalLen = 0;
  for (const p of passages) {
    totalLen += p.len;
    for (const t of new Set(p.tokens)) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }
  return {
    docFreq,
    avgDocLen: passages.length ? totalLen / passages.length : 1,
    docCount: passages.length,
  };
}

function toTermStats(p: Passage, corpus: Bm25Corpus): TermStats {
  return {
    tokens: p.tokens,
    len: p.len,
    idf: (term) => idfFor(corpus.docCount, corpus.docFreq.get(term) || 0),
  };
}

/** Best passage score per artifact, with a title/tag hit worth a flat bonus. */
function bestFts(
  clauseTokenLists: string[][],
  passages: Passage[],
  titleTokens: Set<string>,
  boost: number
): { score: number; passage: Passage | null } {
  if (passages.length === 0 || clauseTokenLists.length === 0) return { score: 0, passage: null };

  const corpus = buildCorpus(passages);
  let best = 0;
  let bestPassage: Passage | null = null;

  for (const qTokens of clauseTokenLists) {
    if (qTokens.length === 0) continue;
    let titleHit = false;
    for (const t of new Set(qTokens)) {
      if (titleTokens.has(t)) {
        titleHit = true;
        break;
      }
    }
    for (const p of passages) {
      const stats = toTermStats(p, corpus);
      const { raw, coverage } = scoreBm25(qTokens, stats, corpus);
      let score = normalizeBm25(raw, coverage);
      if (titleHit) score = Math.min(1, score + boost);
      if (score > best) {
        best = score;
        bestPassage = p;
      }
    }
  }
  return { score: best, passage: bestPassage };
}

/**
 * Best (clause, vector) pair. Returns the index, not just the score: the X-Ray
 * line must name the section that ACTUALLY won. Reading only `clauseVectors[0]`
 * reported the first clause's nearest section even when a later clause produced
 * the winning score — wrong whenever `splitClauses` is on, which is the default.
 */
function bestVector(
  clauseVectors: Float32Array[] | null,
  vectors: Float32Array[]
): { score: number; vectorIndex: number } {
  if (!clauseVectors || clauseVectors.length === 0 || vectors.length === 0) {
    return { score: 0, vectorIndex: -1 };
  }
  let best = 0;
  let bestVectorIndex = -1;
  for (const qv of clauseVectors) {
    for (let i = 0; i < vectors.length; i++) {
      const s = cosineSimilarity(qv, vectors[i]);
      if (s > best) {
        best = s;
        bestVectorIndex = i;
      }
    }
  }
  return { score: best, vectorIndex: bestVectorIndex };
}

export function scoreArtifactsAgainstDraft(input: DraftSearchInput): ArtifactMatchResult[] {
  const { draftText, clauseVectors, artifacts, indexMap, attachedArtifactIds, config } = input;
  const results: ArtifactMatchResult[] = [];

  const clauses = splitDraftIntoClauses(draftText, config.splitClauses);
  if (clauses.length === 0) return results;

  const clauseTokenLists = clauses.map(tokenizeForFts).filter((t) => t.length > 0);

  for (const art of artifacts) {
    // Parked notes never suggest themselves — only the cleanup tool touches them.
    if (isArtifactArchived(art)) continue;

    const sections = cachedSections(art);
    const record = indexMap.get(art.id);
    const status = indexStatusFor(art, indexMap, getModelForSlot('embed'));
    const isAlreadyAttached = attachedArtifactIds.has(art.id);

    const titleTokens = new Set(tokenizeForFts(`${art.title} ${(art.tags || []).join(' ')}`));
    const methodScores: Partial<Record<MatchMethod, number>> = {};
    let matchedSectionHeading: string | undefined;
    let matchedSnippet: string | undefined;
    let matchedQa: ArtifactMatchResult['matchedQa'];

    if (config.ftsSections && sections.length > 0) {
      const titleBoostTokens = new Set([
        ...tokenizeForFts(art.title),
        ...(art.tags || []).flatMap((t) => tokenizeForFts(t)),
      ]);
      const passages: Passage[] = sections.map((s) => {
        // `sectionSearchText` omits the title on purpose: injecting it into
        // every body passage makes a title-word query match all of them
        // equally, which flattens the ranking and pads raw for free. The title
        // stays reachable via sec-meta's own text plus bestFts's flat bonus.
        const text = sectionSearchText(s);
        const tokens = tokenizeForFts(text);
        return {
          heading: s.heading,
          tokens,
          len: tokens.length,
          snippet: sectionSnippet(text),
        };
      });
      const { score, passage } = bestFts(clauseTokenLists, passages, titleBoostTokens, 0.12);
      if (score > 0) methodScores.ftsSections = score;
      if (score > 0 && passage) {
        matchedSectionHeading = passage.heading;
        matchedSnippet = passage.snippet;
      }
    }

    if (config.ftsQa && record?.qaPairs.length) {
      const passages: Passage[] = record.qaPairs.map((qa) => {
        // No artifact title here either — same reason as section passages:
        // title-in-every-passage makes all of them tie on a title-word query.
        const text = `${qa.question} ${qa.answer} ${qa.keywords.join(' ')}`;
        const tokens = tokenizeForFts(text);
        return { heading: qa.sectionHeading, tokens, len: tokens.length, qa, snippet: qa.answer };
      });
      const { score, passage } = bestFts(clauseTokenLists, passages, titleTokens, 0.12);
      if (score > 0) methodScores.ftsQa = score;
      if (score > 0 && passage?.qa) {
        matchedQa = {
          question: passage.qa.question,
          answer: passage.qa.answer,
          sectionHeading: passage.qa.sectionHeading,
        };
        matchedSectionHeading = passage.qa.sectionHeading;
        matchedSnippet = sectionSnippet(passage.qa.answer);
      }
    }

    if (config.vecSections && clauseVectors && record?.sectionVectors.length) {
      const { score: v, vectorIndex } = bestVector(clauseVectors, record.sectionVectors);
      if (v > 0) {
        methodScores.vecSections = v;
        // Name the section that won, not the first clause's nearest neighbour.
        if (vectorIndex >= 0 && !matchedSectionHeading) {
          matchedSectionHeading = record.sectionHeadings[vectorIndex];
          matchedSnippet = record.sectionSnippets[vectorIndex];
        }
      }
    }

    if (config.vecQa && clauseVectors && record?.qaVectors.length) {
      const { score: v, vectorIndex } = bestVector(clauseVectors, record.qaVectors);
      if (v > 0) {
        methodScores.vecQa = v;
        if (!matchedQa && vectorIndex >= 0) {
          const qa = record.qaPairs[vectorIndex];
          if (qa) {
            matchedQa = { question: qa.question, answer: qa.answer, sectionHeading: qa.sectionHeading };
            matchedSectionHeading = qa.sectionHeading;
            matchedSnippet = sectionSnippet(qa.answer);
          }
        }
      }
    }

    const entries = Object.entries(methodScores) as Array<[MatchMethod, number]>;
    if (entries.length === 0) continue;
    entries.sort((a, b) => b[1] - a[1]);

    let bestScore = entries[0][1];
    const hasFts = (methodScores.ftsSections ?? 0) >= 0.45 || (methodScores.ftsQa ?? 0) >= 0.45;
    const hasVec = (methodScores.vecSections ?? 0) >= 0.45 || (methodScores.vecQa ?? 0) >= 0.45;
    // Agreement between an independent lexical and vector signal is worth a
    // little more confidence than either alone — capped so it can't buy a miss.
    if (hasFts && hasVec) bestScore = Math.min(1, bestScore + 0.05);

    results.push({
      artifactId: art.id,
      title: art.title,
      isAlreadyAttached,
      bestScore,
      aboveThreshold: bestScore >= config.threshold,
      winningMethod: entries[0][0],
      methodScores,
      matchedSectionHeading,
      matchedSnippet,
      matchedQa,
      indexStatus: status,
    });
  }

  results.sort((a, b) => b.bestScore - a.bestScore);
  return results;
}

/** The number that lands on the [+ Attach] badge. Archived/attached never count. */
export function countMissingMatches(results: ArtifactMatchResult[]): number {
  return results.filter((r) => !r.isAlreadyAttached && r.aboveThreshold).length;
}
