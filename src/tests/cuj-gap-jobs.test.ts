/**
 * CUJ matrix gaps G1–G5 (+ G9, folded here) — server job law end-to-end
 * (design-docs/21E §2.2–2.4, 22_CUJ_TEST_MATRIX gap register).
 *
 * G1 — per-thread FIFO head-block law: a failed/stopped HEAD blocks later
 *      queued jobs on that thread; retry/discard of the head unblocks them.
 * G2 — job exits: POST /api/jobs/:id/retry re-queues and completes (mock
 *      succeeds on the 2nd call); DELETE /api/jobs/:id discards (no turns).
 * G3 — kind:'regenerate' via /jobs/send replaces the target turn in place
 *      (id preserved, no new turn row).
 * G4 — deleteThread / deleteFolder mutations → rows gone + delta tombstones.
 * G5 — job commit with buffered <artifact> + <topic_shift> → artifacts row
 *      + previous chapter sealed / new chapter opened.
 * G9 — /api/server-logs gating: 401 JSON unauth, 200 {logs} authed.
 *
 * In-memory SQLite + real HTTP listener; `@google/genai` MOCKED — zero
 * external calls.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { initDb, closeDbForTests, getDb } from '../../server/db';

process.env.MARKBRAIN_OWNER_EMAIL = 'owner@example.com';
process.env.MARKBRAIN_OWNER_PASSWORD = 'owner-pass-123456';

/* ── provider mock (scripted per test; never touches the network) ─────────── */

type Behavior = 'ok' | 'fail-500' | 'ok-with-sentinels';

const behavior: { current: Behavior; failFirst: number; calls: number; models: string[]; prompts: string[] } = {
  current: 'ok',
  failFirst: 0,
  calls: 0,
  models: [],
  prompts: [],
};

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      async *generateContentStream(params?: { model?: string; contents?: string }) {
        behavior.calls += 1;
        behavior.models.push(String(params?.model ?? ''));
        behavior.prompts.push(String(params?.contents ?? ''));
        if (behavior.current === 'fail-500' || behavior.calls <= behavior.failFirst) {
          const err = new Error('Provider error: 500 Internal Server Error') as Error & { status?: number };
          err.status = 500;
          throw err;
        }
        if (behavior.current === 'ok-with-sentinels') {
          // One chunk carrying an artifact block and a topic_shift block
          // (demux formats from src/domains/03-stream-protocol).
          yield {
            text:
              'Extracted the hook. ' +
              '<artifact file="the-hook.md" title="The Hook">' +
              '<subtitle>Hook sub</subtitle>' +
              '<description>Hook desc</description>' +
              '<summary>Hook sum</summary>' +
              '<content># The Hook</content>' +
              '</artifact>' +
              '<topic_shift title="Chapter Two" subtitle="The sequel"/>',
          };
          return;
        }
        const chunks = ['Hello from ', 'the mocked ', 'model reply.'];
        for (const c of chunks) {
          await new Promise((r) => setTimeout(r, 15));
          yield { text: c };
        }
      },
      async generateContent() {
        return { text: 'DESCRIPTION: d\nSUMMARY: s' };
      },
      async embedContent() {
        return { embeddings: [{ values: [0.5, 0.5] }] };
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

const PROJECT_ID = 'proj-cuj-gap';

interface ApiRes {
  status: number;
  body: any;
}

async function api(pathname: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<ApiRes> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token !== null) headers.Authorization = `Bearer ${opts.token ?? token}`;
  const res = await fetch(base + pathname, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body: body ?? { raw: text } };
}

async function waitFor<T>(fn: () => Promise<T | null> | T | null, timeoutMs = 8000, stepMs = 40): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = await fn();
    if (out !== null && out !== undefined && out !== false) return out as T;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

function jobState(jobId: string): string | undefined {
  const r = getDb().prepare('SELECT state FROM chat_jobs WHERE job_id = ?').get(jobId) as { state: string } | undefined;
  return r?.state;
}

