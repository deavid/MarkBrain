/**
 * It broadcasts "pull the server state NOW" to whoever listens — the delta
 * poller answers by running its pull immediately instead of waiting for the
 * next 10s tick or a real window focus.
 *
 * Replaces the two hidden couplings this used to travel by (tech-debt audit,
 * Phase 1.4): a fake `window.dispatchEvent(new Event('focus'))` fired from the
 * send queue, and the untyped string event `markbrain:sync-now`. Same
 * behavior, visible contract: unlock / password change / job completion call
 * `requestSyncNow()`, `useVpsDeltaSync` subscribes.
 */
type SyncNowListener = () => void;

const listeners = new Set<SyncNowListener>();

/** Subscribe to "sync now" requests. Returns the unsubscribe function. */
export function subscribeSyncNow(cb: SyncNowListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Fire a "sync now" request — the delta poller pulls immediately. */
export function requestSyncNow(): void {
  listeners.forEach((l) => l());
}
