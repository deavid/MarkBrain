/**
 * Snapshot loader — project snapshot hydration.
 *
 * Two entry points, one hydration body (extracted verbatim from
 * DomainRegistry.tsx — mechanical split, ZERO behavior change):
 *   - `loadProjectSnapshotIntoDomains` — the single content load path:
 *     boot and project switching both come through here (the active project
 *     or its fresh domain instances changed → fetch snapshot → hydrate).
 *     Replaces the old chain of localStorage sync-read → static seed →
 *     cloud overlay.
 *   - `loadNewWorkspace` — create-workspace data load (create on the active
 *     backend, register it, hydrate its genesis content).
 *
 * Thread hydration rides along: the registry partitions snapshot
 * turns/chapters by threadId (backfilling legacy snapshots with a default
 * "Main" thread) and returns only the ACTIVE thread's content for the live
 * domains. All dependencies arrive via parameters so this is unit-testable;
 * DomainRegistry stays the composition root that injects them.
 */
import type { IWorkspaceDomain } from '../domains/00-workspace';
import type { IDialogueTimelineDomain } from '../domains/01-dialogue-timeline';
import type { IArtifactDocumentDomain } from '../domains/01-artifact-document';
import type { IChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import type { ITopologicalGraphDomain } from '../domains/02-topological-graph';
import type { ThreadRegistry } from '../domains/06-chat-threads';
import type { ProjectSnapshot } from '../services/stores/projectStore';
import type { HydratedRef } from './persistWorker';
import { logger } from '../utils/logger';

/** Live domains + thread registry + the hydration gate flag. */
export interface HydrationDeps {
  threadRegistry: ThreadRegistry;
  timeline: IDialogueTimelineDomain;
  segmentation: IChapterSegmentationDomain;
  artifacts: IArtifactDocumentDomain;
  graph: ITopologicalGraphDomain;
  hydratedRef: HydratedRef;
}

/**
 * Shared hydration body: partition the snapshot by thread, load the ACTIVE
 * thread's content into the live domains, then open the save gate.
 */
export function hydrateProjectFromSnapshot(
  projectId: string,
  snap: ProjectSnapshot | null | undefined,
  deps: HydrationDeps
): void {
  const { threadRegistry, timeline, segmentation, artifacts, graph, hydratedRef } = deps;
  const activeContent = threadRegistry.hydrate({
    projectId,
    threads: snap?.threads as any,
    folders: snap?.folders as any,
    turns: (snap?.turns as any) || [],
    chapters: (snap?.chapters as any) || [],
    activeThreadId: snap?.activeThreadId,
  });
  timeline.loadTurns(activeContent.turns);
  segmentation.loadChapters(activeContent.chapters);
  artifacts.loadArtifacts(snap?.artifacts || []);
  graph.loadEdges(snap?.edges || []);
  hydratedRef.current = true;
}

export interface ProjectLoadDeps extends HydrationDeps {
  activeProjectId: string;
  loadProjectSnapshot: (projectId: string) => Promise<ProjectSnapshot | null>;
}

/**
 * Async runner for the snapshot-load effect: fetch → hydrate, with a stale
 * guard for project switches mid-flight. Two distinct outcomes:
 *   - RESOLVED (incl. null = confirmed absence) → hydrate normally; null
 *     takes the fresh/empty path and the save gate opens (correct for a
 *     genuinely-new project).
 *   - REJECTED (failure — network, permission, no session) → ONE error log,
 *     NO hydration, hydratedRef stays false: domains sit empty with saves
 *     blocked. Hydrating from null here would open the gate and let the
 *     first user action merge-save empty arrays over the real snapshot.
 * Returns the effect cleanup (marks the run stale).
 */
export function loadProjectSnapshotIntoDomains(deps: ProjectLoadDeps): () => void {
  const { activeProjectId, loadProjectSnapshot, ...hydration } = deps;
  let stale = false;
  (async () => {
    try {
      const snap = await loadProjectSnapshot(activeProjectId);
      if (stale) return;
      hydrateProjectFromSnapshot(activeProjectId, snap, hydration);
    } catch (err) {
      // Load failure ≠ project absence: do NOT hydrate, do NOT open the gate.
      logger.error(
        'DomainRegistry',
        `Snapshot load failed for ${activeProjectId} — domains stay empty, saves blocked until a successful load`,
        err
      );
    }
  })();
  return () => {
    stale = true;
  };
}

export interface NewWorkspaceMeta {
  id: string;
  name: string;
  codeName: string;
  description: string;
  color: string;
}

export interface NewWorkspaceDeps extends HydrationDeps {
  /** persistenceService.createCloudProject — resolves identity per branch. */
  createCloudProject: (meta: NewWorkspaceMeta) => Promise<ProjectSnapshot>;
  workspace: IWorkspaceDomain;
}

/**
 * Create-workspace data load: persist the new project on the ACTIVE backend,
 * register it in the workspace (replaces the registry — count becomes 1),
 * hydrate its genesis content, open the save gate. The caller updates
 * `cloudProjectsCount` afterwards.
 */
export async function loadNewWorkspace(
  meta: NewWorkspaceMeta,
  deps: NewWorkspaceDeps
): Promise<void> {
  const { createCloudProject, workspace, threadRegistry, hydratedRef } = deps;
  // Backend-agnostic: persistenceService resolves identity per branch
  // (firestore requires a signed-in user; local needs none) and throws
  // a clear error when it can't proceed.
  const snap = await createCloudProject(meta);
  workspace.loadUserProjects([snap]);
  hydrateProjectFromSnapshot(meta.id, snap, {
    threadRegistry,
    timeline: deps.timeline,
    segmentation: deps.segmentation,
    artifacts: deps.artifacts,
    graph: deps.graph,
    hydratedRef,
  });
}