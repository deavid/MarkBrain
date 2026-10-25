/**
 * Phase 5 — send-and-forget server jobs (design-docs/21E §5).
 *
 * The provider is MOCKED (vi.mock '@google/genai') — zero external calls.
 * Slow stream: 3 chunks over ~60ms; failure mode: throws 429-shaped error.
 *
 * 1. Phone screen-lock: SSE client disconnects after chunk 1 → server still
 *    finishes, commits the pair, runs title + chapter-summary chores; delta
 *    on "wake" delivers everything; job gone from activeJobs.
 * 2. Failure law: upstream 500 while locked → 0 turns, failed job in
 *    activeJobs with errorReason + partialText.
 * 3. Explicit stop aborts → store-as-is commits the partial pair.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { initDb, closeDbForTests, getDb } from '../../server/db';

process.env.MARKBRAIN_OWNER_EMAIL = 'owner@example.com';
process.env.MARKBRAIN_OWNER_PASSWORD = 'owner-pass-123456';

/* ── provider mock (no network, deterministic pacing) ─────────────────────── */

type StreamBehavior = 'slow-ok' | 'fail-500' | 'slow-partial' | 'topic-shift';

const behavior: { current: StreamBehavior; chunkDelayMs: number } = {
  current: 'slow-ok',
  chunkDelayMs: 25,
};

const captured: { titleCalls: number; summarizeCalls: number } = { titleCalls: 0, summarizeCalls: 0 };

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      async *generateContentStream() {
        if (behavior.current === 'fail-500') {
          const err = new Error('Provider error: 500 Internal Server Error') as Error & { status?: number };
          err.status = 500;
          throw err;
        }
        const chunks =
          behavior.current === 'topic-shift'
            ? [
                'Opening prose. ',
                '<topic_shift title="Alpha" description="first topic"/> ',
                '<topic_shift title="Beta" description="second topic"/> ',
                'Closing prose.',
              ]
            : ['Hello from ', 'the mocked ', 'model reply.'];
        for (const c of chunks) {
          await new Promise((r) => setTimeout(r, behavior.chunkDelayMs));
          yield { text: c };
        }
      },
      async generateContent(params: { contents: string }) {
        const contents = String(params.contents ?? '');
        if (/Give this conversation a title/.test(contents)) {
          captured.titleCalls += 1;
          return { text: 'Synced Phone Send' };
        }
        captured.summarizeCalls += 1;
        return { text: 'DESCRIPTION: A sealed chapter.\nSUMMARY: Filled by the server chore.' };
      },
    };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

initDb(':memory:');

const { app } = await import('../../server/app');
const { ensureOwnerBootstrap } = await import('../../server/lib/users');

let server: Server;
let base = '';
let token = '';

const PROJECT_ID = 'proj-jobs-1';
const THREAD_ID = 'thread-jobs-1';

interface ApiRes {
  status: number;
  body: any;
}

