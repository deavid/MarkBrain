/**
 * Chapter token caps (design-docs/31 §3.2, Phase 2.1).
 *
 * Soft cap at 64k tokens: a visible nudge plus the Auto-Split affordance.
 * Hard cap at 128k tokens: sends block, but with a small grace of 2 USER
 * turns so the exchange the user is mid-way through can finish.
 *
 * The evaluator is 100% PURE — a function of the chapter's turns alone. No
 * database columns, no mutable counters that reset on reload: the grace state
 * is DERIVED from where the turn list crossed the line, so it survives every
 * restart, sync and import by construction.
 */
import type { Turn } from '../01-dialogue-timeline/types';
import { turnPromptTokens } from '../../../shared/turnCommit/turnTokens';

export const CHAPTER_SOFT_CAP_TOKENS = 64_000;
export const CHAPTER_HARD_CAP_TOKENS = 128_000;
/** User turns allowed AFTER the chapter first crosses the hard cap. */
export const CHAPTER_HARD_CAP_GRACE_TURNS = 2;

export interface ChapterCapStatus {
  totalTokens: number;
  status: 'ok' | 'soft-cap' | 'grace' | 'hard-blocked';
  /** Remaining sends allowed after crossing 128k (2 → 1 → 0). */
  graceSendsRemaining: number;
}

/**
 * Walk the chapter's turns in order, accumulating each turn's prompt-token
 * cost (cached `meta.contentTokens` first, on-the-fly estimate otherwise —
 * see `turnPromptTokens`). The status follows from where the walk crossed
 * the hard line and how many user turns landed after that point.
 */
export function evaluateChapterTokenCap(turns: Turn[]): ChapterCapStatus {
  let totalTokens = 0;
  let crossedHardCapAtTurnIdx = -1;
  for (let i = 0; i < turns.length; i++) {
    totalTokens += turnPromptTokens(turns[i]);
    if (crossedHardCapAtTurnIdx === -1 && totalTokens >= CHAPTER_HARD_CAP_TOKENS) {
      crossedHardCapAtTurnIdx = i;
    }
  }

  if (totalTokens < CHAPTER_SOFT_CAP_TOKENS) {
    return { totalTokens, status: 'ok', graceSendsRemaining: CHAPTER_HARD_CAP_GRACE_TURNS };
  }
  if (totalTokens < CHAPTER_HARD_CAP_TOKENS) {
    return { totalTokens, status: 'soft-cap', graceSendsRemaining: CHAPTER_HARD_CAP_GRACE_TURNS };
  }

  let graceUserTurnsUsed = 0;
  if (crossedHardCapAtTurnIdx !== -1) {
    for (let i = crossedHardCapAtTurnIdx + 1; i < turns.length; i++) {
      if (turns[i].role === 'user') graceUserTurnsUsed++;
    }
  }
  if (graceUserTurnsUsed < CHAPTER_HARD_CAP_GRACE_TURNS) {
    return {
      totalTokens,
      status: 'grace',
      graceSendsRemaining: CHAPTER_HARD_CAP_GRACE_TURNS - graceUserTurnsUsed,
    };
  }
  return { totalTokens, status: 'hard-blocked', graceSendsRemaining: 0 };
}
