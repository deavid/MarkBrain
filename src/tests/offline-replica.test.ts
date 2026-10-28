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
