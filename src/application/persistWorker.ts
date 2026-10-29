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
import type { IArtifactVersioningDomain } from '../domains/01-artifact-versioning';
import type { IChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import type { ITopologicalGraphDomain } from '../domains/02-topological-graph';
import type { ThreadRegistry } from '../domains/06-chat-threads';
import type { ProjectSnapshot } from '../services/stores/projectStore';
import { logger } from '../utils/logger';
import { notifyCritical } from '../utils/criticalNotifications';
import { isSlowSaveSeam } from '../services/persistenceService';

/** Shared with snapshotLoader: saves stay blocked until hydration lands. */
export type HydratedRef = { current: boolean };

export interface PersistDeps {
  workspace: IWorkspaceDomain;
  timeline: IDialogueTimelineDomain;
  segmentation: IChapterSegmentationDomain;
  artifacts: IArtifactDocumentDomain;
  graph: ITopologicalGraphDomain;
  versioning: IArtifactVersioningDomain;
  threadRegistry: ThreadRegistry;
  hydratedRef: HydratedRef;
  saveProjectSnapshot: (
    projectId: string,
    snapshot: Omit<ProjectSnapshot, 'projectId' | 'updatedAt'>
  ) => Promise<void>;
  isCaptureMode: () => boolean;
}

/** Skips when there is no active project, hydration hasn't landed, or the run is read-only. */
let persistAttempts = 0;

export async function persistProjectSnapshot(deps: PersistDeps): Promise<void> {
  const {
    workspace,
    timeline,
    segmentation,
    artifacts,
    graph,
    versioning,
    threadRegistry,
    hydratedRef,
    saveProjectSnapshot,
    isCaptureMode,
  } = deps;
  const activeId = workspace.getActiveProjectId();
  // Count EVERY debounced save that would have gone to a backend. This is the
  // cadence that decides whether a session is free (20k Firestore writes/day)
  // or on fire, so it is measured before any gate can hide it.
  persistAttempts += 1;
  logger.info('DomainRegistry', `Persist attempt #${persistAttempts} for ${activeId ?? '(none)'}`);
  if (!activeId) return;
  if (!hydratedRef.current) {
    // Every silently-blocked save is a session that dies on refresh — say so.
    logger.warn('DomainRegistry', 'Snapshot save blocked: project not hydrated yet — this session will not be persisted');
    return;
  }
  // Capture/fixture runs are read-only. The one exception is the evidence seam
  // `?slowsave=1`, which must reach the save path so the watchdog can be
  // watched — and that path cannot touch a backend at all: it hangs before the
  // store is ever consulted, then fails on the deadline.
  if (isCaptureMode() && !isSlowSaveSeam()) return;

  // Assembly and transmission fail for different reasons, and only one of them
  // is the cloud's fault. Lying about which would send the user hunting for a
  // network problem that isn't there — but both mean the same thing to them:
  // nothing is being saved.
  let payload: Omit<ProjectSnapshot, 'projectId' | 'updatedAt'>;
  try {
    // Meta MUST ride along: IndexedDB put() REPLACES the record, so an omission
    // here wipes name/codeName/description/color on the first auto-save.
    const container = workspace.getProject(activeId);
    // Threads: compose re-flattens live (active thread) + cached (inactive)
    // content and tags every turn/chapter with its threadId.
    const composed = threadRegistry.compose(timeline.getTurns(), segmentation.listChapters());
    payload = {
      turns: composed.turns,
      chapters: composed.chapters,
      threads: composed.threads,
      folders: composed.folders,
      activeThreadId: composed.activeThreadId,
      artifacts: artifacts.listArtifacts(),
      edges: graph.listEdges(),
      // History rides the snapshot: without it an F5 wipes the History tab
      // (Package 1 §1.4). Keyed by artifact id, merged on hydrate.
      revisions: versioning.getAllRevisions(),
      name: container?.metadata.name,
      codeName: container?.metadata.codeName,
      description: container?.metadata.description,
      color: container?.metadata.color,
      // Project-default chat capabilities (Package 2 §2.2) — omit when unset
      // so legacy snapshots stay byte-compatible.
      ...(container?.metadata.capabilities
        ? { capabilities: container.metadata.capabilities }
        : {}),
    };
  } catch (err) {
    logger.error('DomainRegistry', 'Snapshot assembly failed — nothing was sent to storage', err);
    notifyCritical('Could not save your work — changes made now may be lost when you reload.');
    return;
  }

  try {
    await saveProjectSnapshot(activeId, payload);
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
  /** When provided, notifications fired while `hydratedRef.current === false`
   * (initial snapshot hydration or incoming server delta merge) do NOT arm
   * the 500ms save timer — otherwise every hydration/delta merge writes the
   * server's own state back 500ms later. */
  hydratedRef?: HydratedRef;
}

/** Returns the effect cleanup (clears the timer, removes listeners, unsubscribes). */
export function attachPersistWorker(deps: PersistWorkerDeps): () => void {
  const { timeline, segmentation, artifacts, graph, threadRegistry, workspace, persistState, hydratedRef } = deps;
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  const triggerDebouncedSave = () => {
    if (hydratedRef && !hydratedRef.current) return;
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