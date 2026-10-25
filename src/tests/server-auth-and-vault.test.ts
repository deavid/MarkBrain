/**
 * Phase 2 integration tests — SQLite auth, immutable Owner #1, admin,
 * and the RAM/disk key vault (design-docs/21B §8).
 *
 * In-memory SQLite + a real Express listener on an ephemeral port: real
 * HTTP round-trips, zero disk, no provider calls (a locked/no-key vault
 * answers before any model client is built).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { initDb, getDb, closeDbForTests } from '../../server/db';

// In-memory DB must exist before any route handles a request.
initDb(':memory:');

const OWNER_EMAIL = 'deavidsedice@gmail.com';
const OWNER_PASSWORD = 'owner-pass-123456';
const FRIEND_EMAIL = 'friend@example.com';
const FRIEND_PASSWORD = 'friend-pass-123456';
const FAKE_GEMINI_KEY = 'AIzaSyTestKeyForVaultCipher0000000000000';

process.env.MARKBRAIN_OWNER_EMAIL = OWNER_EMAIL;
process.env.MARKBRAIN_OWNER_PASSWORD = OWNER_PASSWORD;

const { app } = await import('../../server/app');
const { ensureOwnerBootstrap, findUserByEmail, setUserEnabled } = await import('../../server/lib/users');
const { clearUnlockedVaultKeysForTests, isVaultUnlocked } = await import('../../server/lib/accountVault');

let server: Server;
let base = '';
let ownerToken = '';
let friendToken = '';

interface ApiRes {
  status: number;
  body: any;
}

async function api(pathname: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<ApiRes> {
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
    /* non-JSON (shouldn't happen on these routes) */
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
});

afterAll(() => {
  server?.close();
  closeDbForTests();
});

describe('21B §8.1 — Account #1 bootstrap', () => {
  it('creates deavidsedice@gmail.com as id=1, is_owner=1, enabled', () => {
    const owner = findUserByEmail(OWNER_EMAIL);
    expect(owner).not.toBeNull();
    expect(owner!.id).toBe(1);
    expect(owner!.isOwner).toBe(true);
    expect(owner!.enabled).toBe(true);
  });

  it('is idempotent — a second bootstrap is a no-op', () => {
    expect(ensureOwnerBootstrap()).toBeNull();
    expect(findUserByEmail(OWNER_EMAIL)!.id).toBe(1);
  });
});

describe('21B §8.3 — unauthenticated calls get 401', () => {
  it('/api/chat/stream', async () => {
    const r = await api('/api/chat/stream', { method: 'POST', body: { model: 'gemini-3.5-flash-lite' } });
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/Authentication required/);
  });

  it('/api/account/settings', async () => {
    const r = await api('/api/account/settings');
    expect(r.status).toBe(401);
  });

  it('/api/admin/users', async () => {
    const r = await api('/api/admin/users');
    expect(r.status).toBe(401);
  });
});

describe('21B §8.4 — login issues a session and unlocks the RAM vault', () => {
  it('POST /api/auth/login returns token + vaultUnlocked user', async () => {
    const r = await api('/api/auth/login', {
      method: 'POST',
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe('string');
    expect(r.body.token.length).toBe(64); // 32 bytes hex
    expect(r.body.user).toMatchObject({ id: 1, email: OWNER_EMAIL, isOwner: true, vaultUnlocked: true });
    ownerToken = r.body.token;
    expect(isVaultUnlocked(1)).toBe(true);
  });

  it('GET /api/auth/session echoes the user with Bearer token', async () => {
    const r = await api('/api/auth/session', { token: ownerToken });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ id: 1, email: OWNER_EMAIL, isOwner: true, vaultUnlocked: true });
  });

  it('bad password is rejected', async () => {
    const r = await api('/api/auth/login', {
      method: 'POST',
      body: { email: OWNER_EMAIL, password: 'wrong-password' },
    });
    expect(r.status).toBe(401);
  });
});

