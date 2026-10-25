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
import { persistProjectSnapshot, attachPersistWorker } from '../application/persistWorker';
import { useSessionMachine } from '../application/sessionMachine';
import { loadProjectSnapshotIntoDomains, loadNewWorkspace } from '../application/snapshotLoader';
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
  signIn: () => Promise<WorkspaceUser>;
  continueLocal: () => Promise<void>;
  signOut: () => Promise<void>;
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
    () => new OpticalCompilerDomain(artifacts, segmentation, timeline),
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
  } = useSessionMachine({
    getBackend,
    setBackend,
    listUserProjects,
    workspace,
  });

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
    threadRegistry,
  ]);

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