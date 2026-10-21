/**
 * The one model window this app compiles for, and the one fill curve that shows
 * "how full it is". Both used to live in different files with different values
 * (a 32k ceiling hardcoded in five places, 1M only on the rail), so the mirror
 * could report 73,420 against 32,000 while the rail measured against 1M.
 */

export const MAX_CONTEXT_TOKENS = 1_000_000;

/**
 * `cbrt(fraction)` for any fill that reports a budget: a linear bar reads empty
 * for the first 100k tokens of a 1M window, and the right-edge rail already
 * used this curve. 1k → 10%, 8k → 20%, 125k → 50%, 1M → 100%.
 */
export function saturationFillFraction(tokens: number, ceiling = MAX_CONTEXT_TOKENS): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.min(1, Math.cbrt(Math.min(1, tokens / Math.max(1, ceiling))));
}

export function saturationFillPct(tokens: number, ceiling = MAX_CONTEXT_TOKENS): number {
  return saturationFillFraction(tokens, ceiling) * 100;
}
