/**
 * THE client-side token estimator — one implementation for the whole client.
 *
 * ~3.8 chars per token for code & technical text. Everything that estimates
 * tokens on the client (mirror rows, compiler totals, import previews, abort
 * fallbacks) imports THIS so the mirror cannot disagree with the compiler.
 * The server keeps its own copy in server/lib/tokens.ts (different runtime —
 * legitimate, not duplication).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}
