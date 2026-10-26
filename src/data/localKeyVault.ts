/**
 * Local Workspace passphrase vault (design-docs/21C §2.1).
 *
 * WebCrypto PBKDF2 (600k iters, SHA-256) → AES-256-GCM. The encrypted
 * envelope lives in `localStorage['markbrain:local:keyVault']`; the CryptoKey
 * and the decrypted slots live ONLY in this module's RAM closure — never on
 * window, never in storage, gone on tab close/refresh.
 *
 * Laws:
 * - No plaintext keys on disk, ever (the old `markbrain:keys:*` plaintext
 *   slots are dead; leftovers are ignored, not migrated).
 * - Wrong passphrase → `unlockLocalVault` returns false (OperationError),
 *   RAM stays untouched.
 * - `lockLocalVault()` zeroes RAM but keeps the envelope; `destroyLocalVault()`
 *   deletes the envelope too.
 */
import type { KeySlotId } from './keySlots';

export interface EncryptedLocalVault {
  version: 1;
  saltHex: string; // 16 random bytes
  ivHex: string; // 12 random bytes
  /** AES-256-GCM ciphertext + 16-byte tag of JSON { slots, chatTier } */
  ciphertextHex: string;
}

export interface LocalVaultPayload {
  slots: Record<KeySlotId, string>;
  chatTier: 'free' | 'paid';
}

export const LOCAL_VAULT_KEY = 'markbrain:local:keyVault';

const EMPTY_SLOTS = (): Record<KeySlotId, string> => ({
  'gemini-free': '',
  'gemini-paid': '',
  'openrouter-free': '',
  'openrouter-paid': '',
});

let pbkdf2Iterations = 600_000;
let ramCryptoKey: CryptoKey | null = null;
let ramSlots: Record<KeySlotId, string> = EMPTY_SLOTS();
let ramChatTier: 'free' | 'paid' = 'free';

/** Test seam — unit tests drop to 1000 so the suite stays milliseconds. */
export function setPbkdf2IterationsForTests(n: number): void {
  pbkdf2Iterations = n;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function deriveLocalVaultKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto unavailable — the local key vault needs a secure context.');
  const baseKey = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: pbkdf2Iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function readEnvelope(): EncryptedLocalVault | null {
  try {
    const raw = storage()?.getItem(LOCAL_VAULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EncryptedLocalVault;
    if (parsed && parsed.version === 1 && parsed.saltHex && parsed.ivHex && parsed.ciphertextHex) return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeEnvelope(env: EncryptedLocalVault): void {
  storage()?.setItem(LOCAL_VAULT_KEY, JSON.stringify(env));
}

async function encryptPayload(key: CryptoKey, payload: LocalVaultPayload): Promise<{ ivHex: string; ciphertextHex: string }> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { ivHex: toHex(iv), ciphertextHex: toHex(ciphertext) };
}

async function decryptPayload(key: CryptoKey, env: EncryptedLocalVault): Promise<LocalVaultPayload> {
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromHex(env.ivHex) as unknown as BufferSource },
    key,
    fromHex(env.ciphertextHex) as unknown as BufferSource
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as LocalVaultPayload;
}

/** Re-seal current RAM state into the envelope (call after every edit). */

/** Public awaitable re-seal — tests await this for deterministic envelopes. */
export async function sealLocalVault(): Promise<void> {
  await sealRamToDisk();
}

async function sealRamToDisk(): Promise<void> {
  if (!ramCryptoKey) return;
  const existing = readEnvelope();
  const salt = existing ? fromHex(existing.saltHex) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const { ivHex, ciphertextHex } = await encryptPayload(ramCryptoKey, { slots: ramSlots, chatTier: ramChatTier });
  writeEnvelope({
    version: 1,
    saltHex: toHex(salt),
    ivHex,
    ciphertextHex,
  });
}

export function hasSavedLocalVault(): boolean {
  return readEnvelope() !== null;
}

export function isLocalVaultUnlocked(): boolean {
  return ramCryptoKey !== null;
}

/** True when a vault exists on disk but RAM is locked — UI shows the unlock prompt. */
export function isLocalVaultLockedError(): boolean {
  return hasSavedLocalVault() && !isLocalVaultUnlocked();
}

export async function createOrResetLocalVault(passphrase: string): Promise<void> {
  if (passphrase.length < 4) throw new Error('Passphrase must be at least 4 characters.');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  ramCryptoKey = await deriveLocalVaultKey(passphrase, salt);
  ramSlots = EMPTY_SLOTS();
  ramChatTier = 'free';
  const { ivHex, ciphertextHex } = await encryptPayload(ramCryptoKey, { slots: ramSlots, chatTier: ramChatTier });
  writeEnvelope({ version: 1, saltHex: toHex(salt), ivHex, ciphertextHex });
}

/** Returns false on wrong passphrase (OperationError) — RAM untouched. */
export async function unlockLocalVault(passphrase: string): Promise<boolean> {
  const env = readEnvelope();
  if (!env) return false;
  try {
    const key = await deriveLocalVaultKey(passphrase, fromHex(env.saltHex));
    const payload = await decryptPayload(key, env);
    ramCryptoKey = key;
    const slots = { ...EMPTY_SLOTS(), ...payload.slots };
    // Legacy read-path (design-docs/24 §1): a pre-split vault's `openrouter`
    // slot reads as `openrouter-free`. Writes always use the new ids.
    const legacy = payload.slots as Record<string, string | undefined>;
    if (legacy.openrouter && !slots['openrouter-free']) {
      slots['openrouter-free'] = legacy.openrouter;
    }
    ramSlots = slots;
    ramChatTier = payload.chatTier === 'paid' ? 'paid' : 'free';
    return true;
  } catch {
    return false;
  }
}

/** Zero RAM; keep the encrypted envelope on disk. */
export function lockLocalVault(): void {
  ramCryptoKey = null;
  ramSlots = EMPTY_SLOTS();
  ramChatTier = 'free';
}

/** Zero RAM AND delete the envelope. */
export function destroyLocalVault(): void {
  lockLocalVault();
  try {
    storage()?.removeItem(LOCAL_VAULT_KEY);
  } catch {
    /* ignore */
  }
}

/* ── RAM slot access (only meaningful while unlocked) ─────────────────────── */

export function getVaultSlot(id: KeySlotId): string | null {
  if (!ramCryptoKey) return null;
  const raw = (ramSlots[id] ?? '').trim();
  return raw.length > 0 ? raw : null;
}

/** Write or clear a slot, then immediately re-seal the envelope (async). */
export async function setVaultSlot(id: KeySlotId, value: string | null): Promise<void> {
  if (!ramCryptoKey) throw new Error('Local key vault is locked.');
  const trimmed = (value ?? '').trim();
  ramSlots[id] = trimmed;
  await sealRamToDisk();
}

export function getVaultChatTier(): 'free' | 'paid' {
  return ramChatTier;
}

export async function setVaultChatTier(tier: 'free' | 'paid'): Promise<void> {
  if (!ramCryptoKey) throw new Error('Local key vault is locked.');
  ramChatTier = tier;
  await sealRamToDisk();
}

/** Test seam: forget all module RAM without touching disk. */
export function resetLocalVaultRamForTests(): void {
  lockLocalVault();
}
