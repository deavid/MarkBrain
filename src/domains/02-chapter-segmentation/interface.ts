import { ChapterPartition, SegmentationEvent } from './types';
import type { Granularity } from '../granularity';

/**
 * Per-thread chapter storage (Phase 4): the active-thread methods operate on
 * the ACTIVE thread's bucket; the *For(threadId) variants address any thread
 * directly so callers never branch on active-vs-inactive.
 */
export interface IChapterSegmentationDomain {
  listChapters(): ChapterPartition[];
  /** The NAMED thread's chapters (a copy). */
  chaptersFor(threadId: string): ChapterPartition[];
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
  /** Same law, on the NAMED thread: seals its open chapters, then creates. */
  declareChapterFor(
    threadId: string,
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
  /** The one unified topic-shift law, on the NAMED thread (active or background). */
  upsertChapterAtBoundaryFor(
    threadId: string,
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
  /** Replaces the NAMED thread's chapters. */
  loadChaptersFor(threadId: string, chapters: ChapterPartition[]): void;
  /** Full (re)hydration: replaces ALL buckets from a snapshot's tagged chapters. */
  loadAllChapters(chapters: ChapterPartition[]): void;
  /** Delta merge on the NAMED thread: upsert by id, sort by startIndex. */
  mergeChaptersFor(threadId: string, incoming: ChapterPartition[]): void;
  /** Every thread's chapters, flattened. */
  allChapters(): ChapterPartition[];
  /** Names the thread the active-thread API reads and writes (thread switch = this, not an array swap). */
  setActiveThread(threadId: string): void;
  /** The thread left the project (deleted): its content goes with it. */
  forgetThread(threadId: string): void;

  subscribe(callback: (event: SegmentationEvent) => void): () => void;
}
