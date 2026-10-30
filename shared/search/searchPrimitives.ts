/**
 * Search primitives shared by the draft-search engine (client) and the server
 * search-index route: pure text/score math, no imports, no environment.
 */

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

/** Both inputs must already be L2-normalized (LAW 6); result clamped to [0,1]. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return Math.max(0, Math.min(1, dot));
}
