/**
 * PHASE 3 UNIFICATION SUITE — one pure decision engine for committing an LLM
 * reply (shared/turnCommit/planTurnCommit.ts), replacing the two divergent
 * engines (client sendQueue commitPair/commitRegenerate + server
 * commitJobPairTransaction). The planner is PURE: no DB, no domains, no clock —
 * every input it needs (state, request) is handed to it, every output is a
 * plan an applier executes. These tests pin the unified rules:
 *
 *   1. Artifact gate + create-vs-update (revision = birth vs OLD state).
 *   2. Capability gates: writeArtifacts OFF drops ops, autoChapter OFF no cut.
 *   3. Topic-shift chapter law: askIndex, boundary retitle, seal-before-create.
 *   4. Link/unlink resolution via artifactFileName slugs + receipts law.
 *   5. Provenance stamping on send (attachments, extracted turnIndex).
 *   6. Regenerate merges into the existing turn.
 */
import { describe, it, expect } from 'vitest';
import { planTurnCommit, type TurnCommitRequest, type TurnCommitState } from '../../shared/turnCommit/planTurnCommit';
import { getMellowPastelColor } from '../../shared/colors';
import type { UniversalArtifactDocument } from '../../shared/types/artifact';
import type { ChapterPartition } from '../../shared/types/chapters';
import type { SemanticEdge } from '../../shared/types/graph';
import type { ChatAttachment } from '../../shared/types/threads';
import type { Turn } from '../../shared/types/timeline';
import type { ExtractedArtifactUpsert } from '../../shared/stream/types';

const NOW = 1_700_000_000_000;

function upsert(over: Partial<ExtractedArtifactUpsert> = {}): ExtractedArtifactUpsert {
  return {
    id: 'the-hook',
    title: 'The Hook',
    type: 'document',
    content: { subtitle: 'sub', description: 'the description', summary: 'the summary', body: '# The Hook\n\nbody' },
    ...over,
  };
}

function baseState(over: Partial<TurnCommitState> = {}): TurnCommitState {
  return {
    artifacts: [],
    edges: [],
    threadTurnsCount: 0,
    chapters: [],
    ...over,
  };
}

function baseRequest(over: Partial<TurnCommitRequest> = {}): TurnCommitRequest {
  return {
    kind: 'send',
    threadId: 'thread-1',
    pairKey: 'pair-1',
    projectId: 'proj-1',
    askText: 'what about the hook?',
    cleanReply: 'Here is the answer.',
    artifactUpserts: [],
    topicShift: null,
    links: [],
    unlinks: [],
    stagedAttachments: [],
    capabilities: { autoChapter: false, writeArtifacts: true, graphLinks: true },
    telemetry: { model: 'gemini-test', inputTokens: 10, outputTokens: 20, totalTokens: 30, latencyMs: 5 },
    now: NOW,
    targetTurnIndex: 0,
    ids: { userTurnId: 'turn-user-1', assistantTurnId: 'turn-ai-1' },
    state: baseState(),
    ...over,
  };
}

function chapter(over: Partial<ChapterPartition> = {}): ChapterPartition {
  return {
    id: 'ch-1',
    workspaceId: 'proj-1',
    threadId: 'thread-1',
    title: 'Genesis',
    status: 'active',
    startIndex: 0,
    createdAt: NOW - 1000,
    ...over,
  };
}

function edge(over: Partial<SemanticEdge> = {}): SemanticEdge {
  return { id: 'edge-x', sourceId: 'art-a', targetId: 'art-b', kind: 'relates_to', ...over };
}

/* ── (a) artifact create vs update ─────────────────────────────────────── */