function seedProject(): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (project_id, user_id, name, code_name, description, color, active_thread_id,
       granularity_law, revision, updated_at) VALUES (?, 1, 'CUJ Gap Project', 'cujgap', '', '#e05a66', NULL, 'user-only', 1, ?)`
  ).run(PROJECT_ID, now);
}

/** Create a thread row (job routes only need the id; this keeps FK-ish data real). */
function seedThread(threadId: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO threads (user_id, project_id, thread_id, title, title_version, folder_id, created_at, updated_at, doc_json, revision)
       VALUES (1, ?, ?, 'Thread', 1, NULL, ?, ?, ?, 1)`
    )
    .run(
      PROJECT_ID,
      threadId,
      now,
      now,
      JSON.stringify({
        id: threadId,
        folderId: null,
        title: 'Thread',
        titleState: 'auto',
        titleVersion: 1,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
        lifecycle: 'active',
        lastOutcome: 'ok',
        preview: '',
        attachments: [],
      })
    );
}

async function enqueueSend(threadId: string, ask: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await api(`/api/projects/${PROJECT_ID}/jobs/send`, {
    method: 'POST',
    body: {
      threadId,
      kind: 'send',
      askText: ask,
      compiledPrompt: `compiled:${ask}`,
      model: 'gemini-3.5-flash-lite',
      ...extra,
    },
  });
  expect(res.status).toBe(201);
  return res.body.job.jobId as string;
}

function countTurns(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM turns WHERE user_id = 1 AND project_id = ?').get(PROJECT_ID) as { n: number }).n;
}

beforeAll(async () => {
  ensureOwnerBootstrap();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no ephemeral port');
  base = `http://127.0.0.1:${addr.port}`;

  const login = await api('/api/auth/login', {
    method: 'POST',
    token: null,
    body: { email: 'owner@example.com', password: 'owner-pass-123456' },
  });
  expect(login.status).toBe(200);
  token = login.body.token;

  const key = await api('/api/account/keys', {
    method: 'PUT',
    body: { slot: 'gemini-free', apiKey: 'AIzaMockKeyForCujGaps000000000000000000' },
  });
  expect(key.status).toBe(200);

  seedProject();
});

afterAll(() => {
  server?.close();
  closeDbForTests();
});

/* ─────────────────────────────────────────────────────────────────────────
 * G1 — Server FIFO head-block law (21E §2.2)
 * ───────────────────────────────────────────────────────────────────────── */

