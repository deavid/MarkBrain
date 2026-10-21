import { ChapterPartition, SegmentationEvent } from './types';
import type { Granularity } from '../granularity';

export interface IChapterSegmentationDomain {
  listChapters(): ChapterPartition[];
  getChapter(id: string): ChapterPartition | null;
  getActiveChapter(): ChapterPartition | null;

  /** Opens a chapter; seals the previous one (full → summary, manual choice kept). */
  declareNewChapter(
    title: string,
    startIndex: number,
    subtitle?: string,
    description?: string,
    summary?: string
  ): ChapterPartition;
  splitChapter(
    chapterId: string,
    splitIndex: number,
    newTitle: string,
    subtitle?: string,
    description?: string
  ): ChapterPartition;
  shiftBoundary(chapterId: string, newStartIndex: number): void;
  updateLevels(
    chapterId: string,
    levels: { subtitle?: string; description?: string; summary?: string }
  ): void;
  setGranularity(chapterId: string, granularity: Granularity): void;
  closeChapter(chapterId: string): void;
  loadChapters(chapters: ChapterPartition[]): void;

  subscribe(callback: (event: SegmentationEvent) => void): () => void;
}
