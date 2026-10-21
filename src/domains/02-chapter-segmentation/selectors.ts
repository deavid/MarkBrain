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
 * How many trailing chapters count as still-live. Their cut is forced to Full
 * and their cut controls are hidden: a chapter you are still talking inside is
 * not something to summarize, and a cut would promise layers nobody wrote.
 */
export const IN_PROGRESS_CHAPTERS = 2;

/**
 * In-progress = the last `IN_PROGRESS_CHAPTERS` chapters of the list, or the
 * active one. Unlike `isChapterOngoing` (geometry: which turns a chapter
 * OWNS), this is a send law: it forces Full and hides the controls. It must
 * never change turn slicing — a sealed chapter still stops at its endIndex.
 */
export function isChapterInProgress(
  chapters: readonly ChapterPartition[],
  index: number
): boolean {
  const chapter = chapters[index];
  if (!chapter) return false;
  if (chapter.status === 'active') return true;
  return index >= chapters.length - IN_PROGRESS_CHAPTERS;
}

/** The cut the payload carries: an in-progress chapter is always Full. */
export function resolveChapterSendGranularity(
  chapters: readonly ChapterPartition[],
  index: number
): Granularity {
  const chapter = chapters[index];
  if (!chapter) return 'full';
  if (isChapterInProgress(chapters, index)) return 'full';
  return resolveChapterGranularity(chapter);
}

/**
 * THE chapter granularity rule — the user's explicit choice, else Full.
 * Nothing in the app moves a chapter's cut: no seal, no split, no "closed
 * chapters can be summarized". An automatic downgrade ships less than the user
 * asked for, silently, and it is indistinguishable from a summary they chose.
 */
export function resolveChapterGranularity(chapter: ChapterPartition): Granularity {
  return chapter.granularity ? normalizeGranularity(chapter.granularity) : 'full';
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
  const granularity = resolveChapterSendGranularity(chapters, index);
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
        granularity: resolveChapterSendGranularity(chapters, index),
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
