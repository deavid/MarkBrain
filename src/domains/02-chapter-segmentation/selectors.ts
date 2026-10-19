/**
 * Chapter ↔ turns selectors — the ONE place the "chapter with its turns"
 * view is derived, and the ONE ongoing rule (it used to be duplicated in
 * three consumers).
 *
 * Selectors derive views over domain types; they are not a second type
 * system. A chapter is a WINDOW (startIndex/endIndex) over the turn list,
 * never an owner of embedded messages — the seam toolkit (move/split/merge)
 * operates on windows (requirement §4.13).
 */
import type { Turn } from '../01-dialogue-timeline/types';
import type { ChapterPartition } from './types';

/** A chapter paired with the turns inside its window — derived, not stored. */
export interface ChapterTurns {
  chapter: ChapterPartition;
  index: number;
  /**
   * Still capturing turns: `status === 'active'` OR the last chapter of the
   * list (the trailing chapter always runs to the latest turn).
   */
  ongoing: boolean;
  turns: Turn[];
}

/** Minimal timeline surface the grouping needs (the domain satisfies it). */
export interface TimelineSliceReader {
  getTurnSlice(startIndex: number, endIndex?: number): Turn[];
}

/** Minimal segmentation surface the grouping needs (the domain satisfies it). */
export interface SegmentationReader {
  listChapters(): ChapterPartition[];
}

/** THE ongoing rule — `active` OR last in the list. */
export function isChapterOngoing(chapters: readonly ChapterPartition[], index: number): boolean {
  const chapter = chapters[index];
  if (!chapter) return false;
  return chapter.status === 'active' || index === chapters.length - 1;
}

/**
 * Turn window for a chapter — an ongoing chapter runs to the latest turn
 * (endIndex ignored); a closed one stops at its endIndex.
 */
export function sliceChapterTurns<T>(
  turns: readonly T[],
  chapter: ChapterPartition,
  ongoing: boolean
): T[] {
  return turns.slice(chapter.startIndex, ongoing ? undefined : chapter.endIndex) as T[];
}

/** Synthesized window when no chapter is registered (chat surface stays usable). */
export const GENESIS_CHAPTER_ID = 'chap-genesis';

/**
 * Chapters with their turns — the shared "chapter with its messages"
 * selector every screen uses (ChatView, MirrorPanel, export).
 */
export function groupTurnsByChapter(
  timeline: TimelineSliceReader,
  segmentation: SegmentationReader,
  workspaceId = ''
): ChapterTurns[] {
  const chapters = segmentation.listChapters();
  if (chapters.length > 0) {
    return chapters.map((chapter, index) => {
      const ongoing = isChapterOngoing(chapters, index);
      return {
        chapter,
        index,
        ongoing,
        turns: timeline.getTurnSlice(chapter.startIndex, ongoing ? undefined : chapter.endIndex),
      };
    });
  }
  // No registered chapters — synthesize a genesis window over the whole
  // timeline so the chat surface is never hidden (was the projection's guard).
  return [
    {
      chapter: {
        id: GENESIS_CHAPTER_ID,
        workspaceId,
        title: 'Genesis Chapter',
        summary: '',
        keyPoints: [],
        status: 'active',
        startIndex: 0,
        createdAt: Date.now(),
      },
      index: 0,
      ongoing: true,
      turns: timeline.getTurnSlice(0, undefined),
    },
  ];
}
