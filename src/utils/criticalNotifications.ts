/**
 * Critical notifications — the one channel from "the app failed badly" to "the
 * user sees it".
 *
 * The problem it exists for: a cloud save that never landed, or a load that
 * came back empty, used to be visible only in the console. The session looked
 * fine, so nobody noticed until the data was gone. These are exactly the
 * failures the instrumentation law calls `error` — user-visible failure, data
 * loss risk — except "visible" used to mean "in DevTools".
 *
 * Deliberately framework-free, like `logger`: the application layer reports
 * (persistWorker on a failed save, snapshotLoader on a failed load), the UI
 * renders (`ui/system/CriticalNotifications.tsx`), and neither imports the
 * other. One sentence per notice, no error specifics — those stay in the
 * console. `notifyCritical` is a no-op for anything short of a failure that
 * impairs the session; a warning that recovers is a `logger.warn`, not this.
 */

export interface CriticalNotice {
  id: number;
  /** One human sentence: what failed, in the user's terms. Never a stack. */
  message: string;
  /** When it (re)appeared — a repeat refreshes the clock instead of stacking. */
  at: number;
}

/** Long enough to read a sentence, short enough not to become furniture. */
export const NOTICE_TTL_MS = 12_000;

/** Beyond this, older notices retire early: a wall of banners is its own noise. */
const MAX_VISIBLE = 3;

let notices: CriticalNotice[] = [];
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let seq = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function clearTimer(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

/** Ephemeral by construction: every notice dies on its own TTL, no dismissal required. */
function scheduleExpiry(id: number): void {
  clearTimer(id);
  timers.set(
    id,
    setTimeout(() => dismissCritical(id), NOTICE_TTL_MS)
  );
}

export function notifyCritical(message: string): void {
  const clean = message.trim();
  if (!clean) return;

  // The same failure repeats on every retry (a save that keeps failing fires on
  // each mutation): refresh that banner's clock rather than stacking twins.
  const existing = notices.find((n) => n.message === clean);
  if (existing) {
    notices = notices.map((n) => (n.id === existing.id ? { ...n, at: Date.now() } : n));
    scheduleExpiry(existing.id);
    emit();
    return;
  }

  const notice: CriticalNotice = { id: ++seq, message: clean, at: Date.now() };
  notices = [...notices, notice];
  if (notices.length > MAX_VISIBLE) {
    const dropped = notices.slice(0, notices.length - MAX_VISIBLE);
    dropped.forEach((n) => clearTimer(n.id));
    notices = notices.slice(notices.length - MAX_VISIBLE);
  }
  scheduleExpiry(notice.id);
  emit();
}

export function dismissCritical(id: number): void {
  const next = notices.filter((n) => n.id !== id);
  if (next.length === notices.length) return;
  clearTimer(id);
  notices = next;
  emit();
}

/** Snapshot for `useSyncExternalStore` — stable identity until something changes. */
export function getCriticalNotices(): CriticalNotice[] {
  return notices;
}

export function subscribeCriticalNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test/teardown hook: forget every notice and every pending timer. */
export function resetCriticalNotices(): void {
  for (const id of timers.keys()) clearTimer(id);
  notices = [];
  emit();
}
