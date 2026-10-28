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
  /**
   * Topic-shift law (David 2026-10-25): a chapter cut that ALREADY exists at
   * startIndex is retitled by the shift — never a duplicate chapter with the
   * same start. No cut there → behaves exactly like declareNewChapter.
   */
  upsertChapterAtBoundary(
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
  /** Merge this chapter into the previous one; null when refused (no previous / previous in progress). */
  mergeChapters(chapterId: string): ChapterPartition | null;
  updateLevels(
    chapterId: string,
    levels: { subtitle?: string; description?: string; summary?: string }
  ): void;
  setGranularity(chapterId: string, granularity: Granularity): void;
  closeChapter(chapterId: string): void;
  loadChapters(chapters: ChapterPartition[]): void;

  subscribe(callback: (event: SegmentationEvent) => void): () => void;
}
