/**
 * Client half of project-delete authority (2026-11-01 VPS bug).
 *
 * The server answers 410 Gone for any write to a tombstoned (deleted)
 * project. vpsStore.save/create must treat that as AUTHORITATIVE deletion:
 * drop the local mirror copy, clear the offline outbox entry, and NEVER
 * resurrect (no 404→POST-create, no retry, no alarm). Before the fix the
 * 404→POST-create fallback re-created the deleted project server-side.
 *
 * Real seam: vpsStore against a stubbed fetch; the IndexedDB mirror is an
 * in-memory stub so the mirror cleanup is assertable. Never touches the
 * network (hermetic law).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { ProjectSnapshot } from '../../src/services/stores/projectStore';

vi.mock('@google/genai', () => ({}));

type MirrorRecord = { id: string; snapshot: ProjectSnapshot };
const mirror = new Map<string, ProjectSnapshot>();
const dirty = new Set<string>();

vi.mock('../services/localBackend', () => ({
  localListProjects: async () => Array.from(mirror.values()).map((s) => ({ ...s })),
  localLoadProject: async (id: string) => mirror.get(id) ?? null,
  localPutProject: async (s: ProjectSnapshot) => void mirror.set(s.projectId, s),
  localReplaceAll: async (list: ProjectSnapshot[]) => {
    mirror.clear();
    list.forEach((s) => mirror.set(s.projectId, s));
  },
  localDeleteProject: async (id: string) => void mirror.delete(id),
}));

vi.mock('../services/workspaceSession', () => ({
  isOfflineReplica: () => false,
  getWorkspaceMode: () => 'vps',
  getVpsSession: () => ({ baseUrl: 'http://127.0.0.1:13055', token: 'tok', userId: 1, email: 't@t', isOwner: false, vaultUnlocked: true }),
  getActiveIdbName: () => 'mb-test-mirror',
}));

// offlineOutbox reads the BARE localStorage global
const lsStore: Record<string, string> = {};
const ls = {
  getItem: (k: string) => lsStore[k] ?? null,
  setItem: (k: string, v: string) => void (lsStore[k] = v),
  removeItem: (k: string) => void delete lsStore[k],
  clear: () => {
    for (const k of Object.keys(lsStore)) delete lsStore[k];
  },
};
vi.stubGlobal('localStorage', ls);
vi.stubGlobal('window', { localStorage: ls, navigator: { onLine: true }, dispatchEvent: () => {} });

/** fetch stub with a scriptable status per method. */
let putStatus = 200;
let postStatus = 201;
const calls: Array<{ method: string; url: string }> = [];
vi.stubGlobal(
  'fetch',
  vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    const status = method === 'PUT' ? putStatus : postStatus;
    return new Response(JSON.stringify({ ok: status < 400, error: status >= 400 ? 'Gone' : undefined }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  })
);

function snapshot(projectId: string, name: string): ProjectSnapshot {
  return {
    projectId,
    name,
    turns: [],
    chapters: [],
    threads: [],
    folders: [],
    artifacts: [],
    edges: [],
    updatedAt: 1000,
  } as unknown as ProjectSnapshot;
}

beforeAll(async () => {
  // import AFTER the mocks are in place
  await import('../services/offlineOutbox');
});

describe('client — a deleted project (410) is authoritative', () => {
  it('a late save answered 410 drops the mirror copy, clears the outbox, and does NOT resurrect via POST create', async () => {
    const { vpsStore } = await import('../services/stores/vpsStore');
    const { markDirty, clearDirty, getAllRecords } = await import('../services/offlineOutbox');
    const { localPutProject } = await import('../services/localBackend');

    const snap = snapshot('proj-tombstoned', 'Doomed');
    await localPutProject(snap); // mirror holds the doomed project
    markDirty('proj-tombstoned', null, snap, null); // outbox has a pending replay

    putStatus = 410; // server tombstone: PUT refused
    postStatus = 410; // ...and the 404→POST-create fallback would also be refused

    await vpsStore.save(snap); // must NOT throw, must NOT create

    expect(mirror.has('proj-tombstoned')).toBe(false); // mirror copy dropped
    expect(Object.keys(getAllRecords())).not.toContain('proj-tombstoned'); // outbox entry gone
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['PUT http://127.0.0.1:13055/api/projects/proj-tombstoned']);
  });

  it('create() answered 410 also drops the mirror copy and clears the outbox', async () => {
    const { vpsStore } = await import('../services/stores/vpsStore');
    const { markDirty, getAllRecords } = await import('../services/offlineOutbox');
    const { localPutProject } = await import('../services/localBackend');

    const snap = snapshot('proj-tombstoned-create', 'Doomed Too');
    await localPutProject(snap);
    markDirty('proj-tombstoned-create', null, snap, null);

    postStatus = 410;
    await vpsStore.create(snap);

    expect(mirror.has('proj-tombstoned-create')).toBe(false);
    expect(Object.keys(getAllRecords())).not.toContain('proj-tombstoned-create');
  });

  it('a healthy save (200) still writes BOTH the mirror and the server (no false positive)', async () => {
    const { vpsStore } = await import('../services/stores/vpsStore');
    const { localPutProject } = await import('../services/localBackend');

    putStatus = 200;
    postStatus = 201;
    const snap = snapshot('proj-healthy', 'Alive');
    await localPutProject(snap);
    calls.length = 0;

    await vpsStore.save(snap);

    expect(mirror.has('proj-healthy')).toBe(true); // mirror intact
    expect(calls.map((c) => c.method)).toEqual(['PUT']); // single PUT, no create fallback
    expect(dirty.size).toBe(0);
  });
});