describe('artifact gate: create vs update', () => {
  it('creates a full doc for a brand-new note (birth-state revision, pastel color, tags, graph seed)', () => {
    const plan = planTurnCommit(baseRequest({ artifactUpserts: [upsert()] }));
    expect(plan.artifactOps).toHaveLength(1);
    const op = plan.artifactOps[0];
    expect(op.isNew).toBe(true);
    expect(op.artifact.id).toBe('the-hook');
    expect(op.artifact.workspaceId).toBe('proj-1');
    expect(op.artifact.code).toBe('the-hook');
    expect(op.artifact.title).toBe('The Hook');
    expect(op.artifact.type).toBe('document');
    expect(op.artifact.category).toBe('note');
    expect(op.artifact.color).toBe(getMellowPastelColor('the-hook'));
    expect(op.artifact.isHighConcept).toBe(false);
    expect(op.artifact.tags).toEqual(['chat-extracted', 'document']);
    expect(op.artifact.graph).toEqual({ is_high_concept: false, x: 300, y: 200 });
    expect(op.artifact.current).toEqual({
      subtitle: 'sub',
      description: 'the description',
      summary: 'the summary',
      body: '# The Hook\n\nbody',
    });
    expect(op.artifact.createdAt).toBe(NOW);
    expect(op.artifact.updatedAt).toBe(NOW);
    // Revision = birth state, recorded BEFORE the upsert is applied.
    expect(op.revision.actor).toBe('ai');
    expect(op.revision.changeSummary).toBe('Created from chat: the description');
    expect(op.revision.title).toBe('The Hook');
    expect(op.revision.layers).toEqual(op.artifact.current);
    expect(op.revision.provenance).toEqual({ threadId: 'thread-1', turnId: 'turn-ai-1', turnIndex: 1 });
  });

  it('falls back the body to "# <title>" when the model wrote no content', () => {
    const plan = planTurnCommit(
      baseRequest({ artifactUpserts: [upsert({ content: { subtitle: '', description: '', summary: '', body: '' } })] })
    );
    expect(plan.artifactOps[0].artifact.current.body).toBe('# The Hook');
  });

  it('updates an existing note (matched by code) and snapshots the OLD state as the revision', () => {
    const existing = {
      id: 'art-old',
      workspaceId: 'proj-1',
      code: 'the-hook',
      title: 'Old Title',
      type: 'document' as const,
      category: 'note',
      isHighConcept: false,
      color: '#4a3f6b',
      current: { subtitle: 'old sub', description: 'old description', summary: 'old summary', body: 'old body' },
      tags: ['chat-extracted'],
      createdAt: NOW - 5000,
      updatedAt: NOW - 5000,
      layersStaleAt: NOW - 100,
    } as UniversalArtifactDocument;
    const plan = planTurnCommit(
      baseRequest({ artifactUpserts: [upsert()], state: baseState({ artifacts: [existing] }) })
    );
    expect(plan.artifactOps).toHaveLength(1);
    const op = plan.artifactOps[0];
    expect(op.isNew).toBe(false);
    // The doc KEEPS the existing id (found by code), gets the new layers.
    expect(op.artifact.id).toBe('art-old');
    expect(op.artifact.title).toBe('The Hook');
    expect(op.artifact.current.body).toBe('# The Hook\n\nbody');
    expect(op.artifact.updatedAt).toBe(NOW);
    expect(op.artifact.layersStaleAt).toBeUndefined();
    // Revision = the OLD state, so History can show/revert what the chat overwrote.
    expect(op.revision.changeSummary).toBe('Update from chat: the description');
    expect(op.revision.title).toBe('Old Title');
    expect(op.revision.layers).toEqual(existing.current);
  });

  it('derives the code from the title slug when the upsert carries no id, and still matches by code', () => {
    // The EXACT slug rule both engines used — lowercase, [^a-z0-9]+ → '-',
    // slice(0,30), no trailing-dash trim: 'My Note!' → 'my-note-'.
    const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const fresh = planTurnCommit(baseRequest({ artifactUpserts: [upsert({ id: '', title: 'My Note!' })] }));
    expect(fresh.artifactOps[0].artifact.code).toBe(slug('My Note!'));
    expect(fresh.artifactOps[0].artifact.code).toBe('my-note-');
    expect(fresh.artifactOps[0].isNew).toBe(true);

    // A later reply with the same title slug matches the earlier note by code.
    const existing = {
      id: 'art-1',
      workspaceId: 'proj-1',
      code: 'my-note-',
      title: 'My Note!',
      type: 'document' as const,
      category: 'note',
      isHighConcept: false,
      current: { subtitle: '', description: 'd', summary: 's', body: 'b' },
      tags: [],
      createdAt: NOW,
      updatedAt: NOW,
    } as UniversalArtifactDocument;
    const plan = planTurnCommit(
      baseRequest({
        artifactUpserts: [upsert({ id: '', title: 'My Note!' })],
        state: baseState({ artifacts: [existing] }),
      })
    );
    expect(plan.artifactOps[0].isNew).toBe(false);
    expect(plan.artifactOps[0].artifact.id).toBe('art-1');
  });

  it('a chapter-type upsert becomes a chapter-typed note', () => {
    const plan = planTurnCommit(baseRequest({ artifactUpserts: [upsert({ type: 'chapter', id: 'ch-note' })] }));
    expect(plan.artifactOps[0].artifact.type).toBe('chapter');
    expect(plan.artifactOps[0].artifact.category).toBe('chapter');
  });
});

