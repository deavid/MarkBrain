/**
 * Live bug 2026-10-30 (VPS mode): deleting artifacts in the Cleanup modal
 * ("Delete permanently") does NOT delete them on the server — the row
 * survives the upsert-only snapshot save and RESURRECTS on refresh.
 *
 * The 2026-10-26 fix covered the import-triage delete path (it queues
 * queueServerMutation explicitly). But purgeArtifactEverywhere only queues
 * the server delete `if (deps.workspace)` — and every UI call site
 * (createCleanupHandlers.applyPlan, createArtifactHandlers.scrubReferencesTo)
 * omits workspace, so the guard silently no-ops. The delete is local-only;
 * a refresh pulls the still-alive server row back.
 *
 * Seam under test (the real pipeline handoff, not the purge in isolation):
 * the CleanupModal handlers wired the way App.tsx wires them — workspace
 * included — in VPS mode. applyPlan must queue a deleteArtifact mutation
 * so the server row dies and a tombstone rides the delta. The queue itself
 * is already covered by delete-resurrection.test.ts; this file pins the
 * wiring the bug lived in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/workspaceSession', () => ({ getWorkspaceMode: () => 'vps' }));
vi.mock('../../src/services/persistenceService', () => ({ isCaptureMode: () => false }));
vi.mock('../../src/gateway/api', () => ({
  apiFetch: async () => ({ ok: true, status: 200 } as Response),
}));

import type { IWorkspaceDomain } from '../domains/00-workspace';
import { ArtifactDocumentDomain } from '../domains/01-artifact-document';
import { ArtifactVersioningDomain } from '../domains/01-artifact-versioning';
import { TopologicalGraphDomain } from '../domains/02-topological-graph';
import { ThreadRegistry } from '../domains/06-chat-threads';
import { createCleanupHandlers } from '../ui/cleanup/createCleanupHandlers';
import { purgeArtifact } from '../application/purgeArtifactEverywhere';
import { pendingMutationCount } from '../application/serverMutationQueue';
import type { CleanupPlan } from '../application/cleanupPlan';

const PROJECT_ID = 'proj-cleanup-vps';
const QUEUE_KEY = 'markbrain-pending-mutations:v1';

// Node env has no localStorage — the queue falls back to an in-memory store.
// Shimming it gives every test a clean, inspectable queue (refresh simulation).
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

function queuedOps(projectId: string): Array<Record<string, unknown>> {
  const raw = JSON.parse(store.get(QUEUE_KEY) ?? '[]') as Array<{ projectId: string }>;
  return raw.filter((m) => m.projectId === projectId);
}

function buildWorld() {
  const artifactsDomain = new ArtifactDocumentDomain(PROJECT_ID);
  const versioning = new ArtifactVersioningDomain();
  const graph = new TopologicalGraphDomain();
  const threadRegistry = new ThreadRegistry();
  const workspace = { getActiveProjectId: () => PROJECT_ID } as unknown as IWorkspaceDomain;
  return { artifactsDomain, versioning, graph, threadRegistry, workspace };
}

const emptyPlan: CleanupPlan = {
  threadsToDelete: [],
  artifactsToDelete: [],
  cascadeThreads: [],
  detach: [],
  skipped: [],
};

beforeEach(() => {
  store.clear();
});

describe('artifact delete reaches the VPS — cleanup modal seam', () => {
  it('applyPlan queues the explicit deleteArtifact mutation in VPS mode', () => {
    const { artifactsDomain, versioning, graph, threadRegistry, workspace } = buildWorld();
    artifactsDomain.upsertArtifact({ id: 'a1', title: 'Doomed', workspaceId: PROJECT_ID, code: 'a1', type: 'document', category: 'note' } as any);

    const handlers = createCleanupHandlers({
      artifactsDomain,
      versioning,
      graph,
      threadRegistry,
      workspace,
      deleteThread: () => {},
      triggerReRender: () => {},
      onArtifactPurged: () => {},
    });

    handlers.applyPlan({ ...emptyPlan, artifactsToDelete: ['a1'] });

    // Local delete happened (pre-existing cascade law)...
    expect(artifactsDomain.getArtifact('a1')).toBeNull();
    // ...and the server delete was queued — this is the RED assertion: before
    // the fix applyPlan never queued anything, so the row resurrected on refresh.
    expect(pendingMutationCount(PROJECT_ID)).toBe(1);
    expect(queuedOps(PROJECT_ID)).toContainEqual({ op: 'deleteArtifact', artifactId: 'a1', projectId: PROJECT_ID });
  });

  it('purgeArtifact queues the server delete whenever a workspace is present (contract pin)', () => {
    const { artifactsDomain, versioning, graph, threadRegistry, workspace } = buildWorld();
    artifactsDomain.upsertArtifact({ id: 'a2', title: 'Doomed', workspaceId: PROJECT_ID, code: 'a2', type: 'document', category: 'note' } as any);

    purgeArtifact({ artifactsDomain, versioning, graph, threadRegistry, workspace }, 'a2');

    expect(pendingMutationCount(PROJECT_ID)).toBe(1);
    expect(queuedOps(PROJECT_ID)).toContainEqual({ op: 'deleteArtifact', artifactId: 'a2', projectId: PROJECT_ID });
  });
});
