/** Shared chapter-window selectors. Chapters are `[startIndex, endIndex)` windows over the turn list, never owners of embedded turns. */
import type { Turn } from '../01-dialogue-timeline/types';
import type { ChapterPartition } from './types';
import { Granularity, cutIncludes, normalizeGranularity } from '../granularity';

export interface ChapterTurns {
  chapter: ChapterPartition;
  index: number;
  /**
   * Still capturing turns: `status === 'active'` OR the last chapter of the
   * list (the trailing chapter always runs to the latest turn).
   */
  ongoing: boolean;
  granularity: Granularity;
  turns: Turn[];
}

export interface TimelineSliceReader {
  getTurnSlice(startIndex: number, endIndex?: number): Turn[];
}

export interface SegmentationReader {
  listChapters(): ChapterPartition[];
}

/**
 * THE window rule — `active` OR last in the list. Purely geometric: it says
 * which turns a chapter owns, NOT how much of them is sent.
 */
export function isChapterOngoing(chapters: readonly ChapterPartition[], index: number): boolean {
  const chapter = chapters[index];
  if (!chapter) return false;
  return chapter.status === 'active' || index === chapters.length - 1;
}

/**
 * THE chapter granularity rule — explicit choice wins; otherwise the default
 * follows the window (open → full, closed → summary).
 */
export function resolveChapterGranularity(
  chapter: ChapterPartition,
  ongoing: boolean
): Granularity {
  if (chapter.granularity) return normalizeGranularity(chapter.granularity);
  return ongoing ? 'full' : 'summary';
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

/**
 * Which layers of a chapter's cut are present (the compiler builds XML from
 * this so its shape and the UI preview cannot disagree).
 */
export function chapterCutIncludes(
  chapters: readonly ChapterPartition[],
  index: number
): { description: boolean; summary: boolean; turns: boolean } {
  const chapter = chapters[index];
  const granularity = resolveChapterGranularity(chapter, isChapterOngoing(chapters, index));
  return {
    description: cutIncludes(granularity, 'description'),
    summary: cutIncludes(granularity, 'summary'),
    turns: cutIncludes(granularity, 'body'),
  };
}

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
        granularity: resolveChapterGranularity(chapter, ongoing),
        turns: timeline.getTurnSlice(chapter.startIndex, ongoing ? undefined : chapter.endIndex),
      };
    });
  }
  // Synthesize a genesis window when no chapters exist so the chat surface stays usable.
  return [
    {
      chapter: {
        id: GENESIS_CHAPTER_ID,
        workspaceId,
        title: 'Genesis Chapter',
        description: '',
        summary: '',
        granularity: 'full',
        status: 'active',
        startIndex: 0,
        createdAt: Date.now(),
      },
      index: 0,
      ongoing: true,
      granularity: 'full',
      turns: timeline.getTurnSlice(0, undefined),
    },
  ];
}
