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

  /** Topic-shift law: replace the cut that exists, never duplicate it. */
  upsertChapterAtBoundary(
    title: string,
    startIndex: number,
    subtitle?: string,
    description?: string,
    summary?: string
  ): ChapterPartition {
    const existing = this.chapters.find((c) => c.startIndex === startIndex);
    if (existing) {
      logger.info('Segmentation', `Topic shift retitles chapter at turn #${startIndex} → "${title}"`);
      existing.title = title;
      existing.subtitle = subtitle || existing.subtitle || '';
      existing.description = description || existing.description || '';
      existing.summary = summary || existing.summary || '';
      existing.status = 'active';
      existing.endIndex = undefined;
      this.emit({ type: 'chapterDeclared', chapter: existing });
      return existing;
    }
    return this.declareNewChapter(title, startIndex, subtitle, description, summary);
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
    const idx = this.chapters.findIndex((c) => c.id === chapterId);
    if (idx === -1) {
      logger.warn('Segmentation', `shiftBoundary: unknown chapter ${chapterId} — ignored`);
      return;
    }
    // Boundary guards (Package 2 §2.6): the seam cannot move past turn 0,
    // cannot swallow the previous chapter's last turn, and cannot cross into
    // the next chapter's window. A seam that lands on another chapter's start
    // would create two chapters owning the same turn.
    if (newStartIndex < 0) {
      logger.warn('Segmentation', `shiftBoundary: turn 0 has no chapter above it — ignored`);
      return;
    }
    const prev = this.chapters[idx - 1];
    if (prev && newStartIndex <= prev.startIndex) {
      logger.warn('Segmentation', `shiftBoundary: seam would cross chapter ${prev.id} — ignored`);
      return;
    }
    const next = this.chapters[idx + 1];
    if (next && newStartIndex >= next.startIndex) {
      logger.warn('Segmentation', `shiftBoundary: seam would cross chapter ${next.id} — ignored`);
      return;
    }
    const chapter = this.chapters[idx];
    chapter.startIndex = newStartIndex;
    this.emit({ type: 'boundaryShifted', chapterId, newStartIndex });
  }

  /**
   * Merge the chapter INTO the one before it (Package 2 §2.6): the previous
   * chapter's window extends to this chapter's end, and this chapter ceases
   * to exist. The previous chapter keeps its title and layers — merging is
   * "this cut was a mistake", not a rewrite. Refused when the previous
   * chapter is still in progress (its window is live; merging would move a
   * boundary the compiler is actively reading) or when there is nothing
   * above to merge into.
   */
  mergeChapters(chapterId: string): ChapterPartition | null {
    const idx = this.chapters.findIndex((c) => c.id === chapterId);
    if (idx <= 0) {
      logger.warn('Segmentation', `mergeChapters: chapter ${chapterId} has no previous chapter — ignored`);
      return null;
    }
    const prev = this.chapters[idx - 1];
    const target = this.chapters[idx];
    // The previous chapter's window is live while it is active — merging would
    // move a boundary the compiler is actively reading (Package 2 §2.6).
    if (prev.status === 'active') {
      logger.warn('Segmentation', `mergeChapters: chapter ${prev.id} is still receiving turns — merge refused`);
      return null;
    }
    prev.endIndex = target.endIndex;
    if (target.endIndex === undefined) prev.status = 'active';
    this.chapters.splice(idx, 1);
    this.emit({ type: 'chapterMerged', mergedChapterId: chapterId, intoChapterId: prev.id });
    logger.info('Segmentation', `Merged chapter ${chapterId} into ${prev.id}`);
    return prev;
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
