/**
 * Audit 26 no-brainer fixes: login rate limiting, timing equalization,
 * session pruning, jobs/send ownership. In-memory SQLite + a real Express
 * listener on an ephemeral port (same pattern as server-auth-and-vault):
 * real HTTP round-trips, zero disk, no provider calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { initDb, getDb, closeDbForTests } from '../../server/db';

initDb(':memory:');

const OWNER_EMAIL = 'owner-audit26@example.com';
const OWNER_PASSWORD = 'owner-pass-123456';

const { app } = await import('../../server/app');
const { createUser } = await import('../../server/lib/users');
const { resetLoginRateLimiterForTests } = await import('../../server/routes/account');

let server: Server;
let base = '';
let ownerToken = '';

async function login(email: string, password: string): Promise<number> {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return res.status;
}

beforeAll(async () => {
  const user = createUser(OWNER_EMAIL, OWNER_PASSWORD, { isOwner: true });
  void user;
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  ownerToken = ((await r.json()) as { token: string }).token;
});

afterAll(async () => {
  server.close();
  closeDbForTests();
});

describe('login rate limit (audit 26 H1)', () => {
  it('throttles after repeated failures from the same IP, correct password included', async () => {
    resetLoginRateLimiterForTests();
    let got429 = false;
    for (let i = 0; i < 15; i++) {
      const status = await login(OWNER_EMAIL, `wrong-password-${i}`);
      if (status === 429) {
        got429 = true;
        break;
      }
      expect(status).toBe(401);
    }
    expect(got429).toBe(true);
    // The limit is per-IP, not per-password: the CORRECT password is also
    // throttled (otherwise the attacker just guesses online with the real
    // email and unlimited tries).
    const correct = await login(OWNER_EMAIL, OWNER_PASSWORD);
    expect(correct).toBe(429);
    resetLoginRateLimiterForTests();
    expect(await login(OWNER_EMAIL, OWNER_PASSWORD)).toBe(200);
  });
});

describe('login timing equalization (audit 26 M8)', () => {
  it('unknown email costs a scrypt run too — no fast 401 path', async () => {
    resetLoginRateLimiterForTests();
    const start = Date.now();
    const status = await login('nobody-here-audit26@test.local', 'whatever-password');
    const elapsed = Date.now() - start;
    expect(status).toBe(401);
    // scrypt N=16384 takes tens of ms; the old fast path returned in ~1ms.
    expect(elapsed).toBeGreaterThanOrEqual(8);
  });
});

describe('session pruning (audit 26 L5)', () => {
  it('expired sessions are deleted on the next login', async () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('audit26-deadbeef', 1, 0, 1)"
    ).run();
    expect((db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get('audit26-deadbeef') as { n: number }).n).toBe(1);
    expect(await login(OWNER_EMAIL, OWNER_PASSWORD)).toBe(200);
    expect((db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get('audit26-deadbeef') as { n: number }).n).toBe(0);
  });
});

describe('jobs/send ownership (audit 26 L6)', () => {
  it('enqueueing into a project the caller does not own 404s without creating a job', async () => {
    const res = await fetch(base + '/api/projects/no-such-project-audit26/jobs/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        threadId: 't1',
        askText: 'hi',
        compiledPrompt: 'p',
        model: 'gemini-2.5-flash',
      }),
    });
    expect(res.status).toBe(404);
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM chat_jobs').get() as { n: number }).n).toBe(0);
  });
});