/* ── (b) writeArtifacts OFF drops artifactOps ──────────────────────────── */

describe('capability gate: writeArtifacts OFF', () => {
  it('drops rogue artifact upserts entirely', () => {
    const plan = planTurnCommit(
      baseRequest({
        artifactUpserts: [upsert(), upsert({ id: 'other', title: 'Other' })],
        capabilities: { autoChapter: false, writeArtifacts: false, graphLinks: false },
      })
    );
    expect(plan.artifactOps).toEqual([]);
  });

  it('still stamps the extractedArtifacts chips on the assistant turn (render truth), gated ops only', () => {
    const plan = planTurnCommit(
      baseRequest({
        artifactUpserts: [upsert()],
        capabilities: { autoChapter: false, writeArtifacts: false, graphLinks: false },
      })
    );
    expect(plan.assistantTurn.extractedArtifacts).toHaveLength(1);
  });
});

/* ── (c) topic-shift chapter law ───────────────────────────────────────── */

describe('topic-shift chapter law', () => {
  it('autoChapter OFF → no chapter op, even with a shift', () => {
    const plan = planTurnCommit(
      baseRequest({
        topicShift: { title: 'New Chapter' },
        capabilities: { autoChapter: false, writeArtifacts: true, graphLinks: false },
      })
    );
    expect(plan.chapterOp).toBeNull();
  });

  it('no shift → no chapter op', () => {
    const plan = planTurnCommit(baseRequest({ topicShift: null }));
    expect(plan.chapterOp).toBeNull();
  });

  it('send: the cut applies at the ask (threadTurnsCount), sealing the ongoing chapter and creating a new one', () => {
    const ongoing = chapter({ id: 'ch-genesis', startIndex: 0 }); // endIndex undefined = ongoing
    const plan = planTurnCommit(
      baseRequest({
        topicShift: { title: 'Depth-First Dive', subtitle: 'sub', description: 'desc', summary: 'sum' },
        capabilities: { autoChapter: true, writeArtifacts: true, graphLinks: true },
        state: baseState({ threadTurnsCount: 4, chapters: [ongoing] }),
      })
    );
    expect(plan.chapterOp).not.toBeNull();
    expect(plan.chapterOp!.askIndex).toBe(4);
    expect(plan.chapterOp!.chapterToSeal).toEqual({ id: 'ch-genesis', endIndex: 4 });
    expect(plan.chapterOp!.create).toMatchObject({
      id: '', // the applier assigns the real id
      workspaceId: 'proj-1',
      threadId: 'thread-1',
      title: 'Depth-First Dive',
      status: 'active',
      startIndex: 4,
    });
    expect(plan.chapterOp!.boundaryToRetitle).toBeNull();
  });

  it('a chapter already cut at the ask index is RETITLED, never duplicated', () => {
    const boundary = chapter({ id: 'ch-at-4', startIndex: 4, title: 'Old Name', status: 'completed', endIndex: 9 });
    const plan = planTurnCommit(
      baseRequest({
        topicShift: { title: 'Better Name', subtitle: 'new sub' },
        capabilities: { autoChapter: true, writeArtifacts: true, graphLinks: true },
        state: baseState({ threadTurnsCount: 4, chapters: [chapter({ id: 'ch-0', startIndex: 0 }), boundary] }),
      })
    );
    expect(plan.chapterOp!.boundaryToRetitle).toMatchObject({
      id: 'ch-at-4',
      title: 'Better Name',
      subtitle: 'new sub',
      status: 'active',
      endIndex: undefined,
    });
    expect(plan.chapterOp!.chapterToSeal).toBeNull();
    expect(plan.chapterOp!.create).toBeNull();
  });

  it('regenerate: the cut applies at the ask of the replaced pair (threadTurnsCount - 2)', () => {
    const plan = planTurnCommit(
      baseRequest({
        kind: 'regenerate',
        targetTurnId: 'turn-ai-9',
        targetTurnIndex: 5,
        topicShift: { title: 'Regen Cut' },
        capabilities: { autoChapter: true, writeArtifacts: true, graphLinks: true },
        state: baseState({ threadTurnsCount: 6 }),
      })
    );
    expect(plan.chapterOp!.askIndex).toBe(4);
  });

  it('seals the LAST active chapter that still runs past the ask', () => {
    const sealed = chapter({ id: 'ch-done', startIndex: 0, status: 'completed', endIndex: 2 });
    const active1 = chapter({ id: 'ch-a', startIndex: 2, endIndex: 10 });
    const active2 = chapter({ id: 'ch-b', startIndex: 5 }); // ongoing, last
    const plan = planTurnCommit(
      baseRequest({
        topicShift: { title: 'Cut' },
        capabilities: { autoChapter: true, writeArtifacts: true, graphLinks: true },
        state: baseState({ threadTurnsCount: 4, chapters: [sealed, active1, active2] }),
      })
    );
    // Both actives run past askIndex 4; the LAST one wins.
    expect(plan.chapterOp!.chapterToSeal).toEqual({ id: 'ch-b', endIndex: 4 });
  });
});

