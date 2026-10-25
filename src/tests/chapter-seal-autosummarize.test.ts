/**
 * The "No summary yet" gap.
 *
 * A chapter sealed by a manual split was filled in the background. A chapter
 * sealed by the model's own <topic_shift> was not — that seal happens inside
 * the stream on a different code path, so it sat at "No summary yet" forever.
 *
 * The fix is one rule for every seal path: when a chapter is created, the one
 * that just LEFT the in-progress window is the one to fill. This file pins the
 * rule itself — the part that is easy to get subtly wrong.
 */
import { describe, it, expect } from 'vitest';
import { chapterThatLeftTheWindow } from '../ui/chat/createChapterHandlers';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import type { ChapterPartition } from '../domains/02-chapter-segmentation';

const seg = (chapters: Array<Partial<ChapterPartition>>) =>
  new ChapterSegmentationDomain(
    'p',
    chapters.map((c, i) => ({
      id: c.id ?? `c${i}`,
      workspaceId: 'p',
      title: c.title ?? `Chapter ${i}`,
      status: c.status ?? 'completed',
      startIndex: c.startIndex ?? i,
      endIndex: c.endIndex ?? i,
      description: c.description ?? '',
      summary: c.summary ?? '',
      createdAt: 0,
    })) as ChapterPartition[]
  );

describe('chapterThatLeftTheWindow', () => {
  // The rule: the due chapter is at index `length - IN_PROGRESS_CHAPTERS - 1`
  // = `length - 3`. That is the one that just left the in-progress window.

  it('picks the chapter that just left the window', () => {
    const s = seg([
      { id: 'older', status: 'completed', summary: '', description: '' },
      { id: 'mid', status: 'completed', summary: '', description: '' },
      { id: 'left', status: 'completed', summary: '', description: '' }, // index 2 of 5
      { id: 'live1', status: 'active' },
      { id: 'live2', status: 'active' },
    ]);
    expect(chapterThatLeftTheWindow(s)?.id).toBe('left');
  });

  it('never touches an in-progress chapter — they send Full', () => {
    // Only 3 chapters: index 0 is outside the window, 1 and 2 are live.
    const s = seg([
      { id: 'due', status: 'completed', summary: '', description: '' },
      { id: 'live1', status: 'active' },
      { id: 'live2', status: 'active' },
    ]);
    expect(chapterThatLeftTheWindow(s)?.id).toBe('due');
  });

  it('is null while everything is still inside the window', () => {
    // Two chapters, both live: there is nothing outside the window to fill.
    const s = seg([
      { id: 'live1', status: 'active' },
      { id: 'live2', status: 'active' },
    ]);
    expect(chapterThatLeftTheWindow(s)).toBeNull();
  });

  it('skips a chapter that already has both layers (never re-summarizes)', () => {
    const s = seg([
      { id: 'full', status: 'completed', summary: 's', description: 'd' }, // index 0 of 3
      { id: 'live1', status: 'active' },
      { id: 'live2', status: 'active' },
    ]);
    expect(chapterThatLeftTheWindow(s)).toBeNull();
  });

  it('does fill a chapter that only has one layer', () => {
    const s = seg([
      { id: 'half', status: 'completed', summary: '', description: 'd' },
      { id: 'live1', status: 'active' },
      { id: 'live2', status: 'active' },
    ]);
    expect(chapterThatLeftTheWindow(s)?.id).toBe('half');
  });

  it('is null with no chapters at all', () => {
    expect(chapterThatLeftTheWindow(seg([]))).toBeNull();
  });
});
