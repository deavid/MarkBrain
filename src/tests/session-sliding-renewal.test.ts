/**
 * Sliding session renewal: once a session is past half its TTL, any
 * authenticated request extends it back to the full window (and re-arms the
 * cookie). Rationale lives at SESSION_RENEW_THRESHOLD_MS in
 * server/routes/account.ts — short version: the TTL must count from last
 * USE, not from login, or a daily-active user gets logged out while offline
 * and unable to re-authenticate.
 *
 * Real Express listener on an ephemeral port (same pattern as
 * audit26-hardening), DB touched directly to age the session.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { initDb, getDb, closeDbForTests } from '../../server/db';

initDb(':memory:');

const OWNER_EMAIL = 'owner-renew@example.com';
const OWNER_PASSWORD = 'owner-pass-123456';

const { app } = await import('../../server/app');
const { createUser } = await import('../../server/lib/users');
const { SESSION_TTL_MS } = await import('../../server/routes/account');

let server: Server;
let base = '';

beforeAll(async () => {
  createUser(OWNER_EMAIL, OWNER_PASSWORD, { isOwner: true });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
  closeDbForTests();
});

async function login(): Promise<string> {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  return ((await res.json()) as { token: string }).token;
}

function sessionRow(token: string): { token_hash: string; expires_at: number } {
  // Same hashing the server uses (sha256 of the hex token).
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const hash = createHash('sha256').update(token).digest('hex');
  return getDb()
    .prepare('SELECT token_hash, expires_at FROM sessions WHERE token_hash = ?')
    .get(hash) as { token_hash: string; expires_at: number };
}

async function callWithToken(token: string): Promise<Response> {
  return fetch(base + '/api/projects', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('sliding session renewal', () => {
  it('young session is served but NOT renewed', async () => {
    const token = await login();
    const before = sessionRow(token).expires_at;
    const res = await callWithToken(token);
    expect(res.status).toBe(200);
    expect(sessionRow(token).expires_at).toBe(before);
  });

  it('past half-life session is renewed to the full window and re-arms the cookie', async () => {
    const token = await login();
    const row = sessionRow(token);
    // Age it artificially: just past the renewal threshold (half the TTL).
    const aged = Date.now() + SESSION_TTL_MS / 2 - 60_000;
    getDb().prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(aged, row.token_hash);

    const res = await callWithToken(token);
    expect(res.status).toBe(200);

    const after = sessionRow(token).expires_at;
    const expectedWindow = Date.now() + SESSION_TTL_MS;
    expect(Math.abs(after - expectedWindow)).toBeLessThan(5_000); // renewed, full window again

    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('mb_session=');
    expect(cookie).toContain(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  });

  it('expired session is still rejected — renewal never resurrects', async () => {
    const token = await login();
    const row = sessionRow(token);
    getDb()
      .prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run(Date.now() - 1_000, row.token_hash);
    const res = await callWithToken(token);
    expect(res.status).toBe(401);
  });
});