/* ── (d) link resolution ───────────────────────────────────────────────── */

describe('link resolution + receipts', () => {
  const alpha = {
    id: 'art-alpha',
    workspaceId: 'proj-1',
    code: 'alpha',
    title: 'Alpha Notes',
    type: 'document' as const,
    category: 'note',
    isHighConcept: false,
    current: { subtitle: '', description: '', summary: '', body: '' },
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
  } as UniversalArtifactDocument;

  it('resolves file slugs against artifactFileName of existing notes AND notes created in the same reply', () => {
    const plan = planTurnCommit(
      baseRequest({
        artifactUpserts: [upsert({ id: 'beta', title: 'Beta Page' })],
        links: [{ source: 'alpha-notes.md', target: 'beta-page.md', kind: 'relates_to' }],
        state: baseState({ artifacts: [alpha] }),
      })
    );
    expect(plan.edgeUpserts).toEqual([
      { id: 'edge-art-alpha-beta-relates_to', sourceId: 'art-alpha', targetId: 'beta', kind: 'relates_to' },
    ]);
    expect(plan.receipts).toEqual([
      {
        action: 'link',
        sourceFile: 'alpha-notes.md',
        targetFile: 'beta-page.md',
        kind: 'relates_to',
        sourceId: 'art-alpha',
        targetId: 'beta',
        applied: true,
      },
    ]);
  });

  it('capability OFF → receipt with resolved ids but applied:false, no edges', () => {
    const plan = planTurnCommit(
      baseRequest({
        links: [{ source: 'alpha-notes.md', target: 'alpha-notes.md', kind: 'refines' }],
        capabilities: { autoChapter: false, writeArtifacts: true, graphLinks: false },
        state: baseState({ artifacts: [alpha] }),
      })
    );
    expect(plan.edgeUpserts).toEqual([]);
    expect(plan.receipts).toHaveLength(1);
    expect(plan.receipts[0].sourceId).toBe('art-alpha');
    expect(plan.receipts[0].targetId).toBe('art-alpha');
    expect(plan.receipts[0].applied).toBe(false);
  });

  it('a self-link never applies (source === target)', () => {
    const plan = planTurnCommit(
      baseRequest({
        links: [{ source: 'alpha-notes.md', target: 'alpha-notes.md', kind: 'refines' }],
        state: baseState({ artifacts: [alpha] }),
      })
    );
    expect(plan.edgeUpserts).toEqual([]);
    expect(plan.receipts[0].applied).toBe(false);
  });

  it('an unresolved side still emits a receipt with a null id', () => {
    const plan = planTurnCommit(
      baseRequest({
        links: [{ source: 'alpha-notes.md', target: 'ghost-file.md', kind: 'relates_to' }],
        state: baseState({ artifacts: [alpha] }),
      })
    );
    expect(plan.receipts[0]).toMatchObject({ sourceId: 'art-alpha', targetId: null, applied: false });
  });
});

