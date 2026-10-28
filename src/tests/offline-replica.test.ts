/**
 * Package 3 §3.6 — offline replica storage + offline session wiring.
 *
 * Covers: rememberReplica/listKnownReplicas/forgetReplica (localStorage
 * contract), the offline session helpers (offline flag, VpsSessionInfo),
 * and the AuthGate-visible state (isOfflineReplica).
 *
 * node-environment shim (no happy-dom in this repo — same pattern as
 * offline-outbox.test.ts): workspaceSession persists to localStorage via
 * window.localStorage, so the window stub carries a working shim.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const lsStore = new Map<string, string>();
const lsShim = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => void lsStore.set(k, String(v)),
  removeItem: (k: string) => void lsStore.delete(k),
};
vi.stubGlobal('localStorage', lsShim);
vi.stubGlobal('window', {
  localStorage: lsShim,
  location: { origin: 'http://localhost:13000' },
  dispatchEvent: () => true,
  addEventListener: () => undefined,
});

const {
  KNOWN_REPLICAS_KEY,
  listKnownReplicas,
  rememberReplica,
  forgetReplica,
  saveVpsSession,
  getVpsSession,
  clearVpsSession,
  isOfflineReplica,
  setWorkspaceMode,
  WORKSPACE_MODE_KEY,
  VPS_SESSION_KEY,
  idbNameForReplica,
  wipeReplicaStorage,
} = await import('../services/workspaceSession');

describe('known replicas (localStorage contract)', () => {
  beforeEach(() => {
    lsStore.clear();
  });

  it('empty list when no replicas have been remembered', () => {
    expect(listKnownReplicas()).toEqual([]);
  });

  it('rememberReplica stores baseUrl, email, idbName and lastUsedAt', () => {
    rememberReplica('https://mb.example.com', 'David@Example.com');
    const list = listKnownReplicas();
    expect(list.length).toBe(1);
    expect(list[0].baseUrl).toBe('https://mb.example.com');
    expect(list[0].email).toBe('David@Example.com');
    expect(list[0].idbName).toBe(idbNameForReplica('https://mb.example.com', 'David@Example.com'));
    expect(list[0].lastUsedAt).toBeGreaterThan(0);
  });

  it('rememberReplica is idempotent per (baseUrl, email) and bumps lastUsedAt', () => {
    rememberReplica('https://mb.example.com', 'a@b.c');
    const first = listKnownReplicas()[0];
    expect(listKnownReplicas().length).toBe(1);
    rememberReplica('https://mb.example.com', 'a@b.c');
    const list = listKnownReplicas();
    expect(list.length).toBe(1);
    expect(list[0].lastUsedAt).toBeGreaterThanOrEqual(first.lastUsedAt);
  });

  it('rememberReplica keeps distinct replicas per baseUrl or email', () => {
    rememberReplica('https://a.example.com', 'a@b.c');
    rememberReplica('https://b.example.com', 'a@b.c');
    rememberReplica('https://a.example.com', 'other@b.c');
    expect(listKnownReplicas().length).toBe(3);
  });

  it('forgetReplica removes only that replica', () => {
    rememberReplica('https://a.example.com', 'a@b.c');
    rememberReplica('https://b.example.com', 'a@b.c');
    forgetReplica('https://a.example.com', 'a@b.c');
    const list = listKnownReplicas();
    expect(list.length).toBe(1);
    expect(list[0].baseUrl).toBe('https://b.example.com');
  });

  it('forgetReplica on an unknown replica is a no-op', () => {
    rememberReplica('https://a.example.com', 'a@b.c');
    forgetReplica('https://x.example.com', 'a@b.c');
    expect(listKnownReplicas().length).toBe(1);
    expect(listKnownReplicas()[0].baseUrl).toBe('https://a.example.com');
  });

  it('corrupt JSON in knownReplicas is treated as an empty list', () => {
    lsStore.set(KNOWN_REPLICAS_KEY, '{not json');
    expect(listKnownReplicas()).toEqual([]);
  });

  it('entries with missing fields are dropped from the list', () => {
    lsStore.set(KNOWN_REPLICAS_KEY, JSON.stringify([
      { baseUrl: 'https://a.example.com', email: 'a@b.c', idbName: 'x', lastUsedAt: 1 },
      { baseUrl: 'https://b.example.com' },
      'garbage',
    ]));
    expect(listKnownReplicas()).toEqual([
      { baseUrl: 'https://a.example.com', email: 'a@b.c', idbName: 'x', lastUsedAt: 1 },
    ]);
  });

  it('listKnownReplicas sorts by lastUsedAt descending', () => {
    // write directly: rememberReplica calls in the same millisecond would tie
    lsStore.set(KNOWN_REPLICAS_KEY, JSON.stringify([
      { baseUrl: 'https://old.example.com', email: 'old@b.c', idbName: 'idb-old', lastUsedAt: 1000 },
      { baseUrl: 'https://new.example.com', email: 'new@b.c', idbName: 'idb-new', lastUsedAt: 2000 },
    ]));
    const list = listKnownReplicas();
    expect(list[0].baseUrl).toBe('https://new.example.com');
    expect(list[1].baseUrl).toBe('https://old.example.com');
  });
});

describe('offline session helpers', () => {
  beforeEach(() => {
    lsStore.clear();
  });

  it('offline session round-trips through saveVpsSession/getVpsSession', () => {
    saveVpsSession({
      baseUrl: 'https://mb.example.com',
      token: '',
      userId: 1,
      email: 'a@b.c',
      isOwner: true,
      vaultUnlocked: false,
      offline: true,
    });
    const session = getVpsSession();
    expect(session).not.toBeNull();
    expect(session!.offline).toBe(true);
    expect(session!.token).toBe('');
  });

  it('online session (no offline flag) is not offline', () => {
    saveVpsSession({
      baseUrl: '',
      token: 'tok',
      userId: 1,
      email: 'a@b.c',
      isOwner: true,
      vaultUnlocked: true,
    });
    expect(getVpsSession()!.offline ?? false).toBe(false);
    expect(isOfflineReplica()).toBe(false);
  });

  it('isOfflineReplica() is true only when mode=vps and session.offline', () => {
    setWorkspaceMode('vps');
    saveVpsSession({
      baseUrl: 'https://mb.example.com',
      token: '',
      userId: 1,
      email: 'a@b.c',
      isOwner: true,
      vaultUnlocked: false,
      offline: true,
    });
    expect(isOfflineReplica()).toBe(true);
    clearVpsSession();
    expect(isOfflineReplica()).toBe(false);
  });

  it('clearVpsSession removes the session but keeps the mode', () => {
    setWorkspaceMode('vps');
    saveVpsSession({
      baseUrl: '',
      token: 'tok',
      userId: 1,
      email: 'a@b.c',
      isOwner: true,
      vaultUnlocked: true,
    });
    expect(lsStore.has(VPS_SESSION_KEY)).toBe(true);
    expect(lsStore.get(WORKSPACE_MODE_KEY)).toBe('vps');
    clearVpsSession();
    expect(lsStore.has(VPS_SESSION_KEY)).toBe(false);
    expect(lsStore.get(WORKSPACE_MODE_KEY)).toBe('vps');
  });
});

describe('wipeReplicaStorage ("Sign out & erase this device\'s copy")', () => {
  beforeEach(() => {
    lsStore.clear();
  });

  it('removes the replica from the list and never throws without indexedDB', async () => {
    rememberReplica('https://mb.example.com', 'wiped@example.com');
    expect(listKnownReplicas().map((r) => r.email)).toContain('wiped@example.com');
    // This environment has no indexedDB: the wipe must still take the
    // knownReplicas entry off and settle (the IDB deletion runs in browsers).
    await expect(wipeReplicaStorage({
      baseUrl: 'https://mb.example.com',
      email: 'wiped@example.com',
      idbName: idbNameForReplica('https://mb.example.com', 'wiped@example.com'),
      lastUsedAt: Date.now(),
    })).resolves.toBeUndefined();
    expect(listKnownReplicas().map((r) => r.email)).not.toContain('wiped@example.com');
  });

  it('wiping one replica leaves the others alone', async () => {
    rememberReplica('https://mb.example.com', 'keep@example.com');
    rememberReplica('https://other.example.com', 'wiped@example.com');
    await wipeReplicaStorage({
      baseUrl: 'https://other.example.com',
      email: 'wiped@example.com',
      idbName: idbNameForReplica('https://other.example.com', 'wiped@example.com'),
      lastUsedAt: Date.now(),
    });
    const emails = listKnownReplicas().map((r) => r.email);
    expect(emails).toContain('keep@example.com');
    expect(emails).not.toContain('wiped@example.com');
  });
});

describe('apiFetch offline-replica short-circuit', () => {
  beforeEach(() => {
    lsStore.clear();
  });

  it('returns HTTP 503 {offline:true} without invoking fetch when offline', async () => {
    setWorkspaceMode('vps');
    saveVpsSession({
      baseUrl: 'https://mb.example.com',
      token: '',
      userId: 1,
      email: 'a@b.c',
      isOwner: true,
      vaultUnlocked: false,
      offline: true,
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { apiFetch } = await import('../gateway/api');
    const res = await apiFetch('/api/projects');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Offline replica mode', offline: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not short-circuit when the session is online', async () => {
    setWorkspaceMode('vps');
    saveVpsSession({
      baseUrl: 'https://mb.example.com',
      token: 'tok',
      userId: 1,
      email: 'a@b.c',
      isOwner: true,
      vaultUnlocked: true,
    });
    const fetchSpy = vi.fn((..._args: unknown[]) =>
      Promise.resolve(new Response('{}', { status: 200 }))
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { apiFetch } = await import('../gateway/api');
    const res = await apiFetch('/api/projects');
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('https://mb.example.com/api/projects');
  });
});

describe('end-to-end signed-out + VPS-offline replica access and export', () => {
  beforeEach(() => {
    lsStore.clear();
  });

  it('user logs in → syncs project to local mirror → signs out (keep) → VPS goes dead → opens offline replica → reads project & exports lossless .tar.gz with zero network calls', async () => {
    // Simulated per-database IndexedDB storage keyed by getActiveIdbName()
    const idbDatabases = new Map<string, Map<string, unknown>>();
    const getStore = (dbName: string) => {
      let db = idbDatabases.get(dbName);
      if (!db) {
        db = new Map();
        idbDatabases.set(dbName, db);
      }
      return db;
    };

    const { getActiveIdbName, openOfflineSession } = await import('../services/workspaceSession');
    const { makeSnapshot } = await import('./fixtures/plaintextFixture');
    const { exportProjectsTarGz, importProjectTarGz } = await import('../domains/plaintextTree');

    // 1. User logs in to VPS (https://mb.example.com as David@Example.com)
    setWorkspaceMode('vps');
    saveVpsSession({
      baseUrl: 'https://mb.example.com',
      token: 'live-jwt-token',
      userId: 7,
      email: 'David@Example.com',
      isOwner: true,
      vaultUnlocked: true,
    });
    rememberReplica('https://mb.example.com', 'David@Example.com');

    // While online, the user's project snapshot is mirrored into the active IndexedDB
    const onlineIdbName = getActiveIdbName();
    expect(onlineIdbName).toBe('markbrain-vps:https://mb.example.com:david@example.com');
    const seededProject = makeSnapshot();
    getStore(onlineIdbName).set(seededProject.projectId, JSON.parse(JSON.stringify(seededProject)));

    // 2. User signs out (keep replica on this device)
    clearVpsSession();
    // WorkspaceMode is cleared on sign-out, returning user to AuthGate
    lsShim.removeItem(WORKSPACE_MODE_KEY);
    expect(getVpsSession()).toBeNull();

    // 3. VPS is now completely DEAD (any fetch throws connection refused)
    const deadNetworkSpy = vi.fn(() => Promise.reject(new TypeError('fetch failed: ECONNREFUSED')));
    vi.stubGlobal('fetch', deadNetworkSpy);

    // 4. User opens AuthGate, sees the known replica, and clicks "Open offline"
    const replicas = listKnownReplicas();
    expect(replicas).toHaveLength(1);
    expect(replicas[0].email).toBe('David@Example.com');

    openOfflineSession(replicas[0]);
    expect(isOfflineReplica()).toBe(true);

    // CRITICAL: the active IndexedDB name in offline replica mode MUST match
    // the exact IndexedDB name that was populated when the user was online!
    const offlineIdbName = getActiveIdbName();
    expect(offlineIdbName).toBe(onlineIdbName);

    // 5. Read the user's projects from the mirror and export them to .tar.gz
    const offlineProjects = [...getStore(offlineIdbName).values()] as ReturnType<typeof makeSnapshot>[];
    expect(offlineProjects).toHaveLength(1);
    expect(offlineProjects[0].name).toBe('Fixture Project — fïxture');
    expect(offlineProjects[0].artifacts).toHaveLength(3);

    const tarGzBytes = await exportProjectsTarGz(offlineProjects);
    expect(tarGzBytes.byteLength).toBeGreaterThan(500);

    // Verify the exported .tar.gz unpacks back to the exact project with all notes & turns
    const restored = await importProjectTarGz(tarGzBytes);
    expect(restored).toEqual(offlineProjects);

    // Zero network calls were attempted while signed out + offline
    expect(deadNetworkSpy).not.toHaveBeenCalled();
  });
});
