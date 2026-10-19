/**
 * H1 regression suite — load failure must NOT equal project absence.
 *
 * State machine under test:
 *   - REJECTED load (network/permission/no-session) → NO hydration, the
 *     hydratedRef save gate stays CLOSED, one ERROR is logged.
 *   - RESOLVED null (confirmed absence) → fresh/empty hydrate, gate OPENS.
 *   - RESOLVED snapshot → normal hydrate, gate opens.
 * Plus the firestoreStore contract: null ONLY when the doc is confirmed
 * missing; no session / fetch error / permission-denied all THROW.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable auth + getDoc controls shared with the module mocks (vi.mock is
// hoisted above imports, so state must come from vi.hoisted).
const fb = vi.hoisted(() => ({
  currentUser: null as { uid: string; email: string | null } | null,
  handleFirestoreError: vi.fn(),
}));
const fs = vi.hoisted(() => ({ getDoc: vi.fn() }));

vi.mock('../services/firebase', () => ({
  db: {},
  auth: fb,
  handleFirestoreError: fb.handleFirestoreError,
  OperationType: { GET: 'GET', WRITE: 'WRITE' },
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: fs.getDoc,
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  collection: vi.fn(),
}));

import { loadProjectSnapshotIntoDomains } from '../application/snapshotLoader';
import { firestoreStore } from '../services/stores/firestoreStore';
import { logger } from '../utils/logger';
import type { ProjectSnapshot } from '../services/stores/projectStore';

/** Flush the loader's fire-and-forget IIFE (resolved-promise chain + macrotask). */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const makeDeps = (loadProjectSnapshot: (id: string) => Promise<ProjectSnapshot | null>) =>
  ({
    activeProjectId: 'proj-1',
    loadProjectSnapshot,
    threadRegistry: { hydrate: vi.fn(() => ({ turns: [], chapters: [] })) },
    timeline: { loadTurns: vi.fn() },
    segmentation: { loadChapters: vi.fn() },
    artifacts: { loadArtifacts: vi.fn() },
    graph: { loadEdges: vi.fn() },
    hydratedRef: { current: false },
  }) as any;

const snap = (id: string): ProjectSnapshot => ({
  projectId: id,
  turns: [],
  chapters: [],
  artifacts: [],
  edges: [],
  updatedAt: 1,
});

describe('loadProjectSnapshotIntoDomains — error vs absent', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('REJECTED load: does NOT hydrate, gate stays closed, logs ERROR', async () => {
    const deps = makeDeps(() => Promise.reject(new Error('network blip')));
    loadProjectSnapshotIntoDomains(deps);
    await flush();

    expect(deps.hydratedRef.current).toBe(false); // save gate closed
    expect(deps.threadRegistry.hydrate).not.toHaveBeenCalled(); // no empty hydrate
    expect(deps.timeline.loadTurns).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[1])).toContain('Snapshot load failed');
  });

  it('RESOLVED null (confirmed absence): fresh hydrates and opens the gate', async () => {
    const deps = makeDeps(() => Promise.resolve(null));
    loadProjectSnapshotIntoDomains(deps);
    await flush();

    expect(deps.hydratedRef.current).toBe(true); // genuinely-new project → gate open
    expect(deps.threadRegistry.hydrate).toHaveBeenCalledTimes(1);
    expect(deps.timeline.loadTurns).toHaveBeenCalledWith([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('RESOLVED snapshot: hydrates the data and opens the gate (baseline)', async () => {
    const project = snap('proj-1');
    const deps = makeDeps(() => Promise.resolve(project));
    loadProjectSnapshotIntoDomains(deps);
    await flush();

    expect(deps.hydratedRef.current).toBe(true);
    expect(deps.threadRegistry.hydrate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1' })
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('firestoreStore.load — null means confirmed absence only', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    fb.handleFirestoreError.mockClear();
    fs.getDoc.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fb.currentUser = null;
  });

  it('no active session → THROWS (not null)', async () => {
    fb.currentUser = null;
    await expect(firestoreStore.load('p1')).rejects.toThrow(/no active Google session/);
  });

  it('doc does not exist → null (confirmed absence)', async () => {
    fb.currentUser = { uid: 'u1', email: 'a@b.c' };
    fs.getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(firestoreStore.load('p1')).resolves.toBeNull();
    expect(fb.handleFirestoreError).not.toHaveBeenCalled();
  });

  it('doc exists → returns the snapshot', async () => {
    fb.currentUser = { uid: 'u1', email: 'a@b.c' };
    const doc = snap('p1');
    fs.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => doc });
    await expect(firestoreStore.load('p1')).resolves.toEqual(doc);
  });

  it('fetch failure → rethrows, never collapses to null', async () => {
    fb.currentUser = { uid: 'u1', email: 'a@b.c' };
    fs.getDoc.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    await expect(firestoreStore.load('p1')).rejects.toThrow('unavailable');
    expect(fb.handleFirestoreError).not.toHaveBeenCalled();
  });

  it('permission-denied → handleFirestoreError fires AND load still throws', async () => {
    fb.currentUser = { uid: 'u1', email: 'a@b.c' };
    const err = Object.assign(new Error('denied'), { code: 'permission-denied' });
    fs.getDoc.mockRejectedValueOnce(err);
    await expect(firestoreStore.load('p1')).rejects.toBe(err);
    expect(fb.handleFirestoreError).toHaveBeenCalledWith(
      err,
      'GET',
      'users/u1/projects/p1'
    );
    expect(errorSpy).not.toHaveBeenCalled(); // store logs warn; ERROR belongs to the loader
  });
});