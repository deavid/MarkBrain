/**
 * keyVault — Tier 2 credential storage (design-docs/16 §4.2, Phase 3).
 *
 * Tier 1 was plaintext localStorage + provider-side key restrictions. Tier 2
 * is this: the key-slot blob is encrypted at rest with AES-GCM under a key
 * derived from a user passphrase (PBKDF2-SHA-256, 600k iterations — OWASP
 * 2023 floor). The passphrase is NEVER stored; a wrong one cannot unlock.
 *
 * Design rules (do not "improve" into theatre):
 * - Plaintext keys live only in this module's in-memory map while UNLOCKED.
 *   Auto-lock (15 min idle) wipes it. Derived AES keys are non-extractable.
 * - No passphrase configured = Tier 1 behaviour (plaintext slots) — the
 *   personal-tool posture. The vault upgrades storage, it does not change
 *   where keys may go (§4.4: never in snapshots/exports/QR).
 * - Locked vault = key slots read as absent. Lanes degrade honestly to the
 *   proxy/empty state — they never silently fall back to a stale cache.
 * - WebCrypto only. No hand-rolled crypto, no base64 "encryption", no
 *   localStorage "obfuscation". If WebCrypto is missing, vault features
 *   refuse to enable rather than pretend.
 */

export interface VaultConfig {
  /** true once the user has set a passphrase on THIS device. */
  enabled: boolean;
  /** Iteration count recorded at encryption time (so it can grow later). */
  iterations: number;
  /** Public salt (base64) — not secret. */
  saltB64: string;
  /** AES-GCM iv (base64) per record — not secret, never reused. */
  ivB64: string;
  /** The encrypted key-slot blob (base64). */
  ciphertextB64: string;
  /** When auto-lock fired last (epoch ms), for the settings UI. */
  lockedAt?: number;
}

/** The blob we persist: { slotId: keyValue }. */
export type SlotBlob = Record<string, string>;

const VAULT_KEY = 'markbrain:keysVault';
const PBKDF2_ITERATIONS = 600_000;
const AUTO_LOCK_MS = 15 * 60 * 1000; // §4.2: inactivity timer wipes the derived key
const MIN_PASSPHRASE_LEN = 8;

/* ----------------------------------------------------------- in-memory state
 * The decrypted map + the CryptoKey exist ONLY here. Nothing else in the app
 * holds plaintext key material after a vault save.
 */
let plaintext: Map<string, string> | null = null;
let derivedKey: CryptoKey | null = null;
let lastActivity = 0;
let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

function subtle(): SubtleCrypto | null {
  try {
    return typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;
  } catch {
    return null;
  }
}

export function vaultSupported(): boolean {
  return subtle() !== null;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readConfig(): VaultConfig | null {
  try {
    const raw = storage()?.getItem(VAULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.enabled !== true) return null;
    return parsed as VaultConfig;
  } catch {
    return null;
  }
}

function writeConfig(cfg: VaultConfig): void {
  storage()?.setItem(VAULT_KEY, JSON.stringify(cfg));
}

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const subtleApi = subtle();
  if (!subtleApi) throw new Error('WebCrypto unavailable — vault cannot be enabled');
  const material = await subtleApi.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  // Non-extractable AES-GCM key — it cannot be serialized out of the page.
  return subtleApi.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypt the current in-memory map into localStorage. */
async function persistCurrent(throwOnError: boolean): Promise<void> {
  const cfg = readConfig();
  const subtleApi = subtle();
  if (!cfg || !subtleApi || !derivedKey || !plaintext) return;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = new TextEncoder().encode(JSON.stringify(Object.fromEntries(plaintext)));
    const ciphertext = await subtleApi.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      derivedKey,
      bytes
    );
    writeConfig({ ...cfg, ivB64: b64encode(iv), ciphertextB64: b64encode(ciphertext), lockedAt: undefined });
  } catch (err) {
    if (throwOnError) throw err;
    // Session memory is still correct; the next successful save repairs disk.
    // Never log anything derived from key material.
  }
}

/* ------------------------------------------------------------------ lifecycle */

export function isVaultEnabled(): boolean {
  return readConfig() !== null;
}

export function isUnlocked(): boolean {
  return plaintext !== null;
}

/** Fresh copy of the decrypted slots. null when locked or absent. */
export function peekSlots(): SlotBlob | null {
  if (!plaintext) return null;
  lastActivity = Date.now();
  return Object.fromEntries(plaintext);
}

/**
 * Enable the vault with a passphrase, migrating the given slots. Refuses
 * (throws) without WebCrypto or with a short passphrase — never pretends.
 */
