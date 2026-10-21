import type { Granularity } from '../granularity';

/** A `[startIndex, endIndex)` window of turns in a thread. `endIndex === undefined` means ongoing through the latest turn. */
export interface ChapterPartition {
  id: string;
  workspaceId: string;
  threadId?: string;
  title: string;
  description?: string;
  summary?: string;
  granularity?: Granularity;
  status: 'active' | 'completed';
  startIndex: number;
  endIndex?: number;
  createdAt: number;
}

export type SegmentationEvent =
  | { type: 'chapterDeclared'; chapter: ChapterPartition }
  | { type: 'chapterSplit'; oldChapterId: string; newChapter: ChapterPartition }
  | { type: 'boundaryShifted'; chapterId: string; newStartIndex: number }
  | { type: 'chapterLevelsUpdated'; chapterId: string; description?: string; summary?: string }
  | { type: 'chapterGranularityChanged'; chapterId: string; granularity: Granularity }
  | { type: 'chaptersLoaded'; chapters: ChapterPartition[] };
