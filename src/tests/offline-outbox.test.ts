/**
 * Offline outbox + replay (2026-10-26 design, discussed with David):
 *
 * 1. offline save → mirror written, outbox queues WHAT changed (entity ids,
 *    scalars, baseRevision), save RESOLVES (no critical banner for offline —
 *    the data is safe in the mirror; the badge tells the truth instead);
 * 2. replay while still offline → network failure, outbox stays queued;
 * 3. replay online, server untouched (revision match) → mirror pushed whole;
 * 4. replay online, server edited meanwhile (revision moved) → entity-level
 *    merge: local wins on dirty ids, server wins elsewhere, offline removals
 *    honoured;
 * 5. project deletion refused while offline.
 *
 * The mirror (localBackend) is an in-memory map; the VPS is a real Express
 * listener on an ephemeral port (same pattern as audit26-hardening).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { initDb, closeDbForTests } from '../../server/db';

initDb(':memory:');

const mirror = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock('../services/localBackend', () => ({
  localLoadProject: vi.fn(async (id: string) => mirror.get(id) ?? null),
  localPutProject: vi.fn(async (snap: Record<string, unknown>) => {
    mirror.set(snap.projectId as string, JSON.parse(JSON.stringify(snap)));
  }),
  localListProjects: vi.fn(async () => [...mirror.values()]),
  localReplaceAll: vi.fn(async (list: Record<string, unknown>[]) => {
    mirror.clear();
    for (const snap of list) mirror.set(snap.projectId as string, JSON.parse(JSON.stringify(snap)));
  }),
  localDeleteProject: vi.fn(async (id: string) => {
    mirror.delete(id);
  }),
}));

const OWNER_EMAIL = 'owner-outbox@example.com';
const OWNER_PASSWORD = 'owner-pass-123456';

// node-environment shim: workspaceSession + offlineOutbox persist to
// localStorage; node has none. A plain Map is enough for these tests.
// NOTE storage() reads window.localStorage, so the window stub must carry it.
const lsStore = new Map<string, string>();
const lsShim = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => void lsStore.set(k, String(v)),
  removeItem: (k: string) => void lsStore.delete(k),
};
vi.stubGlobal('localStorage', lsShim);
vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => undefined, localStorage: lsShim, location: { origin: 'http://localhost' } });

const { app } = await import('../../server/app');
const { createUser } = await import('../../server/lib/users');
const { vpsStore } = await import('../services/stores/vpsStore');
const { replayOutbox } = await import('../services/vpsSync');
const { getRecord, clearDirty, getAllRecords } = await import('../services/offlineOutbox');
const { setWorkspaceMode, saveVpsSession, clearVpsSession } = await import('../services/workspaceSession');
const { localPutProject } = await import('../services/localBackend');
const typeOfMerge = await import('../services/vpsSync');

let server: Server;
let base = '';
let token = '';
let realFetchRef: typeof fetch = fetch;

/** Minimal artifact/turn shape — only ids + content matter to the merge. */
function snapOf(projectId: string, artifacts: Array<{ id: string; title: string }>): Record<string, unknown> {
  return {
    projectId,
    turns: [],
    chapters: [],
    artifacts,
    edges: [],
    updatedAt: 1_000,
    name: 'P',
  };
}

