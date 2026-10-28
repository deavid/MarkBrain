/**
 * Flight recorder (design-docs/28 §4.5) — server side, real `:memory:` SQLite.
 *
 * Covers: lifecycle timestamps, pruning (7-day TTL + 500-per-user cap),
 * own-user-only read API over a real Express listener, and the secrets law —
 * apiKey/Authorization material must never land in request_json.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { initDb, getDb, closeDbForTests } from '../../server/db';

initDb(':memory:');

const { recordCallStart, recordCallAck, recordCallFirstToken, recordCallEnd, listCallLogs, getCallLog } =
  await import('../../server/lib/callRecorder');
const { createUser } = await import('../../server/lib/users');
const { app } = await import('../../server/app');
type ApiCallLog = import('../../src/domains/callLogTypes').ApiCallLog;

let server: Server;
let base = '';

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
  closeDbForTests();
});

/** recordCallStart answers null when the recorder itself fails — tests want the id or a loud failure. */
function startCall(input: Parameters<typeof recordCallStart>[0]): string {
  const id = recordCallStart(input);
  if (!id) throw new Error('recordCallStart returned null');
  return id;
}

async function login(email: string, password: string): Promise<{ token: string; id: number }> {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as { token: string; user: { id: number } };
  return { token: data.token, id: data.user.id };
}

describe('call recorder lifecycle', () => {
  it('start → ack → first token → end writes the full timeline', () => {
    const id = startCall({
      userId: 1,
      kind: 'chat',
      model: 'gemini-3.5-pro',
      request: { endpoint: '/api/chat/stream', model: 'gemini-3.5-pro', systemInstruction: 'sys', compiledPrompt: 'hello' },
    });
    expect(id).toMatch(/^call-/);
    recordCallAck(id);
    recordCallFirstToken(id);
    recordCallEnd(id, {
      status: 'ok',
      responseText: 'prose <artifact_upsert>{"title":"x"}</artifact_upsert>',
      usage: { promptTokenCount: 3 },
      turnId: 'turn-1',
    });

    const log = getCallLog(1, id) as ApiCallLog;
    expect(log).not.toBeNull();
    expect(log.status).toBe('ok');
    expect(log.tAck).not.toBeNull();
    expect(log.tFirstToken!).toBeGreaterThanOrEqual(log.tAck!);
    expect(log.tEnd!).toBeGreaterThanOrEqual(log.tFirstToken!);
    // Raw UNPARSED response: the sentinel block is still in the text.
    expect(log.responseText).toContain('<artifact_upsert>');
    expect(log.turnId).toBe('turn-1');
    expect(log.usage).toEqual({ promptTokenCount: 3 });
    expect(log.request.compiledPrompt).toBe('hello');
  });

  it('aborted and error endings stick', () => {
    const a = startCall({ userId: 1, kind: 'chat', model: 'm', request: { endpoint: 'e', model: 'm' } });
    recordCallEnd(a, { status: 'aborted', responseText: 'partial' });
    expect((getCallLog(1, a) as ApiCallLog).status).toBe('aborted');

    const b = startCall({ userId: 1, kind: 'qa', model: 'm', request: { endpoint: 'e', model: 'm' } });
    recordCallEnd(b, { status: 'error', error: 'model call exceeded 12s' });
    expect((getCallLog(1, b) as ApiCallLog).status).toBe('error');
    expect((getCallLog(1, b) as ApiCallLog).error).toBe('model call exceeded 12s');
  });

  it('recorder failures never throw (null id / missing row are no-ops)', () => {
    expect(() => recordCallAck(null)).not.toThrow();
    expect(() => recordCallEnd(null, { status: 'ok' })).not.toThrow();
    expect(() => recordCallEnd('call-does-not-exist', { status: 'ok' })).not.toThrow();
  });
});

