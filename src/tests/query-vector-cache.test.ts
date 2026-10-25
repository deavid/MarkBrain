/**
 * Near-duplicate query rejection.
 *
 * The exact-match cache only caught byte-identical text. The expensive case is
 * the almost-identical one: two spellings of the same question each cost an
 * embed call, and on a 1,000-request/day budget that is real money for a
 * rounding error. This file pins both halves of the rule:
 *
 *   - near-identical text REUSES the vectors (and says so)
 *   - genuinely different text does NOT — one embed is cheaper than a wrong answer
 */
import { describe, it, expect } from 'vitest';
import {
  QueryVectorCache,
  textSimilarity,
  NEAR_MATCH_THRESHOLD,
  QUERY_CACHE_CAP,
} from '../domains/search/queryVectorCache';

const vecs = (n: number) => Array.from({ length: n }, () => new Float32Array([1, 0]));

describe('textSimilarity', () => {
  it('is 1 for the same text, ignoring case and punctuation', () => {
    expect(textSimilarity('the red torch light.', 'The RED torch light!')).toBe(1);
    expect(textSimilarity('a  b', 'a b')).toBe(1);
  });

  it('is 0 for nothing shared', () => {
    expect(textSimilarity('alpha beta', 'gamma delta')).toBeLessThan(0.1);
  });

  it('rates a rewording as clearly similar but not identical', () => {
    const s = textSimilarity(
      'tell me about the flashlight evidence',
      'tell me about the flashlight evidences'
    );
    expect(s).toBeGreaterThan(0.9);
    expect(s).toBeLessThan(1);
  });

  it('rates different questions as far apart', () => {
    const s = textSimilarity(
      'how do fluids tile in three dimensions',
      'what is the capital of the old kingdom'
    );
    expect(s).toBeLessThan(NEAR_MATCH_THRESHOLD);
  });
});

describe('QueryVectorCache', () => {
  it('reuses the vectors for an exact match and reports it', () => {
    const c = new QueryVectorCache();
    c.set('the flashlight evidence', vecs(1));
    const hit = c.get('the flashlight evidence');
    expect(hit?.match).toBe('exact');
    expect(hit?.similarity).toBe(1);
  });

  it('reuses vectors for a near match, naming the text it came from', () => {
    // 'lights' vs 'light' scores 0.98 — same question, one keystroke apart.
    // (A trailing period is NOT a near match: the normalizer already eats it,
    // so that lands on the exact-match path and is covered above.)
    const c = new QueryVectorCache();
    c.set('the flashlight and the evidence for the red torch light', vecs(1));
    const hit = c.get('the flashlight and the evidence for the red torch lights');
    expect(hit?.match).toBe('near');
    expect(hit?.similarity).toBeGreaterThanOrEqual(NEAR_MATCH_THRESHOLD);
    expect(hit?.sourceText).toBe('the flashlight and the evidence for the red torch light');
  });

  it('refuses to reuse for a genuinely different question', () => {
    const c = new QueryVectorCache();
    c.set('how do fluids tile in three dimensions', vecs(1));
    expect(c.get('what is the capital of the old kingdom')).toBeNull();
  });

  it('prefers the exact match over a merely similar one', () => {
    const c = new QueryVectorCache();
    c.set('alpha beta gamma', vecs(1));
    c.set('alpha beta delta', vecs(2));
    const hit = c.get('alpha beta gamma');
    expect(hit?.match).toBe('exact');
    expect(hit?.vectors.length).toBe(1);
  });

  it('picks the CLOSEST candidate above the threshold', () => {
    const c = new QueryVectorCache();
    c.set('the flashlight evidence for the red torch', vecs(1));
    c.set('the flashlight evidence for the red torch light', vecs(2));
    const hit = c.get('the flashlight evidence for the red torch light!');
    expect(hit?.vectors.length).toBe(2);
  });

  it('evicts the oldest once over the cap, and only the newest few', () => {
    const c = new QueryVectorCache(3);
    for (const t of ['one alpha', 'two beta', 'three gamma', 'four delta']) c.set(t, vecs(1));
    expect(c.size()).toBe(3);
    expect(c.list().map((e) => e.text)).toEqual(['four delta', 'three gamma', 'two beta']);
    expect(c.get('one alpha')).toBeNull();
  });

  it('defaults to a small window on purpose', () => {
    // A long memory would reuse a vector for a question you are no longer
    // asking. Small and recent is the safe shape.
    expect(QUERY_CACHE_CAP).toBeLessThanOrEqual(10);
  });

  it('does not store empty text or empty vectors', () => {
    const c = new QueryVectorCache();
    c.set('', vecs(1));
    c.set('real text', []);
    expect(c.size()).toBe(0);
  });

  it('counts reuses so the inspector can show what it saved', () => {
    const c = new QueryVectorCache();
    c.set('the flashlight evidence', vecs(1));
    c.get('the flashlight evidence');
    c.get('the flashlight evidence.');
    expect(c.list()[0].reuses).toBe(2);
  });

  it('re-embedding the same text replaces rather than duplicates', () => {
    const c = new QueryVectorCache();
    c.set('the flashlight evidence', vecs(1));
    c.set('the flashlight evidence', vecs(2));
    expect(c.size()).toBe(1);
    expect(c.get('the flashlight evidence')?.vectors.length).toBe(2);
  });
});

describe('one character is always the same query (the short-query cliff)', () => {
  it('a letter added to a SHORT query reuses — the 0.95 Dice cliff must not fire', () => {
    const q = new QueryVectorCache();
    const short = 'red torch light';
    q.set(short, [new Float32Array([1, 0])]);
    const hit = q.get('red torch lights');
    expect(hit).not.toBeNull();
    expect(hit!.match).toBe('near');
  });

  it('a letter added to a long query still reuses', () => {
    const q = new QueryVectorCache();
    const long = 'the flashlight and the evidence for the red torch light in the corridor';
    q.set(long, [new Float32Array([1, 0])]);
    expect(q.get(long + 's')).not.toBeNull();
  });

  it('a genuinely different question still pays', () => {
    const q = new QueryVectorCache();
    q.set('red torch light', [new Float32Array([1, 0])]);
    expect(q.get('how do I migrate the storage provider')).toBeNull();
  });
});
