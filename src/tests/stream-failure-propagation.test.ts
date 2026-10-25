/**
 * Failures are drafts, never turns (design-docs/18).
 *
 * History of this file: it started as the pin for the bug David reported
 * (2026-10-25) — a failed request was stored as `<turn role="assistant">
 * Gemini: API key not valid…</turn>` and read back to the model as something
 * it had said. The transport pins below (1-4) keep failures loud; the copy
 * bans keep the two ghost strings dead; the queue laws pin the replacement
 * design: an unpaired ask lives in the DraftQueue and only commitPair writes
 * to the timeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { chatStreamMock } = vi.hoisted(() => ({ chatStreamMock: vi.fn() }));
vi.mock('../gateway/api', () => ({ chatStream: chatStreamMock }));

import { StreamProtocolDomain } from '../domains/03-stream-protocol';
import { DraftQueue, nextSendable, type DraftItem } from '../application/draftQueue';

const frame = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const sse = (frames: string[]): Response =>
  new Response(frames.join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

const turn = () => new StreamProtocolDomain().executeStreamingTurn({ model: 'gemini-3.5-flash-lite' });

describe('stream failures propagate — never an empty success', () => {
  beforeEach(() => chatStreamMock.mockReset());

  it('rejects with the provider reason when status carries state=error (the 401 case)', async () => {
    chatStreamMock.mockResolvedValue(
      sse([
        frame('status', { state: 'connecting', message: 'Connecting…', timestamp: 1, model: 'gemini-3.5-flash-lite' }),
        frame('status', {
          state: 'error',
          message: 'Gemini: API key not valid. Please pass a valid API key.',
          timestamp: 2,
          model: 'gemini-3.5-flash-lite',
        }),
      ])
    );
    await expect(turn()).rejects.toThrow(/API key not valid/);
  });

  it('rejects on an explicit error event — the frame handler must not swallow it', async () => {
    chatStreamMock.mockResolvedValue(sse([frame('error', { error: 'provider exploded' })]));
    await expect(turn()).rejects.toThrow('provider exploded');
  });

  it('rejects when the stream ends with no text and no complete event', async () => {
    chatStreamMock.mockResolvedValue(
      sse([frame('status', { state: 'connecting', message: 'Connecting…', timestamp: 1, model: 'm' })])
    );
    await expect(turn()).rejects.toThrow(/ended without a reply/);
  });

  it('rejects when PARTIAL text arrived but no complete event — the partial belongs to the draft', async () => {
    chatStreamMock.mockResolvedValue(
      sse([
        frame('chunk', { delta: 'half a reply' }),
      ])
    );
    await expect(turn()).rejects.toThrow(/ended without a reply/);
  });

  it('still resolves the happy path: chunk + complete → cleanReply', async () => {
    chatStreamMock.mockResolvedValue(
      sse([
        frame('chunk', { delta: 'Hello back' }),
        frame('complete', {
          rawReply: 'Hello back',
          telemetry: {
            model: 'gemini-3.5-flash-lite',
            inputTokens: 10,
            outputTokens: 3,
            totalTokens: 13,
            latencyMs: 5,
            timeToFirstChunkMs: 2,
            isFallback: false,
          },
        }),
        frame('done', { success: true }),
      ])
    );
    const result = await turn();
    expect(result.cleanReply).toContain('Hello back');
  });
});

describe('the ghost copy stays dead', () => {
  const src = readFileSync(join(process.cwd(), 'src/application/sendQueue.ts'), 'utf8');

  it('never contains the reply the model never said', () => {
    expect(src).not.toContain('No reply came back. Try again.');
    expect(src).not.toContain('reasoning engine');
  });

  it('never writes a failure into turn content — the draft holds it', () => {
    // Failure paths must land on the DraftQueue (fail/stop), not updateTurn.
    expect(src).toContain('this.drafts.fail(');
    expect(src).toContain('this.drafts.stop(');
    // The only writer of both turns is the atomic commit.
    expect(src).toContain('private commitPair(');
    expect(src).not.toContain("lastOutcome: 'error'");
    expect(src).not.toContain("lastOutcome: 'interrupted'");
  });
});

describe('DraftQueue laws (design-docs/18)', () => {
  const item = (over: Partial<DraftItem>): DraftItem => ({
    id: over.id ?? `d-${Math.random()}`,
    threadId: over.threadId ?? 'T',
    text: over.text ?? 'hello',
    state: over.state ?? 'queued',
    createdAt: over.createdAt ?? Date.now(),
    ...over,
  });

  it('an ask is a draft until paired — enqueue writes nothing but the queue', () => {
    const q = new DraftQueue();
    const d = q.enqueue('T', 'testing');
    expect(d.state).toBe('queued');
    expect(q.getItemsForThread('T')).toHaveLength(1);
  });

  it('failure keeps the draft with the reason — the reason is queue-side only', () => {
    const q = new DraftQueue();
    const d = q.enqueue('T', 'testing');
    q.markSending(d.id);
    q.fail(d.id, 'Gemini: API key not valid. Please pass a valid API key.', 'partial words');
    const it = q.getItem(d.id)!;
    expect(it.state).toBe('failed');
    expect(it.reason).toMatch(/API key not valid/);
    expect(it.partial).toBe('partial words');
    // still a draft — no commit happened
    expect(q.getItemsForThread('T')).toHaveLength(1);
  });

  it('the three exits: retry re-queues (clean resend), store-as-is resolves, discard removes', () => {
    const q = new DraftQueue();
    const d = q.enqueue('T', 'ask');
    q.markSending(d.id);
    q.fail(d.id, 'boom', 'half a reply');

    q.retry(d.id);
    let it = q.getItem(d.id)!;
    expect(it.state).toBe('queued');
    expect(it.reason).toBeUndefined();
    expect(it.partial).toBe('half a reply'); // kept for store-as-is, not sent

    q.markSending(d.id);
    q.fail(d.id, 'boom again', 'half a reply');
    q.resolve(d.id); // store-as-is commits the pair then resolves
    expect(q.getItem(d.id)).toBeUndefined();

    const d2 = q.enqueue('T', 'ask2');
    q.markSending(d2.id);
    q.stop(d2.id, 'partial');
    q.discard(d2.id);
    expect(q.getItems()).toHaveLength(0);
  });

  it('Stop is a failed variant with the same exits', () => {
    const q = new DraftQueue();
    const d = q.enqueue('T', 'ask');
    q.markSending(d.id);
    q.stop(d.id, 'partial words');
    const it = q.getItem(d.id)!;
    expect(it.state).toBe('stopped');
    expect(it.partial).toBe('partial words');
    expect(nextSendable(q.getItems())).toBeNull(); // stopped head blocks
    q.retry(d.id);
    expect(nextSendable(q.getItems())?.id).toBe(d.id);
  });

  it('strict FIFO per thread: a failed head blocks its thread and is never skipped', () => {
    const items = [
      item({ id: 'a1', threadId: 'A', state: 'failed' }),
      item({ id: 'a2', threadId: 'A', state: 'queued' }),
      item({ id: 'b1', threadId: 'B', state: 'queued' }),
    ];
    // A is blocked at the head; B (a different conversation) may proceed.
    expect(nextSendable(items)?.id).toBe('b1');
    // A2 is never sendable while a1 is unresolved — pair order = send order.
    const onlyA = items.filter((i) => i.threadId === 'A');
    expect(nextSendable(onlyA)).toBeNull();
  });

  it('only one message in flight at a time', () => {
    const items = [
      item({ id: 's', threadId: 'A', state: 'sending' }),
      item({ id: 'w', threadId: 'B', state: 'queued' }),
    ];
    expect(nextSendable(items)).toBeNull();
  });

  it('new sends enter at the tail; the head of a thread is attempted first', () => {
    const items = [
      item({ id: 'old', threadId: 'A', state: 'queued', createdAt: 1 }),
      item({ id: 'new', threadId: 'A', state: 'queued', createdAt: 2 }),
    ];
    expect(nextSendable(items)?.id).toBe('old');
  });

  it('drafts survive reload (device-local) but buffers do not', () => {
    const store = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
    vi.stubGlobal('window', { localStorage: fakeStorage });
    try {
      const q1 = new DraftQueue();
      const d = q1.enqueue('T', 'survive me');
      q1.markSending(d.id);
      q1.fail(d.id, 'offline', 'partial kept');
      q1.setBuffers(d.id, [{ some: 'artifact' }], []);

      const q2 = new DraftQueue(); // "reload"
      const it = q2.getItem(d.id)!;
      expect(it.text).toBe('survive me');
      expect(it.state).toBe('failed');
      expect(it.reason).toBe('offline');
      expect(it.partial).toBe('partial kept');
      expect(it.bufferedArtifacts).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
