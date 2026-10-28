/**
 * Persistence for the unsent composer draft, keyed by thread.
 *
 * The send-queue drafts already survive a reload (draftQueue.ts) — this covers
 * the OTHER text: whatever is still sitting in the composer box, typed but not
 * sent. Closing the browser, killing the app on a phone, an OS refresh — the
 * text must still be there afterwards, per thread.
 *
 * Storage is mode-scoped (getScopedStorageKey): a draft typed in Local never
 * appears in a VPS workspace and the other way around. Writes are debounced
 * (every keystroke would thrash quota for pasted-long drafts) and flushed
 * synchronously when the page is hidden or unloaded — mobile browsers kill
 * pages without firing beforeunload, but visibility/pagehide do arrive.
 */
import { getScopedStorageKey } from '../services/workspaceSession';

const STORAGE_KEY = 'markbrain:composerDrafts';
const SAVE_DEBOUNCE_MS = 300;
const MAX_THREADS = 50;
const MAX_CHARS = 100_000;

export type ComposerDrafts = Record<string, string>;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Read the saved drafts back. Junk entries are dropped, not repaired:
 * a draft is user text, guessing at it would invent words the user wrote. */
export function loadComposerDrafts(): ComposerDrafts {
  try {
    const raw = storage()?.getItem(getScopedStorageKey(STORAGE_KEY));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const drafts: ComposerDrafts = {};
    for (const [threadId, text] of Object.entries(parsed)) {
      if (!threadId || typeof text !== 'string') continue;
      drafts[threadId] = text.slice(0, MAX_CHARS);
    }
    return drafts;
  } catch {
    return {};
  }
}

function write(drafts: ComposerDrafts): void {
  try {
    // Empty text = the send (or a manual clear) consumed the draft — the
    // entry's job is done. Object order is insertion order, so keeping the
    // last MAX_THREADS entries drops the oldest drafts, not the newest.
    const kept: ComposerDrafts = {};
    for (const [threadId, text] of Object.entries(drafts)) {
      if (typeof text === 'string' && text.length > 0) kept[threadId] = text.slice(0, MAX_CHARS);
    }
    const entries = Object.entries(kept);
    const trimmed = entries.length > MAX_THREADS ? entries.slice(-MAX_THREADS) : entries;
    if (trimmed.length === 0) {
      storage()?.removeItem(getScopedStorageKey(STORAGE_KEY));
    } else {
      storage()?.setItem(getScopedStorageKey(STORAGE_KEY), JSON.stringify(Object.fromEntries(trimmed)));
    }
  } catch {
    /* storage full/unavailable — the draft still lives in memory */
  }
}

let pending: ComposerDrafts | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced save — call on every draft change. */
export function scheduleComposerDraftSave(drafts: ComposerDrafts): void {
  pending = drafts;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (pending) {
      write(pending);
      pending = null;
    }
  }, SAVE_DEBOUNCE_MS);
}

/** Write any pending debounced state right now. Registered on pagehide and
 * visibilitychange→hidden, because a phone killing the page skips timers. */
export function flushComposerDraftSave(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending) {
    write(pending);
    pending = null;
  }
}

/** Install the flush hooks. Once per app, from a mount effect. */
export function registerComposerDraftFlush(): () => void {
  const onHide = () => {
    if (document.visibilityState === 'hidden') flushComposerDraftSave();
  };
  window.addEventListener('pagehide', flushComposerDraftSave);
  document.addEventListener('visibilitychange', onHide);
  return () => {
    window.removeEventListener('pagehide', flushComposerDraftSave);
    document.removeEventListener('visibilitychange', onHide);
  };
}