/**
 * Free-tier Firestore writes are metered against document size out of a small
 * daily quota (his console: "Free daily write units per project ... per day"),
 * so the two ways this app wasted them were bugs, not policy:
 *   1. a stale debounce id made flushPendingSave re-write the full document on
 *      every alt-tab even when nothing had changed;
 *   2. a save of content identical to what the server already holds.
 * Both are pinned here: duplicate content must cost zero writes, and a failed
 * write must NOT be remembered as saved (or the quota-limited content would
 * never be retried).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const saveMock = vi.fn();
vi.mock('../services/stores/firestoreStore', () => ({
  firestoreStore: {
    save: (...args: unknown[]) => saveMock(...args),
    load: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    replaceAll: vi.fn(),
  },
}));
vi.mock('../services/stores/localStore', () => ({
  localStore: {
    save: vi.fn(),
    load: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    replaceAll: vi.fn(),
  },
}));

import type { ProjectSnapshot } from '../services/stores/projectStore';

const baseSnap: Omit<ProjectSnapshot, 'projectId' | 'updatedAt'> = {
  turns: [{ id: 't1', role: 'user', content: 'hi', threadId: 'th1', timestamp: 1 }],
  chapters: [],
  artifacts: [],
  edges: [],
  threads: [],
  folders: [],
  activeThreadId: 'th1',
  name: 'P',
  codeName: 'P',
  description: '',
  color: '#000',
};

describe('a save of unchanged content costs nothing', () => {
  beforeEach(() => {
    saveMock.mockReset();
    saveMock.mockResolvedValue(undefined);
    vi.resetModules();
  });
  afterEach(() => vi.resetModules());

  const freshService = async () => {
    vi.resetModules();
    return await import('../services/persistenceService');
  };

  it('writes once, then skips identical payloads until the content moves', async () => {
    const { saveProjectSnapshot } = await freshService();
    await saveProjectSnapshot('p1', baseSnap);
    await saveProjectSnapshot('p1', baseSnap); // debounced echo / flush race
    await saveProjectSnapshot('p1', baseSnap);
    expect(saveMock).toHaveBeenCalledTimes(1);

    const next = { ...baseSnap, activeThreadId: 'th2' };
    await saveProjectSnapshot('p1', next);
    expect(saveMock).toHaveBeenCalledTimes(2);

    // a different project has its own fingerprint
    await saveProjectSnapshot('p2', baseSnap);
    expect(saveMock).toHaveBeenCalledTimes(3);
  });

  it('does not remember a failed write as saved (quota must retry later)', async () => {
    const { saveProjectSnapshot } = await freshService();
    const quota = Object.assign(new Error('Quota limit exceeded'), {
      code: 'resource-exhausted',
    });
    saveMock.mockRejectedValueOnce(quota);
    const snap = { ...baseSnap, activeThreadId: 'th-fail' };
    await expect(saveProjectSnapshot('p-fail', snap)).rejects.toThrow('Quota limit exceeded');
    expect(saveMock).toHaveBeenCalledTimes(1);

    saveMock.mockResolvedValue(undefined);
    await saveProjectSnapshot('p-fail', snap); // same content: must write again
    expect(saveMock).toHaveBeenCalledTimes(2);
    await saveProjectSnapshot('p-fail', snap); // now remembered
    expect(saveMock).toHaveBeenCalledTimes(2);
  });
});

describe('the flush only fires when a save is genuinely pending', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('a fired debounce leaves nothing pending, so pagehide writes nothing', async () => {
    vi.useFakeTimers();
    const addEventListener = vi.fn();
    vi.stubGlobal('window', { addEventListener, removeEventListener: vi.fn() });
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener,
      removeEventListener: vi.fn(),
    });

    const { attachPersistWorker } = await import('../application/persistWorker');
    const listeners: Record<string, (e?: unknown) => void> = {};
    addEventListener.mockImplementation((type: string, fn: () => void) => {
      listeners[type] = fn;
    });

    const mutations: Array<() => void> = [];
    const domain = {
      subscribe: (fn: () => void) => {
        mutations.push(fn);
        return () => {};
      },
    };
    const persistState = vi.fn();
    attachPersistWorker({
      timeline: domain as never,
      segmentation: domain as never,
      artifacts: domain as never,
      graph: domain as never,
      threadRegistry: domain as never,
      persistState,
    });

    // change → debounce fires → one save, timer cleared
    mutations[0]();
    vi.advanceTimersByTime(500);
    expect(persistState).toHaveBeenCalledTimes(1);

    // THE BUG: a stale timer id made this path save on every tab switch
    listeners['visibilitychange']?.();
    listeners['pagehide']?.();
    expect(persistState).toHaveBeenCalledTimes(1);

    // a change inside the debounce window still flushes on hide, exactly once
    mutations[1]();
    vi.advanceTimersByTime(200);
    (document as { visibilityState: string }).visibilityState = 'hidden';
    listeners['visibilitychange']?.();
    expect(persistState).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000); // the cleared timer must not fire later
    expect(persistState).toHaveBeenCalledTimes(2);
  });
});
