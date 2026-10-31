/**
 * Flight recorder Phase 1 — the DATA layer for the per-message inspector
 * (David 2026-10-30, approved 6-tab design).
 *
 * Today's recorder rows are LIES by omission:
 *   - `request_json` holds our internal function arguments, not what the
 *     provider actually received (thinkingConfig / reasoning effort are
 *     built inside the provider adapters, after the recorder ran).
 *   - The reasoning text is thrown away — only the char count broadcast.
 *   - No first-reasoning timestamp, no chunk counts.
 *
 * The new laws (do not weaken):
 *   - `request.wire` = the EXACT payload the provider call received,
 *     scrubbed of secrets. What we sent, how.
 *   - `reasoningText` = the model's full thinking stream (ephemeral, same
 *     TTL as the row) — never in `responseText`.
 *   - `tFirstReasoning` < `tFirstToken`: the wall-clock of the first
 *     thinking token.
 *   - `textChunks` / `reasoningChunks` = streaming chunk counts.
 *   - `httpStatus` = the provider's HTTP status when the wire is raw fetch
 *     (local mode); null when the SDK hides it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { initDb, getDb, closeDbForTests } from '../../server/db';

initDb(':memory:');

/* ── A. The schema annealer: the new columns must exist ──────────────────── */

describe('api_call_logs schema: the inspector columns exist', () => {
  it('has reasoning_text, t_first_reasoning, text_chunks, reasoning_chunks, http_status', () => {
    const db = getDb();
    const cols = (db.prepare(`PRAGMA table_info(api_call_logs)`).all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    for (const col of ['reasoning_text', 't_first_reasoning', 'text_chunks', 'reasoning_chunks', 'http_status']) {
      expect(cols).toContain(col);
    }
  });
});

/* ── B. The recorder API: new lifecycle + fields ─────────────────────────── */

const { recordCallStart, recordCallFirstReasoning, recordCallEnd, getCallLog } = await import(
  '../../server/lib/callRecorder'
);

describe('callRecorder: first-reasoning, reasoning text, chunks, wire payload', () => {
  it('records t_first_reasoning (first wins, like tAck/tFirstToken)', () => {
    const id = recordCallStart({
      userId: 1,
      kind: 'chat',
      provider: 'gemini',
      model: 'gemini-test',
      request: { endpoint: 'generateContentStream', model: 'gemini-test' },
    });
    if (!id) throw new Error('recordCallStart returned null');
    recordCallFirstReasoning(id);
    const t1 = getCallLog(1, id)?.tFirstReasoning;
    expect(t1).not.toBeNull();
    recordCallFirstReasoning(id);
    // First wins: the second call must NOT move the timestamp.
    expect(getCallLog(1, id)?.tFirstReasoning).toBe(t1);
  });

  it('stores reasoningText on end, NEVER in responseText, with chunk counts', () => {
    const id = recordCallStart({
      userId: 1,
      kind: 'chat',
      provider: 'gemini',
      model: 'gemini-test',
      request: { endpoint: 'generateContentStream', model: 'gemini-test' },
    });
    if (!id) throw new Error('recordCallStart returned null');
    recordCallEnd(id, {
      status: 'ok',
      responseText: 'Hello world',
      reasoningText: 'Let me think about it carefully...',
      textChunks: 3,
      reasoningChunks: 4,
    });
    const call = getCallLog(1, id);
    expect(call?.reasoningText).toContain('Let me think');
    expect(call?.responseText).toBe('Hello world');
    expect(call?.responseText).not.toContain('Let me think');
    expect(call?.textChunks).toBe(3);
    expect(call?.reasoningChunks).toBe(4);
  });

  it('stores the exact wire payload in request.wire', () => {
    const id = recordCallStart({
      userId: 1,
      kind: 'chat',
      provider: 'gemini',
      model: 'gemini-test',
      request: {
        endpoint: 'generateContentStream',
        model: 'gemini-test',
        wire: { model: 'gemini-test', contents: 'PROMPT', config: { temperature: 0.7 } },
      } as never,
    });
    if (!id) throw new Error('recordCallStart returned null');
    expect(getCallLog(1, id)?.request.wire).toEqual({
      model: 'gemini-test',
      contents: 'PROMPT',
      config: { temperature: 0.7 },
    });
  });

  it('scrubs secrets out of the wire payload (the scrub law reaches request.wire)', () => {
    const id = recordCallStart({
      userId: 1,
      kind: 'chat',
      provider: 'openrouter',
      model: 'vendor/model',
      request: {
        endpoint: 'direct:chat/completions',
        model: 'vendor/model',
        wire: { model: 'vendor/model', headers: { Authorization: 'Bearer SECRET' }, apiKey: 'sk-SECRET' },
      } as never,
    });
    if (!id) throw new Error('recordCallStart returned null');
    const wire = getCallLog(1, id)?.request.wire as Record<string, unknown>;
    expect(JSON.stringify(wire)).not.toContain('SECRET');
  });
});

/* ── C. The server provider: streamFromModel must EXPOSE the wire ────────── */

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      async generateContent() {
        return { text: '' };
      },
      async embedContent() {
        return { embeddings: [{ values: [0.1] }] };
      },
      async *generateContentStream() {
        yield { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }] } }] };
        yield { candidates: [{ content: { parts: [{ text: 'Reply body' }] } }] };
      },
    };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

