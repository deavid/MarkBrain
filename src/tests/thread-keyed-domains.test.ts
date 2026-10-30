/**
 * Phase 4 — thread-keyed domains. The ACTIVE thread's turns/chapters and every
 * INACTIVE thread's turns/chapters live in the SAME domain storage, keyed by
 * threadId. The old split brain (private inactive Map in ThreadRegistry) is
 * gone: one write path per operation, no active/inactive forks.
 */
import { describe, it, expect } from 'vitest';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import { ThreadRegistry, makeDefaultThread } from '../domains/06-chat-threads';
import type { Turn } from '../domains/01-dialogue-timeline';
import type { ChapterPartition } from '../domains/02-chapter-segmentation';
import type { ChatThread } from '../domains/06-chat-threads';

const turn = (id: string, role: 'user' | 'assistant', content: string, threadId?: string): Turn => ({
  id,
  role,
  content,
  timestamp: 1,
  threadId,
});

const chapter = (id: string, threadId?: string, startIndex = 0): ChapterPartition => ({
  id,
  workspaceId: 'p1',
  threadId,
  title: 'Genesis Chapter',
  status: 'active',
  startIndex,
  createdAt: 1,
});

describe('DialogueTimelineDomain — per-thread storage', () => {
  it('appendTurnFor writes per thread; turnsFor reads each back; nothing lost or duplicated', () => {
    const tl = new DialogueTimelineDomain('p1');
    const a = tl.appendTurnFor('A', 'user', 'a1');
    const b = tl.appendTurnFor('B', 'user', 'b1');

    expect(a.threadId).toBe('A'); // stamped on append
    expect(b.threadId).toBe('B');
    expect(tl.turnsFor('A').map((t) => t.id)).toEqual([a.id]);
    expect(tl.turnsFor('B').map((t) => t.id)).toEqual([b.id]);
    expect(tl.turnsFor('A').map((t) => t.content)).toEqual(['a1']);
    expect(tl.allTurns()).toHaveLength(2);
    expect(tl.countFor('A')).toBe(1);
    expect(tl.countFor('B')).toBe(1);
  });

  it('setActiveThread switches the active API without losing or duplicating anything', () => {
    const tl = new DialogueTimelineDomain('p1');
    tl.appendTurnFor('A', 'user', 'a1');
    tl.setActiveThread('A');
    tl.appendTurn('user', 'a2'); // active API → A's bucket
    tl.setActiveThread('B');
    expect(tl.getTurns()).toHaveLength(0); // B is empty; A's turns are NOT gone
    tl.appendTurn('assistant', 'b1'); // active API → B's bucket
    tl.setActiveThread('A');
    expect(tl.getTurns().map((t) => t.content)).toEqual(['a1', 'a2']);
    expect(tl.allTurns()).toHaveLength(3);
    expect(tl.turnsFor('B').map((t) => t.content)).toEqual(['b1']);
  });

  it('updateTurnFor edits the named thread only', () => {
    const tl = new DialogueTimelineDomain('p1');
    const a = tl.appendTurnFor('A', 'user', 'a1');
    const b = tl.appendTurnFor('B', 'user', 'b1');
    tl.updateTurnFor('A', a.id, { content: 'a1-edited' });
    expect(tl.turnsFor('A')[0].content).toBe('a1-edited');
    expect(tl.turnsFor('B')[0].content).toBe('b1');
    void b;
  });

  it('loadTurnsFor replaces one thread; clear() clears only the active thread; clearAll empties everything', () => {
    const tl = new DialogueTimelineDomain('p1');
    tl.appendTurnFor('A', 'user', 'a1');
    tl.appendTurnFor('B', 'user', 'b1');
    tl.loadTurnsFor('A', [turn('x1', 'user', 'x', 'A')]);
    expect(tl.turnsFor('A').map((t) => t.id)).toEqual(['x1']);
    expect(tl.turnsFor('B')).toHaveLength(1);

    tl.setActiveThread('B');
    tl.clear();
    expect(tl.turnsFor('B')).toHaveLength(0);
    expect(tl.turnsFor('A')).toHaveLength(1);

    tl.clearAll();
    expect(tl.allTurns()).toHaveLength(0);
  });
});

