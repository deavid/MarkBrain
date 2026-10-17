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
import { INITIAL_PROJECTS } from '../data/initialData';
import {
  getStoredSnapshotSync,
  saveProjectSnapshot,
  loadProjectSnapshot,
  listUserProjects,
  createCloudProject,
  ProjectSnapshot,
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
  isSyncing: boolean;
  isCloudSynced: boolean;
  signIn: () => Promise<User>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
  createCloudWorkspace: (meta: {
    id: string;
    name: string;
    codeName: string;
    description: string;
    color: string;
  }) => Promise<void>;
  reloadCloudProjects: () => Promise<void>;
}

const DomainContext = createContext<DomainContextValue | null>(null);

export const DomainProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const workspace = useMemo(() => new WorkspaceDomain(), []);
  const activeProjectId = workspace.getActiveProjectId();

  // Try loading synchronous snapshot for zero-flash initial render
  const storedSnapshot = useMemo(() => {
    return getStoredSnapshotSync(activeProjectId);
  }, [activeProjectId]);

  // Find fallback initial project seed data
  const seedProject = useMemo(() => {
    return INITIAL_PROJECTS.find((p) => p.id === activeProjectId) || INITIAL_PROJECTS[0];
  }, [activeProjectId]);

  // Seed turns: prefer persisted snapshot over static seed
  const initialTurns = useMemo(() => {
    if (storedSnapshot && storedSnapshot.turns && storedSnapshot.turns.length > 0) {
      return storedSnapshot.turns;
    }
    if (!seedProject) return [];
    const turns: any[] = [];
    seedProject.chapters.forEach((c) => {
      c.messages.forEach((m) => {
        turns.push({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp).getTime(),
          extractedArtifacts: m.extractedArtifacts,
        });
      });
    });
    return turns;
  }, [storedSnapshot, seedProject]);

  // Seed chapters: prefer persisted snapshot over static seed
  const initialChapters = useMemo(() => {
    if (storedSnapshot && storedSnapshot.chapters && storedSnapshot.chapters.length > 0) {
      return storedSnapshot.chapters;
    }
    if (!seedProject) return [];
    let turnCursor = 0;
    return seedProject.chapters.map((c) => {
      const startIndex = turnCursor;
      turnCursor += c.messages.length;
      return {
        id: c.id,
        workspaceId: activeProjectId,
        title: c.title,
        summary: c.summary,
        keyPoints: c.keyPoints,
        status: c.status,
        startIndex,
        endIndex: c.status === 'completed' ? turnCursor : undefined,
        createdAt: new Date(c.createdAt).getTime(),
      };
    });
  }, [storedSnapshot, seedProject, activeProjectId]);

  // Seed artifacts: prefer persisted snapshot over static seed
  const initialArtifacts = useMemo(() => {
    if (storedSnapshot && storedSnapshot.artifacts && storedSnapshot.artifacts.length > 0) {
      return storedSnapshot.artifacts;
    }
    if (!seedProject) return [];
    return seedProject.artifacts.map((a) => ({
      id: a.id,
      workspaceId: activeProjectId,
      code: a.code || a.id,
      title: a.title || 'Untitled',
      type: (a.type as any) || 'document',
      category: a.category || 'system-spec',
      isHighConcept: Boolean(a.isHighConcept),
      color: a.color,
      current: a.current || {
        t0_label: a.title || 'Untitled',
        t1_abstract: a.description || '',
        t2_summary: a.summary || '',
        t3_body: a.content || '',
      },
      tags: a.tags || [],
      createdAt: typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : Date.now(),
      updatedAt: typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : Date.now(),
    }));
  }, [storedSnapshot, seedProject, activeProjectId]);

  // Seed edges: prefer persisted snapshot over static seed
  const initialEdges = useMemo(() => {
    if (storedSnapshot && storedSnapshot.edges && storedSnapshot.edges.length > 0) {
      return storedSnapshot.edges;
    }
    if (!seedProject) return [];
    return seedProject.edges.map((e) => ({
      id: e.id,
      sourceId: e.sourceNodeId ? e.sourceNodeId.replace(/^node-/, '') : (e.source || ''),
      targetId: e.targetNodeId ? e.targetNodeId.replace(/^node-/, '') : (e.target || ''),
      kind: 'relates_to' as const,
      weight: e.strength || 1.0,
    }));
  }, [storedSnapshot, seedProject]);

  const timeline = useMemo(() => new DialogueTimelineDomain(activeProjectId, initialTurns), [activeProjectId, initialTurns]);
  const artifacts = useMemo(() => new ArtifactDocumentDomain(activeProjectId, initialArtifacts as any), [activeProjectId, initialArtifacts]);
  const versioning = useMemo(() => new ArtifactVersioningDomain(), []);
  const graph = useMemo(() => new TopologicalGraphDomain(initialEdges as any), [initialEdges]);
  const segmentation = useMemo(() => new ChapterSegmentationDomain(activeProjectId, initialChapters as any), [activeProjectId, initialChapters]);
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

  // Authentication & Cloud Sync State
  const [currentUser, setCurrentUser] = useState<User | null>(auth.currentUser);
  const [authInitialized, setAuthInitialized] = useState<boolean>(false);
  const [cloudProjectsCount, setCloudProjectsCount] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isCloudSynced, setIsCloudSynced] = useState<boolean>(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Persistence worker: Saves active domain state to local storage and Firestore
  const persistState = useCallback(async () => {
    const activeId = workspace.getActiveProjectId();
    if (!activeId) return; // Never persist if no active project exists
    setIsSyncing(true);
    try {
      await saveProjectSnapshot(activeId, {
        turns: timeline.getTurns(),
        chapters: segmentation.listChapters(),
        artifacts: artifacts.listArtifacts(),
        edges: graph.listEdges(),
      });
      if (auth.currentUser) {
        setIsCloudSynced(true);
      }
    } catch (err) {
      console.warn('[DomainRegistry] Persistence failed:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [workspace, timeline, segmentation, artifacts, graph]);

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
    const unsubSegmentation = segmentation.subscribe(triggerDebouncedSave);
    const unsubGraph = graph.subscribe(triggerDebouncedSave);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      unsubTimeline();
      unsubArtifacts();
      unsubSegmentation();
      unsubGraph();
    };
  }, [timeline, artifacts, segmentation, graph, persistState]);

  // Helper to load user's Firestore cloud projects
  const loadUserCloudData = useCallback(async (user: User) => {
    setIsSyncing(true);
    try {
      const userProjects = await listUserProjects(user.uid);
      setCloudProjectsCount(userProjects.length);
      if (userProjects.length > 0) {
        workspace.loadUserProjects(userProjects);
        const activeId = workspace.getActiveProjectId();
        const cloud = await loadProjectSnapshot(activeId);
        if (cloud) {
          if (cloud.turns) timeline.loadTurns(cloud.turns);
          if (cloud.chapters) segmentation.loadChapters(cloud.chapters);
          if (cloud.artifacts) artifacts.loadArtifacts(cloud.artifacts);
          if (cloud.edges) graph.loadEdges(cloud.edges);
        }
        setIsCloudSynced(true);
      } else {
        // Authenticated user has zero projects in Firestore: prompt genesis
        workspace.loadUserProjects([]);
        timeline.clear();
        segmentation.loadChapters([]);
        artifacts.loadArtifacts([]);
        graph.loadEdges([]);
        setIsCloudSynced(true);
      }
    } catch (err) {
      console.warn('[DomainRegistry] Error loading cloud projects:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [workspace, timeline, segmentation, artifacts, graph]);

  // Auth observer: load from Firestore when user authenticates
  useEffect(() => {
    const unsubAuth = subscribeToAuth(async (user) => {
      setCurrentUser(user);
      setAuthInitialized(true);
      if (user) {
        await loadUserCloudData(user);
      } else {
        setIsCloudSynced(false);
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

  const syncNow = useCallback(async () => {
    await persistState();
  }, [persistState]);

  const createCloudWorkspace = useCallback(async (meta: {
    id: string;
    name: string;
    codeName: string;
    description: string;
    color: string;
  }) => {
    if (!auth.currentUser) throw new Error('Cannot create project without active authentication');
    setIsSyncing(true);
    try {
      const snap = await createCloudProject(auth.currentUser.uid, meta);
      workspace.loadUserProjects([snap]);
      timeline.loadTurns(snap.turns);
      segmentation.loadChapters(snap.chapters);
      artifacts.loadArtifacts(snap.artifacts);
      graph.loadEdges(snap.edges);
      setCloudProjectsCount(1);
      setIsCloudSynced(true);
    } finally {
      setIsSyncing(false);
    }
  }, [workspace, timeline, segmentation, artifacts, graph]);

  const reloadCloudProjects = useCallback(async () => {
    if (auth.currentUser) {
      await loadUserCloudData(auth.currentUser);
    }
  }, [loadUserCloudData]);

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
      isSyncing,
      isCloudSynced,
      signIn,
      signOut,
      syncNow,
      createCloudWorkspace,
      reloadCloudProjects,
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
      isSyncing,
      isCloudSynced,
      signIn,
      signOut,
      syncNow,
      createCloudWorkspace,
      reloadCloudProjects,
    ]
  );

  return <DomainContext.Provider value={value}>{children}</DomainContext.Provider>;
};

export function useDomains(): DomainContextValue {
  const ctx = useContext(DomainContext);
  if (!ctx) throw new Error('useDomains must be used within a DomainProvider');
  return ctx;
}