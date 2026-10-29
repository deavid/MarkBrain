/**
 * VPS user journeys — happy paths with REALISTIC UI-shaped payloads.
 *
 * The gap this closes: earlier verification hit the API with handcrafted
 * empty payloads (`chapters: []`), so a genesis chapter WITHOUT a threadId
 * crashed `POST /api/projects` with `NOT NULL constraint failed` and nobody
 * noticed. Every payload here is what the real UI sends.
 *
 * In-memory SQLite + real HTTP listener; `@google/genai` MOCKED (artifact
 * saves enqueue server-side indexing — zero external calls allowed).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { initDb, closeDbForTests } from '../../server/db';
import type { ProjectSnapshot } from '../services/stores/projectStore';

process.env.MARKBRAIN_OWNER_EMAIL = 'owner@example.com';
process.env.MARKBRAIN_OWNER_PASSWORD = 'owner-pass-123456';

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
        yield { text: 'stream reply' };
      },
    };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

// The mirror store is IndexedDB-only; journeys exercise vpsStore's server
// contract, so the mirror is a no-op stub (no network, no IDB in Node).
vi.mock('../services/localBackend', () => ({
  localListProjects: async () => [],
  localLoadProject: async () => null,
  localPutProject: async () => {},
  localReplaceAll: async () => {},
  localDeleteProject: async () => {},
}));

initDb(':memory:');

const { app } = await import('../../server/app');
const { ensureOwnerBootstrap } = await import('../../server/lib/users');

let server: Server;
let base = '';
let token = '';

interface ApiRes {
  status: number;
  body: any;
  contentType: string;
  text: string;
}

async function api(pathname: string, opts: { method?: string; body?: unknown; rawBody?: string } = {}): Promise<ApiRes> {
  const res = await fetch(base + pathname, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: opts.rawBody !== undefined ? opts.rawBody : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body, contentType: res.headers.get('content-type') ?? '', text };
}

function expectJsonNotHtml(res: ApiRes): void {
  expect(res.contentType).toContain('application/json');
  expect(res.text).not.toContain('<html');
}

beforeAll(async () => {
  ensureOwnerBootstrap();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no ephemeral port');
  base = `http://127.0.0.1:${addr.port}`;

  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'owner-pass-123456' }),
  });
  const loginBody = (await login.json()) as { token: string };
  expect(login.status).toBe(200);
  token = loginBody.token;
});

afterAll(() => {
  server?.close();
  closeDbForTests();
});

/* ─────────────────────────────────────────────────────────────────────────
 * 1 — Create workspace from the UI (Genesis)
 * The exact payload the UI sends, verbatim.
 * ───────────────────────────────────────────────────────────────────────── */

// The real "Genesis workspace" create payload — genesis chapter has NO threadId.
const GENESIS_PAYLOAD = {
  project: {
    projectId: 'proj-mvo8wsih-gxot',
    turns: [],
    chapters: [
      {
        id: 'chap-genesis-mvo8wsih',
        workspaceId: 'proj-mvo8wsih-gxot',
        title: 'Genesis Chapter',
        summary: '',
        description: '',
        granularity: 'full',
        status: 'active',
        startIndex: 0,
        createdAt: 1792958017625,
      },
    ],
    artifacts: [],
    edges: [],
    updatedAt: 1792958017625,
    name: 'Unhaunter Brainstorming',
    codeName: 'UNH-BR1',
    description: 'A space for thinking out loud.',
    color: '#3b82f6',
  },
};

