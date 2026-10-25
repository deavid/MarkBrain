/**
 * Account cryptography & the server RAM key vault (design-docs/21B §3).
 *
 * Laws (do not weaken):
 * - Passwords: scrypt (N=16384, r=8, p=1), 16-byte salt, 64-byte hash,
 *   stored as `scrypt$<saltHex>$<hashHex>`, verified with timingSafeEqual.
 * - Vault key: SEPARATE 16-byte salt (`users.kdf_salt`), scrypt → 32 bytes,
 *   held ONLY in server RAM (`unlockedVaultKeys`). Never written to disk.
 * - `user_secrets` payload: AES-256-GCM, fresh 12-byte iv per save.
 * - After a restart the RAM map is empty → key/AI routes answer 428
 *   VAULT_LOCKED until POST /api/auth/unlock (or a fresh login).
 * - Raw API key strings NEVER leave this process toward the browser —
 *   only `{ configured, hint: '…last4' }`.
 */
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { getDb } from '../db';
import { OpenRouterClient, isOpenRouterModel } from '../providers/openrouter';
import type { LaneAiSurface } from '../providers/lane';

// Four key slots (design-docs/24 §1): the OpenRouter slot split into free/paid,
// mirroring the Gemini pair. `openrouter` survives as a LEGACY read alias only.
export type KeySlotId = 'gemini-free' | 'gemini-paid' | 'openrouter-free' | 'openrouter-paid';

export const KEY_SLOTS: readonly KeySlotId[] = [
  'gemini-free',
  'gemini-paid',
  'openrouter-free',
  'openrouter-paid',
];

/** The pre-split slot id — read-path only; writes always use the new ids. */
export type LegacyKeySlotId = 'openrouter';

export interface AccountKeysPayload {
  'gemini-free'?: string;
  'gemini-paid'?: string;
  'openrouter-free'?: string;
  'openrouter-paid'?: string;
  /** Legacy pre-split OpenRouter key. Reads as openrouter-free; never written. */
  openrouter?: string;
}

export interface AuthUser {
  id: number;
  email: string;
  isOwner: boolean;
  vaultUnlocked: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** userId → vault key. RAM only. */
const unlockedVaultKeys = new Map<number, Buffer>();

/** Test seam: simulates a server restart (design-docs/21B §8.6). */
export function clearUnlockedVaultKeysForTests(): void {
  unlockedVaultKeys.clear();
}

export function isVaultUnlocked(userId: number): boolean {
  return unlockedVaultKeys.has(userId);
}

export class VaultLockedError extends Error {
  readonly status = 428;
  readonly code = 'VAULT_LOCKED';
  constructor() {
    super('Server session keys are locked after a server restart. Enter your password to unlock.');
  }
}

export class NoKeyError extends Error {
  readonly status = 400;
  readonly code = 'NO_API_KEY';
  constructor(provider: string) {
    super(`No API key configured for ${provider}. Open Model Settings → Keys to add one.`);
  }
}

/** Map a thrown crypto/vault error onto the HTTP vocabulary. */
export function sendVaultError(res: Response, err: unknown): void {
  if (err instanceof VaultLockedError) {
    res.status(428).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof NoKeyError) {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  const msg = err instanceof Error ? err.message : 'Internal error';
  res.status(500).json({ error: msg });
}

// ── Password hashing ────────────────────────────────────────────────────────

export function hashPassword(password: string, salt?: Buffer): { stored: string; salt: Buffer } {
  const pwSalt = salt ?? crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, pwSalt, 64, { N: 16384, r: 8, p: 1 });
  return { stored: `scrypt$${pwSalt.toString('hex')}$${hash.toString('hex')}`, salt: pwSalt };
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

// ── Vault key derivation & RAM map ──────────────────────────────────────────

export function deriveVaultKey(password: string, kdfSalt: Buffer): Buffer {
  return crypto.scryptSync(password, kdfSalt, 32, { N: 16384, r: 8, p: 1 });
}

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  kdf_salt: Buffer;
  is_owner: number;
  enabled: number;
}

/** Verify password → derive vault key → hold in RAM. Used by login + unlock. */
export function unlockVaultWithPassword(userId: number, password: string): void {
  const row = getDb()
    .prepare('SELECT id, email, password_hash, kdf_salt, is_owner, enabled FROM users WHERE id = ?')
    .get(userId) as UserRow | undefined;
  if (!row || row.enabled !== 1) throw new Error('Invalid credentials.');
  if (!verifyPassword(password, row.password_hash)) throw new Error('Invalid credentials.');
  unlockedVaultKeys.set(userId, deriveVaultKey(password, Buffer.from(row.kdf_salt)));
}

export function lockVault(userId: number): void {
  unlockedVaultKeys.delete(userId);
}

// ── user_secrets encryption ─────────────────────────────────────────────────

interface SecretsRow {
  iv: Buffer;
  auth_tag: Buffer;
  ciphertext: Buffer;
}

export function readKeysPayload(userId: number): AccountKeysPayload | null {
  if (!isVaultUnlocked(userId)) throw new VaultLockedError();
  const row = getDb()
    .prepare('SELECT iv, auth_tag, ciphertext FROM user_secrets WHERE user_id = ?')
    .get(userId) as SecretsRow | undefined;
  if (!row) return null;
  const key = unlockedVaultKeys.get(userId)!;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, row.iv);
  decipher.setAuthTag(row.auth_tag);
  const plaintext = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]);
  const payload = JSON.parse(plaintext.toString('utf8')) as AccountKeysPayload;
  // Legacy read-path (design-docs/24 §1): a pre-split payload's `openrouter`
  // slot reads as `openrouter-free`. The write path only ever stores new ids —
  // the next PUT /api/account/keys save rewrites the payload in the new shape.
  if (payload.openrouter && !payload['openrouter-free']) {
    payload['openrouter-free'] = payload.openrouter;
  }
  return payload;
}

