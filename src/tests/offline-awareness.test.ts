/**
 * Offline awareness (PWA): navigator.onLine flips behavior, not correctness.
 *
 * - A send while offline stays QUEUED — never a doomed request that marks the
 *   head failed and blocks its thread. Reconnect walks the queue (the
 *   constructor's 'online' listener; in tests, the next kick point does).
 * - TTS and other network affordances gate on the same signal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SendQueue, type SendQueueDeps } from '../application/sendQueue';
import {
  isOnline,
  setOnlineForTests,
  subscribeOnline,
} from '../application/connectivity';

type Turn = { id: string; role: string; content: string; timestamp: number; meta?: unknown };

function makeDeps(overrides: Partial<SendQueueDeps> = {}) {
  const turns: Turn[] = [];
  let turnN = 0;
  const streamMock = vi.fn();

  const deps: SendQueueDeps = {
    threadRegistry: {
      getActiveThreadId: () => 'T1',
      getThread: () => ({
        id: 'T1',
        title: 'Test',
        titleState: 'placeholder',
        titleVersion: 0,
        lifecycle: 'active',
      }),
      patch: vi.fn(),
      getAttachments: () => [],
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
      appendTurn: (role: string, content: string, _a?: unknown, meta?: unknown) => {
        const t = { id: `t${++turnN}`, role, content, timestamp: Date.now(), meta };
        turns.push(t);
        return t;
      },
      updateTurn: vi.fn(),
      count: () => turns.length,
    } as never,
    segmentation: { listChapters: () => [], declareNewChapter: vi.fn() } as never,
    artifacts: { getArtifact: () => null, upsertArtifact: vi.fn((a: any) => a) } as never,
    versioning: { recordRevision: vi.fn() } as never,
    compiler: { compile: () => ({ compiledPrompt: 'PROMPT', systemInstruction: 'SYS' }) } as never,
    stream: { executeStreamingTurn: streamMock } as never,
    triggerReRender: vi.fn(),
    setStreamingStatus: vi.fn(),
    setStreamPhase: vi.fn(),
    markThreadUnread: vi.fn(),
    requestAutoTitle: async () => null,
    postChatCancel: vi.fn(),
    confirm: () => true,
    getContext: () => ({
      model: { id: 'gemini-3.8-flash', name: 'Google: Gemini 3.8 Flash' },
      projectId: 'p1',
      projectTitle: 'P',
      tokenCeiling: 1000,
    }),
    ...overrides,
  } as SendQueueDeps;

  return { deps, streamMock };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => setOnlineForTests(true));
afterEach(() => setOnlineForTests(true));

describe('connectivity snapshot', () => {
  it('defaults to online and notifies subscribers on the forced flip', () => {
    expect(isOnline()).toBe(true);
    const seen: boolean[] = [];
    const unsub = subscribeOnline(() => seen.push(isOnline()));
    setOnlineForTests(false);
    setOnlineForTests(true);
    unsub();
    expect(seen).toEqual([false, true]);
    expect(isOnline()).toBe(true);
  });
});

describe('sends while offline queue instead of failing', () => {
  it('offline send stays queued; no attempt is made', async () => {
    const { deps, streamMock } = makeDeps();
    const q = new SendQueue(() => deps);
    setOnlineForTests(false);
    q.handleSendMessage('held while offline');
    await flush();
    const d = q.getQueue()[0];
    expect(d.state).toBe('queued');
    expect(streamMock).not.toHaveBeenCalled();
    expect(deps.timeline.count()).toBe(0);
  });

  it('a later kick point once online walks the held queue (FIFO)', async () => {
    const { deps, streamMock } = makeDeps();
    streamMock.mockImplementation(
      (_p: unknown, cbs: any) => {
        cbs?.onChunk?.('reply ', 'reply ');
        return Promise.resolve({ cleanReply: 'reply ' });
      }
    );
    const q = new SendQueue(() => deps);
    setOnlineForTests(false);
    q.handleSendMessage('held');
    await flush();
    expect(q.getQueue()[0].state).toBe('queued');

    setOnlineForTests(true);
    q.handleSendMessage('after reconnect');
    await flush();
    await flush();
    // Both asks attempt in FIFO order, not just the new one.
    expect(streamMock).toHaveBeenCalledTimes(2);
  });

  it('retrying a failed draft while offline stays queued, never re-fails', async () => {
    const { deps, streamMock } = makeDeps();
    streamMock.mockRejectedValueOnce(new Error('boom'));
    const q = new SendQueue(() => deps);
    q.handleSendMessage('first');
    await flush();
    const failed = q.getQueue()[0];
    expect(failed.state).toBe('failed');

    setOnlineForTests(false);
    q.retryDraft(failed.id);
    await flush();
    expect(q.getQueue()[0].state).toBe('queued');
    expect(streamMock).toHaveBeenCalledTimes(1);
  });
});