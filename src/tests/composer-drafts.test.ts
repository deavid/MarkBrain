/**
 * composerDrafts — persistence for the unsent composer text, keyed by thread.
 * The send-queue drafts have their own store; this is the text still sitting
 * in the box. Contract: mode-scoped storage, junk input degrades to empty
 * (never guessed at), empty text is consumed rather than stored, saves are
 * debounced and flush when the page hides.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  flushComposerDraftSave,
  loadComposerDrafts,
  registerComposerDraftFlush,
  scheduleComposerDraftSave,
} from '../application/composerDrafts';
import { getScopedStorageKey } from '../services/workspaceSession';

function stubWindow(seed: Record<string, string> = {}) {
  const storage = new Map(Object.entries(seed));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return storage;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loadComposerDrafts', () => {
  it('no storage → empty', () => {
    stubWindow();
    expect(loadComposerDrafts()).toEqual({});
  });

  it('junk shapes degrade to empty, string entries pass through', () => {
    const key = getScopedStorageKey('markbrain:composerDrafts');
    stubWindow({ [key]: 'not json at all' });
    expect(loadComposerDrafts()).toEqual({});
    stubWindow({ [key]: JSON.stringify([1, 2]) });
    expect(loadComposerDrafts()).toEqual({});
    stubWindow({ [key]: JSON.stringify({ T1: 'hello', bad: 42, '': 'no key' }) });
    expect(loadComposerDrafts()).toEqual({ T1: 'hello' });
  });
});

describe('save + load round trip', () => {
  it('debounced save persists; empty text is consumed, not stored', () => {
    const storage = stubWindow();
    scheduleComposerDraftSave({ T1: 'first idea' });
    expect(storage.has(getScopedStorageKey('markbrain:composerDrafts'))).toBe(false);
    vi.advanceTimersByTime(300);
    expect(loadComposerDrafts()).toEqual({ T1: 'first idea' });

    scheduleComposerDraftSave({ T1: '' });
    vi.advanceTimersByTime(300);
    expect(storage.has(getScopedStorageKey('markbrain:composerDrafts'))).toBe(false);
  });

  it('only the latest scheduled state is written, once', () => {
    const storage = stubWindow();
    scheduleComposerDraftSave({ T1: 'a' });
    scheduleComposerDraftSave({ T1: 'ab' });
    scheduleComposerDraftSave({ T1: 'abc' });
    vi.advanceTimersByTime(300);
    expect(loadComposerDrafts()).toEqual({ T1: 'abc' });
    expect(storage.get(getScopedStorageKey('markbrain:composerDrafts'))).toBe(JSON.stringify({ T1: 'abc' }));
  });

  it('flush writes pending state without waiting for the timer', () => {
    const storage = stubWindow();
    scheduleComposerDraftSave({ T1: 'typed' });
    flushComposerDraftSave();
    expect(loadComposerDrafts()).toEqual({ T1: 'typed' });
  });

  it('keeps at most the newest 50 threads', () => {
    stubWindow();
    const many: Record<string, string> = {};
    for (let i = 0; i < 60; i++) many[`T${i}`] = `text ${i}`;
    scheduleComposerDraftSave(many);
    vi.advanceTimersByTime(300);
    const loaded = loadComposerDrafts();
    expect(Object.keys(loaded)).toHaveLength(50);
    expect(loaded['T59']).toBe('text 59');
    expect(loaded['T0']).toBeUndefined();
  });
});

describe('registerComposerDraftFlush', () => {
  it('hooks pagehide and visibilitychange, and cleans up', () => {
    const w = stubWindow() as unknown as Map<string, string> & { window?: unknown };
    void w;
    const win = window as unknown as {
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
    };
    const doc = document as unknown as {
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
    };
    const cleanup = registerComposerDraftFlush();
    expect(win.addEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(doc.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    cleanup();
    expect(win.removeEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});