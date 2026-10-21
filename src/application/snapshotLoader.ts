/** The single project-content load path: boot, project switching, and new-workspace creation all hydrate through here. */
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
 * Loads the ACTIVE thread's content into the live domains, then opens the save gate.
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
  createCloudProject: (meta: NewWorkspaceMeta) => Promise<ProjectSnapshot>;
  workspace: IWorkspaceDomain;
}

/** Persists the project, registers it, hydrates genesis content, and opens the save gate. The caller updates `cloudProjectsCount`. */
export async function loadNewWorkspace(
  meta: NewWorkspaceMeta,
  deps: NewWorkspaceDeps
): Promise<void> {
  const { createCloudProject, workspace, threadRegistry, hydratedRef } = deps;
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