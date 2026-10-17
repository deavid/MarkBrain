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
import {
  saveProjectSnapshot,
  loadProjectSnapshot,
  listUserProjects,
  createCloudProject,
  isCaptureMode,
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
  signOut: () => Promise<void>;
  createCloudWorkspace: (meta: {
    id: string;
    name: string;
    codeName: string;
    description: string;
    color: string;
  }) => Promise<void>;
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
  const compiler = useMemo(
    () => new OpticalCompilerDomain(graph, artifacts, segmentation, timeline),
    [graph, artifacts, segmentation, timeline]
  );

  /**
   * Single load path for project CONTENT: boot and project switching both
   * come through here — the active project (or its fresh domain instances)
   * changed → fetch its snapshot → hydrate. Replaces the old chain of
   * localStorage sync-read → static seed → cloud overlay.
   */
  useEffect(() => {
    if (!activeProjectId) return;
    let stale = false;
    (async () => {
      try {
        const snap = await loadProjectSnapshot(activeProjectId);
        if (stale || !snap) return;
        timeline.loadTurns(snap.turns || []);
        segmentation.loadChapters(snap.chapters || []);
        artifacts.loadArtifacts(snap.artifacts || []);
        graph.loadEdges(snap.edges || []);
      } catch (err) {
        console.warn('[DomainRegistry] snapshot load failed:', err);
      }
    })();
    return () => {
      stale = true;
    };
  }, [activeProjectId, timeline, segmentation, artifacts, graph]);

  // Authentication & cloud state
  const [currentUser, setCurrentUser] = useState<User | null>(auth.currentUser);
  const [authInitialized, setAuthInitialized] = useState<boolean>(false);
  // null = "cloud project list not resolved yet" (App holds its boot loader on this)
  const [cloudProjectsCount, setCloudProjectsCount] = useState<number | null>(null);

  // Persistence worker: debounced Firestore save on domain mutations
  const persistState = useCallback(async () => {
    const activeId = workspace.getActiveProjectId();
    if (!activeId) return;
    if (isCaptureMode()) return; // capture/fixture runs are read-only
    try {
      await saveProjectSnapshot(activeId, {
        turns: timeline.getTurns(),
        chapters: segmentation.listChapters(),
        artifacts: artifacts.listArtifacts(),
        edges: graph.listEdges(),
      });
    } catch (err) {
      console.warn('[DomainRegistry] Persistence failed:', err);
    }
  }, [workspace, timeline, segmentation, artifacts, graph]);

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

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      unsubTimeline();
      unsubArtifacts();
      unsubChapters();
      unsubGraph();
    };
  }, [timeline, segmentation, artifacts, graph, persistState]);

  // Cloud project LIST — the single boot path for the workspace registry.
  // listUserProjects never throws (it catches → []), but every path must set
  // the count: the App boot gate waits on `cloudProjectsCount !== null`.
  const loadUserCloudData = useCallback(
    async (user: User) => {
      try {
        const userProjects = await listUserProjects(user.uid);
        setCloudProjectsCount(userProjects.length);
        workspace.loadUserProjects(userProjects); // [] clears registry → Genesis
      } catch (err) {
        console.warn('[DomainRegistry] Error loading cloud projects:', err);
        setCloudProjectsCount(0);
      }
    },
    [workspace]
  );

  // Auth observer: load from Firestore when user authenticates
  useEffect(() => {
    const unsubAuth = subscribeToAuth(async (user) => {
      setCurrentUser(user);
      setAuthInitialized(true);
      if (user) {
        await loadUserCloudData(user);
      } else {
        setCloudProjectsCount(null);
      }
    });

    return unsubAuth;
  }, [loadUserCloudData]);

  const signIn = useCallback(async () => {
    return await signInWithGoogle();
  }, []);

  const signOut = useCallback(async () => {
    await logOut();
  }, []);

  const createCloudWorkspace = useCallback(
    async (meta: {
      id: string;
      name: string;
      codeName: string;
      description: string;
      color: string;
    }) => {
      if (!auth.currentUser) throw new Error('Cannot create project without active authentication');
      const snap = await createCloudProject(auth.currentUser.uid, meta);
      workspace.loadUserProjects([snap]);
      timeline.loadTurns(snap.turns || []);
      segmentation.loadChapters(snap.chapters || []);
      artifacts.loadArtifacts(snap.artifacts || []);
      graph.loadEdges(snap.edges || []);
      setCloudProjectsCount(1);
    },
    [workspace, timeline, segmentation, artifacts, graph]
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
      signOut,
      createCloudWorkspace,
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
      signOut,
      createCloudWorkspace,
    ]
  );

  return <DomainContext.Provider value={value}>{children}</DomainContext.Provider>;
};

export function useDomains(): DomainContextValue {
  const ctx = useContext(DomainContext);
  if (!ctx) throw new Error('useDomains must be used within a DomainProvider');
  return ctx;
}