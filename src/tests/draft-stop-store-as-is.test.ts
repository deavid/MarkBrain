/**
 * T3 emulated end-to-end through the real SendQueue (David 2026-10-25:
 * "hard to test, we will trust you here - and ENSURE YOU HAVE tests to
 * emulate this proper").
 *
 * The Stop contract (design-docs/18): a stopped attempt NEVER enters chat
 * storage. The partial lives on the draft, and the only exits are Retry /
 * Store-as-is / Discard. Store-as-is commits the pair with the partial as the
 * reply — that is the only way the text reaches the timeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SendQueue, type SendQueueDeps } from '../application/sendQueue';

type Turn = { id: string; role: string; content: string; timestamp: number; meta?: unknown };

function makeDeps(overrides: Partial<SendQueueDeps> = {}) {
  const turns: Turn[] = [];
  const appended: Array<{ role: string; content: string }> = [];
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
        appended.push({ role, content });
        return t;
      },
      updateTurn: (id: string, partial: { content?: string }) => {
        const t = turns.find((x) => x.id === id);
        if (t && partial.content !== undefined) t.content = partial.content;
      },
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

  return { deps, turns, appended, streamMock };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

describe('Stop mid-answer — the draft keeps the pair out of chat (T3)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('abort → stopped draft with the partial; timeline untouched', async () => {
    const { deps, appended, streamMock } = makeDeps();
    streamMock.mockImplementation(
      (_p: unknown, cbs: any) =>
        new Promise((_resolve, reject) => {
          cbs.onChunk?.('partial ', 'partial ');
          cbs.onChunk?.('words', 'partial words');
          cbs.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    const q = new SendQueue(() => deps);
    q.handleSendMessage('the ask');
    await flush();
    q.stopGeneration();
    await flush();

    const drafts = q.getDraftsForThread('T1');
    expect(drafts).toHaveLength(1);
    expect(drafts[0].state).toBe('stopped');
    expect(drafts[0].partial).toBe('partial words');
    // NOTHING reached chat storage — the ask is not a turn.
    expect(appended).toEqual([]);
  });

  it('Store-as-is commits the pair with the partial as the reply — the only exit that writes', async () => {
    const { deps, appended, streamMock } = makeDeps();
    streamMock.mockImplementation(
      (_p: unknown, cbs: any) =>
        new Promise((_resolve, reject) => {
          cbs.onChunk?.('partial words', 'partial words');
          cbs.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    const q = new SendQueue(() => deps);
    q.handleSendMessage('the ask');
    await flush();
    q.stopGeneration();
    await flush();

    q.storeAsIsDraft(q.getDraftsForThread('T1')[0].id);
    await flush();

    expect(appended).toEqual([
      { role: 'user', content: 'the ask' },
      { role: 'assistant', content: 'partial words' },
    ]);
    expect(q.getDraftsForThread('T1')).toHaveLength(0);
  });

  it('Discard drops the would-be pair — ask and partial leave no trace', async () => {
    const { deps, appended, streamMock } = makeDeps();
    streamMock.mockImplementation(
      (_p: unknown, cbs: any) =>
        new Promise((_resolve, reject) => {
          cbs.onChunk?.('partial words', 'partial words');
          cbs.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    const q = new SendQueue(() => deps);
    q.handleSendMessage('the ask');
    await flush();
    q.stopGeneration();
    await flush();
    q.discardDraft(q.getDraftsForThread('T1')[0].id);
    await flush();
    expect(appended).toEqual([]);
    expect(q.getDraftsForThread('T1')).toHaveLength(0);
  });

  it('a failed attempt lands on the draft with the real reason — never turn content', async () => {
    const { deps, appended, streamMock } = makeDeps();
    streamMock.mockRejectedValue(
      Object.assign(new Error('Gemini: API key not valid. Please pass a valid API key.'), {
        name: 'Error',
      })
    );
    const q = new SendQueue(() => deps);
    q.handleSendMessage('the ask');
    await flush();
    const drafts = q.getDraftsForThread('T1');
    expect(drafts).toHaveLength(1);
    expect(drafts[0].state).toBe('failed');
    expect(drafts[0].reason).toMatch(/API key not valid/);
    expect(appended).toEqual([]);
    // ...and the ghost reply the model never said must not exist anywhere.
    expect(drafts[0].text).toBe('the ask');
  });

  it('a successful attempt commits the pair atomically (both turns at once)', async () => {
    const { deps, appended, streamMock } = makeDeps();
    streamMock.mockResolvedValue({
      cleanReply: 'the reply',
      rawReply: 'the reply',
      artifacts: [],
      topicShift: undefined,
      telemetry: {
        model: 'gemini-3.8-flash',
        inputTokens: 5,
        outputTokens: 2,
        totalTokens: 7,
        latencyMs: 10,
        timeToFirstChunkMs: 3,
        isFallback: false,
      },
    });
    const q = new SendQueue(() => deps);
    q.handleSendMessage('the ask');
    await flush();
    expect(appended).toEqual([
      { role: 'user', content: 'the ask' },
      { role: 'assistant', content: 'the reply' },
    ]);
    expect(q.getDraftsForThread('T1')).toHaveLength(0);
  });
});
