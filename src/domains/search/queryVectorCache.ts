/**
 * Query-vector cache with near-duplicate rejection.
 *
 * The exact-match cache stopped identical text from re-embedding, but the
 * expensive case is the *almost* identical one: "the flashlight and the
 * evidence for the red torch light" and "the flashlight and the evidence for
 * the red torch light." are different keys and would each cost an embed call.
 * On a 1,000-request/day budget that is real money for a rounding error.
 *
 * We cannot compare vectors before we have them — that is the chicken and egg —
 * so the comparison is on TEXT: character-trigram Dice over the normalized
 * string. Trigrams because they survive punctuation, casing and whitespace
 * (which is most of what changes) and still notice a reworded clause.
 *
 * The ring buffer is deliberately small (the last handful of queries). A query
 * is a live thing: what you typed ten minutes ago is not what you mean now, so
 * a long memory would silently reuse a vector for a question you are no longer
 * asking. Small and recent is the safe shape.
 */

/** How many past queries to remember. Small on purpose — see the header. */
export const QUERY_CACHE_CAP = 8;

/**
 * Similarity at or above this is "the same query, typed differently".
 *
 * 0.95 rather than a literal 0.99: at 0.99 you only catch whitespace and
 * punctuation, which the normalizer already handles. 0.95 still catches a
 * stray word or a typo, and the vectors for those are within noise of each
 * other. Below this we pay for a real embed rather than guess.
 */
export const NEAR_MATCH_THRESHOLD = 0.95;

function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Character trigrams, padded so the edges of the string count too. */
function trigrams(text: string): Set<string> {
  const t = `  ${normalize(text)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

/** Dice coefficient over trigrams: 1 = identical, 0 = nothing shared. */
export function textSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared += 1;
  return (2 * shared) / (A.size + B.size);
}

/** Levenshtein distance over the normalized text (small strings only — the
 *  inputs here are queries, not documents). */
export function editDistance(a: string, b: string): number {
  const s = normalize(a);
  const t = normalize(b);
  if (s === t) return 0;
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * The same query, typed differently.
 *
 * Two shapes qualify, because one threshold cannot cover both:
 *  - ONE character of difference is always the same query (a typo, a letter
 *    you added, a stray dot). This is the case a percentage misses on short
 *    queries: 1 char in 12 is an 8% change — Dice ~0.8, which is exactly why
 *    short queries kept re-embedding.
 *  - OR ≥95% similar (trigram Dice): catches whitespace/casing noise and the
 *    odd stray word on longer queries.
 */
export function isNearDuplicate(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (editDistance(na, nb) <= 1) return true;
  return textSimilarity(a, b) >= NEAR_MATCH_THRESHOLD;
}

export interface QueryCacheHit {
  vectors: Float32Array[];
  /** 'exact' = same text. 'near' = close enough to reuse on purpose. */
  match: 'exact' | 'near';
  /** 1 for exact; otherwise the Dice score that justified the reuse. */
  similarity: number;
  /** The text the vectors were actually computed from. */
  sourceText: string;
}

export interface QueryCacheEntry {
  text: string;
  vectors: Float32Array[];
  at: number;
  /** How many times this entry has been reused instead of re-embedded. */
  reuses: number;
}

export class QueryVectorCache {
  private entries: QueryCacheEntry[] = [];

  constructor(
    private readonly cap: number = QUERY_CACHE_CAP,
    private readonly threshold: number = NEAR_MATCH_THRESHOLD
  ) {}

  /**
   * Look up a query. Returns the EXACT match first; only then falls back to a
   * near match. Never returns a hit below the threshold — better to spend one
   * embed than to score a query against someone else's vector.
   */
  get(text: string): QueryCacheHit | null {
    const key = normalize(text);
    if (!key) return null;

    for (const e of this.entries) {
      if (normalize(e.text) === key) {
        e.reuses += 1;
        return { vectors: e.vectors, match: 'exact', similarity: 1, sourceText: e.text };
      }
    }

    let best: { entry: QueryCacheEntry; score: number } | null = null;
    for (const e of this.entries) {
      if (!isNearDuplicate(text, e.text)) continue;
      const score = textSimilarity(text, e.text);
      if (!best || score > best.score) best = { entry: e, score };
    }
    if (best) {
      best.entry.reuses += 1;
      return {
        vectors: best.entry.vectors,
        match: 'near',
        similarity: best.score,
        sourceText: best.entry.text,
      };
    }
    return null;
  }

  set(text: string, vectors: Float32Array[]): void {
    const key = normalize(text);
    if (!key || vectors.length === 0) return;
    // Replace rather than duplicate when the same text is embedded again.
    this.entries = this.entries.filter((e) => normalize(e.text) !== key);
    this.entries.push({ text, vectors, at: Date.now(), reuses: 0 });
    // Newest last; evict from the front once over the cap.
    while (this.entries.length > this.cap) this.entries.shift();
  }

  /** Newest first — for the inspector, so the user can see what we compared. */
  list(): QueryCacheEntry[] {
    return [...this.entries].reverse();
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }
}
