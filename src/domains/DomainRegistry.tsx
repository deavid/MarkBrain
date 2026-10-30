import React, { createContext, useContext, useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { WorkspaceDomain, IWorkspaceDomain } from './00-workspace';
import { DialogueTimelineDomain, IDialogueTimelineDomain } from './01-dialogue-timeline';
import { ArtifactDocumentDomain, IArtifactDocumentDomain } from './01-artifact-document';
import { ArtifactVersioningDomain, IArtifactVersioningDomain } from './01-artifact-versioning';
import { TopologicalGraphDomain, ITopologicalGraphDomain } from './02-topological-graph';
import { ChapterSegmentationDomain, IChapterSegmentationDomain } from './02-chapter-segmentation';

import { StreamProtocolDomain, IStreamProtocolDomain } from './03-stream-protocol';
import { ChapterRecalibrationDomain, IChapterRecalibrationDomain } from './03-chapter-recalibration';
import { OpticalCompilerDomain, IOpticalCompilerDomain } from './03-optical-compiler';
import { ThreadRegistry, ThreadContent } from './06-chat-threads';
import { logger } from '../utils/logger';
import {
  saveProjectSnapshot,
  loadProjectSnapshot,
  listUserProjects,
  createCloudProject,
  deleteProject,
  isCaptureMode,
  getBackend,
  setBackend,
} from '../services/persistenceService';
import { persistProjectSnapshot, attachPersistWorker } from '../application/persistWorker';
import { requestSyncNow } from '../application/syncBus';
import { useSessionMachine } from '../application/sessionMachine';
import { loadProjectSnapshotIntoDomains, loadNewWorkspace } from '../application/snapshotLoader';
import { useVpsDeltaSync } from '../application/useVpsDeltaSync';
import { queueServerMutation, flushServerMutations } from '../application/serverMutationQueue';
import { getWorkspaceMode, isOfflineReplica, type KnownReplica } from '../services/workspaceSession';
import { initVpsSync, replayOutbox } from '../services/vpsSync';
import { getAllRecords, OUTBOX_CHANGED_EVENT } from '../services/offlineOutbox';
import type { WorkspaceUser } from '../types';

export interface DomainContextValue {
  workspace: IWorkspaceDomain;
  timeline: IDialogueTimelineDomain;
  artifacts: IArtifactDocumentDomain;
  versioning: IArtifactVersioningDomain;
  graph: ITopologicalGraphDomain;
  segmentation: IChapterSegmentationDomain;
  
  stream: IStreamProtocolDomain;
  recalibration: IChapterRecalibrationDomain;
  compiler: IOpticalCompilerDomain;
  currentUser: WorkspaceUser | null;
  authInitialized: boolean;
  cloudProjectsCount: number | null;
  signIn: (email: string, password: string, baseUrl?: string) => Promise<WorkspaceUser>;
  continueLocal: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Sign out AND erase this device's copy of the server workspace (Package 3 §3.6). */
  signOutWipeReplica: () => Promise<void>;
  /** Open a known replica from its local mirror — offline, no login call. */
  openOfflineReplica: (replica: KnownReplica) => Promise<void>;
  /** Server workspaces that have a local mirror on this device. */
  knownReplicas: KnownReplica[];
  createCloudWorkspace: (meta: {
    id: string;
    name: string;
    codeName: string;
    description: string;
    color: string;
  }) => Promise<void>;
  deleteWorkspace: (projectId: string) => Promise<void>;
  threadRegistry: ThreadRegistry;
  selectThread: (threadId: string) => void;
  createThread: () => string;
  deleteThread: (threadId: string) => void;
  /** Refresh button: replay the offline outbox, re-pull the list, rehydrate the active project. */
  refreshFromServer: () => Promise<void>;
  /** Projects with unsynced offline edits (vps mode only; [] otherwise). */
  unsyncedProjectIds: string[];
}

const DomainContext = createContext<DomainContextValue | null>(null);

export const DomainProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const workspace = useMemo(() => new WorkspaceDomain(), []);
  const activeProjectId = workspace.getActiveProjectId();

  // Domains start EMPTY; data arrives through the snapshot effect below. Nothing
  // may seed a domain with demo content — a seed is not a storage layer, and it
  // would be indistinguishable from real data on the next save.
  const timeline = useMemo(() => new DialogueTimelineDomain(activeProjectId, []), [activeProjectId]);
  const artifacts = useMemo(() => new ArtifactDocumentDomain(activeProjectId, []), [activeProjectId]);
  const versioning = useMemo(() => new ArtifactVersioningDomain(), []);
  const graph = useMemo(() => new TopologicalGraphDomain([]), []);
  const segmentation = useMemo(() => new ChapterSegmentationDomain(activeProjectId, []), [activeProjectId]);
  
  const stream = useMemo(() => new StreamProtocolDomain(), []);
  const recalibration = useMemo(
    () => new ChapterRecalibrationDomain(segmentation, timeline),
    [segmentation, timeline]
  );
  const threadRegistry = useMemo(() => new ThreadRegistry(), []);
  // The compiler reads ONLY the chat's attachments + chapters. The graph is a
  // library lens now, not a context mechanism — it is never passed here.
  const compiler = useMemo(
    () => new OpticalCompilerDomain(artifacts, segmentation, timeline, graph),
    [artifacts, segmentation, timeline]
  );

  const hydratedRef = useRef(false);

  const {
    currentUser,
    authInitialized,
    cloudProjectsCount,
    setCloudProjectsCount,
    signIn,
    continueLocal,
    signOut,
    signOutWipeReplica,
    openOfflineReplica,
    knownReplicas,
    loadUserCloudData,
  } = useSessionMachine({
    getBackend,
    setBackend,
    listUserProjects,
    workspace,
    // Phase 1 of sign-out lives here (the flush needs the domains, which are
    // declared below) — the ref is filled in once persistState exists.
    flushPendingWrites: async () => flushRef.current(),
  });
  const flushRef = useRef<() => void | Promise<void>>(() => {});

  // Manual refresh counter (declared before the load effect that consumes it).
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Load only after the auth observer has resolved, and re-load when the
  // session identity changes. A cloud load fired before the observer lands
  // throws "no active Google session"; the loader's contract is then correct
  // and brutal — no hydration, save gate stays closed — and the old dependency
  // list never retried, so every refresh showed an empty chat while saves
  // silently skipped. Local mode flips authInitialized in the same observer,
  // so both backends gate the same way.
  useEffect(() => {
    if (!activeProjectId) return;
    if (!authInitialized) return;
    hydratedRef.current = false; // block saves until this project's data lands
    return loadProjectSnapshotIntoDomains({
      activeProjectId,
      loadProjectSnapshot,
      threadRegistry,
      timeline,
      segmentation,
      artifacts,
      graph,
      versioning,
      hydratedRef,
    });
  }, [
    activeProjectId,
    authInitialized,
    currentUser?.uid,
    timeline,
    segmentation,
    artifacts,
    graph,
    versioning,
    threadRegistry,
    refreshNonce, // manual refresh button → rehydrate the active project
  ]);

  // Offline replay (vpsSync): push queued edits to the server on reconnect.
  // Event-driven only — 'online' + one attempt after auth. No timers.
  // Offline replica mode: replayOutbox must no-op (no network, and the mirror
  // was opened stale — pushing its edits would clobber server-side changes).
  useEffect(() => {
    initVpsSync();
  }, []);
  useEffect(() => {
    if (!authInitialized || getWorkspaceMode() !== 'vps' || isOfflineReplica()) return;
    void replayOutbox();
  }, [authInitialized, currentUser?.uid]);

  // Unsynced-badge state: which projects have edits queued in the outbox.
  const [unsyncedProjectIds, setUnsyncedProjectIds] = useState<string[]>([]);
  useEffect(() => {
    const update = () => setUnsyncedProjectIds(getAllRecords().map((r) => r.projectId));
    update();
    window.addEventListener(OUTBOX_CHANGED_EVENT, update);
    return () => window.removeEventListener(OUTBOX_CHANGED_EVENT, update);
  }, []);

  // Manual refresh: push the outbox, wake the delta poller, re-pull the list
  // and rehydrate the active project (refreshNonce re-runs its load effect).
  const refreshFromServer = useCallback(async () => {
    if (getWorkspaceMode() !== 'vps' || isOfflineReplica()) return;
    await replayOutbox();
    requestSyncNow();
    await loadUserCloudData();
    setRefreshNonce((n) => n + 1);
  }, [loadUserCloudData]);

  // 21D §4.5: Connected-mode delta poller (focus wake + 10s while visible).
  // Offline replica mode: no delta polling at all — the mirror is the only
  // source of truth and no network call may fire (Package 3 §3.6).
  const lastRevisionRef = useRef(0);
  useVpsDeltaSync({
    activeProjectId: isOfflineReplica() ? null : activeProjectId ?? null,
    lastRevisionRef,
    hydratedRef,
    timeline,
    segmentation,
    artifacts,
    graph,
    threadRegistry,
    versioning,
  });

  const persistState = useCallback(
    () =>
      persistProjectSnapshot({
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
      }),
    [workspace, timeline, segmentation, artifacts, graph, versioning, threadRegistry]
  );

  // Phase 1 of sign-out (flushPendingWrites → sessionMachine): drain the
  // pending debounced save and any queued server mutations NOW, while the
  // session is still valid — before disarm + logout.
  flushRef.current = async () => {
    await persistState();
    if (activeProjectId) await flushServerMutations(activeProjectId);
  };

  useEffect(
    () =>
      attachPersistWorker({
        timeline,
        segmentation,
        artifacts,
        graph,
        threadRegistry,
        workspace,
        persistState,
        hydratedRef,
      }),
    [timeline, segmentation, artifacts, graph, persistState, threadRegistry, workspace]
  );

  const createCloudWorkspace = useCallback(
    async (meta: {
      id: string;
      name: string;
      codeName: string;
      description: string;
      color: string;
    }) => {
      await loadNewWorkspace(meta, {
        createCloudProject,
        workspace,
        threadRegistry,
        timeline,
        segmentation,
        artifacts,
        graph,
        versioning,
        hydratedRef,
      });
      setCloudProjectsCount(1);
    },
    [workspace, timeline, segmentation, artifacts, graph, threadRegistry, setCloudProjectsCount]
  );

  // Permanently delete a project: storage first (throws → nothing in memory
  // changes), then registry. Registry re-picks the active project (or '' →
  // Genesis); count stays truthful so App's boot gates behave.
  const deleteWorkspace = useCallback(
    async (projectId: string) => {
      await deleteProject(projectId);
      workspace.removeProject(projectId);
      setCloudProjectsCount(workspace.listProjects().length);
    },
    [workspace, setCloudProjectsCount]
  );

  const selectThread = useCallback(
    (threadId: string) => {
      const incoming = threadRegistry.select(threadId, {
        turns: timeline.getTurns(),
        chapters: segmentation.listChapters(),
      });
      if (!incoming) return;
      timeline.loadTurns(incoming.turns);
      segmentation.loadChapters(incoming.chapters);
      logger.action('DomainRegistry', `Switched to thread ${threadId}`);
    },
    [threadRegistry, timeline, segmentation]
  );

  const createThread = useCallback((): string => {
    const thread = threadRegistry.createThread();
    const incoming = threadRegistry.select(thread.id, {
      turns: timeline.getTurns(),
      chapters: segmentation.listChapters(),
    });
    if (incoming) {
      timeline.loadTurns(incoming.turns);
      segmentation.loadChapters(incoming.chapters);
    }
    logger.action('DomainRegistry', `Created thread ${thread.id}`);
    return thread.id;
  }, [threadRegistry, timeline, segmentation]);

  const deleteThread = useCallback(
    (threadId: string) => {
      // Explicit delete must reach the VPS — the snapshot save is upsert-only,
      // so without this the row resurrects on refresh (live 2026-10-26).
      queueServerMutation(workspace.getActiveProjectId(), { op: 'deleteThread', threadId });
      const incoming = threadRegistry.deleteThread(threadId);
      if (incoming) {
        // Active thread died — live domains load the fallback thread's content.
        timeline.loadTurns(incoming.turns);
        segmentation.loadChapters(incoming.chapters);
      }
      logger.action('DomainRegistry', `Deleted thread ${threadId}`);
    },
    [threadRegistry, timeline, segmentation]
  );

  const value = useMemo<DomainContextValue>(
    () => ({
      workspace,
      timeline,
      artifacts,
      versioning,
      graph,
      segmentation,
      stream,
      recalibration,
      compiler,
      currentUser,
      authInitialized,
      cloudProjectsCount,
      signIn,
      continueLocal,
      signOut,
      signOutWipeReplica,
      openOfflineReplica,
      knownReplicas,
      createCloudWorkspace,
      deleteWorkspace,
      threadRegistry,
      selectThread,
      createThread,
      deleteThread,
      refreshFromServer,
      unsyncedProjectIds,
    }),
    [
      workspace,
      timeline,
      artifacts,
      versioning,
      graph,
      segmentation,
      
      stream,
      recalibration,
      compiler,
      currentUser,
      authInitialized,
      cloudProjectsCount,
      signIn,
      continueLocal,
      signOut,
      createCloudWorkspace,
      deleteWorkspace,
      threadRegistry,
      selectThread,
      createThread,
      deleteThread,
      refreshFromServer,
      unsyncedProjectIds,
      signOutWipeReplica,
      openOfflineReplica,
      knownReplicas,
    ]
  );
  return <DomainContext.Provider value={value}>{children}</DomainContext.Provider>;
};

export function useDomains(): DomainContextValue {
  const ctx = useContext(DomainContext);
  if (!ctx) throw new Error('useDomains must be used within a DomainProvider');
  return ctx;
}