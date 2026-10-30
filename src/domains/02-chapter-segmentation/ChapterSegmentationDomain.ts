import { IChapterSegmentationDomain } from './interface';
import { ChapterPartition, SegmentationEvent, makeGenesisChapter } from './types';
import { Granularity } from '../granularity';
import { logger } from '../../utils/logger';

const makeChapterId = () => `chap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Per-thread chapter storage (Phase 4). Every thread's chapters live in ONE
 * map keyed by threadId — the active-thread API operates on the ACTIVE
 * thread's bucket exactly as before, and the *For(threadId) variants address
 * any thread directly, so there is no inactive mirror of the chapter laws.
 *
 * The Genesis chapter is the floor: a REAL thread's first touch seeds it
 * (the old registry did this lazily in its per-thread cache — same
 * invariant). The pre-hydration bucket (empty active id) stays genuinely
 * empty, so an unhydrated app reads no phantom chapter.
 */
export class ChapterSegmentationDomain implements IChapterSegmentationDomain {
  private byThread = new Map<string, ChapterPartition[]>();
  private listeners: Set<(event: SegmentationEvent) => void> = new Set();
  private workspaceId: string;
  private activeThreadId = '';

  constructor(workspaceId: string, initialChapters: ChapterPartition[] = []) {
    this.workspaceId = workspaceId;
    this.byThread.set(this.activeThreadId, [...initialChapters]);
    logger.info('Segmentation', `Initialized chapter segmentation for ${workspaceId} with ${initialChapters.length} chapters`);
  }

  /**
   * The thread's bucket, created on first touch. The Genesis chapter is the
   * floor for every REAL thread (the old registry seeded it lazily in its
   * per-thread cache — same invariant, same home): a thread with zero
   * chapters breaks the strip and the compiler. The pre-hydration bucket
   * (empty active id) stays genuinely empty.
   */
  private bucket(threadId: string = this.activeThreadId): ChapterPartition[] {
    let b = this.byThread.get(threadId);
    if (!b) {
      b = threadId ? [makeGenesisChapter(this.workspaceId, threadId)] : [];
      this.byThread.set(threadId, b);
    }
    return b;
  }

  /** Names the thread the active-thread API reads and writes (thread switch = this, not an array swap). */
  setActiveThread(threadId: string): void {
    if (this.activeThreadId === threadId) return;
    this.activeThreadId = threadId;
    this.bucket(threadId);
    this.emit({ type: 'chaptersLoaded', chapters: this.bucket() });
  }

  listChapters(): ChapterPartition[] {
    return [...this.bucket()];
  }

  /** The NAMED thread's chapters (a copy). */
  chaptersFor(threadId: string): ChapterPartition[] {
    return [...this.bucket(threadId)];
  }

  getChapter(id: string): ChapterPartition | null {
    return this.bucket().find((c) => c.id === id) || null;
  }

  getActiveChapter(): ChapterPartition | null {
    return this.bucket().find((c) => c.status === 'active') || this.bucket()[this.bucket().length - 1] || null;
  }

  declareNewChapter(
    title: string,
    startIndex: number,
    subtitle?: string,
    description?: string,
    summary?: string
  ): ChapterPartition {
    return this.declareChapterFor(this.activeThreadId, title, startIndex, subtitle, description, summary);
  }

  /** Opens a chapter on the NAMED thread, sealing its open chapters first. */
  declareChapterFor(
    threadId: string,
    title: string,
    startIndex: number,
    subtitle?: string,
    description?: string,
    summary?: string
  ): ChapterPartition {
    logger.info('Segmentation', `Declare new chapter "${title}" at turn #${startIndex} on ${threadId || '(active)'}`, { subtitle, description });
    // Seal the open chapter. Its CUT is not touched: closing a chapter is a
    // fact about turn windows, not permission to summarize the user's work.
    const chapters = this.bucket(threadId);
    chapters.forEach((c) => {
      if (c.status === 'active') {
        c.status = 'completed';
        if (c.endIndex === undefined) c.endIndex = startIndex;
      }
    });

    const newChapter: ChapterPartition = {
      id: makeChapterId(),
      workspaceId: this.workspaceId,
      threadId,
      title,
      subtitle: subtitle || '',
      description: description || '',
      summary: summary || '',
      granularity: 'full',
      status: 'active',
      startIndex,
      createdAt: Date.now(),
    };

    chapters.push(newChapter);
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
    return this.upsertChapterAtBoundaryFor(this.activeThreadId, title, startIndex, subtitle, description, summary);
  }

  /**
   * Topic-shift law for the NAMED thread (one law for active and background
   * threads alike — Phase 4 unified the two copies): a cut that ALREADY
   * exists at startIndex is retitled by the shift — never a duplicate chapter
   * with the same start. No cut there → seal the open chapter, then declare.
   */
  upsertChapterAtBoundaryFor(
    threadId: string,
    title: string,
    startIndex: number,
    subtitle?: string,
    description?: string,
    summary?: string
  ): ChapterPartition {
    const existing = this.bucket(threadId).find((c) => c.startIndex === startIndex);
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
    return this.declareChapterFor(threadId, title, startIndex, subtitle, description, summary);
  }

  splitChapter(
    chapterId: string,
    splitIndex: number,
    newTitle: string,
    subtitle?: string,
    description?: string
  ): ChapterPartition {
    const chapters = this.bucket();
    const targetIdx = chapters.findIndex((c) => c.id === chapterId);
    if (targetIdx === -1) throw new Error(`Chapter ${chapterId} not found`);

    const target = chapters[targetIdx];
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

    chapters.splice(targetIdx + 1, 0, newChapter);
    this.emit({ type: 'chapterSplit', oldChapterId: chapterId, newChapter });
    return newChapter;
  }

  shiftBoundary(chapterId: string, newStartIndex: number): void {
    const chapters = this.bucket();
    const idx = chapters.findIndex((c) => c.id === chapterId);
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
    const prev = chapters[idx - 1];
    if (prev && newStartIndex <= prev.startIndex) {
      logger.warn('Segmentation', `shiftBoundary: seam would cross chapter ${prev.id} — ignored`);
      return;
    }
    const next = chapters[idx + 1];
    if (next && newStartIndex >= next.startIndex) {
      logger.warn('Segmentation', `shiftBoundary: seam would cross chapter ${next.id} — ignored`);
      return;
    }
    const chapter = chapters[idx];
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
    const chapters = this.bucket();
    const idx = chapters.findIndex((c) => c.id === chapterId);
    if (idx <= 0) {
      logger.warn('Segmentation', `mergeChapters: chapter ${chapterId} has no previous chapter — ignored`);
      return null;
    }
    const prev = chapters[idx - 1];
    const target = chapters[idx];
    // The previous chapter's window is live while it is active — merging would
    // move a boundary the compiler is actively reading (Package 2 §2.6).
    if (prev.status === 'active') {
      logger.warn('Segmentation', `mergeChapters: chapter ${prev.id} is still receiving turns — merge refused`);
      return null;
    }
    prev.endIndex = target.endIndex;
    if (target.endIndex === undefined) prev.status = 'active';
    chapters.splice(idx, 1);
    this.emit({ type: 'chapterMerged', mergedChapterId: chapterId, intoChapterId: prev.id });
    logger.info('Segmentation', `Merged chapter ${chapterId} into ${prev.id}`);
    return prev;
  }

  updateLevels(
    chapterId: string,
    levels: { subtitle?: string; description?: string; summary?: string }
  ): void {
    const chapter = this.bucket().find((c) => c.id === chapterId);
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
    const chapter = this.bucket().find((c) => c.id === chapterId);
    if (!chapter) {
      logger.warn('Segmentation', `setGranularity: unknown chapter ${chapterId} — ignored`);
      return;
    }
    chapter.granularity = granularity;
    this.emit({ type: 'chapterGranularityChanged', chapterId, granularity });
  }

  /** Closing a chapter fixes its turn window — the cut is the user's, not ours. */
  closeChapter(chapterId: string): void {
    const chapter = this.bucket().find((c) => c.id === chapterId);
    if (!chapter) return;
    chapter.status = 'completed';
  }

  loadChapters(chapters: ChapterPartition[]): void {
    this.loadChaptersFor(this.activeThreadId, chapters);
  }

  /** Replaces the NAMED thread's chapters. */
  loadChaptersFor(threadId: string, chapters: ChapterPartition[]): void {
    this.byThread.set(threadId, [...chapters]);
    this.emit({ type: 'chaptersLoaded', chapters: this.chaptersFor(threadId) });
  }

  /** Full (re)hydration: replaces ALL buckets from a snapshot's tagged chapters. */
  loadAllChapters(chapters: ChapterPartition[]): void {
    const grouped = new Map<string, ChapterPartition[]>();
    for (const chapter of chapters) {
      const tid = chapter.threadId ?? this.activeThreadId;
      const list = grouped.get(tid) ?? [];
      list.push(chapter);
      grouped.set(tid, list);
    }
    this.byThread = grouped;
    logger.info('Segmentation', `Loaded ${chapters.length} chapters across ${grouped.size} thread(s) into ${this.workspaceId}`);
    this.emit({ type: 'chaptersLoaded', chapters: [...chapters] });
  }

  /**
   * Delta merge for the NAMED thread (upsert by id, sorted by startIndex).
   * One uniform path — the same call serves the active thread and every
   * background thread.
   */
  mergeChaptersFor(threadId: string, incoming: ChapterPartition[]): void {
    if (incoming.length === 0) return;
    const merged = [...this.bucket(threadId)];
    for (const ch of incoming) {
      const idx = merged.findIndex((c) => c.id === ch.id);
      if (idx >= 0) merged[idx] = ch;
      else merged.push(ch);
    }
    merged.sort((a, b) => a.startIndex - b.startIndex);
    this.byThread.set(threadId, merged);
    this.emit({ type: 'chaptersLoaded', chapters: [...merged] });
  }

  /** Every thread's chapters, flattened (snapshot save + registry compose read this). */
  allChapters(): ChapterPartition[] {
    const out: ChapterPartition[] = [];
    for (const chapters of this.byThread.values()) out.push(...chapters);
    return out;
  }

  /** The thread left the project (deleted): its content goes with it. */
  forgetThread(threadId: string): void {
    this.byThread.delete(threadId);
  }

  subscribe(callback: (event: SegmentationEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(event: SegmentationEvent) {
    this.listeners.forEach((l) => l(event));
  }
}