/** Fresh iv on every save (§3.3). Returns the payload for chaining. */
export function writeKeysPayload(userId: number, payload: AccountKeysPayload): void {
  if (!isVaultUnlocked(userId)) throw new VaultLockedError();
  const key = unlockedVaultKeys.get(userId)!;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  getDb()
    .prepare(
      `INSERT INTO user_secrets (user_id, iv, auth_tag, ciphertext, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET iv = excluded.iv, auth_tag = excluded.auth_tag,
         ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`
    )
    .run(userId, iv, authTag, ciphertext, Date.now());
}

/** Re-encrypt existing secrets under a new vault key (password change, §4.4). */
export function reencryptKeysPayload(userId: number, newVaultKey: Buffer, payload: AccountKeysPayload): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', newVaultKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  getDb()
    .prepare(
      `INSERT INTO user_secrets (user_id, iv, auth_tag, ciphertext, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET iv = excluded.iv, auth_tag = excluded.auth_tag,
         ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`
    )
    .run(userId, iv, authTag, ciphertext, Date.now());
}

export function hasSecretsRow(userId: number): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM user_secrets WHERE user_id = ?').get(userId));
}

// ── Redaction (§6.2.5 — raw keys never reach the browser) ───────────────────

export function keyHint(key: string | undefined): string | null {
  if (!key) return null;
  return `…${key.slice(-4)}`;
}

export function redactKeys(payload: AccountKeysPayload | null): Record<KeySlotId, { configured: boolean; hint: string | null }> {
  const slots: KeySlotId[] = [...KEY_SLOTS];
  const out = {} as Record<KeySlotId, { configured: boolean; hint: string | null }>;
  for (const slot of slots) {
    const key = payload?.[slot];
    out[slot] = { configured: Boolean(key), hint: keyHint(key) };
  }
  return out;
}

// ── Lane key resolution (§3.4) ──────────────────────────────────────────────

export type LaneCapability = 'chat' | 'extract' | 'summarize' | 'qaGen' | 'title' | 'embed' | 'tts';

