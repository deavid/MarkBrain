/**
 * THE token estimator — one implementation for the whole app.
 *
 * ~3.8 chars per token for code & technical text. Lives in `shared/` so the
 * turn-commit planner (shared), the client compiler (src) and every UI badge
 * measure with the SAME rule; `src/utils/estimateTokens.ts` re-exports this,
 * so every existing client import is unchanged. The server keeps its own copy
 * in server/lib/tokens.ts (different runtime — legitimate, not duplication).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}
