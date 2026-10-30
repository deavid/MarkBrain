/**
 * sendReadiness — can this send actually run? (design 25 §1.1)
 *
 * Found live 2026-10-26: with no API keys configured, the user typed a
 * message, hit send and got a FAILED draft. The vault padlock only covered
 * "keys locked", not "keys absent" — two different states, same user pain:
 * attempting something that cannot work.
 *
 * Law: a send is attempted only when a usable credential exists for the
 * selected model. When not, the send button shows the padlock and the click
 * routes the user to the fix — unlock popup (locked) or Model Settings →
 * Keys (no key) — never a doomed attempt.
 */
import { getWorkspaceMode } from '../services/workspaceSession';
import { isCaptureMode } from '../services/persistenceService';
import { resolveLaneKey } from './keySlots';
import { isVaultLocked, subscribeVaultLock } from './vaultReArm';

export type SendBlockReason = 'vault-locked' | 'no-key';

/** The server's last-known key snapshot (VPS): slotId → configured flag. */
let serverKeysConfigured: Record<string, boolean> | null = null;
let serverChatTier: 'free' | 'paid' = 'free';
let readinessVersion = 0;
const readinessListeners = new Set<() => void>();

function notifyReadiness(): void {
  readinessVersion += 1;
  for (const cb of readinessListeners) cb();
}

/** useSyncExternalStore seam: UI re-renders when the snapshot changes. */
export function subscribeReadiness(cb: () => void): () => void {
  readinessListeners.add(cb);
  return () => readinessListeners.delete(cb);
}

export function getReadinessVersion(): number {
  return readinessVersion;
}

/** Called from the delta poll's piggybacked /api/account/settings check. */
export function setServerKeySnapshot(body: {
  keys?: Record<string, { configured: boolean }>;
  chatTier?: 'free' | 'paid';
  vaultUnlocked?: boolean;
}): void {
  const map: Record<string, boolean> = {};
  for (const [slot, info] of Object.entries(body.keys ?? {})) {
    map[slot] = Boolean(info?.configured);
  }
  serverKeysConfigured = map;
  if (body.chatTier === 'paid' || body.chatTier === 'free') serverChatTier = body.chatTier;
  notifyReadiness();
}

export function resetServerKeySnapshot(): void {
  serverKeysConfigured = null;
}

/** Does a configured key exist for this model's provider, per mode? */
export function isKeyConfiguredForModel(modelId: string): boolean {
  const provider = modelId.includes('/') || modelId.startsWith('openrouter') ? 'openrouter' : 'gemini';
  if (getWorkspaceMode() === 'vps') {
    if (!serverKeysConfigured) return true; // snapshot unknown — don't gate on guesses
    if (serverChatTier === 'paid') {
      return Boolean(
        serverKeysConfigured[provider === 'gemini' ? 'gemini-paid' : 'openrouter-paid']
      );
    }
    return Boolean(
      serverKeysConfigured[provider === 'gemini' ? 'gemini-free' : 'openrouter-free'] ||
        serverKeysConfigured[provider === 'gemini' ? 'gemini-paid' : 'openrouter-paid']
    );
  }
  // Local: the vault answers live.
  return resolveLaneKey('chat', modelId) !== null;
}

export interface SendReadiness {
  ok: boolean;
  reason: SendBlockReason | null;
}

/** The one pre-flight the composer asks before a send goes out. */
export function evaluateSendReadiness(modelId: string): SendReadiness {
  // Capture/fixture runs fake the stream (gateway/api fixtureChatStream): no
  // key, no vault, nothing to be ready FOR. A padlock here would be theater.
  if (isCaptureMode()) return { ok: true, reason: null };
  if (isVaultLocked()) return { ok: false, reason: 'vault-locked' };
  if (!isKeyConfiguredForModel(modelId)) return { ok: false, reason: 'no-key' };
  return { ok: true, reason: null };
}

// The vault lock is an INPUT to readiness — but useSyncExternalStore only
// re-renders when THIS store's version bumps, and that used to happen only on
// the 10s poll's settings fetch. Live 2026-10-30: unlocking the vault flipped
// the lock bus instantly while the amber send-padlock stayed several seconds.
// Subscribe: every lock flip (unlock popup, Model Settings, silent re-arm)
// re-evaluates readiness NOW.
subscribeVaultLock(() => notifyReadiness());