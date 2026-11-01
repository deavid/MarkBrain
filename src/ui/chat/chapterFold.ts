/**
 * Long-chat Phase 1.2 (design-docs/31 §3.1 + BUGS/LONG_CHAT_PHASE_1_2_PLAN.md
 * §1.2, Appendix A.3): the DEFAULT-FOLD rule and the cap on simultaneously
 * open Full chapters, as PURE functions so they are unit-testable without a
 * DOM.
 *
 * Folding is a UI-view decision ONLY — it never touches what
 * OpticalCompilerDomain sends (that is governed by the chapter cut alone).
 */
import type { ChapterPartition } from '../../types';
import { isChapterOngoing, resolveChapterGranularity } from '../../domains/02-chapter-segmentation';

/** How many Full-granularity chapters may be unfolded at once. */
export const MAX_OPEN_FULL_CHAPTERS = 3;

/**
 * How many turns of an expanded Full chapter mount at once (Phase 1.3): the
 * most recent window mounts first, earlier turns load upward on demand. Pure
 * UI view state — the compiler always sees the whole chapter.
 */
export const CHAPTER_TURN_WINDOW_STEP = 40;

/**
 * The default collapsed state for a chapter the user has never toggled.
 *
 * - The last 2 chapters (active + immediately preceding) always start
 *   unfolded — they are the live conversation.
 * - Older chapters at `full` granularity start folded: their turns are the
 *   only DOM explosion risk, so they mount zero bubbles until opened.
 * - Older chapters at summary/description/title keep their compact layers
 *   visible (they mount no MessageBubbles at all — see ChapterSection).
 */
export function defaultChapterCollapsed(chapters: ChapterPartition[], index: number): boolean {
  const chapter = chapters[index];
  if (!chapter) return false;
  if (index >= chapters.length - 2) return false;
  return resolveChapterGranularity(chapter) === 'full';
}

export interface EvictOpenFullParams {
  /** The thread's chapters, in order. */
  chapters: ChapterPartition[];
  /** Chapter ids in the order the user opened them, oldest first. */
  openOrder: string[];
  /** Current collapsed map (id → user-set collapsed state). */
  collapsed: Record<string, boolean>;
}

/**
 * The eviction rule: when more than MAX_OPEN_FULL_CHAPTERS Full chapters are
 * unfolded, fold the least-recently-opened NON-ONGOING one. The active/last
 * chapter is never auto-folded, and chapters the user explicitly folded are
 * already out of the count.
 *
 * Returns the id to fold, or null when the count is within the cap.
 */
export function evictOpenFullChapter(params: EvictOpenFullParams): string | null {
  const { chapters, openOrder, collapsed } = params;
  const openFull: string[] = [];
  chapters.forEach((c, idx) => {
    const effective = resolveChapterGranularity(c);
    if (effective !== 'full') return;
    if (collapsed[c.id]) return;
    openFull.push(c.id);
  });
  if (openFull.length <= MAX_OPEN_FULL_CHAPTERS) return null;

  const isOngoing = (id: string): boolean => {
    const idx = chapters.findIndex((c) => c.id === id);
    return idx !== -1 && isChapterOngoing(chapters, idx);
  };
  // Oldest first, skipping the ongoing chapter and anything already folded.
  for (const id of openOrder) {
    if (!openFull.includes(id)) continue;
    if (isOngoing(id)) continue;
    return id;
  }
  // Order map incomplete (e.g. hydrated state): fall back to the oldest
  // non-ongoing open Full chapter by list position.
  for (const id of openFull) {
    if (!isOngoing(id)) return id;
  }
  return null;
}
