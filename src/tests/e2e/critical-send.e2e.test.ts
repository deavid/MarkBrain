/**
 * THE critical user journey, end to end (David 2026-10-25: "sending a message
 * is a critical, super mega critical user journey. WTF are you testing,
 * tautonomies?").
 *
 * No unit-seam mocks for the path under test: the REAL Express server over a
 * real HTTP socket, the REAL SendQueue/DraftQueue client over real `fetch`,
 * and a FAKE LLM API server at the network boundary (OpenAI-compatible SSE,
 * the same wire our OpenRouter client speaks). Zero external calls — the
 * router refuses any host that is not the test server or the fake LLM.
 *
 * Journeys (design-docs/22 section C, Connected mode):
 *   C1  send → stream → pair commits atomically, honest phase ladder observed
 *   C13 reload → reconcile rebinds, never duplicates (the live 2026-10-25 bug)
 *   C4  fail → reload → RETRY goes through /jobs/:id/retry (never a duplicate
 *       send behind the dead head)
 *   C8  FIFO: failed head blocks; the queued draft stays QUEUED (never a fake
 *       "thinking"); discarding the head unblocks the queue
 *   C2  stop mid-stream → stopped draft with the partial → store-as-is commits
 *   C14/A10 VAULT_LOCKED → failed draft with code → unlock → retry succeeds
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { initDb, closeDbForTests, getDb } from '../../../server/db';

process.env.MARKBRAIN_OWNER_EMAIL = 'owner@example.com';
process.env.MARKBRAIN_OWNER_PASSWORD = 'owner-pass-123456';

/* ── the fake LLM API server (OpenAI-compatible SSE, at the fetch boundary) ── */

type UpstreamBehavior = 'ok' | 'fail-500' | 'slow-ok';

const upstream = {
  behavior: 'ok' as UpstreamBehavior,
  chunkDelayMs: 20,
  requests: [] as string[], // the prompts that reached the fake LLM
  models: [] as string[], // the model ids the fake LLM was asked to serve
};