/* ── (e) unlink ────────────────────────────────────────────────────────── */

describe('unlink resolution', () => {
  const edges = [
    edge({ id: 'edge-1', sourceId: 'art-a', targetId: 'art-b', kind: 'relates_to' }),
    edge({ id: 'edge-2', sourceId: 'art-a', targetId: 'art-b', kind: 'refines' }),
    edge({ id: 'edge-3', sourceId: 'art-b', targetId: 'art-a', kind: 'relates_to' }),
  ];

  it('kind narrows the removal to the matching edges only', () => {
    const plan = planTurnCommit(
      baseRequest({
        unlinks: [{ source: 'a.md', target: 'b.md', kind: 'relates_to' }],
        state: baseState({ artifacts: [
          { id: 'art-a', code: 'a', title: 'A' } as any,
          { id: 'art-b', code: 'b', title: 'B' } as any,
        ], edges }),
      })
    );
    expect(plan.edgeDeletes).toEqual(['edge-1']);
    expect(plan.receipts).toEqual([
      { action: 'unlink', sourceFile: 'a.md', targetFile: 'b.md', kind: 'relates_to', sourceId: 'art-a', targetId: 'art-b', applied: true },
    ]);
  });

  it('a kind-less unlink removes EVERY kind between the pair', () => {
    const plan = planTurnCommit(
      baseRequest({
        unlinks: [{ source: 'a.md', target: 'b.md', kind: null }],
        state: baseState({ artifacts: [
          { id: 'art-a', code: 'a', title: 'A' } as any,
          { id: 'art-b', code: 'b', title: 'B' } as any,
        ], edges }),
      })
    );
    expect(plan.edgeDeletes).toEqual(['edge-1', 'edge-2']);
    expect(plan.receipts[0].kind).toBe('');
    expect(plan.receipts[0].applied).toBe(true);
  });

  it('graphLinks OFF → applied:false, no deletes, receipt still emitted', () => {
    const plan = planTurnCommit(
      baseRequest({
        unlinks: [{ source: 'a.md', target: 'b.md', kind: null }],
        capabilities: { autoChapter: false, writeArtifacts: true, graphLinks: false },
        state: baseState({ artifacts: [
          { id: 'art-a', code: 'a', title: 'A' } as any,
          { id: 'art-b', code: 'b', title: 'B' } as any,
        ], edges }),
      })
    );
    expect(plan.edgeDeletes).toEqual([]);
    expect(plan.receipts[0].applied).toBe(false);
    expect(plan.receipts[0].sourceId).toBe('art-a');
  });
});