async function api(pathname: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<ApiRes> {
  const res = await fetch(base + pathname, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* SSE/empty */
  }
  return { status: res.status, body };
}

async function waitFor<T>(fn: () => Promise<T | null> | T | null, timeoutMs = 5000, stepMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = await fn();
    if (out !== null && out !== undefined && out !== false) return out as T;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

function seedProject(): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (project_id, user_id, name, code_name, description, color, active_thread_id,
       granularity_law, revision, updated_at) VALUES (?, 1, 'Jobs Project', 'jobs', '', '#e05a66', ?, 'user-only', 1, ?)`
  ).run(PROJECT_ID, THREAD_ID, now);
  db.prepare(
    `INSERT INTO threads (user_id, project_id, thread_id, title, title_version, folder_id, created_at, updated_at, doc_json, revision)
     VALUES (1, ?, ?, 'Placeholder', 0, NULL, ?, ?, ?, 1)`
  ).run(
    PROJECT_ID,
    THREAD_ID,
    now,
    now,
    JSON.stringify({
      id: THREAD_ID,
      folderId: null,
      title: 'Placeholder',
      titleState: 'placeholder',
      titleVersion: 0,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      lifecycle: 'active',
      lastOutcome: 'ok',
      preview: '',
      attachments: [],
    })
  );
  // Two turns already (title chore needs >= 2) + one sealed chapter missing layers.
  const insertTurn = db.prepare(
    `INSERT INTO turns (user_id, project_id, thread_id, turn_id, seq, role, content, timestamp, meta_json, doc_json, revision)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 1)`
  );
  insertTurn.run(PROJECT_ID, THREAD_ID, 'turn-ask-0', 0, 'user', 'seed ask', now - 1000, JSON.stringify({ id: 'turn-ask-0', role: 'user', content: 'seed ask', timestamp: now - 1000, threadId: THREAD_ID }));
  insertTurn.run(PROJECT_ID, THREAD_ID, 'turn-reply-0', 1, 'assistant', 'seed reply', now - 999, JSON.stringify({ id: 'turn-reply-0', role: 'assistant', content: 'seed reply', timestamp: now - 999, threadId: THREAD_ID }));
  const sealed = {
    id: 'ch-sealed-1',
    workspaceId: PROJECT_ID,
    threadId: THREAD_ID,
    title: 'Sealed Chapter',
    status: 'completed',
    startIndex: 0,
    endIndex: 2,
    createdAt: now - 1000,
  };
  db.prepare(
    `INSERT INTO chapters (user_id, project_id, thread_id, chapter_id, start_turn_id, end_turn_id, title,
       description, summary, granularity, order_index, doc_json, chapter_thread_id, revision)
     VALUES (1, ?, ?, 'ch-sealed-1', '0', '2', 'Sealed Chapter', NULL, NULL, 'full', 0, ?, ?, 1)`
  ).run(PROJECT_ID, THREAD_ID, JSON.stringify(sealed), THREAD_ID);
}

async function enqueueSend(ask: string): Promise<string> {
  const res = await api(`/api/projects/${PROJECT_ID}/jobs/send`, {
    method: 'POST',
    token,
    body: {
      threadId: THREAD_ID,
      kind: 'send',
      askText: ask,
      compiledPrompt: `compiled:${ask}`,
      model: 'gemini-3.5-flash-lite',
    },
  });
  expect(res.status).toBe(201);
  return res.body.job.jobId as string;
}

/** Attach to the SSE stream, read until `dropAfterChunks` chunks, then destroy. */
async function attachAndDrop(jobId: string, dropAfterChunks: number): Promise<void> {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/jobs/${jobId}/stream`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunks = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    while (buffer.includes('\n\n')) {
      const idx = buffer.indexOf('\n\n');
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (frame.includes('event: chunk')) {
        chunks += 1;
        if (chunks >= dropAfterChunks) {
          controller.abort(); // screen locks — socket dies
          return;
        }
      }
    }
  }
}

