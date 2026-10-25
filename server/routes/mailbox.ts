/**
 * Mailbox — the ONE stateful thing this server owns (design-docs/16 §5, D4).
 *
 * A one-shot, short-TTL bucket for E2E-encrypted pairing bundles. The server
 * sees opaque bytes and a random id. It cannot decrypt them: the key is
 * derived from the pairing secret that lives only in the QR fragment (see
 * src/gateway/pairing.ts). D4: "impossible for me to decode on the fly".
 *
 * Limits (§6: this must never become a free file drop):
 *   - one blob per slot, size-capped (2 MiB — a project export is well under)
 *   - TTL 10 minutes, enforced on every read AND by a sweep
 *   - one-shot download: the first successful GET clears the slot
 *   - slot ids are client-chosen but must be random-looking (we check shape,
 *     not ownership — there is no account, and ciphertext is opaque)
 *   - modest per-IP write cap to blunt abuse
 */
import type { Express, Request, Response } from 'express';
import { logServer } from '../lib/log';

interface MailboxEntry {
  ivB64: string;
  ciphertextB64: string;
  saltB64: string;
  expiresAt: number;
  from: string;
}

const MAILBOX = new Map<string, MailboxEntry>();
const TTL_MS = 10 * 60 * 1000;
const MAX_BLOB_BYTES = 2 * 1024 * 1024;
const SLOT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const WRITES_PER_IP = 20;

const writeCounts = new Map<string, { n: number; resetAt: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [id, entry] of MAILBOX) {
    if (entry.expiresAt <= now) MAILBOX.delete(id);
  }
  for (const [ip, rec] of writeCounts) {
    if (rec.resetAt <= now) writeCounts.delete(ip);
  }
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = writeCounts.get(ip);
  if (!rec || rec.resetAt <= now) {
    writeCounts.set(ip, { n: 1, resetAt: now + TTL_MS });
    return false;
  }
  rec.n += 1;
  return rec.n > WRITES_PER_IP;
}

export function registerMailboxRoutes(app: Express): void {
  // PUT: drop a bundle into a slot. Replaces whatever was there (an id can be
  // retried; ciphertext is opaque so there is no leak in overwriting).
  app.put('/api/mailbox/:slot', (req: Request, res: Response) => {
    sweep();
    const slot = String(req.params.slot || '');
    if (!SLOT_ID_RE.test(slot)) {
      return res.status(400).json({ error: 'slot id must be 16-64 chars of [A-Za-z0-9_-]' });
    }
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) {
      logServer('warn', 'MAILBOX', `write rate limit hit for ${ip}`);
      return res.status(429).json({ error: 'too many bundles from this address — try again later' });
    }
    const { ivB64, ciphertextB64, saltB64 } = req.body ?? {};
    if (
      typeof ivB64 !== 'string' ||
      typeof ciphertextB64 !== 'string' ||
      typeof saltB64 !== 'string' ||
      ciphertextB64.length === 0 ||
      ciphertextB64.length > MAX_BLOB_BYTES
    ) {
      return res.status(400).json({ error: 'ivB64/ciphertextB64/saltB64 strings required; ciphertext ≤ 2 MiB' });
    }
    MAILBOX.set(slot, {
      ivB64,
      ciphertextB64,
      saltB64,
      expiresAt: Date.now() + TTL_MS,
      from: ip,
    });
    logServer('info', 'MAILBOX', `bundle stored (slot ${slot.slice(0, 6)}…, ${ciphertextB64.length} chars, TTL ${TTL_MS / 60000}min)`);
    return res.json({ ok: true, ttlMs: TTL_MS });
  });

  // GET: one-shot pickup. First success clears the slot — a replay finds
  // nothing (§5: one-time code semantics).
  app.get('/api/mailbox/:slot', (req: Request, res: Response) => {
    sweep();
    const slot = String(req.params.slot || '');
    const entry = MAILBOX.get(slot);
    if (!entry) {
      return res.status(404).json({ error: 'no bundle for that slot (expired, used, or never existed)' });
    }
    MAILBOX.delete(slot);
    logServer('info', 'MAILBOX', `bundle picked up (slot ${slot.slice(0, 6)}…)`);
    return res.json({ ivB64: entry.ivB64, ciphertextB64: entry.ciphertextB64, saltB64: entry.saltB64 });
  });

  // DELETE: let the sender cancel a bundle they regret.
  app.delete('/api/mailbox/:slot', (req: Request, res: Response) => {
    sweep();
    const slot = String(req.params.slot || '');
    const existed = MAILBOX.delete(slot);
    return res.json({ ok: true, deleted: existed });
  });
}
