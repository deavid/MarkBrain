import type { Granularity } from '../granularity';

/**
 * A chapter is a WINDOW of turns (startIndex/endIndex) plus the layers it can
 * be sent at. `granularity` is where it gets cut in the payload:
 *
 *   title        → the title only (a mention)
 *   description  → title + description
 *   summary      → title + description + summary
 *   full         → title + description + summary + the verbatim turns
 *
 * Optional so legacy snapshots hydrate; `resolveChapterGranularity()` supplies
 * the default (open → full, closed → summary). No excluded/hidden state: a
 * chapter is either in the chat or it isn't, and it is always in.
 */
export interface ChapterPartition {
  id: string;
  workspaceId: string;
  /** Chat-thread ownership — indices are relative to that thread's turn list. */
  threadId?: string;
  title: string;
  /** 1–2 sentences: what this chapter is about (level 2 of the cut). */
  description?: string;
  /** Multi-paragraph recap of the turns (level 3 of the cut). */
  summary?: string;
  granularity?: Granularity;
  status: 'active' | 'completed';
  startIndex: number;
  endIndex?: number; // undefined means ongoing/until latest
  createdAt: number;
}

export type SegmentationEvent =
  | { type: 'chapterDeclared'; chapter: ChapterPartition }
  | { type: 'chapterSplit'; oldChapterId: string; newChapter: ChapterPartition }
  | { type: 'boundaryShifted'; chapterId: string; newStartIndex: number }
  | { type: 'chapterLevelsUpdated'; chapterId: string; description?: string; summary?: string }
  | { type: 'chapterGranularityChanged'; chapterId: string; granularity: Granularity }
  | { type: 'chaptersLoaded'; chapters: ChapterPartition[] };
