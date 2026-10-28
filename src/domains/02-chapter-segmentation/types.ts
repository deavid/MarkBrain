import type { Granularity } from '../granularity';

/** A `[startIndex, endIndex)` window of turns in a thread. `endIndex === undefined` means ongoing through the latest turn. */
export interface ChapterPartition {
  id: string;
  workspaceId: string;
  threadId?: string;
  title: string;
  /** The index-card hook, sent with the title at the `title` cut. */
  subtitle?: string;
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
  | { type: 'chapterMerged'; mergedChapterId: string; intoChapterId: string }
  | {
      type: 'chapterLevelsUpdated';
      chapterId: string;
      subtitle?: string;
      description?: string;
      summary?: string;
    }
  | { type: 'chapterGranularityChanged'; chapterId: string; granularity: Granularity }
  | { type: 'chaptersLoaded'; chapters: ChapterPartition[] };