describe('ChapterSegmentationDomain — per-thread storage', () => {
  it('upsertChapterAtBoundaryFor on a NON-active thread seals the open chapter past the ask, then creates', () => {
    const seg = new ChapterSegmentationDomain('p1');
    seg.loadChaptersFor('B', [chapter('cB0', 'B')]);
    seg.setActiveThread('A'); // B is NOT the active thread — the law must still hold

    const made = seg.upsertChapterAtBoundaryFor('B', 'Topic', 2, 'sub');
    expect(made.threadId).toBe('B');
    expect(made.startIndex).toBe(2);
    expect(made.status).toBe('active');

    const chapters = seg.chaptersFor('B');
    expect(chapters).toHaveLength(2);
    expect(chapters[0].status).toBe('completed');
    expect(chapters[0].endIndex).toBe(2); // the cut is the ask's index
    expect(chapters[1].startIndex).toBe(2);
    // The untouched thread A still has exactly its Genesis floor.
    expect(seg.chaptersFor('A').map((c) => c.id)).toEqual(['chap-genesis-A']);
  });

  it('a cut that already exists at startIndex is RETITLED, never duplicated', () => {
    const seg = new ChapterSegmentationDomain('p1');
    seg.loadChaptersFor('B', [chapter('cB0', 'B')]);
    const first = seg.upsertChapterAtBoundaryFor('B', 'Topic', 2);
    const again = seg.upsertChapterAtBoundaryFor('B', 'Renamed', 2, 'sub', 'desc');

    expect(again.id).toBe(first.id);
    expect(seg.chaptersFor('B')).toHaveLength(2); // genesis + the one cut
    expect(seg.chaptersFor('B')[1].title).toBe('Renamed');
    expect(seg.chaptersFor('B')[1].status).toBe('active');
    expect(seg.chaptersFor('B')[1].endIndex).toBeUndefined();
  });

  it('declareChapterFor behaves like the active declareNewChapter, keyed by thread', () => {
    const seg = new ChapterSegmentationDomain('p1');
    seg.loadChaptersFor('B', [chapter('cB0', 'B')]);
    const made = seg.declareChapterFor('B', 'New', 3);
    expect(made.threadId).toBe('B');
    const chapters = seg.chaptersFor('B');
    expect(chapters[0].status).toBe('completed');
    expect(chapters[0].endIndex).toBe(3);
    expect(chapters[1].title).toBe('New');
  });

  it('mergeChaptersFor upserts by id and sorts by startIndex', () => {
    const seg = new ChapterSegmentationDomain('p1');
    seg.mergeChaptersFor('B', [
      { ...chapter('c2', 'B', 5), title: 'Late' },
      { ...chapter('c1', 'B', 1), title: 'Early' },
    ]);
    // upsert: same id replaces, never duplicates
    seg.mergeChaptersFor('B', [{ ...chapter('c2', 'B', 5), title: 'Late v2' }]);
    const chapters = seg.chaptersFor('B');
    // The thread's Genesis floor survives the merge (same as the old lazy cache).
    expect(chapters.map((c) => c.id)).toEqual(['chap-genesis-B', 'c1', 'c2']);
    expect(chapters[2].title).toBe('Late v2');
  });

  it('allChapters flattens every thread', () => {
    const seg = new ChapterSegmentationDomain('p1');
    seg.loadChaptersFor('A', [chapter('cA', 'A')]);
    seg.loadChaptersFor('B', [chapter('cB', 'B')]);
    expect(seg.allChapters().map((c) => c.id).sort()).toEqual(['cA', 'cB']);
  });
});

describe('ThreadRegistry + thread-keyed domains — snapshot shape unchanged', () => {
  const hydrateInto = () => {
    const reg = new ThreadRegistry();
    const tA: ChatThread = { ...makeDefaultThread(), id: 'A', lastActivityAt: 100 };
    const tB: ChatThread = { ...makeDefaultThread(), id: 'B', lastActivityAt: 200, title: 'Beta' };
    const content = reg.hydrate({
      projectId: 'p1',
      threads: [tA, tB],
      turns: [turn('a1', 'user', 'in A', 'A'), turn('b1', 'user', 'in B', 'B')],
      chapters: [chapter('cA', 'A')],
      activeThreadId: 'A',
    });
    const tl = new DialogueTimelineDomain('p1');
    const seg = new ChapterSegmentationDomain('p1');
    tl.setActiveThread(reg.getActiveThreadId());
    seg.setActiveThread(reg.getActiveThreadId());
    tl.loadAllTurns(content.allTurns);
    seg.loadAllChapters(content.allChapters);
    return { reg, tl, seg, content };
  };

  it('hydrate returns every thread’s tagged content; the active slice is unchanged', () => {
    const { reg, content } = hydrateInto();
    expect(reg.getActiveThreadId()).toBe('A');
    expect(content.turns.map((t) => t.id)).toEqual(['a1']);
    expect(content.chapters.map((c) => c.id)).toEqual(['cA']);
    expect(content.allTurns.map((t) => t.id).sort()).toEqual(['a1', 'b1']);
    expect(content.allChapters.map((c) => c.id)).toEqual(['cA', 'chap-genesis-B']);
  });

  it('compose(allTurns, allChapters) reproduces the tagged snapshot, genesis fallback included', () => {
    const { reg, tl, seg } = hydrateInto();
    const composed = reg.compose(tl.allTurns(), seg.allChapters());
    expect(composed.threads).toHaveLength(2);
    expect(composed.activeThreadId).toBe('A');
    expect(composed.turns.map((t) => `${t.id}:${t.threadId}`).sort()).toEqual([
      'a1:A',
      'b1:B',
    ]);
    // A has its chapter; B (no chapters in the snapshot) falls back to genesis.
    expect(composed.chapters.map((c) => `${c.id}:${c.threadId}`).sort()).toEqual([
      'cA:A',
      'chap-genesis-B:B',
    ]);
  });

  it('select switches the active thread; background writes never leak across threads', () => {
    const { reg, tl, seg } = hydrateInto();
    expect(reg.select('B')).toBe(true);
    tl.setActiveThread('B');
    seg.setActiveThread('B');
    expect(tl.getTurns().map((t) => t.id)).toEqual(['b1']); // B's own content

    // Background write into A while B is visible.
    tl.appendTurnFor('A', 'user', 'background');
    expect(tl.getTurns()).toHaveLength(1); // visible thread unchanged
    seg.upsertChapterAtBoundaryFor('A', 'Bg Chapter', 1);
    expect(seg.listChapters()).toHaveLength(1); // B's strip unchanged

    // Switch back: A has everything, nothing duplicated.
    expect(reg.select('A')).toBe(true);
    tl.setActiveThread('A');
    seg.setActiveThread('A');
    expect(tl.getTurns().map((t) => t.content)).toEqual(['in A', 'background']);
    expect(seg.listChapters().map((c) => c.title)).toEqual(['Genesis Chapter', 'Bg Chapter']);
    expect(reg.select('A')).toBe(false); // already active → no-op
  });
});
