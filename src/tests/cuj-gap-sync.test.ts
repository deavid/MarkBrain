/**
 * CUJ matrix gaps G6–G8 + G10 — delta merge, vpsStore offline mirror,
 * backup restore journey, workspaceSession contract
 * (design-docs/21C §1, 21D §4.5, 22_CUJ_TEST_MATRIX gap register).
 *
 * G6 — mergeDeltaIntoDomains (tombstones, artifacts, chapters, edges, turns,
 *      threads, folders) against stub domains.
 * G7 — vpsStore list/load fall back to the IndexedDB mirror when the network
 *      is down (localBackend mocked — honest mirror seam, no IDB in Node).
 * G8 — backup restore: parseDatabaseExport(serializeDatabase(...)) →
 *      POST /api/projects/replace-all → GET round-trips the content.
 * G10 — workspaceSession: session round-trip + junk rejection, getActiveIdbName
 *       vps naming, getScopedStorageKey both branches, clear_* cleanup.
 *
 * No real network anywhere: fetch is stubbed, `@google/genai` MOCKED.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { initDb, closeDbForTests } from '../../server/db';

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

/* ── localBackend mirror stub (G7 seeds it; server journeys don't touch it) ── */

const mirror = vi.hoisted(() => ({ projects: new Map<string, Record<string, unknown>>() }));

vi.mock('../services/localBackend', () => ({
  localListProjects: async () => [...mirror.projects.values()],
  localLoadProject: async (projectId: string) => mirror.projects.get(projectId) ?? null,
  localPutProject: async (p: Record<string, unknown>) => {
    mirror.projects.set(p.projectId as string, p);
  },
  localReplaceAll: async (ps: Array<Record<string, unknown>>) => {
    mirror.projects.clear();
    for (const p of ps) mirror.projects.set(p.projectId as string, p);
  },
  localDeleteProject: async (projectId: string) => {
    mirror.projects.delete(projectId);
  },
}));

initDb(':memory:');

const { app } = await import('../../server/app');
const { ensureOwnerBootstrap } = await import('../../server/lib/users');
const { mergeDeltaIntoDomains } = await import('../application/useVpsDeltaSync');
const { vpsStore } = await import('../services/stores/vpsStore');
const { serializeDatabase, parseDatabaseExport } = await import('../services/persistenceService');
const ws = await import('../services/workspaceSession');
import type { ProjectDeltaResponse } from '../../server/db/projectRepo';
import type { VpsDeltaSyncDeps } from '../application/useVpsDeltaSync';
import type { DatabaseExport } from '../services/persistenceService';

let server: Server;
let base = '';
let token = '';

async function api(pathname: string, opts: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(base + pathname, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
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
  expect(login.status).toBe(200);
  token = ((await login.json()) as { token: string }).token;
});

afterAll(() => {
  server?.close();
  closeDbForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  mirror.projects.clear();
  ws.clearWorkspaceMode();
  ws.clearVpsSession();
});

function stubWindow(seed: Record<string, string> = {}) {
  const storage = new Map(Object.entries(seed));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
    },
    location: { origin: 'http://localhost:3030', search: '' },
  });
  return storage;
}

/* ─────────────────────────────────────────────────────────────────────────
 * G6 — mergeDeltaIntoDomains against stub domains
 * ───────────────────────────────────────────────────────────────────────── */

