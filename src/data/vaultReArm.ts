/**
 * vaultReArm — the derived vault key held in TAB RAM ONLY (design-docs/25 §2).
 *
 * The server hands the derived vault key to the authed tab at unlock so a
 * server restart (which wipes the server's RAM) can be re-armed silently via
 * POST /api/auth/unlock-key — no password prompt. The key NEVER touches
 * localStorage or IndexedDB: a refresh forgets it and the user unlocks with
 * their password again. Comfort within a session, not a credential store.
 *
 * Layering (Phase 6): this module holds the re-arm INTENT — the derived key
 * and the lock state. It never imports the gateway itself: the transport
 * (apiFetch) is injected once from the composition root via
 * setVaultReArmTransport. Unset transport = re-arm reports false (honest:
 * without a transport nothing can reach the server).
 */
import { logger } from '../utils/logger';

type VaultReArmTransport = (path: string, init?: RequestInit) => Promise<Response>;

let reArmTransport: VaultReArmTransport | null = null;

/** Wiring point (composition root): hand in the real transport (apiFetch). */
export function setVaultReArmTransport(transport: VaultReArmTransport): void {
  reArmTransport = transport;
}

let reArmKey: string | null = null;

export function rememberReArmKey(key: string | null | undefined): void {
  reArmKey = typeof key === 'string' && /^[0-9a-f]{64}$/.test(key) ? key : null;
}

export function getReArmKey(): string | null {
  return reArmKey;
}

/** Called on sign-out / mode switch — the tab must not keep the key. */
export function forgetReArmKey(): void {
  reArmKey = null;
}

/**
 * One-shot silent re-arm: proves the derived key against the server's DB
 * verifier. Returns true when the vault is armed again. Fired only when a
 * locked vault is detected — one call per occurrence, never polled.
 */
export async function tryReArmVault(): Promise<boolean> {
  if (!reArmKey) return false;
  if (!reArmTransport) return false; // no transport wired — nothing can reach the server
  try {
    const res = await reArmTransport('/api/auth/unlock-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rearmKey: reArmKey }),
    });
    if (res.ok) {
      logger.action('VaultReArm', 'Vault re-armed silently after a server restart');
      setVaultLocked(false);
      return true;
    }
    // Rejected (manual lock elsewhere, password changed) — forget the key so
    // we never retry with a dead secret.
    forgetReArmKey();
    return false;
  } catch (err) {
    logger.warn('VaultReArm', 'Silent re-arm failed (offline?)', err);
    return false;
  }
}

/* ── vaultLockBus lives here too — one small module, one signal ───────────── */

type LockListener = () => void;
const listeners = new Set<LockListener>();
let locked = false;

export function isVaultLocked(): boolean {
  return locked;
}

export function setVaultLocked(next: boolean): void {
  if (next === locked) return;
  locked = next;
  for (const cb of listeners) cb();
}

export function subscribeVaultLock(cb: LockListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}