export function resolveServerLaneKey(userId: number, capability: LaneCapability, modelId: string): string {
  const payload = readKeysPayload(userId) ?? {};
  const tierRow = getDb()
    .prepare('SELECT chat_tier FROM user_settings WHERE user_id = ?')
    .get(userId) as { chat_tier: string } | undefined;
  const chatTier = tierRow?.chat_tier ?? 'free';

  // OpenRouter models carry a provider prefix (`vendor/model`). The same tier
  // law as Gemini (design-docs/24 §2): PAID tier prefers the paid key on every
  // lane, FREE tier prefers the free key — each falling back to the other, then
  // to the legacy pre-split `openrouter` slot.
  if (isOpenRouterModel(modelId)) {
    const orFree = payload['openrouter-free'];
    const orPaid = payload['openrouter-paid'];
    const legacy = payload.openrouter;
    if (chatTier === 'paid') {
      if (orPaid) return orPaid;
      if (orFree) return orFree;
      if (legacy) return legacy;
    } else {
      if (orFree) return orFree;
      if (orPaid) return orPaid;
      if (legacy) return legacy;
    }
    throw new NoKeyError('openrouter');
  }

  // Tier is ACCOUNT-WIDE (David 2026-10-25): "PAID" means every Gemini lane —
  // chat, extract, summarize, title, qaGen, embed, tts — signs with the paid
  // key. The earlier chat-only reading made embeddings/title/extract burn the
  // free quota while chat alone ran paid. Free tier prefers the free key with
  // paid as fallback (free = generous quota; paid = costs money per call).
  // Explicit OpenRouter routing above is unaffected. Design-docs/21B §3.4
  // amended accordingly.
  if (chatTier === 'paid' && payload['gemini-paid']) return payload['gemini-paid'];
  if (payload['gemini-free']) return payload['gemini-free'];
  if (payload['gemini-paid']) return payload['gemini-paid'];
  throw new NoKeyError('gemini');
}

// ── Per-request AI client (§7.3) ────────────────────────────────────────────

/** Either provider, behind the identical call surface (design-docs/24 §4). */
export type LaneAiClient = GoogleGenAI | OpenRouterClient;

function clientForApiKey(modelId: string, apiKey: string): LaneAiClient {
  return isOpenRouterModel(modelId) ? new OpenRouterClient(apiKey) : new GoogleGenAI({ apiKey });
}

/**
 * Build the caller's AI client for this request: requires an authenticated
 * user (requireAuth), an unlocked vault (else 428), and a configured lane key
 * (else 400 NO_API_KEY). Never reads process.env.
 *
 * Facade (design-docs/24 §4): a `/`-shaped model id returns the OpenRouter
 * client; everything else stays GoogleGenAI. Both expose
 * models.generateContent / models.generateContentStream yielding `{text}`.
 */
export function aiForRequest(req: Request, capability: LaneCapability, modelId: string): LaneAiClient {
  const user = req.user;
  if (!user) throw new VaultLockedError(); // requireAuth should have caught this; fail closed
  if (!isVaultUnlocked(user.id)) throw new VaultLockedError();
  const apiKey = resolveServerLaneKey(user.id, capability, modelId);
  return clientForApiKey(modelId, apiKey);
}

/** Same law, keyed by userId — the job runner has no Request (21E: decoupled). */
export function aiClientForUser(userId: number, capability: LaneCapability, modelId: string): LaneAiClient {
  if (!isVaultUnlocked(userId)) throw new VaultLockedError();
  const apiKey = resolveServerLaneKey(userId, capability, modelId);
  return clientForApiKey(modelId, apiKey);
}

/**
 * Gemini-only lanes (embed, tts): the raw GoogleGenAI client. The catalog
 * caps those lanes to Gemini model ids, so an OpenRouter id here is a hard
 * error, never a silent swap (errors are final).
 */
export function geminiAiForRequest(req: Request, capability: LaneCapability, modelId: string): GoogleGenAI {
  if (isOpenRouterModel(modelId)) {
    throw new Error(`Model "${modelId}" is not available for ${capability} on this server.`);
  }
  const user = req.user;
  if (!user) throw new VaultLockedError();
  if (!isVaultUnlocked(user.id)) throw new VaultLockedError();
  const apiKey = resolveServerLaneKey(user.id, capability, modelId);
  return new GoogleGenAI({ apiKey });
}

export type { LaneAiSurface };