function makeStubs(seed: {
  turns?: unknown[];
  artifacts?: unknown[];
  chapters?: unknown[];
  edges?: unknown[];
  threads?: unknown[];
  folders?: Array<{ id: string; name: string }>;
  activeThreadId?: string;
}) {
  const state = {
    turns: [...(seed.turns ?? [])] as Array<Record<string, unknown>>,
    artifacts: [...(seed.artifacts ?? [])] as Array<Record<string, unknown>>,
    chapters: [...(seed.chapters ?? [])] as Array<Record<string, unknown>>,
    edges: [...(seed.edges ?? [])] as Array<Record<string, unknown>>,
    threads: [...(seed.threads ?? [])] as Array<Record<string, unknown>>,
    folders: [...(seed.folders ?? [])] as Array<{ id: string; name: string }>,
    activeThreadId: seed.activeThreadId ?? 'thread-active',
    deletedArtifacts: [] as string[],
    deletedThreads: [] as string[],
    deletedFolders: [] as string[],
    createdThreads: [] as unknown[],
    mergedInactiveChapters: [] as Array<{ threadId: string; chapters: Array<Record<string, unknown>> }>,
    committedAttachments: [] as Array<{ threadId: string; artifactId: string; turnIndex: number | null; turnId: string | null }>,
    patchedThreads: [] as Array<{ id: string; patch: unknown }>,
    createdFolders: [] as string[],
  };
  const deps = {
    activeProjectId: 'p1',
    lastRevisionRef: { current: 0 },
    timeline: {
      getTurns: () => state.turns,
      loadTurns: (t: Array<Record<string, unknown>>) => {
        state.turns = t;
      },
    },
    artifacts: {
      listArtifacts: () => state.artifacts,
      loadArtifacts: (a: Array<Record<string, unknown>>) => {
        state.artifacts = a;
      },
      deleteArtifact: (id: string) => {
        state.deletedArtifacts.push(id);
        state.artifacts = state.artifacts.filter((x) => x.id !== id);
      },
    },
    segmentation: {
      listChapters: () => state.chapters,
      loadChapters: (c: Array<Record<string, unknown>>) => {
        state.chapters = c;
      },
    },
    graph: {
      listEdges: () => state.edges,
      loadEdges: (e: Array<Record<string, unknown>>) => {
        state.edges = e;
      },
    },
    threadRegistry: {
      getActiveThreadId: () => state.activeThreadId,
      getThread: (id: string) => state.threads.find((t) => t.id === id) ?? null,
      patch: (id: string, patch: unknown) => {
        state.patchedThreads.push({ id, patch });
        const t = state.threads.find((x) => x.id === id);
        if (t) Object.assign(t, patch);
      },
      createThread: (t: unknown) => {
        state.createdThreads.push(t);
        state.threads.push(t as Record<string, unknown>);
      },
      deleteThread: (id: string) => {
        state.deletedThreads.push(id);
        state.threads = state.threads.filter((t) => t.id !== id);
      },
      deleteFolder: (id: string) => {
        state.deletedFolders.push(id);
        state.folders = state.folders.filter((f) => f.id !== id);
      },
      getFolders: () => state.folders,
      mergeInactiveChapters: (threadId: string, chapters: Array<Record<string, unknown>>) => {
        state.mergedInactiveChapters.push({ threadId, chapters });
      },
      commitAttachment: (
        threadId: string,
        artifactId: string,
        turnIndex: number | null,
        turnId: string | null
      ) => {
        state.committedAttachments.push({ threadId, artifactId, turnIndex, turnId });
        return true;
      },
      createFolder: (name: string) => {
        state.createdFolders.push(name);
        const f = { id: `fold-${name}`, name };
        state.folders.push(f);
        return f;
      },
    },
    deps: undefined as unknown as VpsDeltaSyncDeps,
  };
  deps.deps = deps as unknown as VpsDeltaSyncDeps;
  return { state, deps: deps.deps };
}

function makeDelta(partial: Partial<ProjectDeltaResponse>): ProjectDeltaResponse {
  return {
    projectId: 'p1',
    revision: 10,
    threads: [],
    folders: [],
    turns: [],
    chapters: [],
    artifacts: [],
    edges: [],
    tombstones: [],
    activeJobs: [],
    ...partial,
  };
}

