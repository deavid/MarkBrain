import React, { createContext, useContext, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { WorkspaceDomain, IWorkspaceDomain } from './00-workspace';
import { DialogueTimelineDomain, IDialogueTimelineDomain } from './01-dialogue-timeline';
import { ArtifactDocumentDomain, IArtifactDocumentDomain } from './01-artifact-document';
import { ArtifactVersioningDomain, IArtifactVersioningDomain } from './01-artifact-versioning';
import { TopologicalGraphDomain, ITopologicalGraphDomain } from './02-topological-graph';
import { ChapterSegmentationDomain, IChapterSegmentationDomain } from './02-chapter-segmentation';
import { ProvenanceTrackingDomain, IProvenanceTrackingDomain } from './02-provenance-tracking';
import { RecursiveGroupingDomain, IRecursiveGroupingDomain } from './02-recursive-grouping';
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

export interface DomainContextValue {
  workspace: IWorkspaceDomain;
  timeline: IDialogueTimelineDomain;
  artifacts: IArtifactDocumentDomain;
  versioning: IArtifactVersioningDomain;
  graph: ITopologicalGraphDomain;
  segmentation: IChapterSegmentationDomain;
  provenance: IProvenanceTrackingDomain;
  grouping: IRecursiveGroupingDomain;
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
  const provenance = useMemo(() => new ProvenanceTrackingDomain(), []);
  const grouping = useMemo(() => new RecursiveGroupingDomain(), []);
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

  /**
   * Single load path for project CONTENT: boot and project switching both
   * come through here — the active project (or its fresh domain instances)
   * changed → fetch its snapshot → hydrate. Replaces the old chain of
   * localStorage sync-read → static seed → cloud overlay.
   *
   * Thread hydration rides along: the registry partitions snapshot
   * turns/chapters by threadId (backfilling legacy snapshots with a default
   * "Main" thread) and returns only the ACTIVE thread's content for the
   * live domains.
   */
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!activeProjectId) return;
    let stale = false;
    hydratedRef.current = false; // block saves until this project's data lands
    const hydrateProject = (snap: Awaited<ReturnType<typeof loadProjectSnapshot>>) => {
      const activeContent = threadRegistry.hydrate({
        projectId: activeProjectId,
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
    };
    (async () => {
      try {
        const snap = await loadProjectSnapshot(activeProjectId);
        if (stale) return;
        hydrateProject(snap);
      } catch (err) {
        logger.warn('DomainRegistry', 'Snapshot load failed', err);
        if (!stale) hydrateProject(null);
      }
    })();
    return () => {
      stale = true;
    };
  }, [activeProjectId, timeline, segmentation, artifacts, graph, threadRegistry]);

  // Authentication & cloud state.
  // Session shape: TWO branches at the gate (Google / Local), but everything
  // downstream just sees `currentUser` — the Local branch presents this
  // display-only pseudo-user so App/Sidebar/Genesis stay backend-agnostic.
  // Storage branch lives entirely in persistenceService (getBackend/setBackend).
  const LOCAL_USER = useMemo(
    () =>
      ({
        uid: 'local',
        email: 'local@markbrain.local',
        displayName: 'Local Space',
        photoURL: null,
      }) as unknown as User,
    []
  );
  const [currentUser, setCurrentUser] = useState<User | null>(() =>
    getBackend() === 'local' ? LOCAL_USER : auth.currentUser
  );
  const [authInitialized, setAuthInitialized] = useState<boolean>(false);
  // null = "cloud project list not resolved yet" (App holds its boot loader on this)
  const [cloudProjectsCount, setCloudProjectsCount] = useState<number | null>(null);

  // Persistence worker: debounced Firestore save on domain mutations
  const persistState = useCallback(async () => {
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
  }, [workspace, timeline, segmentation, artifacts, graph, threadRegistry]);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced auto-save hook on domain state mutations
  useEffect(() => {
    const triggerDebouncedSave = () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
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
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        persistState();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushPendingSave();
    };
    window.addEventListener('pagehide', flushPendingSave);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      window.removeEventListener('pagehide', flushPendingSave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubTimeline();
      unsubArtifacts();
      unsubChapters();
      unsubGraph();
      unsubThreads();
    };
  }, [timeline, segmentation, artifacts, graph, persistState, threadRegistry]);

  // Project LIST — the single boot path for the workspace registry.
  // listUserProjects never throws (it catches → []), but every path must set
  // the count: the App boot gate waits on `cloudProjectsCount !== null`.
  // Backend-agnostic: it resolves its own scope (firestore tree / local store).
  const loadUserCloudData = useCallback(async () => {
    try {
      const userProjects = await listUserProjects();
      setCloudProjectsCount(userProjects.length);
      workspace.loadUserProjects(userProjects); // [] clears registry → Genesis
    } catch (err) {
      logger.warn('DomainRegistry', 'Error loading project list', err);
      setCloudProjectsCount(0);
    }
  }, [workspace]);

  // Auth observer: Google sign-in state. In Local mode the Firebase observer
  // fires `null` on every reload — that must NOT knock the session back to
  // the gate, so Local mode keeps the pseudo-user and loads local projects.
  useEffect(() => {
    const unsubAuth = subscribeToAuth(async (user) => {
      if (getBackend() === 'local') {
        setCurrentUser(LOCAL_USER);
        setAuthInitialized(true);
        await loadUserCloudData();
        return;
      }
      setCurrentUser(user);
      setAuthInitialized(true);
      if (user) {
        await loadUserCloudData();
      } else {
        setCloudProjectsCount(null);
      }
    });

    return unsubAuth;
  }, [loadUserCloudData, LOCAL_USER]);

  const signIn = useCallback(async () => {
    return await signInWithGoogle();
  }, []);

  // Gate branch 2: enter the Local space — no account, IndexedDB only.
  const continueLocal = useCallback(async () => {
    setBackend('local');
    setCurrentUser(LOCAL_USER);
    setAuthInitialized(true);
    await loadUserCloudData();
  }, [loadUserCloudData, LOCAL_USER]);

  // Sign out from EITHER branch: reset backend to firestore + clear session.
  const signOut = useCallback(async () => {
    setBackend('firestore');
    try {
      await logOut(); // no-op when there is no Firebase user (Local mode)
    } catch {
      /* already signed out */
    }
    setCurrentUser(null);
    setCloudProjectsCount(null);
  }, []);

  const createCloudWorkspace = useCallback(
    async (meta: {
      id: string;
      name: string;
      codeName: string;
      description: string;
      color: string;
    }) => {
      // Backend-agnostic: persistenceService resolves identity per branch
      // (firestore requires a signed-in user; local needs none) and throws
      // a clear error when it can't proceed.
      const snap = await createCloudProject(meta);
      workspace.loadUserProjects([snap]);
      const activeContent = threadRegistry.hydrate({
        projectId: meta.id,
        threads: snap.threads as any,
        folders: snap.folders as any,
        turns: (snap.turns as any) || [],
        chapters: (snap.chapters as any) || [],
        activeThreadId: snap.activeThreadId,
      });
      timeline.loadTurns(activeContent.turns);
      segmentation.loadChapters(activeContent.chapters);
      artifacts.loadArtifacts(snap.artifacts || []);
      graph.loadEdges(snap.edges || []);
      hydratedRef.current = true;
      setCloudProjectsCount(1);
    },
    [workspace, timeline, segmentation, artifacts, graph, threadRegistry]
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
    [workspace]
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
      provenance,
      grouping,
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
      provenance,
      grouping,
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