/* ── (f) receipts law ──────────────────────────────────────────────────── */

describe('receipts law', () => {
  it('receipts ride the assistant turn when any link/unlink was asked — even capability-off', () => {
    const plan = planTurnCommit(
      baseRequest({
        links: [{ source: 'ghost-a.md', target: 'ghost-b.md', kind: 'relates_to' }],
        capabilities: { autoChapter: false, writeArtifacts: true, graphLinks: false },
      })
    );
    expect(plan.receipts).toHaveLength(1);
    expect(plan.assistantTurn.extractedLinks).toEqual(plan.receipts);
  });

  it('no links asked → no extractedLinks field on the turn', () => {
    const plan = planTurnCommit(baseRequest());
    expect(plan.receipts).toEqual([]);
    expect(plan.assistantTurn.extractedLinks).toBeUndefined();
  });
});

/* ── (g) send provenance + turn construction ───────────────────────────── */

describe('send: provenance stamping + turn construction', () => {
  it('welds staged attachments to the user turn and stamps turnIndex on everything', () => {
    const staged: ChatAttachment = { artifactId: 'art-att', granularity: 'full', addedAt: NOW - 1, turnIndex: null };
    const plan = planTurnCommit(
      baseRequest({
        artifactUpserts: [upsert()],
        stagedAttachments: [staged],
        state: baseState({ threadTurnsCount: 3 }),
      })
    );
    expect(plan.userTurnIndex).toBe(3);
    expect(plan.assistantTurnIndex).toBe(4);
    expect(plan.userTurn).toMatchObject({
      id: 'turn-user-1',
      role: 'user',
      content: 'what about the hook?',
      timestamp: NOW,
      threadId: 'thread-1',
    });
    expect(plan.userTurn!.meta!.attachments).toEqual([
      { ...staged, turnIndex: 3, turnId: 'turn-user-1' },
    ]);
    expect(plan.assistantTurn.timestamp).toBe(NOW + 1);
    expect(plan.assistantTurn.extractedArtifacts![0].turnIndex).toBe(4);
    expect(plan.assistantTurn.meta).toMatchObject({
      model: 'gemini-test',
      isFallback: false,
      isStreaming: false,
      streamState: 'completed',
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      latencyMs: 5,
    });
    // The revision provenance points at the assistant turn + its index.
    expect(plan.artifactOps[0].revision.provenance).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-ai-1',
      turnIndex: 4,
    });
    expect(plan.threadTouch).toEqual({
      lastOutcome: 'ok',
      lastActivityAt: NOW,
      preview: 'what about the hook?',
    });
  });

  it('no staged attachments → user turn meta stays undefined', () => {
    const plan = planTurnCommit(baseRequest());
    expect(plan.userTurn!.meta).toBeUndefined();
  });

  it('strips residual <link> tags from the stored reply (defensive; the demuxer normally did it)', () => {
    const plan = planTurnCommit(
      baseRequest({ cleanReply: 'prose <link source="a.md" target="b.md" kind="x" /> more prose' })
    );
    expect(plan.assistantTurn.content).toBe('prose more prose');
  });

  it('isFallback flows from the telemetry (server store-as-is path passes true)', () => {
    const plan = planTurnCommit(
      baseRequest({ telemetry: { inputTokens: 1, outputTokens: 1, totalTokens: 2, isFallback: true } })
    );
    expect(plan.assistantTurn.meta!.isFallback).toBe(true);
    expect(plan.assistantTurn.meta!.model).toBeUndefined();
  });
});

/* ── (h) regenerate merge ──────────────────────────────────────────────── */

