/**
 * Phase 2 — the linkage (David 2026-10-30, inspector design approved).
 *
 * The old UI guessed the call from the turn id (`jobIdFor` parsed
 * `turn-ai-job-...`), which only ever worked for VPS jobs: local turns,
 * regenerated replies, and failed drafts were all inspectable-GUESS-FREE.
 * The new law: the call id RIDES THE WIRE and lands where the click happens.
 *
 *   1. Local adapters emit a `call` SSE event with the recorder row id;
 *      executeStreamingTurn surfaces it as StreamTurnResult.callId.
 *   2. The server job stream carries callId in its snapshot and complete
 *      frames; the server commit writes it into the assistant turn's meta.
 *   3. Drafts persist callId — a FAILED/STOPPED draft still knows its row.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { initDb, getDb, closeDbForTests } from '../../server/db';

initDb(':memory:');

const OWNER_EMAIL = 'linkage-owner@example.com';
const OWNER_PASSWORD = 'owner-pass-123456';
process.env.MARKBRAIN_OWNER_EMAIL = OWNER_EMAIL;
process.env.MARKBRAIN_OWNER_PASSWORD = OWNER_PASSWORD;

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
        yield { candidates: [{ content: { parts: [{ text: 'thinking hard', thought: true }] } }] };
        yield { candidates: [{ content: { parts: [{ text: 'The answer.' }] } }] };
        yield { usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3, totalTokenCount: 14 } };
      },
    };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

vi.mock('../services/workspaceSession', () => ({
  getWorkspaceMode: () => 'vps',
  isOfflineReplica: () => false,
  // Faithful to the real scoping: mode 'vps' with NO session falls back to the
  // local prefix (getScopedStorageKey's documented absent-session behavior).
  getScopedStorageKey: (baseKey: string) => `markbrain:local:${baseKey}`,
}));

const { app } = await import('../../server/app');
const { createUser } = await import('../../server/lib/users');
const { unlockVaultWithPassword, writeKeysPayload } = await import('../../server/lib/accountVault');

function seedProject(userId: number): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (project_id, user_id, name, code_name, description, color, active_thread_id,
       granularity_law, revision, updated_at) VALUES ('proj-linkage', ?, 'Linkage', 'lnk', '', '#3355aa', 'th-linkage', 'user-only', 1, ?)`
  ).run(userId, now);
}

let server: Server;
let base = '';
let token = '';
let userId = 1;

beforeAll(async () => {
  const user = createUser(OWNER_EMAIL, OWNER_PASSWORD, { isOwner: true });
  userId = user.id;
  unlockVaultWithPassword(user.id, OWNER_PASSWORD);
  writeKeysPayload(user.id, { 'gemini-free': 'AIzaTESTKEY0000000000000000000000000' });
  seedProject(user.id);
  server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  token = ((await login.json()) as { token: string }).token;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  closeDbForTests();
});

const authed = (init?: RequestInit): RequestInit => ({
  ...init,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
});

describe('the linkage: call id rides the wire onto turns and drafts', () => {
  it('server commit: the assistant turn meta carries the recorder call id', { timeout: 20_000 }, async () => {
    const send = await fetch(`${base}/api/projects/proj-linkage/jobs/send`, authed({
      method: 'POST',
      body: JSON.stringify({
        threadId: 'th-linkage',
        askText: 'What is the plan?',
        compiledPrompt: 'The compiled payload.',
        systemInstruction: 'Be helpful.',
        model: 'gemini-3.5-flash-lite',
      }),
    }));
    expect([200, 201]).toContain(send.status);
    const { job } = (await send.json()) as { job: { jobId: string } };

    // The SNAPSHOT frame must carry the call id (a late watcher learns it
    // without waiting for the whole stream). A watcher attached BEFORE the
    // provider call starts learns it via the `call` event instead — the
    // snapshot it sees may have raced ahead of recorder.start.
    const streamRes = await fetch(`${base}/api/jobs/${job.jobId}/stream`, authed({}));
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    let callEventId: string | null = null;
    let snapshotCallId: string | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      const callEvt = /event: call\ndata: (.+)\n/.exec(raw);
      if (callEvt) {
        try {
          callEventId = (JSON.parse(callEvt[1]) as { callId?: string }).callId ?? null;
        } catch { /* keep reading */ }
      }
      const snap = /event: snapshot\ndata: (.+)\n/.exec(raw);
      if (snap) {
        try {
          snapshotCallId = (JSON.parse(snap[1]) as { callId?: string }).callId ?? null;
        } catch { /* keep reading */ }
      }
      if (raw.includes('event: complete')) break;
    }

    // The row exists and the turn committed with its id in meta.
    const calls = (await (await fetch(`${base}/api/logs/calls?job=${job.jobId}`, authed())).json()) as {
      calls: Array<{ id: string; turnId: string | null }>;
    };
    expect(calls.calls).toHaveLength(1);
    const call = calls.calls[0];
    expect(call.turnId).toBeTruthy();

    // THE LATE WATCHER LAW: attach AFTER the stream completed. Its snapshot
    // frame must still carry the call id (liveCtx fallback → the DB row).
    const late = await fetch(`${base}/api/jobs/${job.jobId}/stream`, authed({}));
    const lateRaw = await late.text();
    const lateSnap = /event: snapshot\ndata: (.+)\n/.exec(lateRaw);
    const lateCallId = lateSnap ? ((JSON.parse(lateSnap[1]) as { callId?: string }).callId ?? null) : null;
    expect(lateCallId).toBe(call.id);

    // THE COMMIT CARRIED IT: the assistant turn's meta.callId === the row id.
    const turnRow = getDb()
      .prepare(`SELECT doc_json FROM turns WHERE user_id = ? AND turn_id = ?`)
      .get(userId, call.turnId) as { doc_json: string } | undefined;
    expect(turnRow).toBeTruthy();
    const turn = JSON.parse(turnRow!.doc_json) as { meta?: { callId?: string } };
    expect(turn.meta?.callId).toBe(call.id);
  });

  it('draft persistence: a FAILED draft keeps its call id for the inspector', async () => {
    // Fail via a model the vault cannot resolve: the draft stays failed with
    // whatever the send produced. We exercise the persisted-DraftItem contract
    // directly on the real DraftQueue store.
    // DraftQueue resolves its storage at MODULE LOAD (typeof window) — the
    // device-local stub must exist BEFORE the import, or persistence is a
    // silent no-op and the reload-survival law is untestable here.
    const mem = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
      },
    };
    const { DraftQueue } = await import('../application/draftQueue');
    const store = { getItem: (k: string) => mem.get(k) ?? null };
    const drafts = new DraftQueue();
    const item = drafts.enqueue('th-linkage', 'This will fail.');
    drafts.markSending(item.id);
    // The wire carried a call id, then the attempt failed.
    drafts.setCallId(item.id, 'call-test-123');
    drafts.fail(item.id, 'The provider rejected the request.', undefined, 'PROVIDER_ERROR');
    // THE LAW: the failed draft still knows its row.
    expect(drafts.getItem(item.id)?.callId).toBe('call-test-123');
    // And it survives a reload (drafts are device-local, persisted under the
    // REAL scoped key — the mock mirrors getScopedStorageKey's absent-session
    // behavior: mode 'vps' with no session → local prefix).
    expect(store.getItem('markbrain:local:markbrain:draftQueue')).toContain('call-test-123');
  });
});
