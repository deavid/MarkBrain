import { ChapterPartition, SegmentationEvent } from './types';
import type { Granularity } from '../granularity';

export interface IChapterSegmentationDomain {
  // Queries
  listChapters(): ChapterPartition[];
  getChapter(id: string): ChapterPartition | null;
  getActiveChapter(): ChapterPartition | null;

  // Commands
  /** Opens a chapter; seals the previous one (full → summary, manual choice kept). */
  declareNewChapter(
    title: string,
    startIndex: number,
    description?: string,
    summary?: string
  ): ChapterPartition;
  splitChapter(
    chapterId: string,
    splitIndex: number,
    newTitle: string,
    description?: string
  ): ChapterPartition;
  shiftBoundary(chapterId: string, newStartIndex: number): void;
  /** Fill in the chapter's text layers (description = level 2, summary = level 3). */
  updateLevels(chapterId: string, levels: { description?: string; summary?: string }): void;
  setGranularity(chapterId: string, granularity: Granularity): void;
  closeChapter(chapterId: string): void;
  loadChapters(chapters: ChapterPartition[]): void;

  // Subscriptions
  subscribe(callback: (event: SegmentationEvent) => void): () => void;
}
