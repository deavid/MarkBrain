/**
 * H1 regression suite — load failure must NOT equal project absence.
 *
 * State machine under test:
 *   - REJECTED load (network/permission/no-session) → NO hydration, the
 *     hydratedRef save gate stays CLOSED, one ERROR is logged.
 *   - RESOLVED null (confirmed absence) → fresh/empty hydrate, gate OPENS.
 *   - RESOLVED snapshot → normal hydrate, gate opens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { loadProjectSnapshotIntoDomains } from '../application/snapshotLoader';
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