describe('journey 1 — create workspace from the UI (Genesis)', () => {
  it('creates the project (201, revision 1) and round-trips meta + genesis chapter', async () => {
    const create = await api('/api/projects', { method: 'POST', body: GENESIS_PAYLOAD });
    expect(create.status).toBe(201);
    expect(create.body.revision).toBe(1);

    const get = await api(`/api/projects/${GENESIS_PAYLOAD.project.projectId}`);
    expect(get.status).toBe(200);
    const p = get.body.project;
    expect(p.name).toBe('Unhaunter Brainstorming');
    expect(p.codeName).toBe('UNH-BR1');
    expect(p.description).toBe('A space for thinking out loud.');
    expect(p.color).toBe('#3b82f6');

    expect(p.chapters).toHaveLength(1);
    const ch = p.chapters[0];
    expect(ch.id).toBe('chap-genesis-mvo8wsih');
    expect(ch.title).toBe('Genesis Chapter');
    expect(ch.status).toBe('active');
    expect(ch.startIndex).toBe(0);
    // Project-level chapter: thread scoping legitimately absent — and the
    // round-trip must preserve that, not invent '' or null.
    expect(ch.threadId).toBeUndefined();
    expect('threadId' in ch).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 2 — Turns without threadId
 * ───────────────────────────────────────────────────────────────────────── */

describe('journey 2 — turns without threadId', () => {
  it('creates and PUT-diffs a snapshot whose turns omit threadId — no crash, unchanged round-trip', async () => {
    const snap: ProjectSnapshot = {
      projectId: 'proj-turns-nothread',
      name: 'Loose Turns',
      codeName: 'LT-1',
      description: 'turns at workspace level',
      color: '#e05a66',
      turns: [
        { id: 'turn-nt-1', role: 'user', content: 'unscoped question', timestamp: 3000 },
        { id: 'turn-nt-2', role: 'assistant', content: 'unscoped answer', timestamp: 3001 },
      ],
      chapters: [],
      artifacts: [],
      edges: [],
      updatedAt: 3000,
    };

    const create = await api('/api/projects', { method: 'POST', body: { project: snap } });
    expect(create.status).toBe(201);

    // PUT-diff with the identical snapshot (the UI's save path).
    const put = await api(`/api/projects/${snap.projectId}`, { method: 'PUT', body: snap });
    expect(put.status).toBe(200);
    expect(put.body.revision).toBe(2);

    // And a real diff edit — content change on one turn.
    const edited: ProjectSnapshot = {
      ...snap,
      turns: [snap.turns[0], { ...snap.turns[1], content: 'unscoped answer, revised' }],
    };
    const put2 = await api(`/api/projects/${snap.projectId}`, { method: 'PUT', body: edited });
    expect(put2.status).toBe(200);

    const get = await api(`/api/projects/${snap.projectId}`);
    expect(get.status).toBe(200);
    const turns = get.body.project.turns as Array<Record<string, unknown>>;
    expect(turns).toHaveLength(2);
    for (const t of turns) {
      expect(t.threadId).toBeUndefined();
      expect('threadId' in t).toBe(false); // absence preserved, not '' or null
    }
    expect(turns.find((t) => t.id === 'turn-nt-1')?.content).toBe('unscoped question');
    expect(turns.find((t) => t.id === 'turn-nt-2')?.content).toBe('unscoped answer, revised');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 3 — Rename / re-describe a workspace
 * ───────────────────────────────────────────────────────────────────────── */

describe('journey 3 — rename / re-describe a workspace', () => {
  it('PUT snapshot diff with new name+description bumps revision; unchanged entities survive', async () => {
    const snap: ProjectSnapshot = {
      projectId: 'proj-rename-1',
      name: 'Old Name',
      codeName: 'RN-1',
      description: 'old description',
      color: '#3b82f6',
      turns: [{ id: 'turn-rn-1', role: 'user', content: 'keep me', timestamp: 4000, threadId: 'thread-rn' }],
      chapters: [
        {
          id: 'chap-rn-1',
          workspaceId: 'proj-rename-1',
          threadId: 'thread-rn',
          title: 'Stable Chapter',
          status: 'active',
          startIndex: 0,
          createdAt: 4000,
        },
      ],
      artifacts: [],
      edges: [],
      updatedAt: 4000,
    };
    const create = await api('/api/projects', { method: 'POST', body: { project: snap } });
    expect(create.status).toBe(201);
    const rev1 = create.body.revision as number;

    const renamed: ProjectSnapshot = { ...snap, name: 'New Name', description: 'new description' };
    const put = await api(`/api/projects/${snap.projectId}`, { method: 'PUT', body: renamed });
    expect(put.status).toBe(200);
    expect(put.body.revision).toBe(rev1 + 1);

    const get = await api(`/api/projects/${snap.projectId}`);
    const p = get.body.project;
    expect(p.name).toBe('New Name');
    expect(p.description).toBe('new description');
    // Unchanged entities keep working.
    expect(p.turns.map((t: { id: string }) => t.id)).toContain('turn-rn-1');
    expect(p.chapters.map((c: { id: string }) => c.id)).toContain('chap-rn-1');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 4 — Chat pair + regenerate
 * ───────────────────────────────────────────────────────────────────────── */

describe('journey 4 — chat pair + regenerate', () => {
  it('commitPair lands both turns in seq order; replaceTurn rewrites content with the id preserved', async () => {
    const projectId = 'proj-pair-1';
    const create = await api('/api/projects', {
      method: 'POST',
      body: { project: { projectId, turns: [], chapters: [], artifacts: [], edges: [], updatedAt: 5000 } },
    });
    expect(create.status).toBe(201);

    const pair = await api(`/api/projects/${projectId}/mutate`, {
      method: 'POST',
      body: {
        op: 'commitPair',
        threadId: 'thread-pair',
        userTurn: { id: 'turn-ask-pair', role: 'user', content: 'how does it work?', timestamp: 5001 },
        assistantTurn: { id: 'turn-reply-pair', role: 'assistant', content: 'like this', timestamp: 5002 },
      },
    });
    expect(pair.status).toBe(200);

    const afterPair = await api(`/api/projects/${projectId}`);
    const turns = afterPair.body.project.turns as Array<{ id: string; role: string; content: string }>;
    expect(turns).toHaveLength(2);
    // Ordered by seq: user first, assistant second.
    expect(turns.map((t) => t.id)).toEqual(['turn-ask-pair', 'turn-reply-pair']);
    expect(turns[0].role).toBe('user');
    expect(turns[1].role).toBe('assistant');

    // Regenerate: replace the assistant reply in place (partial turn payload,
    // exactly what the UI sends).
    const regen = await api(`/api/projects/${projectId}/mutate`, {
      method: 'POST',
      body: {
        op: 'replaceTurn',
        threadId: 'thread-pair',
        turn: { id: 'turn-reply-pair', content: 'v2' },
      },
    });
    expect(regen.status).toBe(200);

    const afterRegen = await api(`/api/projects/${projectId}`);
    const after = afterRegen.body.project.turns as Array<{ id: string; content: string; role: string }>;
    expect(after).toHaveLength(2); // no duplicate
    expect(after.map((t) => t.id)).toEqual(['turn-ask-pair', 'turn-reply-pair']); // ids + order preserved
    expect(after.find((t) => t.id === 'turn-reply-pair')?.content).toBe('v2');
    expect(after.find((t) => t.id === 'turn-reply-pair')?.role).toBe('assistant'); // merged from stored turn
    expect(after.find((t) => t.id === 'turn-ask-pair')?.content).toBe('how does it work?');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 5 — Artifact lifecycle
 * ───────────────────────────────────────────────────────────────────────── */

describe('journey 5 — artifact lifecycle', () => {
  it('upsertArtifact shows up in GET; deleteArtifact removes it and delta carries the tombstone', async () => {
    const projectId = 'proj-art-1';
    await api('/api/projects', {
      method: 'POST',
      body: { project: { projectId, turns: [], chapters: [], artifacts: [], edges: [], updatedAt: 6000 } },
    });

    const upsert = await api(`/api/projects/${projectId}/mutate`, {
      method: 'POST',
      body: {
        op: 'upsertArtifact',
        artifact: {
          id: 'art-lifecycle-1',
          workspaceId: projectId,
          code: 'lifecycle-note',
          title: 'Lifecycle Note',
          type: 'document',
          category: 'note',
          color: '#e05a66',
          isHighConcept: false,
          current: { subtitle: '', description: '', summary: '', body: '# Lifecycle Note' },
          tags: ['chat-extracted'],
          createdAt: 6001,
          updatedAt: 6001,
          graph: { is_high_concept: false, x: 300, y: 200 },
        },
      },
    });
    expect(upsert.status).toBe(200);
    const revAfterUpsert = upsert.body.revision as number;

    const withArt = await api(`/api/projects/${projectId}`);
    expect(withArt.body.project.artifacts.map((a: { id: string }) => a.id)).toContain('art-lifecycle-1');

    const del = await api(`/api/projects/${projectId}/mutate`, {
      method: 'POST',
      body: { op: 'deleteArtifact', artifactId: 'art-lifecycle-1' },
    });
    expect(del.status).toBe(200);

    const afterDel = await api(`/api/projects/${projectId}`);
    expect(afterDel.body.project.artifacts.map((a: { id: string }) => a.id)).not.toContain('art-lifecycle-1');

    // The other device's delta carries the tombstone.
    const delta = await api(`/api/projects/${projectId}/delta?since=${revAfterUpsert}`);
    expect(delta.status).toBe(200);
    expect(delta.body.tombstones).toContainEqual({ entityType: 'artifact', entityId: 'art-lifecycle-1' });
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 6 — Delete workspace
 * ───────────────────────────────────────────────────────────────────────── */

describe('journey 6 — delete workspace', () => {
  it('DELETE is 200, then GET 404 / list empty / second DELETE 404 — all JSON', async () => {
    // Scope the "list empty" assertion to a clean account: drop everything first.
    const before = await api('/api/projects');
    for (const p of before.body.projects as Array<{ projectId: string }>) {
      await api(`/api/projects/${p.projectId}`, { method: 'DELETE' });
    }

    const projectId = 'proj-delete-1';
    await api('/api/projects', {
      method: 'POST',
      body: { project: { projectId, turns: [], chapters: [], artifacts: [], edges: [], updatedAt: 7000 } },
    });

    const del = await api(`/api/projects/${projectId}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    const get = await api(`/api/projects/${projectId}`);
    expect(get.status).toBe(404);
    expectJsonNotHtml(get);
    expect(get.body.error).toBeTruthy();

    const list = await api('/api/projects');
    expect(list.body.projects).toEqual([]);

    const del2 = await api(`/api/projects/${projectId}`, { method: 'DELETE' });
    expect(del2.status).toBe(404);
    expectJsonNotHtml(del2);
    expect(del2.body.error).toBeTruthy();
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 7 — JSON error contract
 * ───────────────────────────────────────────────────────────────────────── */

describe('journey 7 — JSON error contract', () => {
  it('malformed body / invalid mutation op answer 400 JSON — never an HTML stack page', async () => {
    const malformed = await api('/api/projects', { method: 'POST', rawBody: '{"project": ' });
    expect(malformed.status).toBe(400);
    expectJsonNotHtml(malformed);
    expect(typeof malformed.body.error).toBe('string');
    expect(malformed.body.error.length).toBeGreaterThan(0);

    const badOp = await api('/api/projects/proj-mvo8wsih-gxot/mutate', {
      method: 'POST',
      body: { op: 'definitely-not-a-mutation' },
    });
    expect(badOp.status).toBe(400);
    expectJsonNotHtml(badOp);
    expect(badOp.body.error).toContain('Unknown mutation');

    const noMutation = await api('/api/projects/proj-mvo8wsih-gxot/mutate', { method: 'POST', body: {} });
    expect(noMutation.status).toBe(400);
    expectJsonNotHtml(noMutation);
    expect(typeof noMutation.body.error).toBe('string');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 8 — Minimal create
 * ───────────────────────────────────────────────────────────────────────── */

describe('journey 8 — minimal create', () => {
  it('a bare snapshot gets the honest defaults: Untitled Project / #e05a66', async () => {
    const projectId = 'proj-minimal-1';
    const create = await api('/api/projects', {
      method: 'POST',
      body: {
        project: { projectId, turns: [], chapters: [], artifacts: [], edges: [], updatedAt: Date.now() },
      },
    });
    expect(create.status).toBe(201);
    expect(create.body.revision).toBe(1);

    const get = await api(`/api/projects/${projectId}`);
    expect(get.status).toBe(200);
    expect(get.body.project.name).toBe('Untitled Project');
    expect(get.body.project.color).toBe('#e05a66');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Client-side: vpsStore.save falls back to POST create on 404
 * ───────────────────────────────────────────────────────────────────────── */

describe('client — vpsStore.save on 404', () => {
  it('falls back to POST /api/projects create (stubbed fetch + localStorage, no network)', async () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
        clear: () => {
          for (const k of Object.keys(store)) delete store[k];
        },
      },
    });

    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body });
        if (method === 'PUT') {
          return new Response(JSON.stringify({ error: 'Project not found.' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true, revision: 1 }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );

    const { vpsStore } = await import('../services/stores/vpsStore');
    const snapshot = {
      projectId: 'proj-offline-born',
      turns: [],
      chapters: [],
      artifacts: [],
      edges: [],
      updatedAt: 8000,
    } as ProjectSnapshot;

    await vpsStore.save(snapshot);

    expect(calls.map((c) => c.method)).toEqual(['PUT', 'POST']);
    expect(calls[0].url).toContain('/api/projects/proj-offline-born');
    expect(calls[1].url).toContain('/api/projects');
    expect(calls[1].url).not.toContain('proj-offline-born'); // the create endpoint, not the item path
    expect(JSON.parse(calls[1].body!)).toEqual({ project: snapshot });

    vi.unstubAllGlobals();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * Client-side: vpsStore.save on 401 (the sign-out race)
 * Sign-out clears the session while a debounced save is still scheduled;
 * the save MUST queue for replay (mirror already holds it) instead of
 * throwing "could not save to the cloud" at the gate. Found live 2026-10-29.
 * ─────────────────────────────────────────────────────────────────────────── */
describe('client — vpsStore.save on 401 (sign-out race)', () => {
  it('queues the edit for replay instead of throwing a save alarm', async () => {
    // offlineOutbox reads the BARE localStorage global, not window.localStorage
    const store: Record<string, string> = {};
    const ls = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    };
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', { localStorage: ls, dispatchEvent: () => {} });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const { vpsStore } = await import('../services/stores/vpsStore');
    const { clearDirty, getAllRecords } = await import('../services/offlineOutbox');
    clearDirty('proj-signout-race');

    const snapshot = {
      projectId: 'proj-signout-race',
      turns: [],
      chapters: [],
      artifacts: [],
      edges: [],
      updatedAt: 9000,
    } as ProjectSnapshot;

    // no throw, no alarm — the edit is queued for the next sign-in
    await expect(vpsStore.save(snapshot)).resolves.toBeUndefined();

    const queued = getAllRecords().find((r) => r.projectId === 'proj-signout-race');
    expect(queued).toBeDefined();

    vi.unstubAllGlobals();
  });
});
