/**
 * Package 1 (design-docs/28 §1.9) — persistent 4-layer revisions.
 *
 * 1. recordSnapshot + getHistory + rollback round-trip restores the full
 *    title + all 4 layers (including empty/missing layers).
 * 2. loadHistory / getAllRevisions round-trip preserves data (merge never
 *    wipes, versions dedupe).
 * 3. Persistence integration: hydrateProjectFromSnapshot feeds snap.revisions
 *    into the versioning domain; persistProjectSnapshot's payload carries
 *    versioning.getAllRevisions() back out — an F5 keeps the History tab.
 *
 * Pure Node, no happy-dom/jsdom, no network.
 */
import { describe, it, expect, vi } from 'vitest';
import { ArtifactVersioningDomain } from '../domains/01-artifact-versioning/ArtifactVersioningDomain';
import type { ArtifactRevision } from '../domains/01-artifact-versioning/types';
import { hydrateProjectFromSnapshot } from '../application/snapshotLoader';
import { persistProjectSnapshot } from '../application/persistWorker';
import type { ProjectSnapshot } from '../services/stores/projectStore';

function rev(partial: Partial<ArtifactRevision> & { version: number }): ArtifactRevision {
  return {
    timestamp: 1000 + partial.version,
    actor: 'user',
    changeSummary: `rev ${partial.version}`,
    title: `Title v${partial.version}`,
    layers: { subtitle: '', description: '', summary: '', body: `body v${partial.version}` },
    ...partial,
  };
}

describe('ArtifactVersioningDomain — snapshot revisions', () => {
  it('recordSnapshot → getHistory keeps the full title + all 4 layers, empties included', () => {
    const domain = new ArtifactVersioningDomain();
    domain.recordSnapshot('art-1', {
      actor: 'user',
      changeSummary: 'Created note',
      title: 'My Note',
      layers: { subtitle: '', description: '', summary: '', body: 'first body' },
    });
    const history = domain.getHistory('art-1');
    expect(history).toHaveLength(1);
    expect(history[0].version).toBe(1);
    expect(history[0].title).toBe('My Note');
    expect(history[0].layers).toEqual({
      subtitle: '',
      description: '',
      summary: '',
      body: 'first body',
    });
  });

  it('rollback restores the target revision and records the discarded state as a new one (append-only)', () => {
    const domain = new ArtifactVersioningDomain();
    domain.recordSnapshot('art-1', {
      actor: 'ai',
      changeSummary: 'birth',
      title: 'Original',
      layers: { subtitle: 'sub', description: 'desc', summary: 'summ', body: 'v1 body' },
    });
    domain.recordSnapshot('art-1', {
      actor: 'user',
      changeSummary: 'Manual edit',
      title: 'Renamed',
      layers: { subtitle: '', description: '', summary: '', body: 'v2 body' },
    });

    const target = domain.rollback('art-1', 1, {
      title: 'Renamed',
      layers: { subtitle: '', description: '', summary: '', body: 'v2 body' },
    });
    // The caller restores THIS revision's full state (title + all 4 layers).
    expect(target.title).toBe('Original');
    expect(target.layers).toEqual({ subtitle: 'sub', description: 'desc', summary: 'summ', body: 'v1 body' });

    const history = domain.getHistory('art-1');
    // Append-only: the revert itself is undoable — a new revision snapshots
    // what was discarded, version numbers never reset.
    expect(history).toHaveLength(3);
    expect(history[2].version).toBe(3);
    expect(history[2].actor).toBe('user');
    expect(history[2].changeSummary).toBe('Revert to v1');
    expect(history[2].title).toBe('Renamed');
    expect(history[2].layers.body).toBe('v2 body');
  });

  it('rollback throws on an unknown version', () => {
    const domain = new ArtifactVersioningDomain();
    expect(() => domain.rollback('nope', 7)).toThrow();
  });

  it('legacy recordRevision(content) lands as a body-only snapshot and keeps legacy fields', () => {
    const domain = new ArtifactVersioningDomain();
    domain.recordRevision('art-legacy', 'old body', 'old summary');
    domain.recordRevision('art-legacy', 'new body', 'new summary');
    const history = domain.getHistory('art-legacy');
    expect(history).toHaveLength(2);
    expect(history[1].layers).toEqual({
      subtitle: '',
      description: '',
      summary: '',
      body: 'new body',
    });
    expect(history[1].previousContent).toBe('old body');
    // Versions never restart, even in the legacy shape.
    expect(history.map((r) => r.version)).toEqual([1, 2]);
  });
});