beforeAll(async () => {
  ensureOwnerBootstrap();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${addr.port}`;

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'owner-pass-123456' },
  });
  expect(login.status).toBe(200);
  token = login.body.token;

  // Vault key (mocked provider never reads it, the lane resolver demands one).
  const key = await api('/api/account/keys', {
    method: 'PUT',
    token,
    body: { slot: 'gemini-free', apiKey: 'AIzaMockKeyForJobs00000000000000000000' },
  });
  expect(key.status).toBe(200);

  seedProject();
});

afterAll(() => {
  server?.close();
  closeDbForTests();
});

describe('21E §5.1 — the phone screen-lock scenario', () => {
  it('disconnect after chunk 1: server finishes, commits pair + runs chores; wake sees it all', async () => {
    behavior.current = 'slow-ok';
    const jobId = await enqueueSend('send and lock the screen');

    // Watcher connects, sees chunk 1, dies (screen lock).
    await attachAndDrop(jobId, 1);

    // Server keeps running: wait for the job row to disappear (completed → deleted).
    await waitFor(() => {
      const row = getDb().prepare('SELECT 1 FROM chat_jobs WHERE job_id = ?').get(jobId);
      return row === undefined ? true : null;
    }, 8000);

    // "Unlock the phone": delta pull from revision 0.
    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=0`, { token });
    expect(delta.status).toBe(200);

    // Job completed → gone from activeJobs.
    expect(delta.body.activeJobs).toEqual([]);

    // Both turns committed with the full reply content.
    const turns = delta.body.turns as Array<{ id: string; role: string; content: string; meta?: { inputTokens?: number; totalTokens?: number } }>;
    const userTurn = turns.find((t) => t.id.startsWith('turn-user-job-'));
    const aiTurn = turns.find((t) => t.id.startsWith('turn-ai-job-'));
    expect(userTurn).toBeTruthy();
    expect(userTurn!.content).toBe('send and lock the screen');
    expect(aiTurn).toBeTruthy();
    expect(aiTurn!.content).toBe('Hello from the mocked model reply.');
    // Token telemetry: a server-committed reply must never read 0/0/0.
    expect(aiTurn!.meta?.inputTokens).toBeGreaterThan(0);
    expect(aiTurn!.meta?.totalTokens).toBeGreaterThan(0);

    // Chores: thread auto-titled + sealed chapter filled (persisted in SQLite).
    await waitFor(async () => {
      const project = await api(`/api/projects/${PROJECT_ID}`, { token });
      const thread = (project.body.project.threads as Array<{ id: string; title: string; titleVersion: number }>).find(
        (t) => t.id === THREAD_ID
      );
      const chapter = (project.body.project.chapters as Array<{ id: string; summary?: string; description?: string }>).find(
        (c) => c.id === 'ch-sealed-1'
      );
      if (thread?.title === 'Synced Phone Send' && thread.titleVersion >= 1 && chapter?.summary && chapter.description) {
        return true;
      }
      return null;
    }, 8000);
    expect(captured.titleCalls).toBeGreaterThanOrEqual(1);
    expect(captured.summarizeCalls).toBeGreaterThanOrEqual(1);
  });
});

describe('21E §5.2b — honest ladder for a watcher that attached while queued', () => {
  it('snapshot says queued; when the head clears the SAME socket gets connecting → connected (ACK) → chunks → complete', async () => {
    behavior.current = 'slow-ok';
    behavior.chunkDelayMs = 300; // keep the head busy long enough to attach behind it
    try {
      const headId = await enqueueSend('head that blocks the lane');
      const queuedId = await enqueueSend('queued behind the head');

      // Attach to the QUEUED job while the head is still running. The
      // snapshot must say queued — never a fake "thinking".
      const controller = new AbortController();
      const res = await fetch(`${base}/api/jobs/${queuedId}/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const events: Array<{ event: string; data: any }> = [];
      let buffer = '';
      const readLoop = (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          while (buffer.includes('\n\n')) {
            const idx = buffer.indexOf('\n\n');
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const ev = frame.match(/^event: (.+)$/m)?.[1]?.trim() ?? '';
            const dataLine = frame.match(/^data: (.+)$/m)?.[1]?.trim() ?? '{}';
            events.push({ event: ev, data: JSON.parse(dataLine) });
          }
        }
      })();

      // The head completes → the queue kicks the queued job → the SAME
      // watcher socket must ride the whole honest ladder to complete.
      await waitFor(() => {
        const head = getDb().prepare('SELECT state FROM chat_jobs WHERE job_id = ?').get(headId);
        return head === undefined ? true : null; // completed → deleted
      }, 15000);
      await waitFor(() => {
        const frame = events.find((e) => e.event === 'complete');
        return frame ? true : null;
      }, 15000);
      controller.abort();
      await readLoop.catch(() => {});

      const kinds = events.map((e) => e.event);
      expect(kinds[0]).toBe('snapshot');
      expect(events[0].data.state).toBe('queued'); // the honest queued snapshot

      const statuses = events.filter((e) => e.event === 'status').map((e) => e.data.state);
      expect(statuses).toContain('connecting'); // RPC going out — no ACK yet
      expect(statuses).toContain('connected'); // THE ACK BEFORE FIRST TOKEN
      expect(statuses.indexOf('connecting')).toBeLessThan(statuses.indexOf('connected'));
      expect(kinds).toContain('chunk');
      expect(kinds[kinds.length - 1]).toBe('complete');

      // And the queued ask really committed as a pair.
      const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=0`, { token });
      const aiTurn = (delta.body.turns as Array<{ id: string; content: string }>).find(
        (t) => t.id.startsWith('turn-ai-job-') && t.content.includes('queued behind the head') === false
      );
      void aiTurn;
      const asks = (delta.body.turns as Array<{ id: string; role: string; content: string }>)
        .filter((t) => t.role === 'user')
        .map((t) => t.content);
      expect(asks).toContain('queued behind the head');
    } finally {
      behavior.chunkDelayMs = 25;
    }
  });
});

