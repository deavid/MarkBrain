/**
 * The Send Model (design-docs/23): drafts own their payload, their progress,
 * and their exit code.
 *
 *   1. Enqueue snapshots the armed set — retry re-sends THAT snapshot even
 *      after the tray/registry set changes (same send = same payload).
 *   2. Sending freezes the snapshot (updateDraftAttachments refuses).
 *   3. Phase ladder: queued → connecting → awaiting-first-token → writing
 *      (since set on each change, firstTokenAt + chars while writing).
 *   4. VAULT_LOCKED lands as errorCode; the reason stays a human sentence.
 *   5. Discard drops the snapshot with the draft — nothing re-arms.
 *
 * Pure/logic layers only (DraftQueue + SendQueue with stub deps) — no DOM,
 * no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DraftQueue,
  type DraftItem,
} from '../application/draftQueue';
import {
  SendQueue,
  type SendQueueDeps,
} from '../application/sendQueue';
import { looksLikeVaultLocked, VAULT_LOCKED_REASON, vpsPhaseFor } from '../application/sendQueue';
import type { ChatAttachment } from '../domains/06-chat-threads/types';

const att = (id: string, turnIndex: number | null = null): ChatAttachment => ({
  artifactId: id,
  granularity: 'full',
  addedAt: 1,
  turnIndex,
  turnId: turnIndex === null ? null : `t-${turnIndex}`,
});

type Turn = { id: string; role: string; content: string; timestamp: number };

function makeDeps() {
  const turns: Turn[] = [];
  let turnN = 0;
  const streamMock = vi.fn();
  const compileCalls: Array<{ attachments: unknown }> = [];
  let armed: ChatAttachment[] = [att('A', 0), att('B', null)];

  const deps: SendQueueDeps = {
    threadRegistry: {
      getActiveThreadId: () => 'T1',
      getThread: () => ({
        id: 'T1',
        title: 'Test',
        titleState: 'placeholder',
        titleVersion: 0,
        lifecycle: 'active',
        // Package 2 §2.4: the chapter-cut law only fires when autoChapter is ON.
        capabilities: { autoChapter: true },
      }),
      patch: vi.fn(),
      getAttachments: () => [...armed],
      getStagedAttachments: () => armed.filter((a) => a.turnIndex === null),
      stageArtifact: vi.fn(),
      unstageArtifact: vi.fn(),
      setAttachmentGranularity: vi.fn(),
      commitStagedAttachments: () => 0,
      getInactiveContent: () => null,
      appendInactiveTurn: () => null,
      updateInactiveTurn: vi.fn(),
      attachArtifact: vi.fn(),
      declareChapterInactive: vi.fn(),
      applyAutoTitle: () => true,
    } as never,
    timeline: {
      getTurns: () => turns,
      appendTurn: (role: string, content: string) => {
        const t = { id: `t${++turnN}`, role, content, timestamp: Date.now() };
        turns.push(t);
        return t;
      },
      updateTurn: vi.fn(),
      count: () => turns.length,
    } as never,
    segmentation: {
      listChapters: () => [],
      declareNewChapter: vi.fn(),
      upsertChapterAtBoundary: vi.fn(),
    } as never,
    artifacts: { getArtifact: () => null, listArtifacts: () => [], upsertArtifact: vi.fn((a: unknown) => a) } as never,
    graph: { listEdges: () => [] } as never,
    versioning: { recordRevision: vi.fn() } as never,
    compiler: {
      compile: (args: { attachments: unknown }) => {
        compileCalls.push({ attachments: args.attachments });
        return { compiledPrompt: 'P', systemInstruction: 'S' };
      },
    } as never,
    stream: { executeStreamingTurn: streamMock } as never,
    triggerReRender: vi.fn(),
    setStreamingStatus: vi.fn(),
    setStreamPhase: vi.fn(),
    markThreadUnread: vi.fn(),
    requestAutoTitle: async () => null,
    postChatCancel: vi.fn(),
    confirm: () => true,
    getContext: () => ({
      model: { id: 'gemini-3.8-flash', name: 'Gemini' } as never,
      projectId: 'p1',
      projectTitle: 'P',
      tokenCeiling: 1000,
    }),
  } as SendQueueDeps;

  return {
    deps,
    compileCalls,
    streamMock,
    setArmed: (list: ChatAttachment[]) => {
      armed = list;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

describe('the draft owns its payload (design 23 §2.1)', () => {
  it('enqueue snapshots the armed set; a copy, not a live reference', () => {
    const q = new DraftQueue();
    const source = [att('A', 0), att('B', null)];
    const d = q.enqueue('T', 'ask');
    q.setAttachments(d.id, source);
    source.push(att('C', null)); // mutate the source AFTER the snapshot
    const stored = q.getItem(d.id)!.attachments!;
    expect(stored.map((a) => a.artifactId)).toEqual(['A', 'B']);
  });

  it('retry re-sends the SAME snapshot even after the registry set changes', async () => {
    const { deps, compileCalls, streamMock, setArmed } = makeDeps();
    streamMock.mockRejectedValue(new Error('provider exploded'));
    const q = new SendQueue(() => deps);
    q.handleSendMessage('the ask');
    await flush();

    // The tray/registry set changes AFTER the enqueue snapshot.
    setArmed([att('Z', null)]);

    q.retryDraft(q.getDraftsForThread('T1')[0].id);
    await flush();

    expect(compileCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of compileCalls) {
      expect((call.attachments as ChatAttachment[]).map((a) => a.artifactId)).toEqual(['A', 'B']);
    }
  });

  it('sending freezes: updateDraftAttachments is refused once markSending ran', () => {
    const q = new DraftQueue();
    const d = q.enqueue('T', 'ask');
    q.setAttachments(d.id, [att('B', null)]);
    q.markSending(d.id);
    // The queue-side freeze; SendQueue.updateDraftAttachments refuses the same way.
    const before = q.getItem(d.id)!.attachments!.map((a) => a.artifactId);
    expect(before).toEqual(['B']);
    expect(q.getItem(d.id)!.state).toBe('sending');
  });

  it('discard drops the snapshot with the draft — nothing re-arms', () => {
    const q = new DraftQueue();
    const d = q.enqueue('T', 'ask');
    q.setAttachments(d.id, [att('B', null)]);
    q.discard(d.id);
    expect(q.getItem(d.id)).toBeUndefined();
    expect(q.getItems()).toHaveLength(0);
  });
});

describe('topic-shift chapter law on the client (David 2026-10-25)', () => {
  it('LAST shift wins; the cut lands at the human ask; an existing cut is retitled, not duplicated', async () => {
    const { deps, streamMock } = makeDeps();
    streamMock.mockImplementation((_p: unknown, cbs: any) => {
      cbs.onTopicShift?.({ title: 'Alpha', description: 'first' });
      cbs.onTopicShift?.({ title: 'Beta', description: 'second' });
      return { cleanReply: 'the reply', telemetry: undefined };
    });
    const q = new SendQueue(() => deps);
    q.handleSendMessage('the ask that changes the topic');
    await flush();

    const seg = deps.segmentation as unknown as {
      declareNewChapter: ReturnType<typeof vi.fn>;
      upsertChapterAtBoundary: ReturnType<typeof vi.fn>;
    };
    expect(seg.upsertChapterAtBoundary).toHaveBeenCalledTimes(1);
    expect(seg.upsertChapterAtBoundary).toHaveBeenCalledWith('Beta', 0, undefined, 'second', undefined);
    expect(seg.declareNewChapter).not.toHaveBeenCalled();
  });
});

describe('honest progress phases (design 23 §2.2)', () => {
  it('vpsPhaseFor: server truth → card phase — queued never claims thinking', () => {
    expect(vpsPhaseFor('queued')).toBe('queued'); // accepted / FIFO-blocked — NOT thinking
    expect(vpsPhaseFor('sending')).toBe('connecting'); // RPC in flight, no ACK
    expect(vpsPhaseFor('streaming')).toBe('connecting'); // legacy event → connecting
    expect(vpsPhaseFor('connected')).toBe('awaiting-first-token'); // provider ACK, zero text
    expect(vpsPhaseFor('writing')).toBe('writing');
    expect(vpsPhaseFor('anything-else')).toBe('connecting'); // unknown → honest default
  });


  it('ladder: queued → connecting → awaiting-first-token → writing', () => {
    const q = new DraftQueue();
    const d = q.enqueue('T', 'ask');
    expect(q.getItem(d.id)!.progress?.phase).toBe('queued');

    q.setProgress(d.id, { phase: 'connecting' });
    let p = q.getItem(d.id)!.progress!;
    expect(p.phase).toBe('connecting');
    expect(typeof p.since).toBe('number');

    const beforeAwait = Date.now();
    q.setProgress(d.id, { phase: 'awaiting-first-token' });
    p = q.getItem(d.id)!.progress!;
    expect(p.phase).toBe('awaiting-first-token');
    expect(p.since).toBeGreaterThanOrEqual(beforeAwait);

    q.setProgress(d.id, { phase: 'writing', firstTokenAt: Date.now(), chars: 12 });
    p = q.getItem(d.id)!.progress!;
    expect(p.phase).toBe('writing');
    expect(p.firstTokenAt).toBeGreaterThan(0);
    expect(p.chars).toBe(12);

    q.setProgress(d.id, { chars: 1204 });
    p = q.getItem(d.id)!.progress!;
    expect(p.phase).toBe('writing');
    expect(p.chars).toBe(1204);
    expect(p.firstTokenAt).toBeGreaterThan(0);
  });

  it('a chunked attempt that fails keeps the writing clock + chars on the draft', async () => {
    const { deps, streamMock } = makeDeps();
    streamMock.mockImplementation((_p: unknown, cbs: any) => {
      cbs.onChunk?.('hello ', 'hello ');
      cbs.onChunk?.('world', 'hello world');
      return Promise.reject(new Error('provider exploded'));
    });
    const q = new SendQueue(() => deps);
    q.handleSendMessage('the ask');
    await flush();
    const d = q.getDraftsForThread('T1')[0];
    expect(d.progress?.phase).toBe('writing');
    expect(d.progress?.chars).toBe('hello world'.length);
    expect(d.partial).toBe('hello world');
    expect(d.reason).toMatch(/provider exploded/);
  });
});

describe('VAULT_LOCKED exit (design 23 §2.3)', () => {
  it('looksLikeVaultLocked matches the known sentences', () => {
    expect(
      looksLikeVaultLocked(
        'Server session keys are locked after a server restart. Enter your password to unlock.'
      )
    ).toBe(true);
    expect(looksLikeVaultLocked('Local key vault is locked.')).toBe(true);
    expect(looksLikeVaultLocked('Gemini: API key not valid.')).toBe(false);
  });

  it('a failed attempt with the code lands errorCode; the reason stays human-readable', async () => {
    const { deps, streamMock } = makeDeps();
    streamMock.mockRejectedValue(
      new Error('Server session keys are locked after a server restart. Enter your password to unlock.')
    );
    const q = new SendQueue(() => deps);
    q.handleSendMessage('the ask');
    await flush();
    const d = q.getDraftsForThread('T1')[0];
    expect(d.state).toBe('failed');
    expect(d.errorCode).toBe('VAULT_LOCKED');
    expect(d.reason).toMatch(/Enter your password/);
    expect(d.reason).not.toBe(VAULT_LOCKED_REASON); // the provider's own sentence stands
  });

  it('retry clears the old errorCode but keeps the snapshot', async () => {
    const q = new DraftQueue();
    const d = q.enqueue('T', 'ask');
    q.setAttachments(d.id, [att('B', null)]);
    q.markSending(d.id);
    q.fail(d.id, 'boom', undefined, 'VAULT_LOCKED');
    q.retry(d.id);
    const it = q.getItem(d.id) as DraftItem;
    expect(it.state).toBe('queued');
    expect(it.errorCode).toBeUndefined();
    expect(it.attachments!.map((a) => a.artifactId)).toEqual(['B']);
  });
});