const { streamFromModel } = await import('../../server/providers/gemini');
type LaneAiSurface = import('../../server/providers/lane').LaneAiSurface;

describe('streamFromModel: onWire captures the EXACT provider payload', () => {
  it('calls onWire with model + contents + the full config (thinkingConfig included)', async () => {
    const surface = {
      models: {
        generateContent: async () => ({ text: '' }),
        async *generateContentStream() {
          yield { candidates: [{ content: { parts: [{ text: 'x' }] } }] };
        },
      },
    } as unknown as LaneAiSurface;
    let wire: unknown;
    const collected: string[] = [];
    for await (const c of await streamFromModel(surface, 'gemini-3.8-flash', 'THE PROMPT', 'THE SYSTEM', 1, {
      onWire: (payload) => (wire = payload),
      onChunk: (c) => collected.push(c.text ?? c.reasoning ?? ''),
    })) {
      void c;
    }
    expect(wire).toEqual({
      model: 'gemini-3.8-flash',
      contents: 'THE PROMPT',
      config: {
        systemInstruction: 'THE SYSTEM',
        temperature: 0.7,
        thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: true },
      },
    });
    expect(collected.join('')).toContain('x');
  });

  it('streams split chunks through onChunk too (reasoning visible to the recorder caller)', async () => {
    const surface = {
      models: {
        generateContent: async () => ({ text: '' }),
        async *generateContentStream() {
          yield { candidates: [{ content: { parts: [{ text: 'deep thought', thought: true }] } }] };
          yield { candidates: [{ content: { parts: [{ text: 'answer text' }] } }] };
        },
      },
    } as unknown as LaneAiSurface;
    const chunks: Array<{ text?: string; reasoning?: string }> = [];
    for await (const c of await streamFromModel(surface, 'm', 'P', 'S', 1, {
      onChunk: (c) => chunks.push(c),
    })) {
      void c;
    }
    expect(chunks).toEqual([
      { reasoning: 'deep thought' },
      { text: 'answer text' },
    ]);
  });
});

/* ── D. E2E: the job runner records the whole truth on the real wire ─────── */

const OWNER_EMAIL = 'wire-e2e-owner@example.com';
const OWNER_PASSWORD = 'owner-pass-123456';
process.env.MARKBRAIN_OWNER_EMAIL = OWNER_EMAIL;
process.env.MARKBRAIN_OWNER_PASSWORD = OWNER_PASSWORD;

