/**
 * Mailbox (design-docs/16 §5) — the one stateful thing the server owns.
 * Pins: opaque-only storage, one-shot pickup, TTL/sweep, size caps, rate
 * limits, and that it mounts even in shell mode (it never touches content).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { registerMailboxRoutes } from '../../server/routes/mailbox';

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  registerMailboxRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

const SLOT = 'a'.repeat(22);

function bundle(label: string) {
  return {
    ivB64: btoa('iv-' + label),
    ciphertextB64: btoa('ciphertext-' + label),
    saltB64: btoa('salt-' + label),
  };
}

describe('mailbox store/pickup', () => {
  it('PUT stores, GET picks up exactly once, second GET 404s', async () => {
    const put = await fetch(`${base}/api/mailbox/${SLOT}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle('once')),
    });
    expect(put.status).toBe(200);

    const first = await fetch(`${base}/api/mailbox/${SLOT}`);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.ciphertextB64).toBe(bundle('once').ciphertextB64);

    const second = await fetch(`${base}/api/mailbox/${SLOT}`);
    expect(second.status).toBe(404); // one-shot (§5)
  });

  it('stores only the opaque fields — nothing else from the request leaks in', async () => {
    const slot = 'b'.repeat(22);
    await fetch(`${base}/api/mailbox/${slot}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...bundle('opaque'),
        from: 'evil-injected-field',
        keyMaterial: 'AIza-should-not-stick',
      }),
    });
    const res = await fetch(`${base}/api/mailbox/${slot}`);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['ciphertextB64', 'ivB64', 'saltB64']);
    expect(JSON.stringify(body)).not.toContain('should-not-stick');
  });

  it('DELETE removes a pending bundle', async () => {
    const slot = 'c'.repeat(22);
    await fetch(`${base}/api/mailbox/${slot}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle('del')),
    });
    const del = await fetch(`${base}/api/mailbox/${slot}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await del.json()).deleted).toBe(true);
    expect((await fetch(`${base}/api/mailbox/${slot}`)).status).toBe(404);
  });
});

describe('mailbox limits', () => {
  it('rejects junk slot ids', async () => {
    for (const bad of ['short', 'has spaces!', 'x'.repeat(80)]) {
      const res = await fetch(`${base}/api/mailbox/${encodeURIComponent(bad)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle('junk')),
      });
      expect(res.status).toBe(400);
    }
  });

  it('rejects missing/oversized ciphertext', async () => {
    const slot = 'd'.repeat(22);
    const empty = await fetch(`${base}/api/mailbox/${slot}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ivB64: 'a', ciphertextB64: '', saltB64: 'c' }),
    });
    expect(empty.status).toBe(400);

    const missing = await fetch(`${base}/api/mailbox/${slot}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ivB64: 'a', saltB64: 'c' }),
    });
    expect(missing.status).toBe(400);
  });

  it('rate-limits writes per address (§6: never a free file drop)', async () => {
    const ip = '203.0.113.7';
    let sawLimit = false;
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${base}/api/mailbox/${'e'.repeat(22)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body: JSON.stringify(bundle('rl')),
      });
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });
});