describe('G6 — useVpsDeltaSync mergeDeltaIntoDomains', () => {
  it('tombstones remove entities across all domains (deletions win)', () => {
    const { state, deps } = makeStubs({
      artifacts: [{ id: 'art-1' }, { id: 'art-2' }],
      chapters: [{ id: 'ch-1', startIndex: 0 }, { id: 'ch-2', startIndex: 5 }],
      edges: [{ id: 'edge-1' }],
      threads: [{ id: 'thread-1' }, { id: 'thread-2' }],
      folders: [{ id: 'fold-1', name: 'Ideas' }],
    });
    mergeDeltaIntoDomains(
      makeDelta({
        tombstones: [
          { entityType: 'artifact', entityId: 'art-1' },
          { entityType: 'chapter', entityId: 'ch-1' },
          { entityType: 'edge', entityId: 'edge-1' },
          { entityType: 'thread', entityId: 'thread-1' },
          { entityType: 'folder', entityId: 'fold-1' },
        ],
      }),
      deps
    );
    expect(state.deletedArtifacts).toEqual(['art-1']);
    expect(state.artifacts.map((a) => a.id)).toEqual(['art-2']);
    expect(state.chapters.map((c) => c.id)).toEqual(['ch-2']);
    expect(state.edges).toEqual([]);
    expect(state.deletedThreads).toEqual(['thread-1']);
    expect(state.deletedFolders).toEqual(['fold-1']);
  });

  it('chapters route PER THREAD: other threads go to the registry cache, never the active strip', () => {
    // Live bug 2026-10-25: every thread's chapters were loaded into the active
    // segmentation → the strip rendered other threads' windows against this
    // timeline ("Genesis Chapter" twice with duplicated contents).
    const { state, deps } = makeStubs({
      chapters: [{ id: 'ch-own', startIndex: 0, threadId: 'thread-active' }],
      threads: [{ id: 'thread-other' }],
      activeThreadId: 'thread-active',
    });
    mergeDeltaIntoDomains(
      makeDelta({
        chapters: [
          { id: 'ch-own', startIndex: 0, threadId: 'thread-active', workspaceId: 'p1', title: 'Own', status: 'active', createdAt: 1 },
          { id: 'ch-own', startIndex: 0, workspaceId: 'p1', title: 'Own v2', status: 'active', createdAt: 2 }, // same id → upserted
          { id: 'ch-foreign', startIndex: 0, threadId: 'thread-other', workspaceId: 'p1', title: 'Foreign', status: 'active', createdAt: 3 },
          { id: 'ch-legacy', startIndex: 3, workspaceId: 'p1', title: 'Legacy', status: 'active', createdAt: 4 }, // no threadId → active thread
        ],
      }),
      deps
    );
    expect(state.chapters.map((c) => c.id)).toEqual(['ch-own', 'ch-legacy']);
    expect(state.chapters.some((c) => c.id === 'ch-foreign')).toBe(false);
    expect(state.mergedInactiveChapters).toEqual([
      {
        threadId: 'thread-other',
        chapters: [
          { id: 'ch-foreign', startIndex: 0, threadId: 'thread-other', workspaceId: 'p1', title: 'Foreign', status: 'active', createdAt: 3 },
        ],
      },
    ]);
  });

  it('artifacts, chapters and edges upsert by id; chapters sort by startIndex', () => {
    const { state, deps } = makeStubs({
      artifacts: [{ id: 'art-1', title: 'old' }],
      chapters: [{ id: 'ch-late', startIndex: 9 }],
      edges: [{ id: 'edge-1', kind: 'old' }],
    });
    mergeDeltaIntoDomains(
      makeDelta({
        artifacts: [
          { id: 'art-1', title: 'new' },
          { id: 'art-3', title: 'fresh' },
        ] as unknown as ProjectDeltaResponse['artifacts'],
        chapters: [
          { id: 'ch-late', startIndex: 9, title: 'touched' },
          { id: 'ch-early', startIndex: 1 },
        ] as unknown as ProjectDeltaResponse['chapters'],
        edges: [
          { id: 'edge-1', kind: 'new' },
          { id: 'edge-2', kind: 'added' },
        ] as unknown as ProjectDeltaResponse['edges'],
      }),
      deps
    );
    expect(state.artifacts.map((a) => `${a.id}:${a.title}`)).toEqual(['art-1:new', 'art-3:fresh']);
    expect(state.chapters.map((c) => c.id)).toEqual(['ch-early', 'ch-late']); // sorted by startIndex
    expect(state.edges.map((e) => `${e.id}:${e.kind}`)).toEqual(['edge-1:new', 'edge-2:added']);
  });

  it('turns merge into the active thread preserving order; other-lane turns are skipped', () => {
    const { state, deps } = makeStubs({
      activeThreadId: 'thread-active',
      turns: [
        { id: 't-1', threadId: 'thread-active', timestamp: 1, content: 'a' },
        { id: 't-2', threadId: 'thread-active', timestamp: 2, content: 'b' },
      ],
    });
    mergeDeltaIntoDomains(
      makeDelta({
        turns: [
          { id: 't-2', threadId: 'thread-active', timestamp: 2, content: 'b-touched' },
          { id: 't-3', threadId: 'thread-active', timestamp: 3, content: 'c' },
          { id: 't-0', threadId: 'thread-active', timestamp: 0.5, content: 'early' },
          { id: 't-other', threadId: 'thread-other', timestamp: 9, content: 'other lane' },
        ] as unknown as ProjectDeltaResponse['turns'],
      }),
      deps
    );
    // existing kept in place (t-2 replaced by content); genuinely-new rows are
    // appended AFTER the local list, sorted by timestamp (t-0 @ 0.5 before t-3 @ 3).
    expect(state.turns.map((t) => t.id)).toEqual(['t-1', 't-2', 't-0', 't-3']);
    expect(state.turns[1].content).toBe('b-touched');
    expect(state.turns[2].content).toBe('early');
    expect(state.turns[3].content).toBe('c');
    expect(state.turns.some((t) => t.id === 't-other')).toBe(false);
  });

  it('server attachment provenance commits registry staged entries (tray empties, chips render)', () => {
    // Live 2026-10-25: the pair commits SERVER-side; the registry's staged
    // entries stayed `null` forever → the staged tray never emptied and the
    // chips never rendered ("attachments didn't get removed when sent to the
    // draft bin").
    const { state, deps } = makeStubs({ activeThreadId: 'thread-active' });
    mergeDeltaIntoDomains(
      makeDelta({
        revision: 11,
        turns: [
          {
            id: 't-user-9',
            threadId: 'thread-active',
            role: 'user',
            content: 'the ask',
            timestamp: 1,
            meta: { attachments: [{ artifactId: 'art-1', turnIndex: 4, turnId: 't-user-9' }] },
          },
          // Foreign thread: provenance routes by the turn's OWN threadId.
          {
            id: 't-f-1',
            threadId: 'thread-other',
            role: 'user',
            content: 'other lane',
            timestamp: 2,
            meta: { attachments: [{ artifactId: 'art-2', turnIndex: 0, turnId: 't-f-1' }] },
          },
          // Junk rows must be ignored, not crash the merge.
          {
            id: 't-junk',
            threadId: 'thread-active',
            role: 'user',
            content: 'junk',
            timestamp: 3,
            meta: { attachments: [{ artifactId: '', turnIndex: 1 }, {}, 'nonsense'] },
          },
        ] as never,
      }),
      deps
    );
    const byArt = (id: string) => state.committedAttachments.filter((c) => c.artifactId === id);
    expect(byArt('art-1')).toEqual([
      { threadId: 'thread-active', artifactId: 'art-1', turnIndex: 4, turnId: 't-user-9' },
    ]);
    expect(byArt('art-2')).toEqual([
      { threadId: 'thread-other', artifactId: 'art-2', turnIndex: 0, turnId: 't-f-1' },
    ]);
    expect(state.committedAttachments.length).toBe(2); // junk ignored
  });

  it('threads patch when known and create when new; unknown folders are created', () => {
    const { state, deps } = makeStubs({
      threads: [{ id: 'thread-known', title: 'old title' }],
      folders: [{ id: 'fold-known', name: 'Known' }],
    });
    mergeDeltaIntoDomains(
      makeDelta({
        threads: [
          { id: 'thread-known', title: 'renamed' },
          { id: 'thread-new', title: 'brand new' },
        ] as unknown as ProjectDeltaResponse['threads'],
        folders: [
          { id: 'fold-known', name: 'Known' },
          { id: 'fold-new', name: 'Fresh' },
        ] as unknown as ProjectDeltaResponse['folders'],
      }),
      deps
    );
    expect(state.patchedThreads).toEqual([{ id: 'thread-known', patch: { id: 'thread-known', title: 'renamed' } }]);
    expect(state.createdThreads.map((t) => (t as { id: string }).id)).toEqual(['thread-new']);
    expect(state.createdFolders).toEqual(['Fresh']); // known folder not recreated
    expect(state.folders.map((f) => f.name)).toEqual(['Known', 'Fresh']);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * G7 — vpsStore offline mirror fallback
 * ───────────────────────────────────────────────────────────────────────── */

describe('G7 — vpsStore offline mirror fallback', () => {
  const snap = (projectId: string) => ({
    projectId,
    turns: [],
    chapters: [],
    artifacts: [],
    edges: [],
    updatedAt: 1,
    name: `Project ${projectId}`,
  });

  it('list() falls back to the mirror when fetch rejects (network down)', async () => {
    mirror.projects.set('p-mirror', snap('p-mirror') as Record<string, unknown>);
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', failing);

    const projects = await vpsStore.list();
    expect(failing).toHaveBeenCalled(); // server was attempted first
    expect(projects.map((p) => p.projectId)).toEqual(['p-mirror']);
  });

  it('load() falls back to the mirror when fetch rejects (network down)', async () => {
    mirror.projects.set('p-load', snap('p-load') as Record<string, unknown>);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const project = await vpsStore.load('p-load');
    expect(project?.projectId).toBe('p-load');
    expect(project?.name).toBe('Project p-load');

    const missing = await vpsStore.load('p-absent');
    expect(missing).toBeNull(); // honest absence from the mirror too
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * G8 — backup restore journey (server-level round-trip)
 * ───────────────────────────────────────────────────────────────────────── */

describe('G8 — backup restore: serialize → parse → replace-all → GET round-trip', () => {
  it('a restored project round-trips its content through the server', async () => {
    const project = {
      projectId: 'proj-restore-1',
      turns: [
        {
          id: 'turn-r1',
          role: 'user' as const,
          content: 'restored ask',
          timestamp: 1000,
          threadId: 'thread-r1',
        },
        {
          id: 'turn-r2',
          role: 'assistant' as const,
          content: 'restored reply',
          timestamp: 2000,
          threadId: 'thread-r1',
        },
      ],
      chapters: [
        {
          id: 'ch-r1',
          workspaceId: 'proj-restore-1',
          title: 'Restored Chapter',
          status: 'active' as const,
          startIndex: 0,
          createdAt: 1000,
        },
      ],
      artifacts: [
        {
          id: 'art-r1',
          workspaceId: 'proj-restore-1',
          code: 'restored-note',
          title: 'Restored Note',
          type: 'document' as const,
          category: 'note',
          color: '#e05a66',
          isHighConcept: false,
          current: { subtitle: '', description: '', summary: '', body: '# Restored Note' },
          tags: [],
          createdAt: 1000,
          updatedAt: 1000,
          graph: { is_high_concept: false, x: 0, y: 0 },
        },
      ],
      edges: [],
      updatedAt: 3000,
      name: 'Restored Workspace',
      codeName: 'RS-1',
      description: 'came back from a backup file',
      color: '#3b82f6',
    };

    // Export → file → parse (the exact backup file journey).
    const file: DatabaseExport = {
      format: 'markbrain-database',
      version: 1,
      exportedAt: Date.now(),
      backend: 'local',
      projects: [project],
    };
    const parsed = parseDatabaseExport(serializeDatabase(file));
    expect(parsed.projects).toHaveLength(1);

    const replace = await api('/api/projects/replace-all', {
      method: 'POST',
      body: { projects: parsed.projects },
    });
    expect(replace.status).toBe(200);
    expect(replace.body.ok).toBe(true);

    const listed = await api('/api/projects');
    const found = (listed.body.projects as Array<{ projectId: string }>).find((p) => p.projectId === 'proj-restore-1');
    expect(found).toBeTruthy();

    const full = await api('/api/projects/proj-restore-1');
    expect(full.status).toBe(200);
    const snap = full.body.project as {
      name: string;
      codeName: string;
      description: string;
      color: string;
      turns: Array<{ id: string; content: string }>;
      chapters: Array<{ id: string; title: string }>;
      artifacts: Array<{ id: string; title: string }>;
    };
    expect(snap.name).toBe('Restored Workspace');
    expect(snap.codeName).toBe('RS-1');
    expect(snap.description).toBe('came back from a backup file');
    expect(snap.color).toBe('#3b82f6');
    expect(snap.turns.map((t) => t.content)).toEqual(['restored ask', 'restored reply']);
    expect(snap.chapters[0].title).toBe('Restored Chapter');
    expect(snap.artifacts[0].title).toBe('Restored Note');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * G10 — workspaceSession session contract
 * ───────────────────────────────────────────────────────────────────────── */

const SESSION = {
  baseUrl: 'https://markbrain.unhaunter.com',
  token: 'bearer-token-abc',
  userId: 7,
  email: 'Deavid@Example.com',
  isOwner: true,
  vaultUnlocked: true,
};

describe('G10 — workspaceSession session contract', () => {
  it('saveVpsSession / getVpsSession round-trips and rejects junk JSON', () => {
    stubWindow();
    expect(ws.getVpsSession()).toBeNull();

    ws.saveVpsSession(SESSION);
    const back = ws.getVpsSession();
    expect(back).toEqual(SESSION);

    // Junk shapes are rejected honestly — never half-hydrated.
    const storage = stubWindow();
    storage.set(ws.VPS_SESSION_KEY, 'not json at all');
    expect(ws.getVpsSession()).toBeNull();
    storage.set(ws.VPS_SESSION_KEY, JSON.stringify({ hello: 'world' }));
    expect(ws.getVpsSession()).toBeNull();
    storage.set(ws.VPS_SESSION_KEY, JSON.stringify({ ...SESSION, userId: 'seven' }));
    expect(ws.getVpsSession()).toBeNull();
  });

  it('getActiveIdbName: markbrain-local vs markbrain-vps:<origin>:<email> per mode', () => {
    stubWindow();
    expect(ws.getActiveIdbName()).toBe('markbrain-local'); // absent mode = local

    ws.setWorkspaceMode('local');
    expect(ws.getActiveIdbName()).toBe('markbrain-local');

    ws.setWorkspaceMode('vps');
    ws.saveVpsSession(SESSION);
    expect(ws.getActiveIdbName()).toBe('markbrain-vps:https://markbrain.unhaunter.com:deavid@example.com');

    // Empty baseUrl = same origin → window.location.origin is the namespace.
    ws.saveVpsSession({ ...SESSION, baseUrl: '' });
    expect(ws.getActiveIdbName()).toBe('markbrain-vps:http://localhost:3030:deavid@example.com');
  });

  it('getScopedStorageKey namespacing (both branches)', () => {
    stubWindow();
    expect(ws.getScopedStorageKey('draft')).toBe('markbrain:local:draft'); // absent mode = local

    ws.setWorkspaceMode('local');
    expect(ws.getScopedStorageKey('draft')).toBe('markbrain:local:draft');

    ws.setWorkspaceMode('vps');
    ws.saveVpsSession(SESSION);
    expect(ws.getScopedStorageKey('draft')).toBe('markbrain:vps:https://markbrain.unhaunter.com:deavid@example.com:draft');
  });

  it('clearWorkspaceMode / clearVpsSession clean up both keys', () => {
    const storage = stubWindow();
    ws.setWorkspaceMode('vps');
    ws.saveVpsSession(SESSION);
    expect(storage.has(ws.WORKSPACE_MODE_KEY)).toBe(true);
    expect(storage.has(ws.VPS_SESSION_KEY)).toBe(true);

    ws.clearWorkspaceMode();
    expect(storage.has(ws.WORKSPACE_MODE_KEY)).toBe(false);
    expect(ws.getWorkspaceMode()).toBeNull();

    ws.clearVpsSession();
    expect(storage.has(ws.VPS_SESSION_KEY)).toBe(false);
    expect(ws.getVpsSession()).toBeNull();
  });
});