const { app } = await import('../../server/app');
const { createUser } = await import('../../server/lib/users');
const { unlockVaultWithPassword, writeKeysPayload } = await import('../../server/lib/accountVault');

let server: Server;
let base = '';
let token = '';

beforeAll(async () => {
  const user = createUser(OWNER_EMAIL, OWNER_PASSWORD, { isOwner: true });
  unlockVaultWithPassword(user.id, OWNER_PASSWORD);
  writeKeysPayload(user.id, { 'gemini-free': 'AIzaTESTKEY0000000000000000000000000' });
  const db = getDb();
  db.prepare(
    `INSERT INTO projects (project_id, user_id, name, code_name, description, color, active_thread_id,
       granularity_law, revision, updated_at) VALUES ('proj-wire-e2e', ?, 'Wire E2E', 'wire', '', '#e05a66', 'th-wire-e2e', 'user-only', 1, ?)`
  ).run(user.id, Date.now());
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  token = ((await login.json()) as { token: string }).token;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDbForTests();
});

const authed = (init?: RequestInit): RequestInit => ({
  ...init,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
});

describe('e2e: the chat job path records wire + reasoning + timings + chunks', () => {
  it(
    'the completed call row carries the exact wire, the reasoning text, first-reasoning timing, and chunk counts',
    { timeout: 20_000 },
    async () => {
      const send = await fetch(`${base}/api/projects/proj-wire-e2e/jobs/send`, authed({
        method: 'POST',
        body: JSON.stringify({
          threadId: 'th-wire-e2e',
          askText: 'What is the plan?',
          compiledPrompt: 'The compiled payload.',
          systemInstruction: 'Be helpful.',
          model: 'gemini-3.5-flash-lite',
        }),
      }));
      expect([200, 201]).toContain(send.status);
      const { job } = (await send.json()) as { job: { jobId: string } };

      // Wait for the job to complete (poll the wire until the stream closes).
      const streamRes = await fetch(`${base}/api/jobs/${job.jobId}/stream`, authed({}));
      const reader = streamRes.body!.getReader();
      const decoder = new TextDecoder();
      let raw = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        if (raw.includes('event: complete') || raw.includes('event: error')) break;
      }

      // The recorder row, via its jobId filter (the receipt linkage).
      const callsRes = await fetch(`${base}/api/logs/calls?job=${job.jobId}`, authed({}));
      expect(callsRes.ok).toBe(true);
      const calls = ((await callsRes.json()) as { calls: Array<Record<string, unknown>> }).calls;
      expect(calls).toHaveLength(1);
      const call = calls[0];

      // THE WIRE: exactly what the provider received — thinkingConfig included.
      const request = call.request as { wire?: Record<string, unknown> };
      expect(request.wire).toEqual({
        model: 'gemini-3.5-flash-lite',
        contents: 'The compiled payload.',
        config: {
          systemInstruction: 'Be helpful.',
          temperature: 0.7,
          thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: true },
        },
      });

      // THE REASONING: the thinking text is recorded, and NEVER in the reply.
      expect(String(call.reasoningText)).toContain('think');
      expect(String(call.responseText)).not.toContain('think');

      // THE TIMINGS: first-reasoning lands before the first text token.
      const tFirstReasoning = call.tFirstReasoning as number;
      const tFirstToken = call.tFirstToken as number;
      expect(tFirstReasoning).not.toBeNull();
      expect(tFirstToken).not.toBeNull();
      expect(tFirstReasoning).toBeLessThanOrEqual(tFirstToken);

      // THE CHUNKS: both phases streamed.
      expect((call.reasoningChunks as number) ?? 0).toBeGreaterThan(0);
      expect((call.textChunks as number) ?? 0).toBeGreaterThan(0);

      // THE LINKAGE: the row already knows its turn.
      expect(call.turnId).toBeTruthy();
    }
  );
});