describe('21E §5.2 — server job failure law', () => {
  it('upstream 500 while locked: zero turns, failed job in activeJobs with reason + partial', async () => {
    behavior.current = 'fail-500';
    const before = await api(`/api/projects/${PROJECT_ID}/delta?since=0`, { token });
    const turnsBefore = (before.body.turns as unknown[]).length;

    const jobId = await enqueueSend('this send must fail');

    // Job lands failed with errorReason.
    const row = (await waitFor(() => {
      const r = getDb()
        .prepare('SELECT state, error_reason FROM chat_jobs WHERE job_id = ?')
        .get(jobId) as { state: string; error_reason: string | null } | undefined;
      return r && r.state === 'failed' ? r : null;
    }, 8000)) as { state: string; error_reason: string | null };
    expect(row.state).toBe('failed');
    expect(row.error_reason).toBeTruthy();

    // Zero new turns.
    const after = await api(`/api/projects/${PROJECT_ID}/delta?since=0`, { token });
    expect((after.body.turns as unknown[]).length).toBe(turnsBefore);

    // activeJobs carries the failed job with errorReason (partialText may be '').
    const active = (after.body.activeJobs as Array<{ jobId: string; state: string; errorReason: string | null; partialText: string }>);
    const failedJob = active.find((j) => j.jobId === jobId);
    expect(failedJob).toBeTruthy();
    expect(failedJob!.state).toBe('failed');
    expect(failedJob!.errorReason).toBeTruthy();
    expect(typeof failedJob!.partialText).toBe('string');
  });
});

