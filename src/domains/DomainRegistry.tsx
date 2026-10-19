import React, { createContext, useContext, useMemo, useRef, useEffect, useCallback } from 'react';
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
import {
  auth,
  signInWithGoogle,
  logOut,
  subscribeToAuth,
} from '../services/firebase';
import { User } from 'firebase/auth';
import { persistProjectSnapshot, attachPersistWorker } from '../application/persistWorker';
import { useSessionMachine } from '../application/sessionMachine';
import { loadProjectSnapshotIntoDomains, loadNewWorkspace } from '../application/snapshotLoader';

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
  currentUser: User | null;
  authInitialized: boolean;
  cloudProjectsCount: number | null;
  signIn: () => Promise<User>;
  continueLocal: () => Promise<void>;
  signOut: () => Promise<void>;
  createCloudWorkspace: (meta: {
    id: string;
    name: string;
    codeName: string;
    description: string;
    color: string;
  }) => Promise<void>;
  /** Permanently delete a project from the ACTIVE backend + registry. */
  deleteWorkspace: (projectId: string) => Promise<void>;
  /** Thread metadata + inactive-thread content (see 06-chat-threads). */
  threadRegistry: ThreadRegistry;
  /** Switch the active thread (flush live → cache, load incoming). */
  selectThread: (threadId: string) => void;
  /** Create a thread in the active project and switch to it. Returns its id. */
  createThread: () => string;
  /** Delete a thread; falls back to another thread when the active one dies. */
  deleteThread: (threadId: string) => void;
}

const DomainContext = createContext<DomainContextValue | null>(null);

export const DomainProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // ── Domain instantiation (composition root) ───────────────────────────
  const workspace = useMemo(() => new WorkspaceDomain(), []);
  const activeProjectId = workspace.getActiveProjectId();

  // Domains start EMPTY — data arrives from Firestore via the snapshot
  // effect below. (The old localStorage-mirror + static-seed chain is gone:
  // Storage IS Firebase, and demo seeds are not a storage layer.)
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
  // Chat threads: metadata + inactive-thread content. Single instance —
  // re-hydrated on every project switch (snapshot load effect below).
  const threadRegistry = useMemo(() => new ThreadRegistry(), []);
  const compiler = useMemo(
    () => new OpticalCompilerDomain(graph, artifacts, segmentation, timeline),
    [graph, artifacts, segmentation, timeline]
  );

  // ── Project snapshot hydration (application/snapshotLoader) ───────────
  // Single load path for project CONTENT: boot and project switching both
  // come through here — see snapshotLoader.ts for the full rationale.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!activeProjectId) return;
    hydratedRef.current = false; // block saves until this project's data lands
    return loadProjectSnapshotIntoDomains({
      activeProjectId,
      loadProjectSnapshot,
      threadRegistry,
      timeline,
      segmentation,
      artifacts,
      graph,
      hydratedRef,
    });
  }, [activeProjectId, timeline, segmentation, artifacts, graph, threadRegistry]);

  // ── Authentication & cloud session (application/sessionMachine) ───────
  // Local branch presents the LOCAL_USER pseudo-user inside the machine —
  // App/Sidebar/Genesis stay backend-agnostic. Storage branch lives entirely
  // in persistenceService (getBackend/setBackend).
  const {
    currentUser,
    authInitialized,
    cloudProjectsCount,
    setCloudProjectsCount,
    signIn,
    continueLocal,
    signOut,
  } = useSessionMachine({
    auth,
    signInWithGoogle,
    logOut,
    subscribeToAuth,
    getBackend,
    setBackend,
    listUserProjects,
    workspace,
  });

  // ── Persistence worker (application/persistWorker) ────────────────────
  // Debounced Firestore save on domain mutations + pagehide/visibility flush.
  const persistState = useCallback(
    () =>
      persistProjectSnapshot({
        workspace,
        timeline,
        segmentation,
        artifacts,
        graph,
        threadRegistry,
        hydratedRef,
        saveProjectSnapshot,
        isCaptureMode,
      }),
    [workspace, timeline, segmentation, artifacts, graph, threadRegistry]
  );

  useEffect(
    () =>
      attachPersistWorker({
        timeline,
        segmentation,
        artifacts,
        graph,
        threadRegistry,
        persistState,
      }),
    [timeline, segmentation, artifacts, graph, persistState, threadRegistry]
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

  // ── Chat-thread operations (need the live domains to flush/load) ──────

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
      createCloudWorkspace,
      deleteWorkspace,
      threadRegistry,
      selectThread,
      createThread,
      deleteThread,
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
    ]
  );

  return <DomainContext.Provider value={value}>{children}</DomainContext.Provider>;
};

export function useDomains(): DomainContextValue {
  const ctx = useContext(DomainContext);
  if (!ctx) throw new Error('useDomains must be used within a DomainProvider');
  return ctx;
}