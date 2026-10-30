/**
 * The thinking preview on the draft card (David 2026-10-30).
 *
 * Reasoning streams to the DraftQueue as an in-memory-only progress field:
 * reasoningPreview / reasoningChars on DraftProgress. Laws pinned here:
 *   1. reasoning deltas tick reasoningChars/reasoningPreview while the card
 *      is thinking;
 *   2. the preview RESETS when the phase flips to writing — the thinking
 *      preview belongs to thinking (clearing keeps the card honest);
 *   3. reasoning after writing never resurrects the preview;
 *   4. reasoning NEVER touches the draft's partial text;
 *   5. reasoning NEVER persists — the localStorage save strips it;
 *   6. the VPS job stream's `reasoning` event lands the same way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DraftQueue } from '../application/draftQueue';
import { SendQueue, type SendQueueDeps } from '../application/sendQueue';

type Turn = { id: string; role: string; content: string; timestamp: number };

function makeDeps() {
  const turns: Turn[] = [];
  let turnN = 0;
  const streamMock = vi.fn();

  const deps: SendQueueDeps = {
    threadRegistry: {
      getActiveThreadId: () => 'T1',
      getThread: () => ({
        id: 'T1', title: 'Test', titleState: 'placeholder', titleVersion: 0, lifecycle: 'active',
      }),
      patch: vi.fn(),
      getAttachments: () => [],
      commitStagedAttachments: () => 0,
      getStagedAttachments: () => [],
      attachArtifact: vi.fn(),
      applyAutoTitle: () => true,
    } as never,
    timeline: {
      getTurns: () => turns,
      turnsFor: () => turns,
      appendTurn: (role: string, content: string) => {
        const t = { id: `t${++turnN}`, role, content, timestamp: Date.now() };
        turns.push(t);
        return t;
      },
      appendTurnFor: (_threadId: string, role: string, content: string) => {
        const t = { id: `t${++turnN}`, role, content, timestamp: Date.now() };
        turns.push(t);
        return t;
      },
      updateTurn: vi.fn(),
      updateTurnFor: vi.fn(),
      count: () => turns.length,
    } as never,
    segmentation: {
      listChapters: () => [],
      chaptersFor: () => [],
      declareNewChapter: vi.fn(),
      upsertChapterAtBoundary: vi.fn(),
      upsertChapterAtBoundaryFor: vi.fn(),
    } as never,
    artifacts: { getArtifact: () => null, listArtifacts: () => [], upsertArtifact: vi.fn((a: unknown) => a) } as never,
    graph: { listEdges: () => [] } as never,
    versioning: { recordRevision: vi.fn() } as never,
    compiler: { compile: () => ({ compiledPrompt: 'P', systemInstruction: 'S' }) } as never,
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

  return { deps, streamMock };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

const RESULT = {
  cleanReply: 'Answer', rawReply: 'Answer', artifacts: [], topicShift: undefined,
  links: [], unlinks: [], telemetry: undefined,
};

describe('the reasoning preview lives on the draft progress — thinking only', () => {
  beforeEach(() => {
    vi.unstubAllGlobals(); // no window → DraftQueue persistence is a no-op
  });

  it('reasoning ticks the preview while thinking; writing resets it; late reasoning never resurrects it', async () => {
    const { deps, streamMock } = makeDeps();
    streamMock.mockImplementation(async (_p: unknown, cbs: any) => {
      await cbs.onStatus?.({ state: 'connected', message: 'thinking', timestamp: 1 });

      await cbs.onReasoning?.('pondering the ask', 'pondering the ask');
      const drafts = (q as unknown as { drafts: DraftQueue }).drafts;
      const p1 = drafts.getItemsForThread('T1')[0].progress;
      expect(p1?.reasoningChars).toBe(17);
      expect(p1?.reasoningPreview).toBe('pondering the ask');
      expect(p1?.phase).toBe('awaiting-first-token'); // reasoning does not flip the phase

      await cbs.onStatus?.({ state: 'writing', message: 'writing', timestamp: 2 });
      const p2 = drafts.getItemsForThread('T1')[0].progress;
      expect(p2?.phase).toBe('writing');
      expect(p2?.reasoningChars).toBe(0); // THE RESET
      expect(p2?.reasoningPreview).toBe('');

      await cbs.onReasoning?.(' late', ' late'); // after text started — client ignores
      const p3 = drafts.getItemsForThread('T1')[0].progress;
      expect(p3?.reasoningChars).toBe(0);

      return RESULT;
    });

    const q = new SendQueue(() => deps);
    q.handleSendMessage('the ask');
    await flush();

    // The pair committed with PROSE ONLY — reasoning leaked nowhere.
    expect(deps.timeline.getTurns().map((t) => t.content)).toEqual(['the ask', 'Answer']);
  });

  it('reasoning never persists: the localStorage save carries no reasoning fields', () => {
    const saved: string[] = [];
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: (_k: string, v: string) => saved.push(v),
        removeItem: () => {},
      },
    });
    try {
      const dq = new DraftQueue();
      const d = dq.enqueue('T', 'ask');
      dq.setProgress(d.id, {
        phase: 'awaiting-first-token', since: 1,
        reasoningPreview: 'secret thoughts', reasoningChars: 99,
      });
      const json = saved.at(-1) ?? '';
      expect(json).not.toContain('reasoning');
      expect(json).not.toContain('secret thoughts');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('readVpsSse — the job stream reasoning event (David 2026-10-30)', () => {
  beforeEach(() => vi.unstubAllGlobals());

  function sseResponse(frames: string[]): Response {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(c) {
          for (const f of frames) c.enqueue(encoder.encode(f));
          c.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    );
  }

  function queueWithThinkingDraft(deps: SendQueueDeps) {
    const q = new SendQueue(() => deps);
    const draftsQueue = (q as unknown as { drafts: DraftQueue }).drafts;
    const item = draftsQueue.enqueue('T1', 'the ask');
    draftsQueue.markSending(item.id);
    draftsQueue.setProgress(item.id, { phase: 'awaiting-first-token', since: Date.now() });
    const readVpsSse = (
      q as unknown as { readVpsSse: (res: Response, item: unknown, deps: SendQueueDeps) => Promise<boolean> }
    ).readVpsSse.bind(q);
    return { q, item, readVpsSse };
  }

  it('a reasoning event updates reasoningPreview/chars and never the partial text', async () => {
    const { deps } = makeDeps();
    const { q, item, readVpsSse } = queueWithThinkingDraft(deps);

    const terminal = await readVpsSse(
      sseResponse([
        'event: reasoning\ndata: {"type":"reasoning","delta":"deep thought","chars":12}\n\n',
        'event: reasoning\ndata: {"type":"reasoning","delta":" more","chars":17}\n\n',
      ]),
      item,
      deps
    );
    expect(terminal).toBe(false); // no terminal event → the caller re-attaches

    const d = q.getDraftsForThread('T1')[0];
    expect(d.progress?.reasoningChars).toBe(17);
    expect(d.progress?.reasoningPreview).toBe('deep thought more');
    // The partial text is prose only — reasoning never entered it.
    expect(d.partial).toBeUndefined();
    expect(d.progress?.phase).toBe('awaiting-first-token');
  });

  it('the writing transition clears the reasoning preview', async () => {
    const { deps } = makeDeps();
    const { q, item, readVpsSse } = queueWithThinkingDraft(deps);

    await readVpsSse(
      sseResponse([
        'event: reasoning\ndata: {"type":"reasoning","delta":"deep thought","chars":12}\n\n',
        'event: chunk\ndata: {"type":"chunk","delta":"AB","partialText":"AB"}\n\n',
      ]),
      item,
      deps
    );

    const d = q.getDraftsForThread('T1')[0];
    expect(d.progress?.phase).toBe('writing');
    expect(d.progress?.reasoningChars).toBe(0); // THE RESET
    expect(d.progress?.reasoningPreview).toBe('');
    expect(d.partial).toBe('AB');
  });
});
