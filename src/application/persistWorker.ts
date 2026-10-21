/**
 * Debounced snapshot save on domain mutations, plus a flush when the tab hides
 * or dies (pagehide / visibilitychange) — otherwise reloading inside the debounce
 * window silently loses the last mutation.
 *
 * Saves stay blocked until hydration lands (`hydratedRef`): a save fired against
 * half-loaded domains would write empty arrays over the real snapshot.
 */
import type { IWorkspaceDomain } from '../domains/00-workspace';
import type { IDialogueTimelineDomain } from '../domains/01-dialogue-timeline';
import type { IArtifactDocumentDomain } from '../domains/01-artifact-document';
import type { IChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import type { ITopologicalGraphDomain } from '../domains/02-topological-graph';
import type { ThreadRegistry } from '../domains/06-chat-threads';
import type { ProjectSnapshot } from '../services/stores/projectStore';
import { logger } from '../utils/logger';
import { notifyCritical } from '../utils/criticalNotifications';

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

/** Skips when there is no active project, hydration hasn't landed, or the run is read-only. */
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
  if (!hydratedRef.current) {
    // Every silently-blocked save is a session that dies on refresh — say so.
    logger.warn('DomainRegistry', 'Snapshot save blocked: project not hydrated yet — this session will not be persisted');
    return;
  }
  if (isCaptureMode()) return; // capture/fixture runs are read-only
  try {
    // Meta MUST ride along: IndexedDB put() REPLACES the record, so an omission
    // here wipes name/codeName/description/color on the first auto-save.
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
    // The console has the specifics; the user needs to know the session is not
    // being saved at all. This is the failure that silently ate days of work.
    notifyCritical('Could not save to the cloud — changes made now may be lost when you reload.');
  }
}

export interface PersistWorkerDeps {
  timeline: IDialogueTimelineDomain;
  segmentation: IChapterSegmentationDomain;
  artifacts: IArtifactDocumentDomain;
  graph: ITopologicalGraphDomain;
  threadRegistry: ThreadRegistry;
  persistState: () => void | Promise<void>;
}

/** Returns the effect cleanup (clears the timer, removes listeners, unsubscribes). */
export function attachPersistWorker(deps: PersistWorkerDeps): () => void {
  const { timeline, segmentation, artifacts, graph, threadRegistry, persistState } = deps;
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  const triggerDebouncedSave = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      // Null it: a fired timer is not a pending save. Without this,
      // flushPendingSave saw a stale id on every alt-tab and re-wrote the
      // whole document with nothing changed — pure quota burn.
      saveTimeout = null;
      persistState();
    }, 500);
  };

  const unsubTimeline = timeline.subscribe(triggerDebouncedSave);
  const unsubArtifacts = artifacts.subscribe(triggerDebouncedSave);
  const unsubChapters = segmentation.subscribe(triggerDebouncedSave);
  const unsubGraph = graph.subscribe(triggerDebouncedSave);
  const unsubThreads = threadRegistry.subscribe(triggerDebouncedSave);

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