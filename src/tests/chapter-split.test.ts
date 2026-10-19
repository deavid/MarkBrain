/**
 * Split-at-clicked-message contract (chapter journey honesty).
 *
 * The per-message "Split Chapter" button promises "Split into new chapter
 * starting at this message" — so the split boundary must land AT the clicked
 * turn: the clicked message becomes the FIRST turn of the new chapter, and
 * the new chapter is never empty. The old handler ignored the message id and
 * split at timeline.count(), spawning an empty chapter at the thread end.
 */
import { describe, it, expect } from 'vitest';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline/DialogueTimelineDomain';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation/ChapterSegmentationDomain';
import { createChapterHandlers } from '../ui/chat/createChapterHandlers';

const WS = 'proj-split-at-message';

function genesisChapter() {
  return {
    id: 'chap-1',
    workspaceId: WS,
    title: 'Genesis Chapter',
    status: 'active' as const,
    startIndex: 0,
    createdAt: Date.now(),
  };
}

function build(turnCount: number) {
  const timeline = new DialogueTimelineDomain(WS, []);
  const segmentation = new ChapterSegmentationDomain(WS, [genesisChapter()]);
  const turns = Array.from({ length: turnCount }, (_, i) =>
    timeline.appendTurn(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`)
  );
  const { handleDeclareChapter } = createChapterHandlers({ timeline, segmentation });
  return { timeline, segmentation, turns, handleDeclareChapter };
}

describe('Split at clicked message', () => {
  it('splits the containing chapter at the clicked turn — clicked message is the FIRST turn of the new chapter', () => {
    const { timeline, segmentation, turns, handleDeclareChapter } = build(3);

    handleDeclareChapter(turns[1].id, 'Journey Chapter');

    const chapters = segmentation.listChapters();
    expect(chapters).toHaveLength(2);

    const [oldCh, newCh] = chapters;
    // Boundary AT the clicked message: old ends before it, new starts there.
    expect(oldCh.status).toBe('completed');
    expect(oldCh.endIndex).toBe(1);
    expect(newCh.startIndex).toBe(1);
    expect(newCh.status).toBe('active');
    expect(newCh.topicShiftReason).toBe('User split chapter boundary');

    // The new chapter is non-empty and opens with the clicked message.
    const newTurns = timeline.getTurnSlice(newCh.startIndex, newCh.endIndex);
    expect(newTurns.map((t) => t.id)).toEqual([turns[1].id, turns[2].id]);

    // The old chapter keeps exactly the messages before the click.
    const oldTurns = timeline.getTurnSlice(oldCh.startIndex, oldCh.endIndex);
    expect(oldTurns.map((t) => t.id)).toEqual([turns[0].id]);
  });

  it('splitting on the first message still yields a non-empty new chapter starting there', () => {
    const { timeline, segmentation, turns, handleDeclareChapter } = build(3);

    handleDeclareChapter(turns[0].id, 'Journey Chapter');

    const chapters = segmentation.listChapters();
    expect(chapters).toHaveLength(2);
    const newCh = chapters[1];
    expect(newCh.startIndex).toBe(0);
    expect(newCh.topicShiftReason).toBe('User split chapter boundary');
    expect(timeline.getTurnSlice(newCh.startIndex, newCh.endIndex).map((t) => t.id)).toEqual([
      turns[0].id,
      turns[1].id,
      turns[2].id,
    ]);
  });

  it('splits inside an earlier completed chapter without touching the active one', () => {
    const { timeline, segmentation, turns, handleDeclareChapter } = build(4);
    segmentation.declareNewChapter('Chapter 2', 2, 'auto topic shift');
    expect(segmentation.listChapters()).toHaveLength(2);
    const activeChapterId = segmentation.listChapters()[1].id;

    // Click a message in chapter 1 (completed, [0, 2)).
    handleDeclareChapter(turns[1].id, 'Detail Dive');

    const chapters = segmentation.listChapters();
    expect(chapters).toHaveLength(3);
    const [c1, splitOff, c2] = chapters;
    expect(c1).toMatchObject({ status: 'completed', endIndex: 1 });
    expect(splitOff).toMatchObject({
      status: 'completed',
      startIndex: 1,
      endIndex: 2,
      topicShiftReason: 'User split chapter boundary',
    });
    // The active chapter is untouched — same identity, same window.
    expect(c2.id).toBe(activeChapterId);
    expect(c2).toMatchObject({ status: 'active', startIndex: 2 });
    // Split-off chapter holds the clicked message — never empty.
    expect(timeline.getTurnSlice(splitOff.startIndex, splitOff.endIndex).map((t) => t.id)).toEqual([
      turns[1].id,
    ]);
  });

  it('never creates a chapter when the message id is unknown', () => {
    const { segmentation, handleDeclareChapter } = build(3);

    handleDeclareChapter('ghost-message-id', 'Phantom Chapter');

    expect(segmentation.listChapters()).toHaveLength(1);
  });

  it('stale end on the ongoing last chapter still yields a non-empty tail chapter', () => {
    const { timeline, segmentation, turns, handleDeclareChapter } = build(4);
    // Legacy state: last chapter closed early (endIndex 2) but turns 2..3 arrived
    // without a new chapter — the ongoing rule still renders them there.
    segmentation.loadChapters([{ ...genesisChapter(), status: 'completed', endIndex: 2 }]);

    handleDeclareChapter(turns[3].id, 'Tail Chapter');

    const chapters = segmentation.listChapters();
    expect(chapters).toHaveLength(2);
    const tail = chapters[1];
    expect(tail.startIndex).toBe(3);
    // No inverted/empty window: the tail runs to the latest turn.
    expect(timeline.getTurnSlice(tail.startIndex, tail.endIndex).map((t) => t.id)).toEqual([
      turns[3].id,
    ]);
  });
});