describe('regenerate: merge into the existing turn', () => {
  const existing: Turn = {
    id: 'turn-ai-9',
    role: 'assistant',
    content: 'old reply',
    timestamp: NOW - 500,
    threadId: 'thread-1',
    extractedLinks: [{ action: 'link', sourceFile: 'x.md', targetFile: 'y.md', kind: 'relates_to', sourceId: null, targetId: null, applied: false }],
    meta: { model: 'old-model', attachments: [{ artifactId: 'keep-me', turnIndex: 5 }] },
  };

  it('replaces content/timestamp/layers on the SAME turn doc, merging meta, keeping ids', () => {
    const plan = planTurnCommit(
      baseRequest({
        kind: 'regenerate',
        targetTurnId: 'turn-ai-9',
        targetTurnIndex: 5,
        askText: 'the original ask',
        cleanReply: 'the NEW reply',
        artifactUpserts: [upsert({ id: 'regen-note', title: 'Regen Note' })],
        existingAssistantTurn: existing,
        telemetry: { model: 'new-model', inputTokens: 5, outputTokens: 6, totalTokens: 11 },
        ids: { userTurnId: 'unused', assistantTurnId: 'turn-ai-9' },
        state: baseState({ threadTurnsCount: 6 }),
      })
    );
    expect(plan.userTurn).toBeNull();
    expect(plan.userTurnIndex).toBe(5);
    expect(plan.assistantTurnIndex).toBe(5);
    expect(plan.assistantTurn.id).toBe('turn-ai-9');
    expect(plan.assistantTurn.content).toBe('the NEW reply');
    expect(plan.assistantTurn.timestamp).toBe(NOW);
    expect(plan.assistantTurn.extractedArtifacts![0]).toMatchObject({ id: 'regen-note', turnIndex: 5 });
    // meta merge: existing keys preserved (attachments), telemetry wins.
    expect(plan.assistantTurn.meta).toMatchObject({
      model: 'new-model',
      attachments: [{ artifactId: 'keep-me', turnIndex: 5 }],
      inputTokens: 5,
    });
    // Old receipts with no new asks stay put.
    expect(plan.assistantTurn.extractedLinks).toEqual(existing.extractedLinks);
    expect(plan.artifactOps[0].revision.provenance).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-ai-9',
      turnIndex: 5,
    });
  });

  it('new receipts replace the old ones on regenerate', () => {
    const plan = planTurnCommit(
      baseRequest({
        kind: 'regenerate',
        targetTurnId: 'turn-ai-9',
        targetTurnIndex: 5,
        links: [{ source: 'a.md', target: 'b.md', kind: 'refines' }],
        existingAssistantTurn: existing,
        ids: { userTurnId: 'unused', assistantTurnId: 'turn-ai-9' },
        state: baseState({
          threadTurnsCount: 6,
          artifacts: [
            { id: 'art-a', code: 'a', title: 'A' } as any,
            { id: 'art-b', code: 'b', title: 'B' } as any,
          ],
        }),
      })
    );
    expect(plan.assistantTurn.extractedLinks).toEqual([
      { action: 'link', sourceFile: 'a.md', targetFile: 'b.md', kind: 'refines', sourceId: 'art-a', targetId: 'art-b', applied: true },
    ]);
    expect(plan.edgeUpserts).toHaveLength(1);
  });

  it('a missing existing turn doc still yields a well-formed replacement', () => {
    const plan = planTurnCommit(
      baseRequest({
        kind: 'regenerate',
        targetTurnId: 'turn-ai-9',
        targetTurnIndex: 2,
        existingAssistantTurn: null,
        ids: { userTurnId: 'unused', assistantTurnId: 'turn-ai-9' },
      })
    );
    expect(plan.assistantTurn.id).toBe('turn-ai-9');
    expect(plan.assistantTurn.role).toBe('assistant');
    expect(plan.assistantTurn.threadId).toBe('thread-1');
  });
});
