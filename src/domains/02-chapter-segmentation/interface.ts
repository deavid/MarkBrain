import { ChapterPartition, SegmentationEvent } from './types';

export interface IChapterSegmentationDomain {
  // Queries
  listChapters(): ChapterPartition[];
  getChapter(id: string): ChapterPartition | null;
  getActiveChapter(): ChapterPartition | null;

  // Commands
  declareNewChapter(title: string, startIndex: number, reason?: string): ChapterPartition;
  splitChapter(chapterId: string, splitIndex: number, newTitle: string, reason?: string): ChapterPartition;
  shiftBoundary(chapterId: string, newStartIndex: number): void;
  updateSummary(chapterId: string, summary: string, keyPoints?: string[]): void;
  closeChapter(chapterId: string): void;
  loadChapters(chapters: ChapterPartition[]): void;

  // Subscriptions
  subscribe(callback: (event: SegmentationEvent) => void): () => void;
}
