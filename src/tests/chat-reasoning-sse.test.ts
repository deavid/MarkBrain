/**
 * The chat route streams reasoning as its own SSE event (David 2026-10-30):
 * `event: reasoning` with { delta, chars, timestamp } — a LIVE preview only.
 *
 * THE EPHEMERAL LAW, pinned at the route seam: reasoning NEVER enters
 * `fullText`, never rides a `chunk` event, and never appears in
 * `complete.rawReply` (the thing that becomes the turn). The 'writing'
 * status fires on the first TEXT chunk, not on the first reasoning delta —
 * the card stays in its thinking phase while only reasoning has arrived.
 *
 * streamFromModel is mocked: this file pins the ROUTE's handling of
 * reasoning-carrying lane chunks (the wrapper's own split is pinned in
 * gemini-reasoning-split.test.ts). No provider is ever touched.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { initDb, closeDbForTests } from '../../server/db';
import type { LaneTextChunk } from '../../server/providers/lane';

initDb(':memory:');

vi.mock('../../server/providers/gemini', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../server/providers/gemini')>();
  return { ...mod, streamFromModel: vi.fn() };
});

const OWNER_EMAIL = 'owner@example.com';
const OWNER_PASSWORD = 'owner-pass-123456';
process.env.MARKBRAIN_OWNER_EMAIL = OWNER_EMAIL;
process.env.MARKBRAIN_OWNER_PASSWORD = OWNER_PASSWORD;

const { app } = await import('../../server/app');
const { createUser } = await import('../../server/lib/users');
const { unlockVaultWithPassword, writeKeysPayload } = await import('../../server/lib/accountVault');
const { streamFromModel } = await import('../../server/providers/gemini');

let server: Server;
let base = '';
let token = '';

function sseEvents(raw: string): Array<{ event: string; data: any }> {
  return raw
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? 'message';
      const data = /^data: (.+)$/m.exec(block)?.[1] ?? '{}';
      return { event, data: JSON.parse(data) };
    });
}

beforeAll(async () => {
  const user = createUser(OWNER_EMAIL, OWNER_PASSWORD, { isOwner: true });
  unlockVaultWithPassword(user.id, OWNER_PASSWORD);
  writeKeysPayload(user.id, { 'gemini-free': 'AIzaTESTKEY0000000000000000000000000' });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  token = ((await login.json()) as any).token;
});

afterAll(() => {
  server?.close();
  closeDbForTests();
  vi.unstubAllGlobals();
});

describe('POST /api/chat/stream — the reasoning event (David 2026-10-30)', () => {
  it('reasoning rides its own event, never the chunk stream nor the reply', async () => {
    const chunks: LaneTextChunk[] = [
      { reasoning: 'thinking hard about it' }, // reasoning-only first
      { text: 'Hello' },
      { text: ' world', reasoning: 'more thinking' }, // both ride
      { usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } },
    ];
    (streamFromModel as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      (async function* () {
        for (const c of chunks) yield c;
      })()
    );

    const res = await fetch(`${base}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: 'gemini-3.8-flash', compiledPrompt: 'PROMPT' }),
    });
    expect(res.status).toBe(200);
    const events = sseEvents(await res.text());

    // Reasoning events: running char count, never a `chunk` event.
    const reasoning = events.filter((e) => e.event === 'reasoning');
    expect(reasoning).toHaveLength(2);
    expect(reasoning[0].data).toMatchObject({ delta: 'thinking hard about it', chars: 22 });
    expect(reasoning[1].data).toMatchObject({ delta: 'more thinking', chars: 35 });
    expect(reasoning.every((e) => typeof e.data.timestamp === 'number')).toBe(true);

    // Text chunks carry ONLY text.
    const chunkDeltas = events.filter((e) => e.event === 'chunk').map((e) => e.data.delta);
    expect(chunkDeltas).toEqual(['Hello', ' world']);

    // The writing status fires on the first TEXT chunk, not the first
    // reasoning delta — thinking is still thinking.
    const writingIdx = events.findIndex((e) => e.event === 'status' && e.data.state === 'writing');
    expect(writingIdx).toBeGreaterThan(events.findIndex((e) => e.event === 'reasoning'));

    // THE EPHEMERAL LAW: the reply is prose only.
    const complete = events.find((e) => e.event === 'complete')!;
    expect(complete.data.rawReply).toBe('Hello world');
  });

  it('a reasoning-only stream still completes honestly (empty reply path unchanged)', async () => {
    (streamFromModel as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      (async function* () {
        yield { reasoning: 'endless pondering' } as LaneTextChunk;
      })()
    );
    const res = await fetch(`${base}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: 'gemini-3.8-flash', compiledPrompt: 'PROMPT' }),
    });
    const events = sseEvents(await res.text());
    expect(events.filter((e) => e.event === 'reasoning')).toHaveLength(1);
    // No chunk events, no writing status — nothing was written.
    expect(events.some((e) => e.event === 'chunk')).toBe(false);
    expect(events.some((e) => e.event === 'status' && e.data.state === 'writing')).toBe(false);
    const complete = events.find((e) => e.event === 'complete')!;
    expect(complete.data.rawReply).toBe('');
  });
});