export async function enableVault(passphrase: string, currentSlots: SlotBlob): Promise<void> {
  const subtleApi = subtle();
  if (!subtleApi) throw new Error('WebCrypto unavailable — vault cannot be enabled');
  const pass = (passphrase ?? '').trim();
  if (pass.length < MIN_PASSPHRASE_LEN) {
    throw new Error(`Passphrase too short — use at least ${MIN_PASSPHRASE_LEN} characters`);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pass, salt, PBKDF2_ITERATIONS);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(currentSlots ?? {}));
  const ciphertext = await subtleApi.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    bytes
  );

  writeConfig({
    enabled: true,
    iterations: PBKDF2_ITERATIONS,
    saltB64: b64encode(salt),
    ivB64: b64encode(iv),
    ciphertextB64: b64encode(ciphertext),
    lockedAt: Date.now(),
  });

  plaintext = new Map(Object.entries(currentSlots ?? {}));
  derivedKey = key;
  lastActivity = Date.now();
  scheduleAutoLock();
}

/**
 * Unlock with the passphrase. Wrong passphrase → false (genuinely
 * undecryptable — that is the point). Throws only when WebCrypto is missing
 * and a vault actually exists.
 */
export async function unlockVault(passphrase: string): Promise<boolean> {
  const cfg = readConfig();
  if (!cfg) return false;
  const subtleApi = subtle();
  if (!subtleApi) throw new Error('WebCrypto unavailable — cannot unlock');
  try {
    const key = await deriveKey(
      passphrase ?? '',
      b64decode(cfg.saltB64),
      cfg.iterations || PBKDF2_ITERATIONS
    );
    const plainBuf = await subtleApi.decrypt(
      { name: 'AES-GCM', iv: b64decode(cfg.ivB64) as unknown as BufferSource },
      key,
      b64decode(cfg.ciphertextB64) as unknown as BufferSource
    );
    const blob = JSON.parse(new TextDecoder().decode(plainBuf)) as SlotBlob;
    plaintext = new Map(Object.entries(blob && typeof blob === 'object' ? blob : {}));
    derivedKey = key;
    lastActivity = Date.now();
    scheduleAutoLock();
    return true;
  } catch {
    return false;
  }
}

/** Wipe plaintext + the derived key from memory. Ciphertext stays on disk. */
export function lockVault(): void {
  plaintext = null;
  derivedKey = null;
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
  const cfg = readConfig();
  if (cfg) writeConfig({ ...cfg, lockedAt: Date.now() });
}

/**
 * Turn the vault off and hand the slots back as plaintext — the caller
 * (keySlots) decides whether they return to Tier 1 storage or are discarded.
 * Verifies the passphrase even when already unlocked: demotion must not work
 * from memory state alone.
 */
export async function disableVault(passphrase: string): Promise<SlotBlob> {
  const cfg = readConfig();
  if (!cfg) return {};
  const ok = await unlockVault(passphrase);
  const slots = ok ? (peekSlots() ?? {}) : null;
  if (!slots) throw new Error('Current passphrase is wrong');
  storage()?.removeItem(VAULT_KEY);
  lockVault();
  return slots;
}

/**
 * Change the passphrase. Always verifies the old one — this is the one
 * operation where guessing must not work from an unlocked session alone.
 */
export async function changePassphrase(oldPass: string, newPass: string): Promise<void> {
  const cfg = readConfig();
  if (!cfg) throw new Error('Vault is not enabled');
  const next = (newPass ?? '').trim();
  if (next.length < MIN_PASSPHRASE_LEN) {
    throw new Error(`Passphrase too short — use at least ${MIN_PASSPHRASE_LEN} characters`);
  }
  const ok = await unlockVault(oldPass);
  if (!ok) throw new Error('Current passphrase is wrong');
  const slots = peekSlots() ?? {};
  storage()?.removeItem(VAULT_KEY);
  lockVault();
  await enableVault(next, slots);
}

/* ---------------------------------------------------------------- slot writes */

/**
 * Synchronous slot mutation while unlocked: memory updates immediately (so
 * getKeySlot is coherent), disk catches up asynchronously. Throws when the
 * vault is locked — the UI disables inputs in that state.
 */
export function setSlotInVault(slotId: string, value: string | null): void {
  if (!plaintext || !derivedKey) throw new Error('Vault is locked — unlock before changing keys');
  const next = new Map(plaintext);
  const trimmed = (value ?? '').trim();
  if (trimmed.length > 0) next.set(slotId, trimmed);
  else next.delete(slotId);
  plaintext = next;
  lastActivity = Date.now();
  scheduleAutoLock();
  void persistCurrent(false);
}

/**
 * Persist a full slot map (async, awaited). Used by enable/unlock paths that
 * want confirmation before returning to the caller.
 */
export async function saveSlots(slots: SlotBlob): Promise<void> {
  if (!derivedKey) throw new Error('Vault is locked — unlock before changing keys');
  plaintext = new Map(Object.entries(slots));
  lastActivity = Date.now();
  scheduleAutoLock();
  await persistCurrent(true);
}

/* ------------------------------------------------------------------ auto-lock */

function scheduleAutoLock(): void {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(() => {
    if (Date.now() - lastActivity >= AUTO_LOCK_MS) lockVault();
    else scheduleAutoLock();
  }, AUTO_LOCK_MS);
}

/** Test hook — reset all module state (never called by app code). */
export function _resetVaultForTests(): void {
  lockVault();
  storage()?.removeItem(VAULT_KEY);
}