describe('loadHistory / getAllRevisions round-trip', () => {
  it('loaded revisions come back through getAllRevisions, deduped by version, merged not wiped', () => {
    const domain = new ArtifactVersioningDomain();
    domain.loadHistory({
      'art-1': [rev({ version: 1 }), rev({ version: 2 })],
      'art-2': [rev({ version: 1, actor: 'ai', changeSummary: 'Created from chat' })],
    });
    const all = domain.getAllRevisions();
    expect(Object.keys(all).sort()).toEqual(['art-1', 'art-2']);
    expect(all['art-1']).toHaveLength(2);
    expect(all['art-2'][0].changeSummary).toBe('Created from chat');

    // Re-hydrate (poll / reload) with an overlapping row → no duplicates.
    domain.loadHistory({ 'art-1': [rev({ version: 2 })] });
    expect(domain.getHistory('art-1')).toHaveLength(2);

    // An empty/missing incoming list never wipes existing history.
    domain.loadHistory({ 'art-1': [], 'art-3': [rev({ version: 1 })] });
    expect(domain.getHistory('art-1')).toHaveLength(2);
    expect(domain.getHistory('art-3')).toHaveLength(1);
  });
});

describe('persistence integration — revisions ride the snapshot', () => {
  it('hydrateProjectFromSnapshot loads snap.revisions into the versioning domain', () => {
    const versioning = new ArtifactVersioningDomain();
    const snap = {
      projectId: 'proj-1',
      revisions: {
        'art-1': [rev({ version: 1 }), rev({ version: 2, actor: 'ai' })],
      },
    } as unknown as ProjectSnapshot;
    hydrateProjectFromSnapshot('proj-1', snap, {
      threadRegistry: {
        hydrate: vi.fn(() => ({ chapters: [], threads: [], folders: [], turns: [], activeThreadId: null })),
      } as never,
      timeline: { loadTurns: vi.fn() } as never,
      segmentation: { loadChapters: vi.fn() } as never,
      artifacts: { loadArtifacts: vi.fn() } as never,
      graph: { loadEdges: vi.fn() } as never,
      versioning,
      hydratedRef: { current: false },
    });
    const history = versioning.getHistory('art-1');
    expect(history.map((r) => r.version)).toEqual([1, 2]);
    expect(history[1].actor).toBe('ai');
  });

  it('persistProjectSnapshot payload includes versioning.getAllRevisions()', async () => {
    const versioning = new ArtifactVersioningDomain();
    versioning.recordSnapshot('art-1', {
      actor: 'user',
      changeSummary: 'Created note',
      title: 'T',
      layers: { subtitle: '', description: '', summary: '', body: 'b' },
    });
    const saveProjectSnapshot = vi.fn().mockResolvedValue(undefined);
    await persistProjectSnapshot({
      workspace: {
        getActiveProjectId: () => 'proj-1',
        getProject: () => ({ metadata: { name: 'P', codeName: 'p', description: '', color: '#000' } }),
      } as never,
      timeline: { getTurns: () => [] } as never,
      segmentation: { listChapters: () => [] } as never,
      artifacts: { listArtifacts: () => [] } as never,
      graph: { listEdges: () => [] } as never,
      versioning,
      threadRegistry: {
        compose: () => ({ turns: [], chapters: [], threads: [], folders: [], activeThreadId: null }),
      } as never,
      hydratedRef: { current: true },
      saveProjectSnapshot,
      isCaptureMode: () => false,
    });
    expect(saveProjectSnapshot).toHaveBeenCalledTimes(1);
    const payload = saveProjectSnapshot.mock.calls[0][1] as ProjectSnapshot;
    expect(payload.revisions).toBeDefined();
    expect(payload.revisions!['art-1']).toHaveLength(1);
    expect(payload.revisions!['art-1'][0].layers.body).toBe('b');
  });
});
