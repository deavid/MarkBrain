/**
 * The in-progress window: the last two chapters of a chat are still live, so
 * their cut is forced to Full and their controls are hidden — cutting them
 * would promise description/summary layers nobody wrote, and a recap of a
 * chapter you are still typing in is already stale by the next turn.
 *
 * Deliberately separate from `isChapterOngoing` (geometry: which turns a
 * chapter OWNS). Sealing must never move a boundary; it only changes what the
 * last chapters SEND.
 */
import { describe, it, expect } from 'vitest';
import {
  IN_PROGRESS_CHAPTERS,
  isChapterInProgress,
  resolveChapterSendGranularity,
  groupTurnsByChapter,
} from '../domains/02-chapter-segmentation';
import type { ChapterPartition } from '../domains/02-chapter-segmentation';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline';
import { ArtifactDocumentDomain } from '../domains/01-artifact-document';
import { OpticalCompilerDomain } from '../domains/03-optical-compiler';
import type { Granularity } from '../domains/granularity';

const chap = (
  id: string,
  opts: { endIndex?: number; granularity?: Granularity; status?: 'active' | 'completed' } = {}
): ChapterPartition => ({
  id,
  workspaceId: 'p',
  title: id,
  status: opts.status ?? 'completed',
  startIndex: 0,
  endIndex: opts.endIndex,
  granularity: opts.granularity,
  description: '',
  summary: '',
  createdAt: 0,
});

describe('the in-progress window', () => {
  it('the last two chapters of any chat, never fewer', () => {
    expect(IN_PROGRESS_CHAPTERS).toBe(2);
    const list = (n: number) => Array.from({ length: n }, (_, i) => chap(`c${i}`));
    expect(isChapterInProgress(list(1), 0)).toBe(true);
    expect([0, 1].map((i) => isChapterInProgress(list(2), i))).toEqual([true, true]);
    expect([0, 1, 2].map((i) => isChapterInProgress(list(3), i))).toEqual([false, true, true]);
    expect([0, 1, 2, 3].map((i) => isChapterInProgress(list(4), i))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(isChapterInProgress([], 0)).toBe(false);
  });

  it('an active chapter is in progress wherever it sits', () => {
    const list = [chap('c0', { status: 'active' }), chap('c1'), chap('c2'), chap('c3')];
    expect(isChapterInProgress(list, 0)).toBe(true);
  });

  it('forces Full inside the window and honors a manual choice outside it', () => {
    const list = [
      chap('old', { endIndex: 1, granularity: 'title' }),
      chap('recent', { endIndex: 2, granularity: 'title' }),
      chap('open'),
    ];
    expect(resolveChapterSendGranularity(list, 0)).toBe('title'); // out of window: choice stands
    expect(resolveChapterSendGranularity(list, 1)).toBe('full'); // in window: choice overridden
    expect(resolveChapterSendGranularity(list, 2)).toBe('full');
  });

  it('does not move boundaries — geometry stays with isChapterOngoing', () => {
    const timeline = {
      getTurnSlice: (start: number, end?: number) => ['a', 'b', 'c'].slice(start, end),
    };
    const list = [
      chap('done', { endIndex: 2, granularity: 'title' }),
      chap('mid', { endIndex: 3 }),
      chap('open'),
    ];
    const rows = groupTurnsByChapter(timeline as never, { listChapters: () => list }, 'p');
    // Sealed chapter still owns exactly [0, 2) turns, and it is out of the
    // in-progress window so its manual title cut stands.
    expect(rows[0].turns).toEqual(['a', 'b']);
    expect(rows[0].ongoing).toBe(false);
    expect(rows[0].granularity).toBe('title');
  });
});

describe('the compiler sends the last two chapters at Full', () => {
  const build = (chapters: ChapterPartition[]) => {
    const artifacts = new ArtifactDocumentDomain('p', []);
    const segmentation = new ChapterSegmentationDomain('p', chapters);
    const timeline = new DialogueTimelineDomain(
      'p',
      ['zero', 'one', 'two'].map((content, i) => ({
        id: `t${i}`,
        role: 'user' as const,
        content,
        timestamp: 0,
      }))
    );
    return new OpticalCompilerDomain(artifacts, segmentation, timeline);
  };

  it('overrides a stored manual cut on the in-progress chapters only', () => {
    const compiler = build([
      chap('old', { endIndex: 1, granularity: 'title' }),
      chap('recent', { endIndex: 2, granularity: 'title' }),
      chap('open', { granularity: 'title' }),
    ]);
    const rows = compiler.compile({ attachments: [] }).telemetry.chapterBreakdown;
    expect(rows.map((r) => [r.chapterId, r.granularity])).toEqual([
      ['old', 'title'],
      ['recent', 'full'],
      ['open', 'full'],
    ]);
  });

  it('a two-chapter chat is entirely in progress: both send full', () => {
    const compiler = build([chap('a', { endIndex: 1 }), chap('b')]);
    const rows = compiler.compile({ attachments: [] }).telemetry.chapterBreakdown;
    expect(rows.every((r) => r.granularity === 'full')).toBe(true);
  });
});
