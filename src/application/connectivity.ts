/**
 * Is the device online? The PWA's own signal: `navigator.onLine` plus the
 * `online`/`offline` events the browser fires when it changes.
 *
 * Honest limits: `onLine` means "has a network interface", not "the server
 * answers" — captive portals and dead DNS read as online. That is fine here:
 * its job is the coarse switch (queue sends, dim network features), and a
 * false positive just falls back to the normal failure path (the draft fails
 * and can be retried). A false negative never happens while the interface is
 * up, which is the direction we care about.
 *
 * Snapshot + subscribe, same shape the vault lock and TTS transport use, so
 * components read it with useSyncExternalStore and re-render on the flip.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let installed = false;

function readOnLine(): boolean {
  try {
    // Coerced: `undefined` (no such API — node, old engines) means ONLINE.
    // Only an explicit false is offline.
    return typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  } catch {
    return true;
  }
}

let online = readOnLine();

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('online', () => {
    online = true;
    for (const fn of listeners) fn();
  });
  window.addEventListener('offline', () => {
    online = false;
    for (const fn of listeners) fn();
  });
}

/** Current connectivity snapshot. Safe to call anywhere, always returns a
 * boolean (SSR / no window counts as online — nothing to gate there). */
export function isOnline(): boolean {
  return online;
}

/** Subscribe to flips. Installs the browser listeners on first subscriber. */
export function subscribeOnline(fn: Listener): () => void {
  install();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam: force the snapshot and notify subscribers. */
export function setOnlineForTests(value: boolean): void {
  online = value;
  for (const fn of listeners) fn();
}