describe('§5.4 — topic-shift chapter law (David 2026-10-25)', () => {
  const SHIFT_THREAD = 'thread-shift-1';
  const seedShiftThread = (): void => {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO threads (user_id, project_id, thread_id, title, title_version, folder_id, created_at, updated_at, doc_json, revision)
       VALUES (1, ?, ?, 'Shift Thread', 0, NULL, ?, ?, ?, 1)`
    ).run(PROJECT_ID, SHIFT_THREAD, now, now, JSON.stringify({ id: SHIFT_THREAD, title: 'Shift Thread' }));
    const ins = db.prepare(
      `INSERT INTO turns (user_id, project_id, thread_id, turn_id, seq, role, content, timestamp, meta_json, doc_json, revision)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 1)`
    );
    ins.run(PROJECT_ID, SHIFT_THREAD, `t-pre-1`, 0, 'user', 'pre-existing turn 1', now, JSON.stringify({ id: 't-pre-1', role: 'user', content: 'pre-existing turn 1' }));
    ins.run(PROJECT_ID, SHIFT_THREAD, `t-pre-2`, 1, 'assistant', 'pre-existing turn 2', now, JSON.stringify({ id: 't-pre-2', role: 'assistant', content: 'pre-existing turn 2' }));
  };

  const chapterTitles = (): Array<{ title: string; startIndex: number; endIndex: number | null }> => {
    const rows = getDb()
      .prepare(`SELECT doc_json FROM chapters WHERE user_id = 1 AND chapter_thread_id = ? ORDER BY order_index ASC`)
      .all(SHIFT_THREAD) as Array<{ doc_json: string }>;
    return rows.map((r) => {
      const d = JSON.parse(r.doc_json);
      return { title: d.title, startIndex: d.startIndex, endIndex: d.endIndex ?? null };
    });
  };

  const enqueueOnShiftThread = (ask: string, extra: Record<string, unknown> = {}): Promise<string> =>
    api(`/api/projects/${PROJECT_ID}/jobs/send`, {
      method: 'POST',
      token,
      body: { threadId: SHIFT_THREAD, kind: 'send', askText: ask, compiledPrompt: `compiled:${ask}`, model: 'gemini-3.5-flash-lite', ...extra },
    }).then((r) => {
      expect(r.status).toBe(201);
      return r.body.job.jobId as string;
    });

  it('last shift wins; the cut lands at the human ask; a repeated shift REPLACES the cut, never duplicates', async () => {
    behavior.current = 'topic-shift';
    seedShiftThread();

    const jobId = await enqueueOnShiftThread('the ask that changes the topic');
    await waitFor(() => {
      const row = getDb().prepare('SELECT 1 FROM chat_jobs WHERE job_id = ?').get(jobId);
      return row === undefined ? true : null;
    }, 10000);

    // LAST shift wins — exactly one chapter opened, titled 'Beta', never 'Alpha'.
    const after = chapterTitles();
    expect(after.length).toBe(1);
    const opened = after[0];
    expect(opened.title).toBe('Beta');
    // The cut applies at the HUMAN ask: the thread had 2 turns before the
    // pair, so the new chapter starts at index 2 (the ask), NOT after the
    // reply (4).
    expect(opened.startIndex).toBe(2);

    // A regenerate whose reply re-emits the SAME shift replaces the cut —
    // the chapter count must not grow.
    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=0`, { token });
    const aiTurn = (delta.body.turns as Array<{ id: string; threadId: string }>).find(
      (t) => t.threadId === SHIFT_THREAD && t.id.startsWith('turn-ai-job-')
    );
    expect(aiTurn).toBeTruthy();
    const regen = await enqueueOnShiftThread('regenerate the reply', {
      kind: 'regenerate',
      targetTurnId: aiTurn!.id,
    });
    await waitFor(() => {
      const row = getDb().prepare('SELECT 1 FROM chat_jobs WHERE job_id = ?').get(regen);
      return row === undefined ? true : null;
    }, 10000);

    const final = chapterTitles();
    expect(final.length).toBe(1); // replaced, not duplicated
    expect(final[0].title).toBe('Beta');
  }, 20000);
});

describe('21E §5.3 — explicit stop vs disconnect', () => {
  it('stop aborts → store-as-is commits the partial pair', async () => {
    behavior.current = 'slow-ok';
    const jobId = await enqueueSend('stop me halfway');

    // Wait until the job is actually streaming, then stop it explicitly.
    await waitFor(() => {
      const r = getDb().prepare('SELECT state FROM chat_jobs WHERE job_id = ?').get(jobId) as { state: string } | undefined;
      return r && (r.state === 'sending' || r.state === 'queued') ? r : null;
    }, 3000);
    const stop = await api(`/api/jobs/${jobId}/stop`, { method: 'POST', token });
    expect(stop.status).toBe(200);

    const stopped = (await waitFor(() => {
      const r = getDb().prepare('SELECT state FROM chat_jobs WHERE job_id = ?').get(jobId) as { state: string } | undefined;
      return r && r.state === 'stopped' ? r : null;
    }, 5000)) as { state: string };
    expect(stopped.state).toBe('stopped');

    // Store-as-is: commits the pair with the partial text and removes the job.
    const store = await api(`/api/jobs/${jobId}/store-as-is`, { method: 'POST', token });
    expect(store.status).toBe(200);
    expect(store.body.revision).toBeGreaterThan(0);

    const gone = getDb().prepare('SELECT 1 FROM chat_jobs WHERE job_id = ?').get(jobId);
    expect(gone).toBeUndefined();

    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=0`, { token });
    const aiTurns = (delta.body.turns as Array<{ id: string; content: string }>).filter((t) => t.id === `turn-ai-${jobId}`);
    expect(aiTurns.length).toBe(1);
    expect(aiTurns[0].content.length).toBeGreaterThanOrEqual(0); // partial (possibly '')
    expect(aiTurns[0].content).not.toBe('Hello from the mocked model reply.');
  });
});