describe('21B §8.2 — the owner account cannot be disabled', () => {
  it('setUserEnabled(1, false) throws the Hard Law error', () => {
    expect(() => setUserEnabled(1, false)).toThrow(/owner account cannot be disabled/);
  });

  it('PATCH /api/admin/users/1 {enabled:false} answers 400', async () => {
    const r = await api('/api/admin/users/1', {
      method: 'PATCH',
      token: ownerToken,
      body: { enabled: false },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/owner account cannot be disabled/);
    expect(findUserByEmail(OWNER_EMAIL)!.enabled).toBe(true);
  });
});

describe('21B §8.5 — keys encrypt at rest, redact over the wire', () => {
  it('PUT /api/account/keys stores ciphertext (no raw AIza in SQLite)', async () => {
    const r = await api('/api/account/keys', {
      method: 'PUT',
      token: ownerToken,
      body: { slot: 'gemini-free', apiKey: FAKE_GEMINI_KEY },
    });
    expect(r.status).toBe(200);
    expect(r.body.keys['gemini-free']).toEqual({ configured: true, hint: '…0000' });
    expect(JSON.stringify(r.body)).not.toContain(FAKE_GEMINI_KEY);

    const row = getDb()
      .prepare('SELECT ciphertext FROM user_secrets WHERE user_id = 1')
      .get() as { ciphertext: Buffer } | undefined;
    expect(row).toBeTruthy();
    expect(row!.ciphertext.toString('utf8')).not.toContain(FAKE_GEMINI_KEY);
    expect(row!.ciphertext.toString('latin1')).not.toContain('AIza');
  });

  it('GET /api/account/settings returns only {configured, hint} — never the raw key', async () => {
    const r = await api('/api/account/settings', { token: ownerToken });
    expect(r.status).toBe(200);
    expect(r.body.keys['gemini-free']).toEqual({ configured: true, hint: '…0000' });
    expect(r.body.keys['gemini-paid']).toEqual({ configured: false, hint: null });
    expect(r.body.vaultUnlocked).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(FAKE_GEMINI_KEY);
  });
});

describe('21B §8.6 — restart locks the vault; unlock restores the keys', () => {
  it('after clearUnlockedVaultKeysForTests, AI + key routes answer 428 VAULT_LOCKED', async () => {
    clearUnlockedVaultKeysForTests();
    expect(isVaultUnlocked(1)).toBe(false);

    const chat = await api('/api/chat/stream', {
      method: 'POST',
      token: ownerToken,
      body: { model: 'gemini-3.5-flash-lite' },
    });
    expect(chat.status).toBe(428);
    expect(chat.body.code).toBe('VAULT_LOCKED');

    const keys = await api('/api/account/keys', {
      method: 'PUT',
      token: ownerToken,
      body: { slot: 'gemini-paid', apiKey: 'AIzaAnotherTestKey0000000000000000000' },
    });
    expect(keys.status).toBe(428);
    expect(keys.body.code).toBe('VAULT_LOCKED');

    const settings = await api('/api/account/settings', { token: ownerToken });
    expect(settings.status).toBe(200);
    expect(settings.body.vaultUnlocked).toBe(false);
    expect(settings.body.keys['gemini-free'].configured).toBe(false); // locked = not readable
  });

  it('POST /api/auth/unlock with the password restores access and decrypts saved keys', async () => {
    const bad = await api('/api/auth/unlock', { method: 'POST', token: ownerToken, body: { password: 'nope-nope' } });
    expect(bad.status).toBe(401);

    const ok = await api('/api/auth/unlock', {
      method: 'POST',
      token: ownerToken,
      body: { password: OWNER_PASSWORD },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, vaultUnlocked: true });

    const settings = await api('/api/account/settings', { token: ownerToken });
    expect(settings.body.vaultUnlocked).toBe(true);
    expect(settings.body.keys['gemini-free']).toEqual({ configured: true, hint: '…0000' });
    expect(JSON.stringify(settings.body)).not.toContain(FAKE_GEMINI_KEY);
  });
});

describe('21B §8.7 — non-owners get 403 on admin', () => {
  it('owner creates a friend account; friend login; friend admin call is 403', async () => {
    const created = await api('/api/admin/users', {
      method: 'POST',
      token: ownerToken,
      body: { email: FRIEND_EMAIL, password: FRIEND_PASSWORD },
    });
    expect(created.status).toBe(201);
    expect(created.body.user.isOwner).toBe(false);

    const login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: FRIEND_EMAIL, password: FRIEND_PASSWORD },
    });
    expect(login.status).toBe(200);
    friendToken = login.body.token;

    const admin = await api('/api/admin/users', { token: friendToken });
    expect(admin.status).toBe(403);
    expect(admin.body.error).toMatch(/Owner access required/);
  });
});

describe('21B §8.8 — disabling a friend kills their session immediately', () => {
  it('owner disables friend → friend token is 401 on the next request', async () => {
    // Sanity: the friend session works right now.
    const before = await api('/api/auth/session', { token: friendToken });
    expect(before.status).toBe(200);

    const friend = findUserByEmail(FRIEND_EMAIL);
    expect(friend).not.toBeNull();

    const disable = await api(`/api/admin/users/${friend!.id}`, {
      method: 'PATCH',
      token: ownerToken,
      body: { enabled: false },
    });
    expect(disable.status).toBe(200);
    expect(disable.body.user.enabled).toBe(false);

    const after = await api('/api/auth/session', { token: friendToken });
    expect(after.status).toBe(401);

    // Sessions row is gone too, not just rejected at the middleware.
    const row = getDb()
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')
      .get(friend!.id) as { n: number };
    expect(row.n).toBe(0);
  });
});