/** Models whose id contains '/fail-model' ALWAYS fail — per-model behaviors. */
function fakeLlmResponse(init?: RequestInit): Response {
  let model = '';
  try {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    model = String(body?.model ?? '');
  } catch {
    /* junk body */
  }
  upstream.models.push(model);
  upstream.requests.push('hit');
  if (upstream.behavior === 'fail-500' || model.includes('/fail-model')) {
    return new Response(JSON.stringify({ error: { message: 'upstream exploded' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  const chunks = [
        'Reply ',
        'from the ',
        'fake LLM. ',
        '<artifact file="e2e-fake-note.md" title="E2E Fake Note">' +
          '<subtitle>From the wire</subtitle>' +
          '<description>An artifact emitted by the fake LLM</description>' +
          '<summary>Fake note summary</summary>' +
          '<content># E2E Fake Note\nbody text</content>' +
          '</artifact>',
      ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) {
        await new Promise((r) => setTimeout(r, upstream.chunkDelayMs));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`));
      }
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 } })}\n\n`
        )
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/* ── chores mock (the Gemini SDK is a mock — zero network, deterministic) ─── */

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      async generateContent(params: { contents: string }) {
        const contents = String(params.contents ?? '');
        if (/Give this conversation a title/.test(contents)) return { text: 'E2E Title' };
        return { text: 'DESCRIPTION: e2e.\nSUMMARY: e2e summary.' };
      },
    };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

/* ── boot the real app ────────────────────────────────────────────────────── */

initDb(':memory:');

const { app } = await import('../../../server/app');
const { ensureOwnerBootstrap } = await import('../../../server/lib/users');
const { clearUnlockedVaultKeysForTests } = await import('../../../server/lib/accountVault');
const { setWorkspaceMode, clearWorkspaceMode, saveVpsSession, clearVpsSession } = await import(
  '../../services/workspaceSession'
);

let server: Server;
let base = '';
let token = '';
let userId = 1;
const PROJECT_ID = 'proj-e2e-send';
const THREADS = ['th-a', 'th-b', 'th-c', 'th-d', 'th-e', 'th-f'];

interface ApiRes {
  status: number;
  body: any;
}
async function api(pathname: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<ApiRes> {
  const res = await fetch(base + pathname, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body };
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

/* ── the fetch router: test server + fake LLM, EVERYTHING else refused ────── */

const realFetch = globalThis.fetch.bind(globalThis);

/** A persistent window/localStorage — the client's session + draft persistence ride it. */
const clientStorage = new Map<string, string>();
function stubClientWindow(): void {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => clientStorage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        clientStorage.set(k, v);
      },
      removeItem: (k: string) => {
        clientStorage.delete(k);
      },
    },
    location: { origin: base },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

beforeEach(() => {
  stubClientWindow(); // the client session + draft persistence ride this Map
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(base)) return realFetch(url, init); // the real app
    if (url.startsWith('https://openrouter.ai/')) return fakeLlmResponse(init); // the fake LLM
    // Refuse everything else — no external system is EVER stressed by a test.
    throw new Error(`E2E fetch router: unexpected outbound request to ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals(); // safe: beforeEach re-stubs fetch AND the window
});

/* ── the real client queue over real HTTP ─────────────────────────────────── */

import { SendQueue, type SendQueueDeps } from '../../application/sendQueue';
import type { ChatAttachment } from '../../domains/06-chat-threads/types';

function makeClientDeps(
  threadId: string,
  renderedPhases: string[],
  modelBox: { current: { id: string; name: string } } = {
    current: { id: 'nvidia/nemotron-3.5-lightning:free', name: 'Nemotron' },
  }
): SendQueueDeps {
  const turns: Array<{ id: string; role: string; content: string; timestamp: number }> = [];
  let turnN = 0;
  return {
    threadRegistry: {
      getActiveThreadId: () => threadId,
      getThread: () => ({
        id: threadId,
        title: 'E2E',
        titleState: 'placeholder',
        titleVersion: 0,
        lifecycle: 'active',
      }),
      patch: vi.fn(),
      // One STAGED attachment — the send must snapshot it onto the draft, the
      // job payload must carry it, and the committed pair must record its
      // provenance (turnId + turnIndex). Found live 2026-10-25: the server
      // committed it with null provenance → no chips rendered at all.
      getAttachments: () =>
        [
          {
            artifactId: 'art-e2e-staged-1',
            granularity: 'full',
            addedAt: 1,
            turnIndex: null,
            turnId: null,
          },
        ] as ChatAttachment[],
      getStagedAttachments: () => [],
      stageArtifact: vi.fn(),
      unstageArtifact: vi.fn(),
      setAttachmentGranularity: vi.fn(),
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
      appendTurn: (role: string, content: string) => {
        const t = { id: `t${++turnN}`, role, content, timestamp: Date.now() };
        turns.push(t);
        return t;
      },
      updateTurn: vi.fn(),
      count: () => turns.length,
    } as never,
    segmentation: { listChapters: () => [], declareNewChapter: vi.fn() } as never,
    artifacts: { getArtifact: () => null, upsertArtifact: vi.fn((a: unknown) => a) } as never,
    versioning: { recordRevision: vi.fn() } as never,
    // The compiler is client-side logic, unit-tested elsewhere; here it passes
    // the ask through so the FAKE LLM can echo-verify what it received.
    compiler: {
      compile: (args: { historyTurns: Array<{ content: string }> }) => ({
        compiledPrompt: args.historyTurns.at(-1)?.content ?? '',
        systemInstruction: 'e2e-sys',
      }),
    } as never,
    stream: { executeStreamingTurn: vi.fn() } as never, // unused in vps mode
    triggerReRender: vi.fn(() => {
      // sample the draft's honest phase on every render the queue triggers
      const d = queueRef.current?.getDraftsForThread(threadId)[0];
      if (d?.progress) renderedPhases.push(d.progress.phase);
    }),
    setStreamingStatus: vi.fn(),
    setStreamPhase: vi.fn(),
    markThreadUnread: vi.fn(),
    requestAutoTitle: async () => null,
    postChatCancel: vi.fn(),
    confirm: () => true,
    getContext: () => ({
      model: modelBox.current as never,
      projectId: PROJECT_ID,
      projectTitle: 'E2E Project',
      tokenCeiling: 4000,
    }),
  } as SendQueueDeps;
}

// the triggerReRender closure needs the queue — a settable ref does it
const queueRef: { current: SendQueue | null } = { current: null };

function newClientQueue(threadId: string, renderedPhases: string[], modelBox?: { current: { id: string; name: string } }): SendQueue {
  const deps = makeClientDeps(threadId, renderedPhases, modelBox);
  const queue = new SendQueue(() => deps);
  queueRef.current = queue;
  return queue;
}

beforeAll(async () => {
  stubClientWindow();
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
  userId = login.body.user.id;

  // A vault key for the OpenRouter lane (the fake LLM never reads it).
  const key = await api('/api/account/keys', {
    method: 'PUT',
    token,
    body: { slot: 'openrouter-free', apiKey: 'sk-or-e2e-fake-key-000000000000000000' },
  });
  expect(key.status).toBe(200);

  // Project + thread rows (commitJobPairTransaction needs the project).
  const proj = await api('/api/projects', {
    method: 'POST',
    token,
    body: {
      projectId: PROJECT_ID,
      name: 'E2E Send Project',
      codeName: 'e2e-send',
      description: '',
      turns: [],
      chapters: [],
      artifacts: [],
      edges: [],
    },
  });
  expect(proj.status).toBe(201);
  const db = getDb();
  const now = Date.now();
  for (const tid of THREADS) {
    db.prepare(
      `INSERT INTO threads (user_id, project_id, thread_id, title, title_version, folder_id, created_at, updated_at, doc_json, revision)
       VALUES (?, ?, ?, 'E2E Thread', 0, NULL, ?, ?, ?, 1)`
    ).run(userId, PROJECT_ID, tid, now, now, JSON.stringify({ id: tid, title: 'E2E Thread' }));
  }

  // The client session points at the REAL test server over real HTTP.
  setWorkspaceMode('vps');
  saveVpsSession({ baseUrl: base, token, userId, email: 'owner@example.com', isOwner: true, vaultUnlocked: true });
});

afterAll(() => {
  server?.close();
  closeDbForTests();
  clearWorkspaceMode();
  clearVpsSession();
  vi.unstubAllGlobals();
});

async function turnsOfThread(threadId: string): Promise<Array<{ role: string; content: string }>> {
  const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=0`, { token });
  return ((delta.body?.turns ?? []) as Array<{ threadId?: string; role: string; content: string }>)
    .filter((t) => t.threadId === threadId)
    .map(({ role, content }) => ({ role, content }));
}

/* ── C1: send → stream → pair commits atomically, honest ladder ───────────── */

describe('C1 — send → stream → pair commits atomically', () => {
  it('the real client sends over real HTTP; the fake LLM answers; the pair lands; the ladder is honest', async () => { // vitest: real-HTTP journeys
    upstream.behavior = 'slow-ok';
    upstream.chunkDelayMs = 150; // slow TTFT — the ACK must be observable, not raced
    upstream.requests = [];
    const renderedPhases: string[] = [];
    const queue = newClientQueue('th-a', renderedPhases);

    queue.handleSendMessage('hello upstream');
    await waitFor(() => (queue.getQueue().length === 0 ? true : null), 10000);

    // The fake LLM received EXACTLY the compiled ask.
    expect(upstream.requests.length).toBe(1);

    // The pair committed atomically in SQLite — both turns, real reply.
    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=0`, { token });
    const turns = (delta.body.turns as Array<{ id: string; threadId: string; role: string; content: string; meta?: any }>).filter(
      (t) => t.threadId === 'th-a'
    );
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(turns[0].content).toBe('hello upstream');
    expect(turns[1].content).toBe('Reply from the fake LLM.');

    // EXTRACTED ARTIFACTS: the sentinel block is demuxed out of the reply and
    // both lands in the artifact set AND rides the assistant turn — the chat
    // renders the cards under the reply (live 2026-10-25: table yes, chat no).
    const aiRow = (delta.body.turns as Array<{ id: string; extractedArtifacts?: Array<Record<string, unknown>> }>).find(
      (t) => t.id === turns[1].id
    );
    expect(aiRow?.extractedArtifacts?.length).toBe(1);
    expect(aiRow!.extractedArtifacts![0]).toMatchObject({
      title: 'E2E Fake Note',
      category: 'note',
      content: '# E2E Fake Note\nbody text',
    });
    const artRow = (delta.body.artifacts as Array<{ id: string; title?: string }>).find(
      (a) => a.title === 'E2E Fake Note'
    );
    expect(artRow).toBeTruthy();

    // PROVENANCE: the staged attachment rides the user turn with turnId +
    // turnIndex — the chips must render, not vanish into provenance -1.
    const atts = turns[0].meta?.attachments as Array<{ artifactId: string; turnId?: string; turnIndex?: number | null }>;
    expect(atts?.length).toBe(1);
    expect(atts[0].artifactId).toBe('art-e2e-staged-1');
    expect(atts[0].turnId).toBe(turns[0].id);
    expect(typeof atts[0].turnIndex).toBe('number');
    expect(atts[0].turnIndex).toBeGreaterThanOrEqual(0);

    // TOKENS: the mirror must never show "0 in · 0 out · 0 total tok".
    expect(turns[1].meta?.inputTokens).toBeGreaterThan(0);
    expect(turns[1].meta?.totalTokens).toBeGreaterThan(0);

    // The honest ladder was OBSERVED through the real server events:
    // queued → [connecting] → awaiting-first-token (the provider ACK) → writing.
    // 'connecting' is skippable when the watcher attaches after the ACK — the
    // snapshot then says connected:true directly (a race the E2E itself caught).
    expect(renderedPhases[0]).toBe('queued');
    expect(renderedPhases).toContain('awaiting-first-token');
    expect(renderedPhases).toContain('writing');
    expect(renderedPhases.indexOf('awaiting-first-token')).toBeLessThan(renderedPhases.lastIndexOf('writing'));
  }, 20000);
});

/* ── C13: reload → reconcile rebinds, never duplicates ────────────────────── */

describe('C13 — reload: reconcile rebinds, never duplicates', () => {
  it('a completed send leaves NOTHING behind; a fresh client after "reload" sees zero drafts', async () => { // vitest: real-HTTP journeys
    upstream.behavior = 'ok';
    upstream.requests = [];
    const queue = newClientQueue('th-b', []);
    queue.handleSendMessage('completed before reload');
    await waitFor(() => (queue.getQueue().length === 0 ? true : null), 10000);

    // Simulated reload: a brand-new SendQueue (loads persisted drafts) + reconcile.
    const reloaded = newClientQueue('th-b', []);
    await reloaded.reconcileServerJobs(PROJECT_ID);
    expect(reloaded.getQueue().length).toBe(0); // completed job → no draft, no duplicate
    expect(upstream.requests.length).toBe(1); // and NO re-send happened
  }, 20000);
});

/* ── C4: fail → reload → retry via /jobs/:id/retry, never a duplicate send ── */

describe('C4 — fail → reload → retry the SAME job', () => {
  it('the retried draft reuses the row (one /retry, one more LLM hit, exactly one pair)', async () => { // vitest: real-HTTP journeys
    upstream.behavior = 'fail-500';
    upstream.requests = [];
    const queue = newClientQueue('th-c', []);
    queue.handleSendMessage('fail me then retry');
    await waitFor(() => {
      const d = queue.getDraftsForThread('th-c')[0];
      return d?.state === 'failed' ? d : null;
    }, 10000);
    expect(upstream.requests.length).toBe(1);
    expect((await turnsOfThread('th-c')).length).toBe(0); // failed → zero turns

    // Reload: the persisted failed draft keeps its serverJobId binding.
    const reloaded = newClientQueue('th-c', []);
    await reloaded.reconcileServerJobs(PROJECT_ID);
    const drafts = reloaded.getDraftsForThread('th-c');
    expect(drafts.length).toBe(1); // rebound, NOT duplicated
    expect(drafts[0].serverJobId).toBeTruthy();
    expect(drafts[0].state).toBe('failed');

    // Retry — must go through POST /jobs/:id/retry, NOT a new send.
    upstream.behavior = 'ok';
    reloaded.retryDraft(drafts[0].id);
    await waitFor(() => (reloaded.getQueue().length === 0 ? true : null), 10000);

    expect(upstream.requests.length).toBe(2); // fail + retry — no third attempt
    const turns = await turnsOfThread('th-c');
    expect(turns.length).toBe(2); // exactly ONE pair
    expect(turns[1].content).toBe('Reply from the fake LLM.');
    // No leftover job rows (a duplicate send would still be queued/blocked).
    const jobs = await api(`/api/projects/${PROJECT_ID}/jobs`, { token });
    expect(jobs.body.jobs.length).toBe(0);
  }, 20000);
});

/* ── C8: FIFO — failed head blocks; queued stays QUEUED; discard unblocks ─── */

describe('C8 — FIFO head-block law, observed by the real client', () => {
  it('the queued draft behind a failed head stays QUEUED (never fake thinking); discard unblocks', async () => { // vitest: real-HTTP journeys
    upstream.behavior = 'fail-500';
    upstream.requests = [];
    const queue = newClientQueue('th-d', []);
    queue.handleSendMessage('failing head');
    await waitFor(() => {
      const d = queue.getDraftsForThread('th-d')[0];
      return d?.state === 'failed' ? d : null;
    }, 10000);

    upstream.behavior = 'ok';
    queue.handleSendMessage('queued behind the failure');
    await new Promise((r) => setTimeout(r, 500)); // give any WRONG runner a chance

    const items = queue.getDraftsForThread('th-d');
    expect(items.length).toBe(2);
    const blocked = items.find((i) => i.state === 'queued')!;
    expect(blocked).toBeTruthy();
    expect(blocked!.text).toBe('queued behind the failure');
    // THE regression: a blocked draft must never claim the model is thinking.
    expect(blocked!.progress?.phase).toBe('queued');
    expect(upstream.requests.length).toBe(1); // the blocked job never reached the LLM

    // Discard the head → the queue proceeds IN ORDER.
    queue.discardDraft(items[0].id);
    await waitFor(() => (queue.getQueue().length === 0 ? true : null), 10000);
    const turns = await turnsOfThread('th-d');
    expect(turns.map((t) => t.content)).toEqual(['queued behind the failure', 'Reply from the fake LLM.']);
  }, 20000);
});

/* ── C2: stop mid-stream → stopped draft → store-as-is commits the partial ── */

describe('C2 — stop mid-stream, then store-as-is', () => {
  it('stop keeps the partial on the draft; store-as-is commits it as the pair', async () => { // vitest: real-HTTP journeys
    upstream.behavior = 'slow-ok';
    upstream.chunkDelayMs = 150;
    try {
      const queue = newClientQueue('th-e', []);
      queue.handleSendMessage('stop me midway');
      await waitFor(() => {
        const d = queue.getDraftsForThread('th-e')[0];
        if (process.env.E2E_DEBUG) console.log('C2 poll:', d?.state, d?.progress?.phase, JSON.stringify(d?.partial));
        return d?.progress?.phase === 'writing' && (d.partial?.length ?? 0) > 0 ? d : null;
      }, 10000);

      queue.stopGeneration();
      await waitFor(() => {
        const d = queue.getDraftsForThread('th-e')[0];
        return d?.state === 'stopped' ? d : null;
      }, 10000);
      const stopped = queue.getDraftsForThread('th-e')[0];
      expect(stopped.partial).toBeTruthy();

      queue.storeAsIsDraft(stopped.id);
      await waitFor(() => (queue.getQueue().length === 0 ? true : null), 10000);
      const turns = await turnsOfThread('th-e');
      expect(turns.length).toBe(2);
      expect(turns[1].content).toBe(stopped.partial); // the partial became the pair
    } finally {
      upstream.chunkDelayMs = 20;
    }
  }, 20000);
});

/* ── C14/A10: VAULT_LOCKED → failed draft with code → unlock → retry ──────── */

describe('C14 — VAULT_LOCKED: honest code, unlock, retry', () => {
  it('locked vault → failed draft carries VAULT_LOCKED; unlock + retry commits the pair', async () => { // vitest: real-HTTP journeys
    upstream.behavior = 'ok';
    upstream.requests = [];
    const queue = newClientQueue('th-b', []); // reuse the quiet thread
    clearUnlockedVaultKeysForTests(); // server restart semantics

    queue.handleSendMessage('sent while locked');
    await waitFor(() => {
      const d = queue.getDraftsForThread('th-b')[0];
      if (process.env.E2E_DEBUG) console.log('C14 poll:', d?.state, d?.errorCode, d?.reason);
      return d?.state === 'failed' && d.errorCode === 'VAULT_LOCKED' ? d : null;
    }, 10000);

    // The real unlock endpoint restores the vault.
    const unlock = await api('/api/auth/unlock', { method: 'POST', token, body: { password: 'owner-pass-123456' } });
    expect(unlock.status).toBe(200);

    queue.retryDraft(queue.getDraftsForThread('th-b')[0].id);
    await waitFor(() => (queue.getQueue().length === 0 ? true : null), 10000);
    const turns = await turnsOfThread('th-b');
    const askIdx = turns.findIndex((t) => t.role === 'user' && t.content === 'sent while locked');
    expect(askIdx).toBeGreaterThanOrEqual(0);
    expect(turns[askIdx + 1].content).toBe('Reply from the fake LLM.');
  }, 20000);
});
/* ── C15: send-with-attachments fails → change model → retry ──────────────── */

describe('C15 — failed send with attachments → change model → retry', () => {
  // David's live scenario (2026-10-25): the first model fails twice; the user
  // selects another model and hits Retry. Expected: the retry uses the NEW
  // model, the pair's model + token stats reflect the attempt that actually
  // ran, and the attachments ride the send (provenance welded server-side).
  it('the retry carries the CURRENT model; the pair records it with real tokens', async () => { // vitest: real-HTTP journeys
    upstream.requests = [];
    upstream.models = [];
    upstream.behavior = 'fail-500'; // the first model's lane fails upstream
    const modelBox = { current: { id: 'nvidia/nemotron-3.5-lightning:free', name: 'Nemotron' } };
    const queue = newClientQueue('th-f', [], modelBox);

    queue.handleSendMessage('retry me with a different model');
    await waitFor(() => {
      const d = queue.getDraftsForThread('th-f')[0];
      return d?.state === 'failed' ? d : null;
    }, 10000);
    expect(upstream.requests.length).toBe(1);
    expect((await turnsOfThread('th-f')).length).toBe(0); // failed → zero turns

    // The user changes the model (nvidia → z-ai, both OpenRouter lanes), then
    // hits Retry on the failed draft.
    upstream.behavior = 'ok';
    modelBox.current = { id: 'z-ai/glm-5.3-flash', name: 'GLM 5.3 Flash' };
    queue.retryDraft(queue.getDraftsForThread('th-f')[0].id);
    await waitFor(() => (queue.getQueue().length === 0 ? true : null), 10000);

    // The fake LLM saw the FAILED model once and the NEW model on the retry —
    // never a re-run of the model that already failed twice.
    expect(upstream.models).toEqual(['nvidia/nemotron-3.5-lightning:free', 'z-ai/glm-5.3-flash']);
    expect(upstream.requests.length).toBe(2);

    // Exactly one pair, and its stats come from the attempt that succeeded:
    // the NEW model + the fake LLM's usage (10 in / 6 out / 16 total), never
    // the failed model's identity.
    const turns = await turnsOfThread('th-f');
    expect(turns.length).toBe(2);
    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=0`, { token });
    const rows = (delta.body.turns as Array<{ threadId?: string; role: string; meta?: any }>).filter(
      (t) => t.threadId === 'th-f'
    );
    const ai = rows.find((t) => t.role === 'assistant')!;
    expect(ai.meta?.model).toBe('z-ai/glm-5.3-flash');
    expect(ai.meta?.inputTokens).toBe(10);
    expect(ai.meta?.totalTokens).toBe(16);

    // The staged attachment rode the retry and got provenance welded —
    // chips render on the user turn (not stuck in the staged tray).
    const user = rows.find((t) => t.role === 'user')!;
    const atts = user.meta?.attachments as Array<{ artifactId: string; turnId?: string; turnIndex?: number | null }>;
    expect(atts?.length).toBe(1);
    expect(atts[0].artifactId).toBe('art-e2e-staged-1');
    expect(atts[0].turnId).toBe((user as unknown as { id: string }).id);
    expect(atts[0].turnIndex).toBeGreaterThanOrEqual(0);

    // No leftover job rows.
    const jobs = await api(`/api/projects/${PROJECT_ID}/jobs`, { token });
    expect((jobs.body.jobs as Array<{ jobId: string }>).length).toBe(0);
  }, 20000);
});