beforeAll(async () => {
  createUser(OWNER_EMAIL, OWNER_PASSWORD, { isOwner: true });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  token = ((await res.json()) as { token: string }).token;

  setWorkspaceMode('vps');
  saveVpsSession({ baseUrl: base, token, userId: 1, email: OWNER_EMAIL, isOwner: true, vaultUnlocked: true });

  // Offline switch: every fetch aimed at the VPS throws the same TypeError a
  // real airplane-mode fetch throws. Anything else passes through. The test's
  // own server-side calls (the "desktop") capture and use the real fetch.
  const realFetch = globalThis.fetch;
  realFetchRef = realFetch;
  (globalThis as { __outboxOffline?: boolean }).__outboxOffline = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if ((globalThis as { __outboxOffline?: boolean }).__outboxOffline && url.startsWith(base)) {
      throw new TypeError('Failed to fetch');
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterAll(() => {
  server.close();
  closeDbForTests();
});

async function serverProject(projectId: string): Promise<{ project: Record<string, unknown>; revision: number } | null> {
  const res = await realFetchRef(`${base}/api/projects/${encodeURIComponent(projectId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  expect(res.ok).toBe(true);
  return (await res.json()) as { project: Record<string, unknown>; revision: number };
}

describe('offline outbox + replay', () => {
  it('queues offline saves in the outbox and resolves them; replay pushes the mirror when the server is untouched', async () => {
    const id = 'outbox-basic';
    // Seed the server AND the mirror with revision 1 (as vpsStore.load would).
    const seed = snapOf(id, [{ id: 'a1', title: 'A1' }]);
    const createRes = await fetch(base + '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ project: seed }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { revision: number };
    await localPutProject({ ...seed, revision: created.revision } as never);

    // ---- airplane mode ----
    (globalThis as { __outboxOffline?: boolean }).__outboxOffline = true;

    const edited = snapOf(id, [
      { id: 'a1', title: 'A1-offline-edit' },
      { id: 'a2', title: 'A2-new' },
    ]);
    await expect(vpsStore.save(edited as never)).resolves.toBeUndefined(); // no throw: mirror has it
    const rec = getRecord(id);
    expect(rec).not.toBeNull();
    expect([...rec!.dirty.added.artifacts].sort()).toEqual(['a1', 'a2']);
    expect(rec!.baseRevision).toBe(created.revision);

    // Replay while offline: network failure, record stays queued.
    await expect(replayOutbox()).resolves.toBe(0);
    expect(getRecord(id)).not.toBeNull();

    // ---- back online, nobody else wrote (baseRevision still matches) ----
    (globalThis as { __outboxOffline?: boolean }).__outboxOffline = false;
    await expect(replayOutbox()).resolves.toBeGreaterThanOrEqual(1);
    expect(getRecord(id)).toBeNull(); // cleared

    const after = await serverProject(id);
    const artifacts = after!.project.artifacts as Array<{ id: string; title: string }>;
    expect(artifacts.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect(artifacts.find((a) => a.id === 'a1')!.title).toBe('A1-offline-edit');
  });

  it('merges entity-level when the server moved on: local wins dirty ids, server wins the rest, offline removals honoured', async () => {
    const id = 'outbox-merge';
    const seed = snapOf(id, [
      { id: 'a1', title: 'A1' },
      { id: 'a2', title: 'A2' },
    ]);
    const createRes = await fetch(base + '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ project: seed }),
    });
    const created = (await createRes.json()) as { revision: number };
    await localPutProject({ ...seed, revision: created.revision } as never);

    // ---- airplane mode: phone edits a1, adds a3, deletes a2 (the real UI
    // path: entity deletes ride the persistent mutation queue, which the
    // snapshot PUT cannot express — it is upsert-only server-side).
    (globalThis as { __outboxOffline?: boolean }).__outboxOffline = true;
    const { queueServerMutation } = await import('../application/serverMutationQueue');
    await vpsStore.save(
      snapOf(id, [
        { id: 'a1', title: 'A1-phone' },
        { id: 'a3', title: 'A3-phone' },
      ]) as never
    );
    queueServerMutation(id, { op: 'deleteArtifact', artifactId: 'a2' });

    // Meanwhile the desktop edits a2 (server-side, direct API call).
    const desktop = snapOf(id, [
      { id: 'a1', title: 'A1' },
      { id: 'a2', title: 'A2-DESKTOP' },
      { id: 'a4', title: 'A4-desktop' },
    ]);
    const putRes = await realFetchRef(`${base}/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(desktop),
    });
    expect(putRes.ok).toBe(true);

    // ---- back online: merge, not clobber ----
    (globalThis as { __outboxOffline?: boolean }).__outboxOffline = false;
    await replayOutbox();
    const after = (await serverProject(id))!;
    const artifacts = after.project.artifacts as Array<{ id: string; title: string }>;
    const byId = Object.fromEntries(artifacts.map((a) => [a.id, a.title]));
    expect(byId['a1']).toBe('A1-phone'); // local dirty id wins
    expect(byId['a2']).toBeUndefined(); // offline removal honoured
    expect(byId['a3']).toBe('A3-phone'); // offline addition survives
    expect(byId['a4']).toBe('A4-desktop'); // server-only edit preserved (the whole point)
    expect(getRecord(id)).toBeNull();
  });

  it('created offline → replay POSTs it; offline project deletion is refused', async () => {
    const id = 'outbox-created-offline';
    (globalThis as { __outboxOffline?: boolean }).__outboxOffline = true;
    vi.stubGlobal('navigator', { onLine: false }); // airplane mode

    await expect(vpsStore.create(snapOf(id, [{ id: 'a1', title: 'born offline' }]) as never)).resolves.toBeUndefined();
    expect(getRecord(id)).not.toBeNull();
    await expect(
      vpsStore.delete(id)
    ).rejects.toThrow(/needs a connection/i); // deletion stays online-only
    expect((await serverProject(id))).toBeNull(); // server never saw it

    (globalThis as { __outboxOffline?: boolean }).__outboxOffline = false;
    vi.stubGlobal('navigator', { onLine: true }); // back online
    await replayOutbox();
    const after = await serverProject(id);
    expect(after).not.toBeNull();
    expect(getRecord(id)).toBeNull();

    // Online deletion works and clears any stale queue entry.
    await expect(vpsStore.delete(id)).resolves.toBeUndefined();
    expect(await serverProject(id)).toBeNull();
    expect(getRecord(id)).toBeNull();
    void clearDirty;
    void getAllRecords;
    void typeOfMerge;
  });
});
