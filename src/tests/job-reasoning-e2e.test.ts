/**
 * THE FULL THINKING-PREVIEW CHAIN, end to end (David 2026-10-30: "I could
 * clearly see that event source growing, but still no thinking coming through").
 *
 * Every half of this chain passed in isolation and yet the browser showed
 * nothing — so this test pins the WHOLE wire at once, with only the SDK faked:
 *
 *   mocked @google/genai (thought parts, exactly what includeThoughts streams)
 *     -> real streamFromModel splitter (thought -> reasoning)
 *     -> real job runner loop (broadcast event: reasoning)
 *     -> real /api/jobs/:id/stream endpoint
 *     -> real wire bytes
 *     -> real SendQueue.readVpsSse (the browser half)
 *     -> real DraftQueueTray render (the glass)
 *
 * The law: by the time this test is green, reasoning that reaches the browser's
 * EventSource CANNOT silently vanish before the card — and the card must show
 * the ticking count + the preview text.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { initDb } from '../../server/db';

initDb(':memory:');

// The REAL SDK shape when thinkingConfig.includeThoughts is on: thought parts
// arrive as content.parts entries with thought: true, interleaved before text.
vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      async generateContent() {
        return { text: 'DESCRIPTION: d\nSUMMARY: s' };
      },
      async embedContent() {
        return { embeddings: [{ values: [0.5, 0.5] }] };
      },
      async *generateContentStream() {
        // The gate mirrors the real provider latency: the watcher attaches
        // (or not) BEFORE any reasoning is broadcast. Without it the instant
        // mock completes the job before the test can even attach.
        await (globalThis as any).__reasoningGate;
        yield { candidates: [{ content: { parts: [{ text: 'Let me think about ', thought: true }] } }] };
        yield { candidates: [{ content: { parts: [{ text: 'the links carefully...', thought: true }] } }] };
        yield { candidates: [{ content: { parts: [{ text: 'More thinking.', thought: true }] } }] };
        yield { candidates: [{ content: { parts: [{ text: 'Hello world' }] } }] };
        yield { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } };
      },
    };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

// Browser-only session modules never run in this file; stub the ones the
// client half (sendQueue) imports so the import graph stays node-safe.
vi.mock('../services/workspaceSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/workspaceSession')>();
  return { ...actual, getWorkspaceMode: () => 'vps', getVpsSession: () => null, isOfflineReplica: () => false };
});

const OWNER_EMAIL = 'owner@example.com';
const OWNER_PASSWORD = 'owner-pass-123456';
process.env.MARKBRAIN_OWNER_EMAIL = OWNER_EMAIL;
process.env.MARKBRAIN_OWNER_PASSWORD = OWNER_PASSWORD;

const { app } = await import('../../server/app');
const { createUser } = await import('../../server/lib/users');
const { unlockVaultWithPassword, writeKeysPayload } = await import('../../server/lib/accountVault');
const { getDb } = await import('../../server/db');
const { SendQueue } = await import('../application/sendQueue');
const { DraftQueue } = await import('../application/draftQueue');

/** Seed the project row: the send endpoint 404s ghost projects (audit 26 L6). */
function seedProject(): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (project_id, user_id, name, code_name, description, color, active_thread_id,
       granularity_law, revision, updated_at) VALUES ('proj-reasoning-e2e', 1, 'Reasoning E2E', 'rzn', '', '#e05a66', 'thread-reasoning-e2e', 'user-only', 1, ?)`
  ).run(now);
}

let server: Server;
let base = '';
let token = '';

beforeAll(async () => {
  const user = createUser(OWNER_EMAIL, OWNER_PASSWORD, { isOwner: true });
  unlockVaultWithPassword(user.id, OWNER_PASSWORD);
  writeKeysPayload(user.id, { 'gemini-free': 'AIzaTESTKEY0000000000000000000000000' });
  seedProject();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  token = (await login.json() as { token: string }).token;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const authed = (init?: RequestInit): RequestInit => ({
  ...init,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
});

describe('the full thinking-preview chain: SDK -> splitter -> runner -> wire -> readVpsSse -> card', () => {
  it('reasoning reaches the wire, survives the client parser, and renders on the card', { timeout: 20_000 }, async () => {
    // 1. Enqueue a real job through the real endpoint.
    let releaseGate!: () => void;
    (globalThis as any).__reasoningGate = new Promise<void>((r) => (releaseGate = r));
    const projectId = 'proj-reasoning-e2e';
    const send = await fetch(`${base}/api/projects/${projectId}/jobs/send`, authed({
      method: 'POST',
      body: JSON.stringify({
        threadId: 'thread-reasoning-e2e',
        kind: 'send',
        askText: 'Link the artifacts properly.',
        compiledPrompt: 'The compiled payload.',
        systemInstruction: 'Be helpful.',
        model: 'gemini-3.5-flash-lite',
        stagedAttachments: [],
        capabilities: { writeArtifacts: true, autoChapter: false, graphLinks: false },
      }),
    }));
    expect([200, 201]).toContain(send.status);
    const { job } = (await send.json()) as { job: { jobId: string } };

    // 2. Watch the REAL stream endpoint; collect raw SSE bytes until complete.
    // The mock stream is gated: the job is mid-flight (state 'sending', no
    // chunks broadcast yet) while we attach — exactly David's real timing.
    const streamRes = await fetch(`${base}/api/jobs/${job.jobId}/stream`, authed({}));
    expect(streamRes.ok).toBe(true);
    releaseGate(); // attached mid-job — now let the provider stream
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      if (raw.includes('event: complete')) break;
    }

    // 3. THE WIRE: reasoning events with a running char count.
    const frames = raw.split('\n\n').filter((b) => b.trim());
    const reasoningFrames = frames
      .filter((b) => /^event: reasoning$/m.test(b))
      .map((b) => JSON.parse(/^data: (.+)$/m.exec(b)![1]));
    expect(reasoningFrames.length).toBeGreaterThan(0);
    expect(reasoningFrames[0].chars).toBeGreaterThan(0);
    const lastReasoningChars = reasoningFrames[reasoningFrames.length - 1].chars;
    // The thinking text NEVER rides the chunk events nor the reply.
    const chunkFrames = frames
      .filter((b) => /^event: chunk$/m.test(b))
      .map((b) => JSON.parse(/^data: (.+)$/m.exec(b)![1]));
    expect(chunkFrames.length).toBeGreaterThan(0);
    // The thinking text never rides the text path — neither as delta nor as
    // the accumulated partialText.
    for (const f of chunkFrames) {
      expect(String(f.delta ?? '')).not.toContain('think');
      expect(String(f.partialText ?? '')).not.toContain('think');
    }
    const complete = JSON.parse(/^data: (.+)$/m.exec(frames.find((b) => /^event: complete$/m.test(b))!)![1]);
    if (complete.rawReply) expect(complete.rawReply).not.toContain('Let me think');

    // 4. THE BROWSER HALF: the real readVpsSse against the REAL wire bytes —
    // the LIVE window David watched: mid-THINKING (before the first text
    // chunk; complete stripped because resolve() removes the draft).
    const thinkingWindow = raw.split('event: chunk')[0];
    expect(thinkingWindow).toContain('event: reasoning');
    const queue = new SendQueue(() => ({}) as never);
    const drafts = (queue as unknown as { drafts: InstanceType<typeof DraftQueue> }).drafts;
    const item = drafts.enqueue('thread-reasoning-e2e', 'Link the artifacts properly.');
    drafts.markSending(item.id);
    const fakeRes = new Response(thinkingWindow, { status: 200 }) as unknown as Response;
    const readVpsSse = (
      queue as unknown as { readVpsSse: (res: Response, item: unknown, deps: unknown) => Promise<boolean> }
    ).readVpsSse.bind(queue);
    const terminal = await readVpsSse(fakeRes, item, {
      drafts,
      markThreadUnread: () => {},
      triggerReRender: () => {},
      setStreamPhase: () => {},
      setStreamingStatus: () => {},
    });
    expect(terminal).toBe(false); // mid-flight — the card is still thinking

    const progress = drafts.getItem(item.id)?.progress;
    // THE contract David watched fail live: the thinking count arrives.
    expect(progress?.reasoningChars).toBe(lastReasoningChars);
    expect(progress?.reasoningChars).toBeGreaterThan(0);
    expect(progress?.reasoningPreview).toContain('Let me think');
    expect(progress?.phase).toBe('awaiting-first-token');

    // 5. THE GLASS: the card renders the ticking count + the preview text.
    const { renderToStaticMarkup } = await import('react-dom/server');
    const React = (await import('react')).default;
    const { DraftQueueTray } = await import('../ui/chat/DraftQueueTray');
    const html = renderToStaticMarkup(
      React.createElement(DraftQueueTray, {
        drafts: drafts.getItemsForThread('thread-reasoning-e2e'),
        onRetryDraft: () => {},
        onStoreAsIsDraft: () => {},
        onDiscardDraft: () => {},
      } as never)
    );
    expect(html).toContain(`${lastReasoningChars.toLocaleString?.() ?? lastReasoningChars} chars thinking`);
    expect(html).toContain('Let me think about');
  });
});
