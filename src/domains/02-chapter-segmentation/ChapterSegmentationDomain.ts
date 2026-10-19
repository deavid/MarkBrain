import { IChapterSegmentationDomain } from './interface';
import { ChapterPartition, SegmentationEvent } from './types';
import { logger } from '../../utils/logger';

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

  declareNewChapter(title: string, startIndex: number, reason?: string): ChapterPartition {
    logger.info('Segmentation', `Declare new chapter "${title}" at turn #${startIndex}`, { reason });
    // Close existing active chapter
    this.chapters.forEach((c) => {
      if (c.status === 'active') {
        c.status = 'completed';
        if (c.endIndex === undefined) c.endIndex = startIndex;
      }
    });

    const newChapter: ChapterPartition = {
      id: `chap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workspaceId: this.workspaceId,
      title,
      status: 'active',
      startIndex,
      topicShiftReason: reason,
      createdAt: Date.now(),
    };

    this.chapters.push(newChapter);
    this.emit({ type: 'chapterDeclared', chapter: newChapter });
    return newChapter;
  }

  splitChapter(chapterId: string, splitIndex: number, newTitle: string, reason?: string): ChapterPartition {
    const targetIdx = this.chapters.findIndex((c) => c.id === chapterId);
    if (targetIdx === -1) throw new Error(`Chapter ${chapterId} not found`);

    const target = this.chapters[targetIdx];
    const prevEnd = target.endIndex;
    target.endIndex = splitIndex;
    target.status = 'completed';

    // A stale/absent end (the ongoing rule runs the last chapter to the latest
    // turn regardless of endIndex) means the new chapter owns the tail — never
    // an end at/before its start, which would slice to an empty/inverted window.
    const newEnd = prevEnd !== undefined && prevEnd > splitIndex ? prevEnd : undefined;

    const newChapter: ChapterPartition = {
      id: `chap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workspaceId: this.workspaceId,
      title: newTitle,
      status: newEnd === undefined ? 'active' : 'completed',
      startIndex: splitIndex,
      endIndex: newEnd,
      topicShiftReason: reason,
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

  updateSummary(chapterId: string, summary: string, keyPoints?: string[]): void {
    const chapter = this.chapters.find((c) => c.id === chapterId);
    if (!chapter) {
      logger.warn('Segmentation', `updateSummary: unknown chapter ${chapterId} — ignored`);
      return;
    }
    chapter.summary = summary;
    if (keyPoints) chapter.keyPoints = keyPoints;
    this.emit({ type: 'chapterSummaryUpdated', chapterId, summary, keyPoints });
  }

  closeChapter(chapterId: string): void {
    const chapter = this.chapters.find((c) => c.id === chapterId);
    if (chapter) chapter.status = 'completed';
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
