/**
 * Unified data model suite — the shape invariants that killed the dual model
 * (design-docs/08_UNIFIED_DATA_MODEL.md): one chapter-turns selector with ONE
 * ongoing rule, one meta vocabulary, one open edge-kind vocabulary.
 */
import { describe, it, expect } from 'vitest';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline/DialogueTimelineDomain';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation/ChapterSegmentationDomain';
import {
  groupTurnsByChapter,
  isChapterOngoing,
} from '../domains/02-chapter-segmentation/selectors';
import type { ChapterPartition } from '../domains/02-chapter-segmentation/types';
import { TopologicalGraphDomain } from '../domains/02-topological-graph/TopologicalGraphDomain';
import { KNOWN_RELATION_KINDS } from '../domains/02-topological-graph/types';

describe('unified model: chapter-turns selector', () => {
  it('applies the ongoing rule (active OR last) and windows turns accordingly', () => {
    const timeline = new DialogueTimelineDomain('proj-1', []);
    const segmentation = new ChapterSegmentationDomain('proj-1', [
      {
        id: 'chap-genesis',
        workspaceId: 'proj-1',
        title: 'Genesis',
        status: 'active',
        startIndex: 0,
        createdAt: 0,
      },
    ]);
    // three turns, then a chapter split at 2
    timeline.appendTurn('user', 't0');
    timeline.appendTurn('assistant', 't1');
    timeline.appendTurn('user', 't2');
    segmentation.declareNewChapter('Ch2', 2, 'shift');
    // force-close Ch2 but leave it LAST in the list
    const chapters = segmentation.listChapters();
    const ch2 = segmentation.getChapter(chapters[1].id)!;
    segmentation.closeChapter(ch2.id);

    const groups = groupTurnsByChapter(timeline, segmentation);
    expect(groups).toHaveLength(2);

    // closed NON-last chapter: window [start, end) — ongoing false
    expect(groups[0].ongoing).toBe(false);
    expect(groups[0].turns.map((t) => t.content)).toEqual(['t0', 't1']);

    // LAST chapter is ongoing even when status === 'completed' — runs to latest
    expect(isChapterOngoing(segmentation.listChapters(), 1)).toBe(true);
    expect(groups[1].ongoing).toBe(true);
    expect(groups[1].turns.map((t) => t.content)).toEqual(['t2']);

    // and the inverse: an 'active' chapter early in the list is also ongoing
    const forced: ChapterPartition[] = [
      { id: 'a', workspaceId: 'p', title: 'A', status: 'active', startIndex: 0, endIndex: 1, createdAt: 0 },
      { id: 'b', workspaceId: 'p', title: 'B', status: 'completed', startIndex: 1, createdAt: 0 },
    ];
    expect(isChapterOngoing(forced, 0)).toBe(true);
    expect(isChapterOngoing(forced, 1)).toBe(true);
  });
});

describe('unified model: meta vocabulary', () => {
  it('turn meta carries exactly the provider-neutral vocabulary — no dual names', () => {
    const timeline = new DialogueTimelineDomain('proj-1', []);
    const turn = timeline.appendTurn('assistant', 'hello');
    timeline.updateTurn(turn.id, {
      meta: {
        model: 'test-model',
        inputTokens: 120,
        outputTokens: 45,
        totalTokens: 165,
        latencyMs: 420,
        timeToFirstChunkMs: 90,
        isStreaming: false,
        streamState: 'completed',
        isFallback: true,
      },
    });
    const meta = timeline.getTurn(turn.id)!.meta!;
    expect(Object.keys(meta).sort()).toEqual(
      [
        'inputTokens',
        'isFallback',
        'isStreaming',
        'latencyMs',
        'model',
        'outputTokens',
        'timeToFirstChunkMs',
        'totalTokens',
        'streamState',
      ].sort()
    );
    // (the exact key-set equality above is the "no dual names" invariant)
  });
});

describe('unified model: edge-kind openness', () => {
  it('round-trips arbitrary kinds and still matches ancestors on known kinds', () => {
    const graph = new TopologicalGraphDomain();
    // arbitrary kind survives the round-trip (vocabulary is open per 01 §4.8)
    const custom = graph.addEdge('x', 'y', 'supported_by_v2');
    expect(graph.listEdges().find((e) => e.id === custom.id)?.kind).toBe('supported_by_v2');
    // known kinds keep traversing: parent_of reaches ancestors
    graph.addEdge('parent', 'x', 'parent_of');
    graph.addEdge('grand', 'parent', 'born_from');
    expect(graph.getAncestors('x').sort()).toEqual(['grand', 'parent']);
    expect(KNOWN_RELATION_KINDS).toContain('relates_to');
  });
});