describe('G1 — per-thread FIFO head-block law', () => {
  it('a failed HEAD blocks later queued jobs on the thread; retry of the head proceeds them', async () => {
    const threadId = 'thread-g1-fail';
    seedThread(threadId);
    behavior.current = 'fail-500';
    behavior.calls = 0;

    const headId = await enqueueSend(threadId, 'this head must fail');
    await waitFor(() => (jobState(headId) === 'failed' ? true : null));
    behavior.current = 'ok';

    const secondId = await enqueueSend(threadId, 'this must wait behind the failed head');
    // The failed head is still the oldest row → the second job must NOT run.
    await new Promise((r) => setTimeout(r, 300));
    expect(jobState(secondId)).toBe('queued');
    expect(jobState(headId)).toBe('failed');

    // The jobs list shows both, in order, with the blocked state honest.
    const list = await api(`/api/projects/${PROJECT_ID}/jobs`);
    const jobs = list.body.jobs as Array<{ jobId: string; state: string }>;
    expect(jobs.find((j) => j.jobId === headId)?.state).toBe('failed');
    expect(jobs.find((j) => j.jobId === secondId)?.state).toBe('queued');

    // Retry the head → it completes, and only then does the second job run.
    const retry = await api(`/api/jobs/${headId}/retry`, { method: 'POST' });
    expect(retry.status).toBe(200);
    await waitFor(() => (jobState(headId) === undefined ? true : null));
    await waitFor(() => (jobState(secondId) === undefined ? true : null));

    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=0`);
    const ids = (delta.body.turns as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(`turn-ai-${headId}`);
    expect(ids).toContain(`turn-ai-${secondId}`);
  });

  it('a stopped HEAD blocks later queued jobs; discard of the head unblocks the queue', async () => {
    const threadId = 'thread-g1-stop';
    seedThread(threadId);
    behavior.current = 'ok';

    const headId = await enqueueSend(threadId, 'stop this head halfway');
    await waitFor(() => {
      const s = jobState(headId);
      return s === 'sending' || s === 'queued' ? true : null;
    });
    const stop = await api(`/api/jobs/${headId}/stop`, { method: 'POST' });
    expect(stop.status).toBe(200);
    await waitFor(() => (jobState(headId) === 'stopped' ? true : null));

    const secondId = await enqueueSend(threadId, 'this must wait behind the stopped head');
    await new Promise((r) => setTimeout(r, 300));
    expect(jobState(secondId)).toBe('queued');

    const before = countTurns();
    const discard = await api(`/api/jobs/${headId}`, { method: 'DELETE' });
    expect(discard.status).toBe(200);
    expect(discard.body.revision).toBeGreaterThan(0);

    // Discard wrote no turns, and the queued job now runs to completion.
    expect(countTurns()).toBe(before);
    await waitFor(() => (jobState(secondId) === undefined ? true : null));
    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=0`);
    const ids = (delta.body.turns as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(`turn-ai-${secondId}`);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * G2 — Job exits: retry completes (2nd call), discard removes without turns
 * ───────────────────────────────────────────────────────────────────────── */

describe('G2 — job exits (retry / discard)', () => {
  it('POST /api/jobs/:id/retry re-queues a failed job and the 2nd attempt completes', async () => {
    const threadId = 'thread-g2-retry';
    seedThread(threadId);
    behavior.current = 'ok';
    behavior.calls = 0;
    behavior.failFirst = 1; // first stream call throws, second succeeds

    const jobId = await enqueueSend(threadId, 'fail once then succeed');
    await waitFor(() => (jobState(jobId) === 'failed' ? true : null));
    const failed = getDb()
      .prepare('SELECT error_reason FROM chat_jobs WHERE job_id = ?')
      .get(jobId) as { error_reason: string | null };
    expect(failed.error_reason).toBeTruthy();

    const retry = await api(`/api/jobs/${jobId}/retry`, { method: 'POST' });
    expect(retry.status).toBe(200);
    expect(retry.body.state).toBe('queued');

    await waitFor(() => (jobState(jobId) === undefined ? true : null)); // completed → row deleted
    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=0`);
    const ai = (delta.body.turns as Array<{ id: string; content: string }>).find((t) => t.id === `turn-ai-${jobId}`);
    expect(ai).toBeTruthy();
    expect(ai!.content).toBe('Hello from the mocked model reply.');
    behavior.failFirst = 0;
  });

  it('retry with overrides uses the CURRENT model + fresh prompt (live 2026-10-25: a retry after a model change re-ran the failed nvidia request)', async () => {
    const threadId = 'thread-g2-retry-override';
    seedThread(threadId);
    behavior.current = 'fail-500';
    behavior.calls = 0;
    behavior.models = [];
    behavior.prompts = [];

    const jobId = await enqueueSend(threadId, 'fail then change model and retry');
    await waitFor(() => (jobState(jobId) === 'failed' ? true : null));
    expect(behavior.models).toEqual(['gemini-3.5-flash-lite']);

    // The user changed the model and hit Retry: the client recompiles and
    // sends overrides. The retry must run the NEW model + NEW prompt.
    behavior.current = 'ok';
    const retry = await api(`/api/jobs/${jobId}/retry`, {
      method: 'POST',
      body: { model: 'gemini-3.8-flash', compiledPrompt: 'compiled:FRESH prompt', systemInstruction: 'fresh-sys' },
    });
    expect(retry.status).toBe(200);
    await waitFor(() => (jobState(jobId) === undefined ? true : null));

    expect(behavior.models).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
    expect(behavior.prompts[1]).toBe('compiled:FRESH prompt');
    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=0`);
    const ai = (delta.body.turns as Array<{ id: string; meta?: any }>).find((t) => t.id === `turn-ai-${jobId}`);
    expect(ai).toBeTruthy();
    expect(ai!.meta?.model).toBe('gemini-3.8-flash');
  });

  it('DELETE /api/jobs/:id discards: job gone, revision bumped, zero turns written', async () => {
    const threadId = 'thread-g2-discard';
    seedThread(threadId);
    behavior.current = 'fail-500';
    behavior.calls = 0;

    const jobId = await enqueueSend(threadId, 'never lands as a turn');
    await waitFor(() => (jobState(jobId) === 'failed' ? true : null));

    const before = countTurns();
    const del = await api(`/api/jobs/${jobId}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(del.body.revision).toBeGreaterThan(0);
    expect(jobState(jobId)).toBeUndefined();
    expect(countTurns()).toBe(before); // never writes turns

    const list = await api(`/api/projects/${PROJECT_ID}/jobs`);
    expect((list.body.jobs as Array<{ jobId: string }>).find((j) => j.jobId === jobId)).toBeUndefined();
    behavior.current = 'ok';
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * G3 — kind:'regenerate' via the job route replaces the target turn
 * ───────────────────────────────────────────────────────────────────────── */

describe("G3 — jobs kind:'regenerate'", () => {
  it('replaces the target assistant turn in SQLite (id preserved, no new row)', async () => {
    const threadId = 'thread-g3-regen';
    seedThread(threadId);
    const now = Date.now();
    const insertTurn = getDb().prepare(
      `INSERT INTO turns (user_id, project_id, thread_id, turn_id, seq, role, content, timestamp, meta_json, doc_json, revision)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 1)`
    );
    insertTurn.run(
      PROJECT_ID,
      threadId,
      'turn-ask-g3',
      50,
      'user',
      'the original ask',
      now - 2000,
      JSON.stringify({ id: 'turn-ask-g3', role: 'user', content: 'the original ask', timestamp: now - 2000, threadId })
    );
    insertTurn.run(
      PROJECT_ID,
      threadId,
      'turn-ai-g3',
      51,
      'assistant',
      'the OLD reply that must be replaced',
      now - 1000,
      JSON.stringify({ id: 'turn-ai-g3', role: 'assistant', content: 'the OLD reply that must be replaced', timestamp: now - 1000, threadId })
    );

    behavior.current = 'ok';
    behavior.calls = 0;
    const before = countTurns();

    const res = await api(`/api/projects/${PROJECT_ID}/jobs/send`, {
      method: 'POST',
      body: {
        threadId,
        kind: 'regenerate',
        askText: 'regenerate the reply',
        compiledPrompt: 'compiled:regen',
        model: 'gemini-3.5-flash-lite',
        targetTurnId: 'turn-ai-g3',
      },
    });
    expect(res.status).toBe(201);
    const jobId = res.body.job.jobId as string;

    await waitFor(() => (jobState(jobId) === undefined ? true : null));

    const rows = getDb()
      .prepare('SELECT turn_id, content, doc_json FROM turns WHERE user_id = 1 AND project_id = ? AND turn_id = ?')
      .all(PROJECT_ID, 'turn-ai-g3') as Array<{ turn_id: string; content: string; doc_json: string }>;
    expect(rows.length).toBe(1); // id preserved, no new turn row
    expect(countTurns()).toBe(before);
    expect(rows[0].content).toBe('Hello from the mocked model reply.');
    const doc = JSON.parse(rows[0].doc_json) as { id: string; content: string };
    expect(doc.id).toBe('turn-ai-g3');
    expect(doc.content).toBe('Hello from the mocked model reply.');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * G4 — deleteThread / deleteFolder tombstones via delta
 * ───────────────────────────────────────────────────────────────────────── */

describe('G4 — deleteThread / deleteFolder tombstones', () => {
  it('deleteThread removes rows and delta carries the thread tombstone', async () => {
    const threadId = 'thread-g4-del';
    seedThread(threadId);
    const now = Date.now();
    getDb()
      .prepare(
        `INSERT INTO turns (user_id, project_id, thread_id, turn_id, seq, role, content, timestamp, meta_json, doc_json, revision)
         VALUES (1, ?, ?, 'turn-g4', 90, 'user', 'bye', ?, '{}', ?, 1)`
      )
      .run(
        PROJECT_ID,
        threadId,
        now,
        JSON.stringify({ id: 'turn-g4', role: 'user', content: 'bye', timestamp: now, threadId })
      );

    const before = await api(`/api/projects/${PROJECT_ID}/delta?since=0`);
    const since = before.body.revision as number;

    const mut = await api(`/api/projects/${PROJECT_ID}/mutate`, {
      method: 'POST',
      body: { op: 'deleteThread', threadId },
    });
    expect(mut.status).toBe(200);

    expect(
      getDb().prepare('SELECT 1 FROM threads WHERE user_id = 1 AND thread_id = ?').get(threadId)
    ).toBeUndefined();
    expect(
      getDb().prepare('SELECT 1 FROM turns WHERE user_id = 1 AND thread_id = ?').get(threadId)
    ).toBeUndefined();

    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=${since}`);
    const tombs = delta.body.tombstones as Array<{ entityType: string; entityId: string }>;
    expect(tombs).toContainEqual({ entityType: 'thread', entityId: threadId });
  });

  it('deleteFolder removes the row and delta carries the folder tombstone', async () => {
    const folderId = 'folder-g4-del';
    const upsert = await api(`/api/projects/${PROJECT_ID}/mutate`, {
      method: 'POST',
      body: { op: 'upsertFolder', folder: { id: folderId, name: 'Ideas', order: 0 } },
    });
    expect(upsert.status).toBe(200);
    const since = upsert.body.revision as number;

    const mut = await api(`/api/projects/${PROJECT_ID}/mutate`, {
      method: 'POST',
      body: { op: 'deleteFolder', folderId },
    });
    expect(mut.status).toBe(200);
    expect(
      getDb().prepare('SELECT 1 FROM folders WHERE user_id = 1 AND folder_id = ?').get(folderId)
    ).toBeUndefined();

    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=${since}`);
    const tombs = delta.body.tombstones as Array<{ entityType: string; entityId: string }>;
    expect(tombs).toContainEqual({ entityType: 'folder', entityId: folderId });
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * G5 — buffered <artifact> + <topic_shift> on job commit
 * ───────────────────────────────────────────────────────────────────────── */

describe('G5 — job commit applies buffered artifacts + topic shifts', () => {
  it('artifact lands as a row; the active chapter is sealed and a new one opened', async () => {
    const threadId = 'thread-g5-sentinels';
    seedThread(threadId);
    const now = Date.now();
    // Two pre-existing turns → the pair lands at thread indices 2 and 3, so the
    // shift's cut (the human ask, index 2) is BEYOND the active chapter's start
    // (0): seal + open is the correct law here.
    const ins = getDb().prepare(
      `INSERT INTO turns (user_id, project_id, thread_id, turn_id, seq, role, content, timestamp, meta_json, doc_json, revision)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 1)`
    );
    ins.run(PROJECT_ID, threadId, 't-g5-1', 0, 'user', 'pre turn 1', now, JSON.stringify({ id: 't-g5-1', role: 'user', content: 'pre turn 1' }));
    ins.run(PROJECT_ID, threadId, 't-g5-2', 1, 'assistant', 'pre turn 2', now, JSON.stringify({ id: 't-g5-2', role: 'assistant', content: 'pre turn 2' }));
    // An ACTIVE chapter on this thread — the shift must seal it and open a new one.
    const activeChapter = {
      id: 'ch-g5-active',
      workspaceId: PROJECT_ID,
      threadId,
      title: 'Active Chapter',
      status: 'active',
      startIndex: 0,
      createdAt: now - 5000,
    };
    getDb()
      .prepare(
        `INSERT INTO chapters (user_id, project_id, thread_id, chapter_id, start_turn_id, end_turn_id, title,
           description, summary, granularity, order_index, doc_json, chapter_thread_id, revision)
         VALUES (1, ?, ?, 'ch-g5-active', '0', NULL, 'Active Chapter', NULL, NULL, 'full', 0, ?, ?, 1)`
      )
      .run(PROJECT_ID, threadId, JSON.stringify(activeChapter), threadId);

    behavior.current = 'ok-with-sentinels';
    behavior.calls = 0;
    const jobId = await enqueueSend(threadId, 'extract the hook and shift topic');
    await waitFor(() => (jobState(jobId) === undefined ? true : null));
    behavior.current = 'ok';

    // Artifact row exists on the project.
    const project = await api(`/api/projects/${PROJECT_ID}`);
    const artifacts = project.body.project.artifacts as Array<{ title: string; current?: { body?: string } }>;
    const hook = artifacts.find((a) => a.title === 'The Hook');
    expect(hook).toBeTruthy();

    // The assistant turn carries the extracted artifacts so the CHAT renders
    // them under the reply (live 2026-10-25: they landed in the table but the
    // message showed nothing — the client's cards read the turn).
    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=0`);
    const aiTurn = (delta.body.turns as Array<{ id: string; extractedArtifacts?: Array<Record<string, unknown>> }>).find(
      (t) => t.id === `turn-ai-${jobId}`
    );
    expect(aiTurn).toBeTruthy();
    expect(aiTurn!.extractedArtifacts?.length).toBe(1);
    expect(aiTurn!.extractedArtifacts![0]).toMatchObject({
      title: 'The Hook',
      category: 'note',
      content: '# The Hook',
    });
    expect(aiTurn!.extractedArtifacts![0].code).toBeTruthy();
    // AI-attachment law: the server stamps the reply turn's thread index so
    // clients weld the extraction as a COMMITTED attachment of that turn.
    expect(aiTurn!.extractedArtifacts![0].turnIndex).toBe(3); // pair at thread indices 2+3

    // The previous chapter is sealed (completed + endIndex) …
    const chapters = project.body.project.chapters as Array<{
      id: string;
      title: string;
      status: string;
      startIndex: number;
      endIndex?: number;
    }>;
    const sealed = chapters.find((c) => c.id === 'ch-g5-active');
    expect(sealed).toBeTruthy();
    expect(sealed!.status).toBe('completed');
    expect(typeof sealed!.endIndex).toBe('number');

    // … and a NEW chapter titled by the shift is open.
    const opened = chapters.find((c) => c.title === 'Chapter Two');
    expect(opened).toBeTruthy();
    expect(opened!.status).toBe('active');
    expect(opened!.id).not.toBe('ch-g5-active');
  });
  it('a chapter cut that ALREADY exists at the ask is RETITLED in place — never a duplicate', async () => {
    const threadId = 'thread-g5b';
    seedThread(threadId);
    const now = Date.now();
    // No pre-existing turns: the pair lands at 0 and 1, the ask is index 0 —
    // exactly where the active chapter already starts.
    const activeChapter = {
      id: 'ch-g5b-active',
      workspaceId: PROJECT_ID,
      threadId,
      title: 'Active Chapter',
      status: 'active',
      startIndex: 0,
      createdAt: now - 5000,
    };
    getDb()
      .prepare(
        `INSERT INTO chapters (user_id, project_id, thread_id, chapter_id, start_turn_id, end_turn_id, title,
           description, summary, granularity, order_index, doc_json, chapter_thread_id, revision)
         VALUES (1, ?, ?, 'ch-g5b-active', '0', NULL, 'Active Chapter', NULL, NULL, 'full', 0, ?, ?, 1)`
      )
      .run(PROJECT_ID, threadId, JSON.stringify(activeChapter), threadId);

    behavior.current = 'ok-with-sentinels';
    behavior.calls = 0;
    const jobId = await enqueueSend(threadId, 'extract the hook and shift topic');
    await waitFor(() => (jobState(jobId) === undefined ? true : null));
    behavior.current = 'ok';

    const project = await api(`/api/projects/${PROJECT_ID}`);
    const allChapters = project.body.project.chapters as Array<{ id: string; title: string; status: string; threadId?: string }>;
    const chapters = allChapters.filter((c) => c.threadId === threadId);
    // The SAME chapter got the shift's title — no second chapter opened.
    expect(chapters.filter((c) => c.title === 'Chapter Two').length).toBe(1);
    const retitled = chapters.find((c) => c.id === 'ch-g5b-active');
    expect(retitled).toBeTruthy();
    expect(retitled!.title).toBe('Chapter Two');
    expect(retitled!.status).toBe('active');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * G9 — /api/server-logs gating (folded into this server-level file)
 * ───────────────────────────────────────────────────────────────────────── */

describe('G9 — /api/server-logs is authed', () => {
  it('unauthenticated GET → 401 JSON; authenticated GET → 200 { logs }', async () => {
    const unauth = await api('/api/server-logs', { token: null });
    expect(unauth.status).toBe(401);
    expect(typeof unauth.body.error).toBe('string');

    const authed = await api('/api/server-logs');
    expect(authed.status).toBe(200);
    expect(Array.isArray(authed.body.logs)).toBe(true);
  });
});