describe('pruning on insert', () => {
  it('deletes records older than 7 days', () => {
    const db = getDb();
    const old = Date.now() - 8 * 24 * 3600 * 1000;
    db.prepare(
      `INSERT INTO api_call_logs (id, user_id, kind, provider, model, t_send, status, request_json)
       VALUES ('old-1', 7, 'chat', 'gemini', 'm', ?, 'ok', '{}')`
    ).run(old);
    recordCallStart({ userId: 7, kind: 'chat', model: 'm', request: { endpoint: 'x', model: 'm' } });
    const row = db.prepare(`SELECT COUNT(*) AS n FROM api_call_logs WHERE id = 'old-1'`).get() as { n: number };
    expect(row.n).toBe(0);
  });

  it('caps at 500 per user, keeping the newest', () => {
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO api_call_logs (id, user_id, kind, provider, model, t_send, status, request_json)
       VALUES (?, ?, 'chat', 'gemini', 'm', ?, 'ok', '{}')`
    );
    for (let i = 0; i < 505; i++) insert.run(`cap-${i}`, 8, Date.now() - i * 1000);
    recordCallStart({ userId: 8, kind: 'chat', model: 'm', request: { endpoint: 'x', model: 'm' } });

    const row = db.prepare(`SELECT COUNT(*) AS n FROM api_call_logs WHERE user_id = 8`).get() as { n: number };
    expect(row.n).toBe(500);
    // cap-0 was the newest of the seeds; cap-504 the oldest — gone.
    const kept = db.prepare(`SELECT COUNT(*) AS n FROM api_call_logs WHERE user_id = 8 AND id = 'cap-0'`).get() as { n: number };
    const dropped = db.prepare(`SELECT COUNT(*) AS n FROM api_call_logs WHERE user_id = 8 AND id = 'cap-504'`).get() as { n: number };
    expect(kept.n).toBe(1);
    expect(dropped.n).toBe(0);
    // other users untouched
    const other = db.prepare(`SELECT COUNT(*) AS n FROM api_call_logs WHERE user_id = 7`).get() as { n: number };
    expect(other.n).toBe(1); // the one inserted in the previous test
  });
});

describe('secrets law', () => {
  it('apiKey / Authorization material never lands in request_json', () => {
    const id = startCall({
      userId: 9,
      kind: 'chat',
      model: 'm',
      request: {
        endpoint: '/api/chat/stream',
        model: 'm',
        systemInstruction: 'harmless',
        compiledPrompt: 'harmless too',
        params: {
          temperature: 0.7,
          apiKey: 'SK-SUPER-SECRET-1',
          headers: { Authorization: 'Bearer SK-SUPER-SECRET-2', 'x-goog-api-key': 'SK-SUPER-SECRET-3' },
          nested: { apiKey: 'SK-SUPER-SECRET-4', keep: 'kept-value' },
        },
      } as never,
    });
    const row = getDb().prepare('SELECT request_json FROM api_call_logs WHERE id = ?').get(id) as {
      request_json: string;
    };
    expect(row.request_json).not.toContain('SK-SUPER-SECRET-1');
    expect(row.request_json).not.toContain('SK-SUPER-SECRET-2');
    expect(row.request_json).not.toContain('SK-SUPER-SECRET-3');
    expect(row.request_json).not.toContain('SK-SUPER-SECRET-4');
    // Everything non-secret survives.
    expect(row.request_json).toContain('kept-value');
    expect(row.request_json).toContain('0.7');
    expect(row.request_json).toContain('harmless');
  });
});

describe('read API is own-user only', () => {
  const EMAIL_A = 'recorder-a@example.com';
  const EMAIL_B = 'recorder-b@example.com';
  let tokenA = '';
  let idA = 0;
  let callId = '';

  beforeAll(async () => {
    createUser(EMAIL_A, 'pass-a-123456', {});
    createUser(EMAIL_B, 'pass-b-123456', {});
    const a = await login(EMAIL_A, 'pass-a-123456');
    tokenA = a.token;
    idA = a.id;
    callId = startCall({
      userId: idA,
      kind: 'title',
      model: 'gemini-3.5-flash-lite',
      request: { endpoint: '/api/title-thread', model: 'gemini-3.5-flash-lite', compiledPrompt: 'p' },
    });
    recordCallEnd(callId, { status: 'ok', responseText: 'A Title' });
  });

  it('owner gets the full record', async () => {
    const res = await fetch(base + `/api/logs/calls/${callId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { call: ApiCallLog };
    expect(data.call.id).toBe(callId);
    expect(data.call.responseText).toBe('A Title');
  });

  it("another user's record answers 404", async () => {
    const b = await login(EMAIL_B, 'pass-b-123456');
    const res = await fetch(base + `/api/logs/calls/${callId}`, {
      headers: { Authorization: `Bearer ${b.token}` },
    });
    expect(res.status).toBe(404);
  });

  it('list returns only own calls, newest first, truncated', async () => {
    const res = await fetch(base + '/api/logs/calls?limit=10', {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { calls: ApiCallLog[] };
    expect(data.calls.length).toBeGreaterThan(0);
    expect(data.calls.every((c) => c.userId === idA)).toBe(true);
    for (let i = 1; i < data.calls.length; i++) {
      expect(data.calls[i - 1].tSend).toBeGreaterThanOrEqual(data.calls[i].tSend);
    }
  });

  it('unauthenticated reads are rejected', async () => {
    const res = await fetch(base + '/api/logs/calls');
    expect(res.status).toBe(401);
  });

  it('listCallLogs/getCallLog helpers enforce the user filter', () => {
    expect(listCallLogs(idA, 10).every((c) => c.userId === idA)).toBe(true);
    expect(getCallLog(idA, callId)).not.toBeNull();
    const other = idA + 1000;
    expect(getCallLog(other, callId)).toBeNull();
  });
});
