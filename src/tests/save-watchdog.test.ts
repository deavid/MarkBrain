/**
 * The write-acknowledgement watchdog, pinned at the facade.
 *
 * This is the bug David hit live: with the free Firestore write quota gone,
 * `setDoc` never settles — the client retries with a backoff cap forever — so
 * the `catch` in persistWorker never ran, no notification appeared, and the app
 * cheerfully went on pretending to save. A `Promise.race` with a deadline is
 * what turns "stuck" into "failed".
 *
 * Both directions are pinned: a save that never settles, and a load that never
 * settles (a stuck read would otherwise spin on the boot loader with the save
 * gate shut).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const saveMock = vi.fn();
const loadMock = vi.fn();
vi.mock('../services/stores/firestoreStore', () => ({
  firestoreStore: {
    save: (...args: unknown[]) => saveMock(...args),
    load: (...args: unknown[]) => loadMock(...args),
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
  turns: [],
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

const HANG: () => Promise<never> = () => new Promise<never>(() => {});

describe('a stuck write fails instead of hanging forever', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveMock.mockReset();
    loadMock.mockReset();
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('the save rejects once the acknowledgement deadline passes', async () => {
    saveMock.mockImplementation(HANG);
    const { saveProjectSnapshot, SAVE_ACK_DEADLINE_MS } = await import(
      '../services/persistenceService'
    );
    expect(SAVE_ACK_DEADLINE_MS).toBe(15_000);

    const pending = saveProjectSnapshot('p-stuck', baseSnap);
    const assertion = expect(pending).rejects.toThrow(/save of p-stuck did not settle within 15000ms/);
    await vi.advanceTimersByTimeAsync(SAVE_ACK_DEADLINE_MS + 1);
    await assertion;
  });

  it('a stuck write is never remembered as saved, so it retries', async () => {
    saveMock.mockImplementation(HANG);
    const { saveProjectSnapshot, SAVE_ACK_DEADLINE_MS } = await import(
      '../services/persistenceService'
    );
    const first = saveProjectSnapshot('p-retry', baseSnap);
    const assertion = expect(first).rejects.toThrow(/did not settle/);
    await vi.advanceTimersByTimeAsync(SAVE_ACK_DEADLINE_MS + 1);
    await assertion;

    // The backend recovers: the SAME content must be written again (the
    // fingerprint was never set while the write was stuck).
    saveMock.mockReset();
    saveMock.mockResolvedValue(undefined);
    await saveProjectSnapshot('p-retry', baseSnap);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('a stuck read fails too, so boot cannot spin forever', async () => {
    loadMock.mockImplementation(HANG);
    const { loadProjectSnapshot, LOAD_DEADLINE_MS } = await import(
      '../services/persistenceService'
    );
    const pending = loadProjectSnapshot('p-stuck');
    const assertion = expect(pending).rejects.toThrow(/load of p-stuck did not settle/);
    await vi.advanceTimersByTimeAsync(LOAD_DEADLINE_MS + 1);
    await assertion;
  });

  it('a fast save is untouched by the deadline', async () => {
    saveMock.mockResolvedValue(undefined);
    const { saveProjectSnapshot } = await import('../services/persistenceService');
    await saveProjectSnapshot('p-fast', baseSnap);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
