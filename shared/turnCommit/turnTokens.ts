/**
 * Cached per-turn prompt-token reads (design-docs/31 §3.4 + Phase 1.1).
 *
 * The commit planner stamps `meta.contentTokens` on EVERY turn it writes
 * (user and assistant), measured on the exact text the compiler would later
 * send. Readers — `estimateChapterCutTokens`, `OpticalCompilerDomain.compile`,
 * the chapter-cap evaluator — go through `turnPromptTokens` so re-renders and
 * streaming ticks do integer sums over cached numbers instead of regex-
 * stripping and re-estimating thousands of historical turn strings.
 *
 * Turns written before this field existed (or by import paths) fall back to
 * estimating on the fly — the number stays correct, only the cache is missed.
 */
import type { Turn } from '../types/timeline';
import { compileTurnContentForPrompt } from '../stream/compilerStub';
import { estimateTokens } from '../estimateTokens';

/** The cached per-turn count, or an on-the-fly estimate when absent. */
export function turnPromptTokens(t: Turn): number {
  const cached = t.meta?.contentTokens;
  if (typeof cached === 'number' && Number.isFinite(cached) && cached >= 0) return cached;
  return estimateTokens(promptTextOf(t));
}

/** The exact text the compiler would send for this turn (cached per object). */
export function promptTextOf(t: Turn): string {
  return t.role === 'assistant' ? compileTurnContentForPrompt(t.content) : t.content;
}

/**
 * Compiled-past-turn memoization (session-only, WeakMap on the turn object).
 *
 * `chapterXml` re-runs `compileTurnContentForPrompt` over every historical
 * turn on every compile — an O(all turns) regex pass per stream chunk. Past
 * turns are immutable, so their compiled text is stable: cache it on the
 * turn OBJECT (never in meta — this is session state, not persisted data).
 */
const compiledCache = new WeakMap<Turn, string>();

/** Compiled-for-prompt text of a past turn, memoized per turn object. */
export function compiledTurnText(t: Turn): string {
  let text = compiledCache.get(t);
  if (text === undefined) {
    text = promptTextOf(t);
    compiledCache.set(t, text);
  }
  return text;
}
