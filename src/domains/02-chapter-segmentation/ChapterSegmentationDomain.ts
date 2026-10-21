import { IChapterSegmentationDomain } from './interface';
import { ChapterPartition, SegmentationEvent } from './types';
import { Granularity } from '../granularity';
import { logger } from '../../utils/logger';

const makeChapterId = () => `chap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export class ChapterSegmentationDomain implements IChapterSegmentationDomain {
  private chapters: ChapterPartition[] = [];
  private listeners: Set<(event: SegmentationEvent) => void> = new Set();
  private workspaceId: string;

  constructor(workspaceId: string, initialChapters: ChapterPartition[] = []) {
    this.workspaceId = workspaceId;
    this.chapters = [...initialChapters];
    logger.info('Segmentation', `Initialized chapter segmentation for ${workspaceId} with ${this.chapters.length} chapters`);
  }

  listChapters(): ChapterPartition[] {
    return [...this.chapters];
  }

  getChapter(id: string): ChapterPartition | null {
    return this.chapters.find((c) => c.id === id) || null;
  }

  getActiveChapter(): ChapterPartition | null {
    return this.chapters.find((c) => c.status === 'active') || this.chapters[this.chapters.length - 1] || null;
  }

  declareNewChapter(
    title: string,
    startIndex: number,
    subtitle?: string,
    description?: string,
    summary?: string
  ): ChapterPartition {
    logger.info('Segmentation', `Declare new chapter "${title}" at turn #${startIndex}`, { subtitle, description });
    // Seal the open chapter. Its CUT is not touched: closing a chapter is a
    // fact about turn windows, not permission to summarize the user's work.
    this.chapters.forEach((c) => {
      if (c.status === 'active') {
        c.status = 'completed';
        if (c.endIndex === undefined) c.endIndex = startIndex;
      }
    });

    const newChapter: ChapterPartition = {
      id: makeChapterId(),
      workspaceId: this.workspaceId,
      title,
      subtitle: subtitle || '',
      description: description || '',
      summary: summary || '',
      granularity: 'full',
      status: 'active',
      startIndex,
      createdAt: Date.now(),
    };

    this.chapters.push(newChapter);
    this.emit({ type: 'chapterDeclared', chapter: newChapter });
    return newChapter;
  }

  splitChapter(
    chapterId: string,
    splitIndex: number,
    newTitle: string,
    subtitle?: string,
    description?: string
  ): ChapterPartition {
    const targetIdx = this.chapters.findIndex((c) => c.id === chapterId);
    if (targetIdx === -1) throw new Error(`Chapter ${chapterId} not found`);

    const target = this.chapters[targetIdx];
    const prevEnd = target.endIndex;
    target.endIndex = splitIndex;
    target.status = 'completed';
    // The cut stays where it was: splitting is a boundary edit, and a chapter
    // that suddenly ships less than the user asked for is a silent downgrade.

    // A stale/absent end (the ongoing rule runs the last chapter to the latest
    // turn regardless of endIndex) means the new chapter owns the tail — never
    // an end at/before its start, which would slice to an empty/inverted window.
    const newEnd = prevEnd !== undefined && prevEnd > splitIndex ? prevEnd : undefined;

    const newChapter: ChapterPartition = {
      id: makeChapterId(),
      workspaceId: this.workspaceId,
      title: newTitle,
      subtitle: subtitle || '',
      description: description || '',
      summary: '',
      granularity: 'full',
      status: newEnd === undefined ? 'active' : 'completed',
      startIndex: splitIndex,
      endIndex: newEnd,
      createdAt: Date.now(),
    };

    this.chapters.splice(targetIdx + 1, 0, newChapter);
    this.emit({ type: 'chapterSplit', oldChapterId: chapterId, newChapter });
    return newChapter;
  }

  shiftBoundary(chapterId: string, newStartIndex: number): void {
    const chapter = this.chapters.find((c) => c.id === chapterId);
    if (!chapter) {
      logger.warn('Segmentation', `shiftBoundary: unknown chapter ${chapterId} — ignored`);
      return;
    }
    chapter.startIndex = newStartIndex;
    this.emit({ type: 'boundaryShifted', chapterId, newStartIndex });
  }

  updateLevels(
    chapterId: string,
    levels: { subtitle?: string; description?: string; summary?: string }
  ): void {
    const chapter = this.chapters.find((c) => c.id === chapterId);
    if (!chapter) {
      logger.warn('Segmentation', `updateLevels: unknown chapter ${chapterId} — ignored`);
      return;
    }
    if (levels.subtitle !== undefined) chapter.subtitle = levels.subtitle;
    if (levels.description !== undefined) chapter.description = levels.description;
    if (levels.summary !== undefined) chapter.summary = levels.summary;
    this.emit({
      type: 'chapterLevelsUpdated',
      chapterId,
      subtitle: chapter.subtitle,
      description: chapter.description,
      summary: chapter.summary,
    });
  }

  setGranularity(chapterId: string, granularity: Granularity): void {
    const chapter = this.chapters.find((c) => c.id === chapterId);
    if (!chapter) {
      logger.warn('Segmentation', `setGranularity: unknown chapter ${chapterId} — ignored`);
      return;
    }
    chapter.granularity = granularity;
    this.emit({ type: 'chapterGranularityChanged', chapterId, granularity });
  }

  /** Closing a chapter fixes its turn window — the cut is the user's, not ours. */
  closeChapter(chapterId: string): void {
    const chapter = this.chapters.find((c) => c.id === chapterId);
    if (!chapter) return;
    chapter.status = 'completed';
  }

  loadChapters(chapters: ChapterPartition[]): void {
    this.chapters = [...chapters];
    this.emit({ type: 'chaptersLoaded', chapters: this.chapters });
  }

  subscribe(callback: (event: SegmentationEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(event: SegmentationEvent) {
    this.listeners.forEach((l) => l(event));
  }
}
