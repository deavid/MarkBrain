/**
 * Persistence worker — debounced snapshot save on domain mutations, plus a
 * flush when the tab hides/dies (pagehide / visibilitychange) so reloading
 * within the 500ms window never loses the last mutation.
 *
 * Extracted verbatim from DomainRegistry.tsx (mechanical split — ZERO
 * behavior change, ZERO change to the registry's public API). All
 * dependencies arrive via parameters so the worker is unit-testable;
 * DomainRegistry stays the composition root that instantiates domains and
 * injects the persistence entry points.
 */
import type { IWorkspaceDomain } from '../domains/00-workspace';
import type { IDialogueTimelineDomain } from '../domains/01-dialogue-timeline';
import type { IArtifactDocumentDomain } from '../domains/01-artifact-document';
import type { IChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import type { ITopologicalGraphDomain } from '../domains/02-topological-graph';
import type { ThreadRegistry } from '../domains/06-chat-threads';
import type { ProjectSnapshot } from '../services/stores/projectStore';
import { logger } from '../utils/logger';

/** Shared with snapshotLoader: saves stay blocked until hydration lands. */
export type HydratedRef = { current: boolean };

export interface PersistDeps {
  workspace: IWorkspaceDomain;
  timeline: IDialogueTimelineDomain;
  segmentation: IChapterSegmentationDomain;
  artifacts: IArtifactDocumentDomain;
  graph: ITopologicalGraphDomain;
  threadRegistry: ThreadRegistry;
  hydratedRef: HydratedRef;
  saveProjectSnapshot: (
    projectId: string,
    snapshot: Omit<ProjectSnapshot, 'projectId' | 'updatedAt'>
  ) => Promise<void>;
  isCaptureMode: () => boolean;
}

/**
 * One debounced-save tick: compose live + cached thread content and write
 * the full snapshot to the ACTIVE backend. Skips when there is no active
 * project, when hydration hasn't landed yet (project switch in flight —
 * data unreliable), and in capture/fixture runs (read-only).
 */
export async function persistProjectSnapshot(deps: PersistDeps): Promise<void> {
  const {
    workspace,
    timeline,
    segmentation,
    artifacts,
    graph,
    threadRegistry,
    hydratedRef,
    saveProjectSnapshot,
    isCaptureMode,
  } = deps;
  const activeId = workspace.getActiveProjectId();
  if (!activeId) return;
  if (!hydratedRef.current) return; // project switch in flight — data unreliable
  if (isCaptureMode()) return; // capture/fixture runs are read-only
  try {
    // Meta MUST ride along: IndexedDB put() REPLACES the record, so an
    // omission here wipes name/codeName/description/color on first
    // auto-save (review P0#3 — caller-side, not snapshot-side).
    const container = workspace.getProject(activeId);
    // Threads: compose re-flattens live (active thread) + cached (inactive)
    // content and tags every turn/chapter with its threadId.
    const composed = threadRegistry.compose(timeline.getTurns(), segmentation.listChapters());
    await saveProjectSnapshot(activeId, {
      turns: composed.turns,
      chapters: composed.chapters,
      threads: composed.threads,
      folders: composed.folders,
      activeThreadId: composed.activeThreadId,
      artifacts: artifacts.listArtifacts(),
      edges: graph.listEdges(),
      name: container?.metadata.name,
      codeName: container?.metadata.codeName,
      description: container?.metadata.description,
      color: container?.metadata.color,
    });
  } catch (err) {
    logger.error('DomainRegistry', 'Persistence failed', err);
  }
}

export interface PersistWorkerDeps {
  timeline: IDialogueTimelineDomain;
  segmentation: IChapterSegmentationDomain;
  artifacts: IArtifactDocumentDomain;
  graph: ITopologicalGraphDomain;
  threadRegistry: ThreadRegistry;
  /** Typically the wrapped `persistProjectSnapshot` call. */
  persistState: () => void | Promise<void>;
}

/**
 * Hook every content domain's subscription to a 500ms-debounced save and
 * install the pagehide/visibilitychange flush. Returns the effect cleanup
 * (clears the pending timer, removes listeners, unsubscribes everything).
 */
export function attachPersistWorker(deps: PersistWorkerDeps): () => void {
  const { timeline, segmentation, artifacts, graph, threadRegistry, persistState } = deps;
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  // Debounced auto-save hook on domain state mutations
  const triggerDebouncedSave = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      persistState();
    }, 500);
  };

  const unsubTimeline = timeline.subscribe(triggerDebouncedSave);
  const unsubArtifacts = artifacts.subscribe(triggerDebouncedSave);
  const unsubChapters = segmentation.subscribe(triggerDebouncedSave);
  const unsubGraph = graph.subscribe(triggerDebouncedSave);
  const unsubThreads = threadRegistry.subscribe(triggerDebouncedSave);

  // Flush a pending debounced save when the tab hides/dies — reloading
  // within the 500ms window must not lose the last mutation.
  const flushPendingSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
      persistState();
    }
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flushPendingSave();
  };
  window.addEventListener('pagehide', flushPendingSave);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    window.removeEventListener('pagehide', flushPendingSave);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    unsubTimeline();
    unsubArtifacts();
    unsubChapters();
    unsubGraph();
    unsubThreads();
  };
}