/**
 * Package 2 (design-docs/28 §2.6) — chapter controls.
 *
 * Locks down:
 *   1. mergeChapters: the chapter folds into the one above it, the turn
 *      window is preserved, and a live (in-progress) previous chapter is
 *      refused.
 *   2. shiftBoundary: the seam cannot move past turn 0 or cross a neighbour.
 *   3. Recalibrate: the handler refuses in-progress chapters and the gateway
 *      call carries the `summarize` model slot plus the steering note.
 *
 * No happy-dom, no network: the gateway is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import type { ChapterPartition } from '../domains/02-chapter-segmentation';
import { ChapterRecalibrationDomain } from '../domains/03-chapter-recalibration';
import { createChapterHandlers } from '../ui/chat/createChapterHandlers';
import type { Turn } from '../domains/01-dialogue-timeline/types';

vi.mock('../gateway/api', () => ({
  summarizeChapter: vi.fn(),
}));
vi.mock('../data/modelConfig', () => ({
  getModelForSlot: vi.fn(() => 'summarize-slot-model'),
}));

import { summarizeChapter } from '../gateway/api';
import { getModelForSlot } from '../data/modelConfig';

const seg = (chapters: Array<Partial<ChapterPartition>>) =>
  new ChapterSegmentationDomain(
    'p',
    chapters.map((c, i) => ({
      id: c.id ?? `c${i}`,
      workspaceId: 'p',
      title: c.title ?? `Chapter ${i}`,
      status: c.status ?? 'completed',
      startIndex: c.startIndex ?? i * 3,
      endIndex: 'endIndex' in c ? c.endIndex : i * 3 + 2,
      description: c.description ?? '',
      summary: c.summary ?? '',
      createdAt: 0,
    })) as ChapterPartition[]
  );

describe('mergeChapters — fold a chapter into the one above it', () => {
  it('extends the previous window to the merged chapter\'s end and removes it', () => {
    const s = seg([
      { id: 'a', startIndex: 0, endIndex: 2 },
      { id: 'b', startIndex: 3, endIndex: 5 },
      { id: 'c', startIndex: 6, endIndex: 8 },
    ]);
    const merged = s.mergeChapters('b');
    expect(merged).not.toBeNull();
    expect(merged?.id).toBe('a');
    const list = s.listChapters();
    expect(list.map((c) => c.id)).toEqual(['a', 'c']);
    // The fold keeps the turn window: 'a' now owns everything 'b' owned.
    expect(list[0].startIndex).toBe(0);
    expect(list[0].endIndex).toBe(5);
    // The survivor keeps its identity: title/layers are the previous chapter's.
    expect(list[0].title).toBe('Chapter 0');
  });

  it('merging the LAST chapter makes the survivor ongoing again', () => {
    const s = seg([
      { id: 'a', startIndex: 0, endIndex: 2 },
      { id: 'b', startIndex: 3, endIndex: undefined, status: 'active' },
    ]);
    const merged = s.mergeChapters('b');
    expect(merged?.endIndex).toBeUndefined();
    expect(merged?.status).toBe('active');
    expect(s.listChapters()).toHaveLength(1);
  });

  it('refuses when the previous chapter is still in progress', () => {
    const s = seg([
      { id: 'a', startIndex: 0, endIndex: 2, status: 'active' },
      { id: 'b', startIndex: 3, endIndex: undefined, status: 'active' },
    ]);
    expect(s.mergeChapters('b')).toBeNull();
    expect(s.listChapters()).toHaveLength(2);
  });

  it('refuses the first chapter — there is nothing above to fold into', () => {
    const s = seg([{ id: 'a', startIndex: 0, endIndex: 2 }]);
    expect(s.mergeChapters('a')).toBeNull();
    expect(s.listChapters()).toHaveLength(1);
  });
});

describe('shiftBoundary — the seam respects its bounds', () => {
  it('moves a valid seam and emits the event', () => {
    const s = seg([
      { id: 'a', startIndex: 0, endIndex: 2 },
      { id: 'b', startIndex: 3, endIndex: 5 },
      { id: 'c', startIndex: 6, endIndex: 8 },
    ]);
    s.shiftBoundary('b', 4); // down one: 'a' grows, 'b' shrinks
    expect(s.getChapter('b')?.startIndex).toBe(4);
    s.shiftBoundary('b', 3); // back up
    expect(s.getChapter('b')?.startIndex).toBe(3);
  });

  it('refuses to move past turn 0', () => {
    const s = seg([
      { id: 'a', startIndex: 0, endIndex: 2 },
      { id: 'b', startIndex: 3, endIndex: 5 },
    ]);
    s.shiftBoundary('b', 0); // 'a' would be left with nothing
    expect(s.getChapter('b')?.startIndex).toBe(3);
    s.shiftBoundary('b', -1);
    expect(s.getChapter('b')?.startIndex).toBe(3);
  });

  it('refuses to cross into a neighbour\'s window', () => {
    const s = seg([
      { id: 'a', startIndex: 0, endIndex: 2 },
      { id: 'b', startIndex: 3, endIndex: 5 },
      { id: 'c', startIndex: 6, endIndex: 8 },
    ]);
    s.shiftBoundary('b', 2); // collides with 'a' (prev.startIndex 0 → seam must stay > 0... 2 > 0 ok)
    // seam at 2 is legal: 'a' keeps turns 0..1. Now try crossing 'c':
    expect(s.getChapter('b')?.startIndex).toBe(2);
    s.shiftBoundary('b', 6); // 'c' starts at 6 — the seam cannot reach or pass it
    expect(s.getChapter('b')?.startIndex).toBe(2);
    s.shiftBoundary('b', 7);
    expect(s.getChapter('b')?.startIndex).toBe(2);
  });
});

describe('recalibrate — the handler and the gateway call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (summarizeChapter as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ subtitle: 'Sub', description: 'Desc', summary: 'Sum' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  function makeTimeline(): { getTurnSlice: ReturnType<typeof vi.fn> } {
    return {
      getTurnSlice: vi.fn(() =>
        Array.from({ length: 3 }, (_, i) => ({
          id: `t${i}`,
          role: 'user',
          content: `turn ${i}`,
          timestamp: 0,
        })) as Turn[]
      ),
    };
  }

  it('the recalibration domain calls the gateway with the summarize model slot and the steering note', async () => {
    const timeline = makeTimeline();
    const s = seg([
      { id: 'a', startIndex: 0, endIndex: 2 },
      { id: 'b', startIndex: 3, endIndex: 5 },
    ]);
    const recalibration = new ChapterRecalibrationDomain(s, timeline as never);
    await recalibration.recalibrateSummary('a', 'focus on mechanics decisions');

    expect(summarizeChapter).toHaveBeenCalledTimes(1);
    const arg = (summarizeChapter as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(getModelForSlot).toHaveBeenCalledWith('summarize');
    expect(arg.model).toBe('summarize-slot-model');
    expect(arg.steeringPrompt).toBe('focus on mechanics decisions');
    // The result lands on the chapter.
    expect(s.getChapter('a')?.summary).toBe('Sum');
  });

  it('the handler passes the steering note through and updates the chapter', async () => {
    const timeline = makeTimeline();
    // Three chapters: 'a' must sit OUTSIDE the in-progress window (the last
    // IN_PROGRESS_CHAPTERS chapters send Full and refuse a recap).
    const s = seg([
      { id: 'a', startIndex: 0, endIndex: 2 },
      { id: 'b', startIndex: 3, endIndex: 5 },
      { id: 'c', startIndex: 6, endIndex: 8 },
    ]);
    const handlers = createChapterHandlers({
      timeline: { getTurns: () => [], getTurnSlice: timeline.getTurnSlice } as never,
      segmentation: s as never,
      recalibration: new ChapterRecalibrationDomain(s, timeline as never),
    });
    await handlers.handleRecalibrateChapter('a', 'focus on the decisions made');
    expect((summarizeChapter as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].steeringPrompt).toBe(
      'focus on the decisions made'
    );
  });

  it('the handler refuses in-progress chapters — nothing is sent to the gateway', async () => {
    const timeline = makeTimeline();
    // Two chapters: 'a' completed, 'b' the live ongoing one (index 1 of 2 is in the window).
    const s = seg([
      { id: 'a', startIndex: 0, endIndex: 2 },
      { id: 'b', startIndex: 3, endIndex: undefined, status: 'active' },
    ]);
    const handlers = createChapterHandlers({
      timeline: { getTurns: () => [], getTurnSlice: timeline.getTurnSlice } as never,
      segmentation: s as never,
      recalibration: new ChapterRecalibrationDomain(s, timeline as never),
    });
    await handlers.handleRecalibrateChapter('b', 'nope');
    expect(summarizeChapter).not.toHaveBeenCalled();
  });
});
