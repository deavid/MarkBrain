/**
 * POST /api/account/password — self-service password change:
 * verifies the CURRENT password first (a typo must never reach the rotation),
 * re-keys the vault (keys carry over — from server RAM, or decrypted with the
 * old password when the server restarted), and reports honestly when they
 * could not be carried. In-memory SQLite + a real Express listener on an
 * ephemeral port (same pattern as audit26-hardening): real HTTP round-trips,
 * zero disk, no provider calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { initDb, getDb, closeDbForTests } from '../../server/db';

initDb(':memory:');

const OWNER_EMAIL = 'owner-pw@example.com';
const OWNER_PASSWORD = 'owner-pass-123456';
const USER_EMAIL = 'friend-pw@example.com';
const USER_PASSWORD = 'friend-pass-123456';

const { app } = await import('../../server/app');
const { createUser, findUserByEmail } = await import('../../server/lib/users');

let server: Server;
let base = '';

async function login(email: string, password: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

function api(token: string, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function tokenFor(email: string, password: string): Promise<string> {
  const r = await login(email, password);
  expect(r.status).toBe(200);
  return (r.body as { token: string }).token;
}

beforeAll(async () => {
  createUser(OWNER_EMAIL, OWNER_PASSWORD, { isOwner: true });
  createUser(USER_EMAIL, USER_PASSWORD);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  server.close();
  closeDbForTests();
});

describe('POST /api/account/password', () => {
  it('requires auth', async () => {
    const res = await api('not-a-token', 'POST', '/api/account/password', {
      oldPassword: 'whatever-123',
      newPassword: 'new-pass-123456',
    });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong current password and changes nothing', async () => {
    const token = await tokenFor(USER_EMAIL, USER_PASSWORD);
    const res = await api(token, 'POST', '/api/account/password', {
      oldPassword: 'wrong-pass-123',
      newPassword: 'new-pass-123456',
    });
    expect(res.status).toBe(401);
    // the old password still logs in — nothing was rotated
    expect((await login(USER_EMAIL, USER_PASSWORD)).status).toBe(200);
  });

  it('rejects a short new password', async () => {
    const token = await tokenFor(USER_EMAIL, USER_PASSWORD);
    const res = await api(token, 'POST', '/api/account/password', {
      oldPassword: USER_PASSWORD,
      newPassword: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('changes the password and carries vault keys across', async () => {
    const token = await tokenFor(USER_EMAIL, USER_PASSWORD);
    // give the vault something to carry
    const put = await api(token, 'PUT', '/api/account/keys', { slot: 'gemini-free', apiKey: 'test-key-123' });
    expect(put.status).toBe(200);

    const res = await api(token, 'POST', '/api/account/password', {
      oldPassword: USER_PASSWORD,
      newPassword: 'friend-new-pass-9',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keysPreserved?: boolean; rearmKey?: string };
    expect(body.keysPreserved).toBe(true);
    expect(typeof body.rearmKey).toBe('string');

    // old password is dead, new one logs in
    expect((await login(USER_EMAIL, USER_PASSWORD)).status).toBe(401);
    const relogin = await login(USER_EMAIL, 'friend-new-pass-9');
    expect(relogin.status).toBe(200);
    const newToken = (relogin.body as { token: string }).token;

    // the carried key is still there under the new password
    const settings = await api(newToken, 'GET', '/api/account/settings');
    const data = (await settings.json()) as {
      vaultUnlocked: boolean;
      keys: Record<string, { configured: boolean }>;
    };
    expect(data.vaultUnlocked).toBe(true);
    expect(data.keys['gemini-free']?.configured).toBe(true);
  });

  it('changes it for the owner too (no UI required for the owner row)', async () => {
    const token = await tokenFor(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await api(token, 'POST', '/api/account/password', {
      oldPassword: OWNER_PASSWORD,
      newPassword: 'owner-new-pass-77',
    });
    expect(res.status).toBe(200);
    expect((await login(OWNER_EMAIL, 'owner-new-pass-77')).status).toBe(200);
  });

  it('reports keysPreserved=false instead of lying when the old vault cannot be decrypted', async () => {
    const CORRUPT_EMAIL = 'corrupt-pw@example.com';
    const created = createUser(CORRUPT_EMAIL, 'corrupt-pass-123456');
    // a secrets row no password can decrypt (orphaned/corrupt ciphertext)
    getDb()
      .prepare('INSERT INTO user_secrets (user_id, iv, auth_tag, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(created.id, Buffer.alloc(12, 1), Buffer.alloc(16, 2), Buffer.from('garbage-ciphertext'), Date.now());

    const token = await tokenFor(CORRUPT_EMAIL, 'corrupt-pass-123456');
    const res = await api(token, 'POST', '/api/account/password', {
      oldPassword: 'corrupt-pass-123456',
      newPassword: 'corrupt-new-pass-9',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keysPreserved?: boolean };
    expect(body.keysPreserved).toBe(false);

    // the rotation itself still worked
    expect((await login(CORRUPT_EMAIL, 'corrupt-new-pass-9')).status).toBe(200);
  });

  it('leaves no stale user rows behind: findUserByEmail still resolves the owner', () => {
    const owner = findUserByEmail(OWNER_EMAIL);
    expect(owner?.email).toBe(OWNER_EMAIL);
  });
});
