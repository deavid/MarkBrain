import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Project,
  Artifact,
  GraphNode,
  GraphEdge,
  Chapter,
  ChatMessage,
  ModelOption,
  AbstractionLevel,
  ResolutionTier,
  getMellowPastelColor,
} from './types';
import { AVAILABLE_MODELS } from './data/models';
import { serializeArtifactToYamlDoc } from './utils/yamlArtifactParser';
import { Sidebar, ActiveView } from './components/Sidebar';
import { SpatialGraph } from './components/SpatialGraph';
import { ChatView } from './components/ChatView';
import { ChatErrorBoundary } from './components/ChatErrorBoundary';
import { AuthGate } from './components/AuthGate';
import { ProjectGenesis } from './components/ProjectGenesis';
import {
  exportDatabase,
  serializeDatabase,
  parseDatabaseExport,
  importDatabase,
} from './services/persistenceService';
import { Brain } from 'lucide-react';
import { logger } from './utils/logger';
import { ArtifactDetailModal } from './components/ArtifactDetailModal';
import { ImportModal } from './components/ImportModal';
import { ExportModal } from './components/ExportModal';
import { ProjectLauncher } from './components/ProjectLauncher';
import { ServerLogsModal } from './components/ServerLogsModal';
import { useDomains } from './domains/DomainRegistry';
import {
  deriveThreadRuntime,
  queuePositionOf,
  titlePipelineStep,
  placeholderTitle,
  sampleTurnsForTitle,
  ThreadRuntime,
} from './domains/06-chat-threads';
import { SaturationOrb } from './domains/04-presentation/telemetry/SaturationOrb';
import { EdgeHeatStrip } from './domains/04-presentation/telemetry/EdgeHeatStrip';
import { MirrorPanel } from './domains/04-presentation/telemetry/MirrorPanel';
import { AmbientTelemetryData } from './domains/04-presentation/telemetry/ambientTelemetry';
import { useImportSession } from './components/import/useImportSession';
import { detectImportFlag, flagRelationship, ImportFlag } from './utils/importDetect';
import { RevisionTriageModal } from './components/RevisionTriageModal';

export default function App() {
  const {
    workspace,
    timeline,
    artifacts: artifactsDomain,
    versioning,
    graph,
    segmentation,
    compiler,
    stream,
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
  } = useDomains();

  // Tick state to force re-render on domain events
  const [tick, setTick] = useState(0);
  const triggerReRender = useCallback(() => setTick((t) => t + 1), []);

  // Subscribe to domain event streams for real-time reactivity
  useEffect(() => {
    const unsubWorkspace = workspace.subscribe(() => triggerReRender());
    const unsubTimeline = timeline.subscribe(() => triggerReRender());
    const unsubArtifacts = artifactsDomain.subscribe(() => triggerReRender());
    const unsubVersioning = versioning.subscribe(() => triggerReRender());
    const unsubGraph = graph.subscribe(() => triggerReRender());
    const unsubSegmentation = segmentation.subscribe(() => triggerReRender());
    const unsubThreads = threadRegistry.subscribe(() => triggerReRender());

    return () => {
      unsubWorkspace();
      unsubTimeline();
      unsubArtifacts();
      unsubVersioning();
      unsubGraph();
      unsubSegmentation();
      unsubThreads();
    };
  }, [
    workspace,
    timeline,
    artifactsDomain,
    versioning,
    graph,
    segmentation,
    threadRegistry,
    triggerReRender,
  ]);

  // Active Project ID from Workspace Domain
  const activeProjectId = workspace.getActiveProjectId();
  const currentContainer = workspace.getProject(activeProjectId);

  // Model selection (default to Google: Gemini 3.5 Flash Lite)
  const [selectedModel, setSelectedModel] = useState<ModelOption>(AVAILABLE_MODELS[0]);

  // Optical Mode state from current container or default
  const opticalMode = currentContainer?.opticalMode || 'autofocus';

  const setOpticalMode = (mode: 'autofocus' | 'manual' | 'myopia') => {
    if (currentContainer) {
      workspace.saveContainer({
        ...currentContainer,
        opticalMode: mode,
      });
      triggerReRender();
    }
  };

  const cycleOpticalMode = () => {
    const next =
      opticalMode === 'autofocus'
        ? 'manual'
        : opticalMode === 'manual'
        ? 'myopia'
        : 'autofocus';
    setOpticalMode(next);
  };

  // Active View: 'chat' | 'graph' | 'artifacts' | 'tokens'
  const [activeView, setActiveView] = useState<ActiveView>('chat');

  // Modals & Project Launcher state
  // Default-open on desktop; default-closed on phones so the drawer+backdrop
  // doesn't bury the composer on first load (review P1 #8).
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [isProjectLauncherOpen, setIsProjectLauncherOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isMirrorOpen, setIsMirrorOpen] = useState(false);
  const [isServerLogsOpen, setIsServerLogsOpen] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  // Phase 3: triage modal — non-null = open, value = flagged pair to focus.
  const [triageFocusId, setTriageFocusId] = useState<string | null>(null);

  // Full-database backup / restore (canonical format lives in persistenceService).
  const importDbFileRef = useRef<HTMLInputElement | null>(null);

  const handleExportDatabase = useCallback(async () => {
    try {
      const data = await exportDatabase();
      const blob = new Blob([serializeDatabase(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `markbrain-db-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      logger.info('App', `Database backup downloaded (${data.projects.length} projects)`);
    } catch (err: any) {
      logger.error('App', `Database export failed: ${err?.message || err}`, err);
    }
  }, []);

  const handleImportDatabaseFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseDatabaseExport(text);
      const n = await importDatabase(parsed);
      logger.info('App', `Database restore OK — ${n} project(s) imported. Reloading…`);
      // Fresh boot is the honest way to show restored data: the boot path
      // (gate → project list → snapshot load) is the one already exercised
      // by every session, fixture, and real-data run.
      window.location.reload();
    } catch (err: any) {
      logger.error('App', `Database import failed: ${err?.message || err}`, err);
      alert(`Import failed: ${err?.message || err}`);
    }
  }, []);

  // Mounted on BOTH the Genesis screen and the main studio (exclusive early
  // returns) — a fresh browser must be able to restore with zero projects,
  // which means the trigger has to exist where the Sidebar doesn't.
  const dbImportInput = (
    <input
      ref={importDbFileRef}
      type="file"
      accept="application/json,.json"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) handleImportDatabaseFile(f);
        e.target.value = '';
      }}
    />
  );

  // ── Serial generation queue ────────────────────────────────────────────────
  // One stream at a time (Gemini quota + serial by design). Sends in other
  // threads enqueue; queued sends within one thread buffer-append (each job =
  // one user turn + one assistant turn when it starts).
  interface QueueJob {
    id: string;
    threadId: string;
    mode: 'new' | 'retry';
    text?: string;
    turnId?: string; // retry target (assistant turn to regenerate)
  }
  const queueRef = useRef<QueueJob[]>([]);
  const activeJobRef = useRef<QueueJob | null>(null);
  const jobAbortRef = useRef<AbortController | null>(null);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [streamPhase, setStreamPhase] = useState<'waiting' | 'streaming' | null>(null);

  // Derived (refs aren't reactive — every queue mutation calls triggerReRender)
  const activeThreadId = threadRegistry.getActiveThreadId();
  const isChatLoading =
    !!activeJobRef.current && activeJobRef.current.threadId === activeThreadId;

  const handleStopGeneration = useCallback(() => {
    logger.action('App', 'Stop generation');
    const job = activeJobRef.current;
    if (job && job.threadId === threadRegistry.getActiveThreadId() && jobAbortRef.current) {
      jobAbortRef.current.abort();
      fetch('/api/chat/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Stop button pressed by user' }),
      }).catch((e) => logger.warn('App', 'POST /api/chat/cancel failed', e));
      // runJob.finally() clears the active job and promotes the queue
    }
  }, [threadRegistry]);

  // Pinned Focal Artifacts & Tier Overrides
  const focalArtifactIds = currentContainer?.focalArtifactIds || [];
  const manualTierOverrides = currentContainer?.tierOverrides || {};

  const handleToggleFocusArtifact = (artId: string) => {
    if (!currentContainer) return;
    const prev = currentContainer.focalArtifactIds || [];
    const next = prev.includes(artId) ? prev.filter((id: string) => id !== artId) : [...prev, artId];
    workspace.saveContainer({
      ...currentContainer,
      focalArtifactIds: next,
    });
    triggerReRender();
  };

  const handleChangeTierOverride = (artId: string, tier: ResolutionTier | null) => {
    if (!currentContainer) return;
    const nextOverrides = { ...currentContainer.tierOverrides };
    if (tier === null) {
      delete nextOverrides[artId];
    } else {
      nextOverrides[artId] = tier;
    }
    workspace.saveContainer({
      ...currentContainer,
      tierOverrides: nextOverrides,
    });
    triggerReRender();
  };

  // Compile Optical Context through compiler domain.
  // NOTE: focalIds = explicitly pinned artifacts ONLY. The selected/viewed
  // artifact is deliberately NOT injected here — selection only ever differs
  // from pins while the detail modal is open (chat cannot happen then), and
  // injecting it made "Current: Tier" and in-context state appear stuck no
  // matter what pin/tier/Auto the user clicked.
  const compiledContext = useMemo(() => {
    return compiler.compile({
      focalIds: focalArtifactIds,
      opticalMode,
      tokenCeiling: currentContainer?.tokenCeiling || 32000,
      tierOverrides: manualTierOverrides,
    });
  }, [compiler, focalArtifactIds, opticalMode, currentContainer?.tokenCeiling, manualTierOverrides, tick]);

  // Telemetry payload for SaturationOrb and EdgeHeatStrip
  const ambientTelemetry: AmbientTelemetryData = useMemo(() => {
    const tb = compiledContext.telemetry.tokenBreakdown;
    const ceiling = currentContainer?.tokenCeiling || 32000;
    return {
      activeChapterTokens: Math.round(tb.historyTokens * 0.7),
      olderChaptersTokens: Math.round(tb.historyTokens * 0.3),
      systemPromptTokens: tb.systemTokens,
      substrateTokens: tb.substrateTokens,
      totalTokens: tb.totalTokens,
      ceiling,
      opticalMode,
      saturationRatio: Math.min(1.0, tb.totalTokens / ceiling),
    };
  }, [compiledContext, currentContainer?.tokenCeiling, opticalMode]);

  // Construct view projection of Projects list for UI components
  const domainProjectsList = useMemo(() => {
    return workspace.listProjects().map((meta) => {
      const container = workspace.getProject(meta.id);
      return {
        id: meta.id,
        name: meta.name,
        codeName: meta.codeName,
        description: meta.description,
        color: meta.color,
        icon: 'Layers',
        currentChapterId: container?.activeChapterId || '',
        chapters: [],
        artifacts: [],
        nodes: [],
        edges: [],
      } as Project;
    });
  }, [workspace, tick]);

  // Construct active Project model snapshot for child UI components
  const activeProject: Project = useMemo(() => {
    const meta = currentContainer?.metadata;
    const domainArtifacts = artifactsDomain.listArtifacts();
    const domainChapters = segmentation.listChapters();
    const domainEdges = graph.listEdges();

    const chapters: Chapter[] = domainChapters.map((c, cIdx) => {
      // Ensure active/ongoing or last chapter captures all latest appended turns
      const isLastChapter = cIdx === domainChapters.length - 1;
      const isOngoing = c.status === 'active' || isLastChapter;
      const sliceEnd = isOngoing ? undefined : c.endIndex;
      const turns = timeline.getTurnSlice(c.startIndex, sliceEnd);
      const messages: ChatMessage[] = turns.map((t) => ({
        id: t.id,
        chapterId: c.id,
        role: t.role,
        content: t.content,
        timestamp: new Date(t.timestamp).toISOString(),
        extractedArtifacts: t.extractedArtifacts,
        meta: t.meta
          ? {
              model: t.meta.model || selectedModel.name,
              inputTokens: t.meta.promptTokens ?? t.meta.inputTokens ?? 0,
              outputTokens: t.meta.candidatesTokens ?? t.meta.outputTokens ?? 0,
              totalTokens: t.meta.totalTokens ?? 0,
              latencyMs: t.meta.durationMs ?? t.meta.latencyMs,
              interrupted: Boolean(t.meta.interrupted || t.meta.streamState === 'interrupted'),
              isStreaming: t.meta.isStreaming,
              streamState: t.meta.streamState,
              ...(t.meta as any),
            }
          : undefined,
      }));

      return {
        id: c.id,
        projectId: activeProjectId,
        title: c.title,
        summary: c.summary,
        keyPoints: [],
        isSummarized: Boolean(c.summary),
        compressionMode: 'full',
        status: c.status,
        createdAt: new Date().toISOString(),
        messages,
      };
    });

    const artifacts: Artifact[] = domainArtifacts;

    const nodes: GraphNode[] = domainArtifacts.map((art, idx) => ({
      id: `node-${art.id}`,
      artifactId: art.id,
      projectId: activeProjectId,
      title: art.title || art.current?.t0_label || 'Untitled',
      type: art.type,
      isHighConcept: art.isHighConcept,
      x: art.graph?.x ?? 300 + (idx % 5) * 180,
      y: art.graph?.y ?? 200 + Math.floor(idx / 5) * 120,
      status: 'active',
      tags: art.tags,
    }));

    const edges: GraphEdge[] = domainEdges.map((e) => ({
      id: e.id,
      sourceProjectId: activeProjectId,
      targetProjectId: activeProjectId,
      sourceNodeId: `node-${e.sourceId}`,
      targetNodeId: `node-${e.targetId}`,
      label: e.kind,
      type: 'dependency',
      strength: e.weight ?? 0.8,
    }));

    // Ensure chat interface is never hidden due to empty chapters array
    let finalChapters: Chapter[] = chapters;
    if (finalChapters.length === 0) {
      logger.info('App', 'No chapters registered in domain; synthesizing Genesis chapter to guarantee chat interface visibility');
      const allTurns = timeline.getTurnSlice(0, undefined);
      finalChapters = [
        {
          id: 'chap-genesis',
          projectId: activeProjectId,
          title: 'Genesis Chapter',
          summary: '',
          keyPoints: [],
          isSummarized: false,
          compressionMode: 'full',
          status: 'active',
          createdAt: new Date().toISOString(),
          messages: allTurns.map((t) => ({
            id: t.id,
            chapterId: 'chap-genesis',
            role: t.role,
            content: t.content,
            timestamp: new Date(t.timestamp).toISOString(),
            extractedArtifacts: t.extractedArtifacts,
            meta: t.meta
              ? {
                  model: t.meta.model || selectedModel.name,
                  inputTokens: t.meta.promptTokens ?? t.meta.inputTokens ?? 0,
                  outputTokens: t.meta.candidatesTokens ?? t.meta.outputTokens ?? 0,
                  totalTokens: t.meta.totalTokens ?? 0,
                  latencyMs: t.meta.durationMs ?? t.meta.latencyMs,
                  interrupted: Boolean(t.meta.interrupted || t.meta.streamState === 'interrupted'),
                  isStreaming: t.meta.isStreaming,
                  streamState: t.meta.streamState,
                  ...(t.meta as any),
                }
              : undefined,
          })),
        },
      ];
    }

    const fallbackId = activeProjectId || currentContainer?.metadata?.id || 'default-workspace';
    return {
      id: fallbackId,
      name: meta?.name || 'Untitled Project',
      codeName: meta?.codeName || 'IDEAS',
      description: meta?.description || 'A space for thinking out loud.',
      color: meta?.color || '#3b82f6',
      icon: 'Layers',
      currentChapterId: currentContainer?.activeChapterId || finalChapters[0]?.id || 'chap-genesis',
      chapters: finalChapters,
      artifacts,
      nodes,
      edges,
      lastActivity: new Date().toISOString(),
    };
  }, [
    activeProjectId,
    currentContainer,
    artifactsDomain,
    segmentation,
    timeline,
    graph,
    tick,
  ]);

  // Select Project & Launch Chat
  const handleSelectProjectAndLaunchChat = (projId: string) => {
    workspace.setActiveProject(projId);
    setActiveView('chat');
    setIsProjectLauncherOpen(false);
  };

  // Create Project & Launch Chat
  const handleCreateProject = (
    name: string,
    description: string,
    codeName: string,
    color: string
  ) => {
    const meta = workspace.createProject(name, description, color, codeName);
    workspace.setActiveProject(meta.id);
    setActiveView('chat');
    setIsProjectLauncherOpen(false);
  };

  // Node position handlers
  const handleUpdateNodePosition = (nodeId: string, x: number, y: number) => {
    const artId = nodeId.replace(/^node-/, '');
    const art = artifactsDomain.getArtifact(artId);
    if (art) {
      artifactsDomain.upsertArtifact({
        ...art,
        id: art.id,
        title: art.title || art.current?.t0_label || 'Untitled',
        graph: {
          ...art.graph,
          x,
          y,
        },
      });
    }
  };

  const handleBatchUpdateNodePositions = (
    updates: Array<{ nodeId: string; x: number; y: number }>
  ) => {
    updates.forEach((u) => {
      handleUpdateNodePosition(u.nodeId, u.x, u.y);
    });
  };

  // Add Edge
  const handleAddEdge = (edge: GraphEdge) => {
    const sArtId = edge.sourceNodeId ? edge.sourceNodeId.replace(/^node-/, '') : '';
    const tArtId = edge.targetNodeId ? edge.targetNodeId.replace(/^node-/, '') : '';

    if (sArtId && tArtId) {
      graph.addEdge(sArtId, tArtId, (edge.label as any) || 'relates_to', edge.strength || 1.0);
    }
  };

  // Update Artifact Resolution
  const handleUpdateArtifactResolution = (
    artifactId: string,
    resolution: AbstractionLevel
  ) => {
    const art = artifactsDomain.getArtifact(artifactId);
    if (art) {
      artifactsDomain.upsertArtifact({
        ...art,
        id: art.id,
        title: art.title,
        resolution,
      });
    }
  };

  const handleUpdateAllArtifactsResolution = (resolution: AbstractionLevel) => {
    const all = artifactsDomain.listArtifacts();
    all.forEach((art) => {
      artifactsDomain.upsertArtifact({
        ...art,
        id: art.id,
        title: art.title,
        resolution,
      });
    });
  };

  // Update Artifact Content (auto-records version history in domain)
  const handleUpdateArtifactContent = (artifactId: string, newContent: string) => {
    const art = artifactsDomain.getArtifact(artifactId);
    if (art) {
      versioning.recordRevision(art.id, newContent, 'Direct manual specification edit');
      artifactsDomain.updateTiers(art.id, { t3_body: newContent });
    }
  };

  // Add New Artifact
  const handleAddArtifact = (newArt: Artifact) => {
    // Idempotent by title (review P1 #7): extracted notes are already
    // auto-upserted via onArtifact with a different id — "Save as Artifact"
    // must update that record, not create a second copy.
    const title = (newArt.title || newArt.current?.t0_label || '').trim();
    const existing = !title
      ? undefined
      : artifactsDomain
        .listArtifacts()
        .find(
          (a) =>
            (a.title || a.current?.t0_label || '').trim() === title
        );
    artifactsDomain.upsertArtifact({
      id: existing?.id ?? newArt.id,
      title: newArt.title || newArt.current?.t0_label || 'Untitled',
      workspaceId: activeProjectId,
      code: newArt.code || newArt.id,
      type: newArt.type === 'chapter' ? 'chapter' : 'document',
      category: newArt.category || 'note',
      isHighConcept: Boolean(newArt.isHighConcept),
      color: newArt.color,
      current: newArt.current || {
        t0_label: newArt.title || 'Untitled',
        t1_abstract: '',
        t2_summary: '',
        t3_body: '',
      },
      tags: newArt.tags || [],
      createdAt: existing?.createdAt ?? newArt.createdAt ?? Date.now(),
      updatedAt: newArt.updatedAt ?? Date.now(),
      // Only copy coordinates when they are real numbers: imported artifacts
      // carry graph metadata without x/y, and `{x: undefined}` poisons
      // Firestore saves (see utils/storageSanitize.ts for the boundary guard).
      graph: (() => {
        const g: { x?: number; y?: number; is_high_concept?: boolean } = {
          is_high_concept: Boolean(newArt.isHighConcept),
        };
        if (typeof newArt.graph?.x === 'number') g.x = newArt.graph.x;
        if (typeof newArt.graph?.y === 'number') g.y = newArt.graph.y;
        return g;
      })(),
      resolution: newArt.resolution,
    });
    setSelectedArtifactId(existing?.id ?? newArt.id);
  };

  // Import-session land (multi-import plan): ALWAYS a separate artifact.
  // Unlike handleAddArtifact (title-idempotent for the chat flow), a colliding
  // frontmatter `id` must never silently overwrite an existing record — mint a
  // fresh id instead. Phase 2: when the body/code/title matches something
  // already imported, auto-attach a revision-of/duplicate-of relationship (the
  // flag) — never merge or block here; triage is post-import. Returns the final
  // id + flag so the session row can reference and display them.
  const handleImportArtifact = (newArt: Artifact): { id: string; flag: ImportFlag | null } => {
    let id = newArt.id;
    if (artifactsDomain.getArtifact(id)) {
      id = `art-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    }
    const flag = detectImportFlag(
      {
        title: newArt.title || newArt.current?.t0_label || '',
        code: newArt.code,
        body: newArt.current?.t3_body || '',
      },
      artifactsDomain.listArtifacts().map((a) => ({
        id: a.id,
        title: a.title || a.current?.t0_label || '',
        code: a.code,
        body: a.current?.t3_body || '',
      }))
    );
    artifactsDomain.upsertArtifact({
      id,
      title: newArt.title || newArt.current?.t0_label || 'Untitled',
      workspaceId: activeProjectId,
      code: newArt.code || id,
      type: newArt.type === 'chapter' ? 'chapter' : 'document',
      category: newArt.category || 'note',
      isHighConcept: Boolean(newArt.isHighConcept),
      color: newArt.color,
      current: newArt.current || {
        t0_label: newArt.title || 'Untitled',
        t1_abstract: '',
        t2_summary: '',
        t3_body: '',
      },
      tags: newArt.tags || [],
      createdAt: newArt.createdAt ?? Date.now(),
      updatedAt: newArt.updatedAt ?? Date.now(),
      // Number-only coordinates — `{x: undefined}` poisons Firestore saves
      // (same guard as handleAddArtifact; see utils/storageSanitize.ts).
      // Relationships: carry incoming edges + append the Phase-2 flag edge.
      graph: (() => {
        const relationships = [...(newArt.graph?.relationships || [])];
        if (flag) relationships.push(flagRelationship(flag));
        const g: {
          x?: number;
          y?: number;
          is_high_concept?: boolean;
          relationships?: Array<{ target: string; type: string; note?: string }>;
        } = {
          is_high_concept: Boolean(newArt.isHighConcept),
        };
        if (typeof newArt.graph?.x === 'number') g.x = newArt.graph.x;
        if (typeof newArt.graph?.y === 'number') g.y = newArt.graph.y;
        if (relationships.length > 0) g.relationships = relationships;
        return g;
      })(),
      resolution: newArt.resolution,
    });
    return { id, flag };
  };

  // Session lives at App level: closing ImportModal keeps the queue processing.
  const importSession = useImportSession(activeProject, handleImportArtifact);

  // ---- Phase 3: post-import triage (work AFTER the fact, never during) ----
  // Graph-only upsert that preserves everything else (incl. regenerating the
  // cached yamlDocument snapshot when the artifact had one).
  const upsertGraphOf = (art: Artifact, graph: NonNullable<Artifact['graph']>) => {
    const next: Artifact = { ...art, graph };
    artifactsDomain.upsertArtifact({
      ...next,
      ...(art.yamlDocument !== undefined ? { yamlDocument: serializeArtifactToYamlDoc(next) } : {}),
    });
  };

  // Dangling-edge + focus scrub for any artifact id leaving the workspace.
  const scrubReferencesTo = (deletedId: string) => {
    artifactsDomain.listArtifacts().forEach((a) => {
      const rels = a.graph?.relationships;
      if (!rels || !rels.some((r) => r.target === deletedId)) return;
      upsertGraphOf(a, {
        ...(a.graph || {}),
        relationships: rels.filter((r) => r.target !== deletedId),
      });
    });
    // One saveContainer for BOTH focal + tier scrub — two sync calls would
    // race on the same stale currentContainer snapshot.
    if (
      currentContainer &&
      ((currentContainer.focalArtifactIds || []).includes(deletedId) ||
        (currentContainer.tierOverrides && deletedId in currentContainer.tierOverrides))
    ) {
      const nextContainer = { ...currentContainer };
      if ((nextContainer.focalArtifactIds || []).includes(deletedId)) {
        nextContainer.focalArtifactIds = (nextContainer.focalArtifactIds || []).filter(
          (i: string) => i !== deletedId
        );
      }
      if (nextContainer.tierOverrides && deletedId in nextContainer.tierOverrides) {
        const overrides = { ...nextContainer.tierOverrides };
        delete overrides[deletedId];
        nextContainer.tierOverrides = overrides;
      }
      workspace.saveContainer(nextContainer);
    }
    if (selectedArtifactId === deletedId) setSelectedArtifactId(null);
    if (triageFocusId === deletedId) setTriageFocusId(null);
  };

  const handleTriageKeepBoth = (newId: string, oldId: string) => {
    const art = artifactsDomain.getArtifact(newId);
    if (!art) return;
    const rels = (art.graph?.relationships || []).filter(
      (r) => !(r.target === oldId && (r.type === 'revision-of' || r.type === 'duplicate-of'))
    );
    upsertGraphOf(art, { ...(art.graph || {}), relationships: rels });
    logger.action('App', `Triage: keep both — dismissed import flag ${newId} → ${oldId}`);
  };

  const handleTriageOverwrite = (newId: string, oldId: string) => {
    const oldArt = artifactsDomain.getArtifact(oldId);
    const newArt = artifactsDomain.getArtifact(newId);
    if (!oldArt || !newArt || oldId === newId) return;
    const oldBody = oldArt.current?.t3_body || '';
    const newBody = newArt.current?.t3_body || '';

    // 1) Snapshot pre-overwrite state (rollback target; content == state at record time).
    versioning.recordRevision(oldId, oldBody, 'Pre-overwrite snapshot (import triage)');

    // 2) Adopt new content/meta onto the OLD id — old keeps identity + coordinates.
    const graph: NonNullable<Artifact['graph']> = {
      is_high_concept: Boolean(newArt.isHighConcept),
    };
    if (typeof oldArt.graph?.x === 'number') graph.x = oldArt.graph.x;
    if (typeof oldArt.graph?.y === 'number') graph.y = oldArt.graph.y;
    const parent = newArt.graph?.parent || oldArt.graph?.parent;
    if (parent) graph.parent = parent;
    const rels = [
      ...(oldArt.graph?.relationships || []).filter((r) => r.target !== newId),
      // Incoming (non-flag) edges travel with the content; flag edges never
      // transfer — a carrier→old edge would become old→old, carrier→third
      // would misattribute the flag to the old artifact.
      ...(newArt.graph?.relationships || []).filter(
        (r) => r.type !== 'revision-of' && r.type !== 'duplicate-of'
      ),
    ];
    if (rels.length > 0) graph.relationships = rels;

    const merged: Artifact = {
      ...oldArt,
      title: newArt.title,
      code: newArt.code || oldArt.code,
      type: newArt.type,
      category: newArt.category,
      isHighConcept: Boolean(newArt.isHighConcept),
      tags: newArt.tags,
      current: newArt.current,
      resolution: newArt.resolution || oldArt.resolution,
      graph,
      updatedAt: Date.now(),
    };
    artifactsDomain.upsertArtifact({
      ...merged,
      yamlDocument: serializeArtifactToYamlDoc(merged),
    });

    // 3) Post state recorded so history's latest matches reality; rollback to
    //    the pre-overwrite entry restores the old body.
    versioning.recordRevision(oldId, newBody, `Overwritten by import triage from "${newArt.title}"`);

    // 4) Carrier removal + dangling-edge/focus scrub.
    artifactsDomain.deleteArtifact(newId);
    scrubReferencesTo(newId);
    logger.action(
      'App',
      `Triage: overwrote "${oldArt.title}" (${oldId}) with "${newArt.title}" (${newId}) — carrier removed, rollback available`
    );
  };

  const handleTriageDelete = (artifactId: string) => {
    const art = artifactsDomain.getArtifact(artifactId);
    artifactsDomain.deleteArtifact(artifactId);
    scrubReferencesTo(artifactId);
    logger.action('App', `Triage: deleted ${art?.title || artifactId}`);
  };

  // Declare New Chapter
  const handleDeclareChapter = (
    _messageId: string,
    title: string
  ) => {
    const currentTurnsCount = timeline.count();
    segmentation.declareNewChapter(title, currentTurnsCount, 'User split chapter boundary');
  };

  // Summarize Chapter
  const handleSummarizeChapter = async (chapterId: string) => {
    const target = segmentation.getChapter(chapterId);
    if (!target) {
      logger.warn('App', `Summarize requested for unknown chapter ${chapterId}`);
      return;
    }

    try {
      const turns = timeline.getTurnSlice(target.startIndex, target.endIndex);
      const res = await fetch('/api/summarize-chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: target.title,
          messages: turns.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(`summarize-chapter HTTP ${res.status}${errBody?.error ? `: ${errBody.error}` : ''}`);
      }
      const data = await res.json();
      segmentation.updateSummary(chapterId, data.summary);
    } catch (err) {
      logger.error('App', `Failed to summarize chapter ${chapterId}`, err);
    }
  };

  // Toggle Chapter Compression
  const handleToggleChapterCompressionMode = (
    _chapterId: string,
    _mode: 'summary' | 'full' | 'dropped'
  ) => {
    // Retained for component contract compatibility
  };

  // ── Thread-aware turn routing ──────────────────────────────────────────────
  // Live domains hold ONLY the active thread's turns/chapters; background
  // jobs write through the registry into the inactive thread's cached content.
  const isActiveThread = (threadId: string) => threadId === threadRegistry.getActiveThreadId();

  const getTurnsOf = (threadId: string) =>
    isActiveThread(threadId)
      ? timeline.getTurns()
      : threadRegistry.getInactiveContent(threadId)?.turns ?? [];

  const getChaptersOf = (threadId: string) =>
    isActiveThread(threadId)
      ? segmentation.listChapters()
      : threadRegistry.getInactiveContent(threadId)?.chapters ?? [];

  const appendTurnToThread = (
    threadId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    extractedArtifacts?: any[],
    meta?: any
  ) => {
    if (isActiveThread(threadId)) {
      return timeline.appendTurn(role, content, extractedArtifacts, meta);
    }
    const turn = threadRegistry.appendInactiveTurn(threadId, role, content, extractedArtifacts, meta);
    if (!turn) throw new Error(`appendInactiveTurn failed for thread ${threadId}`);
    return turn;
  };

  const updateTurnInThread = (threadId: string, turnId: string, partial: any) => {
    if (isActiveThread(threadId)) timeline.updateTurn(turnId, partial);
    else threadRegistry.updateInactiveTurn(threadId, turnId, partial);
  };

  // Stage-0 title: truncated first message, set at send time (instant sidebar
  // feedback even while the job sits in the queue). No LLM involved.
  const noteSendIntent = (threadId: string, text: string) => {
    const thread = threadRegistry.getThread(threadId);
    if (!thread) return;
    const existingUserTurns = getTurnsOf(threadId).filter((t) => t.role === 'user').length;
    const queuedNew = queueRef.current.filter(
      (j) => j.threadId === threadId && j.mode === 'new'
    ).length;
    if (
      existingUserTurns + queuedNew === 0 &&
      thread.titleVersion === 0 &&
      thread.titleState !== 'manual'
    ) {
      threadRegistry.patch(threadId, {
        title: placeholderTitle(text),
        titleState: 'placeholder',
        preview: text.slice(0, 100),
        lastActivityAt: Date.now(),
      });
    } else {
      threadRegistry.patch(threadId, { preview: text.slice(0, 100), lastActivityAt: Date.now() });
    }
  };

  // Staged titling pipeline — fires after a successful assistant reply:
  // stage1 after the 1st, stage2 once after the 3rd. Fire-and-forget meta
  // call; failures keep the current title (titles never block the UX).
  const maybeRetitle = (threadId: string) => {
    const thread = threadRegistry.getThread(threadId);
    if (!thread || thread.titleState === 'manual') return;
    const turns = getTurnsOf(threadId);
    const assistantCount = turns.filter(
      (t) =>
        t.role === 'assistant' &&
        t.meta?.streamState !== 'error' &&
        t.meta?.streamState !== 'interrupted'
    ).length;
    const step = titlePipelineStep(thread, assistantCount);
    if (!step) return;
    const version = step === 'stage1' ? 1 : 2;
    fetch('/api/title-thread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: sampleTurnsForTitle(turns), version }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: any) => {
        if (data?.title && threadRegistry.applyAutoTitle(threadId, data.title, version)) {
          logger.info('App', `Thread title ${step} applied`, { threadId, title: data.title });
          triggerReRender();
        }
      })
      .catch((err) => logger.warn('App', 'title-thread request failed', err));
  };

  // Execute ONE job (new send or retry) against its thread — active thread via
  // live domains, background threads via the registry cache.
  const executeTurn = async (job: QueueJob) => {
    const threadId = job.threadId;
    setStreamingStatus(`Connecting to ${selectedModel.name}...`);
    setStreamPhase('waiting');
    const controller = new AbortController();
    jobAbortRef.current = controller;

    let assistantTurnId: string;
    if (job.mode === 'retry' && job.turnId) {
      assistantTurnId = job.turnId;
      updateTurnInThread(threadId, assistantTurnId, {
        content: '',
        extractedArtifacts: [],
        meta: { model: selectedModel.name, isStreaming: true, streamState: 'connecting' },
      });
    } else {
      appendTurnToThread(threadId, 'user', job.text!);
      assistantTurnId = appendTurnToThread(threadId, 'assistant', '', [], {
        model: selectedModel.name,
        isStreaming: true,
        streamState: 'connecting',
      }).id;
    }
    triggerReRender();

    let streamedContent = '';
    let compiled: any = null;
    try {
      // Compile against THIS thread's turns/chapters (historyTurns override) —
      // background jobs must never leak the visible thread's context.
      compiled = compiler.compile({
        focalIds: focalArtifactIds,
        opticalMode,
        tokenCeiling: currentContainer?.tokenCeiling || 32000,
        tierOverrides: manualTierOverrides,
        log: true, // once-per-send lifecycle log (display memo must stay silent)
        historyTurns: getTurnsOf(threadId),
        historyChapters: getChaptersOf(threadId),
      });

      const result = await stream.executeStreamingTurn(
        {
          model: selectedModel.id,
          projectTitle: activeProject.name,
          compiledPrompt: compiled.compiledPrompt,
          systemInstruction: compiled.systemInstruction,
        },
        {
          signal: controller.signal,
          onStatus: (status) => {
            setStreamingStatus(status.message);
            setStreamPhase(status.state === 'writing' ? 'streaming' : 'waiting');
            updateTurnInThread(threadId, assistantTurnId, {
              meta: {
                model: status.model || selectedModel.name,
                isStreaming: true,
                streamState: status.state,
                durationMs: status.elapsedMs,
              },
            });
            triggerReRender();
          },
          onChunk: (_cleanDelta, accumulatedClean) => {
            streamedContent = accumulatedClean;
            setStreamPhase('streaming');
            updateTurnInThread(threadId, assistantTurnId, {
              content: accumulatedClean,
              meta: {
                model: selectedModel.name,
                isStreaming: true,
                streamState: 'writing',
              },
            });
            triggerReRender();
          },
          onTopicShift: (shift) => {
            if (isActiveThread(threadId)) {
              segmentation.declareNewChapter(shift.title, timeline.count(), shift.abstract);
            } else {
              threadRegistry.declareChapterInactive(
                threadId,
                shift.title,
                getTurnsOf(threadId).length,
                shift.abstract
              );
            }
            triggerReRender();
          },
          onArtifact: (u) => {
            const code = u.id || u.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
            const existing = artifactsDomain.getArtifact(code) || artifactsDomain.getArtifact(u.id);

            if (existing) {
              versioning.recordRevision(
                existing.id,
                u.content.t3_body,
                `Update from chat: ${u.content.t1_abstract}`
              );
            } else {
              const now = Date.now();
              const artTitle = u.title || 'Extracted note';
              const artDesc = u.content.t1_abstract || 'Extracted note.';
              const artSumm = u.content.t2_summary || artDesc;
              const artContent = u.content.t3_body || `# ${artTitle}\n\nExtracted note.`;
              const artColor = getMellowPastelColor(code);

              const newArtifact: Artifact = {
                id: u.id || `art-${now}`,
                workspaceId: activeProjectId,
                code,
                title: artTitle,
                type: u.type === 'chapter' ? 'chapter' : 'document',
                category: 'note',
                color: artColor,
                isHighConcept: false,
                current: {
                  t0_label: artTitle,
                  t1_abstract: artDesc,
                  t2_summary: artSumm,
                  t3_body: artContent,
                },
                tags: ['chat-extracted', u.type || 'note'],
                createdAt: now,
                updatedAt: now,
                graph: {
                  is_high_concept: false,
                  x: 300,
                  y: 200,
                },
                resolution: 'full',
              };
              artifactsDomain.upsertArtifact({
                ...newArtifact,
                yamlDocument: serializeArtifactToYamlDoc(newArtifact),
              });
            }
            triggerReRender();
          },
        }
      );

      // Finalize assistant turn with clean reply, extracted artifacts, and real Gemini API telemetry
      const extractedList = result.artifacts.map((u) => ({
        title: u.title,
        type: u.type,
        abstract: u.content.t1_abstract,
        summary: u.content.t2_summary,
        content: u.content.t3_body,
        highConcept: false,
      }));

      const isInterrupted = controller.signal.aborted;
      const estPrompt =
        result.telemetry?.promptTokens ??
        Math.max(1, Math.ceil((compiled.compiledPrompt?.length || 0) / 4));
      const estCand =
        result.telemetry?.candidatesTokens ??
        Math.max(1, Math.ceil(((result.cleanReply || streamedContent)?.length || 0) / 4));
      const totalTok = result.telemetry?.totalTokens ?? (estPrompt + estCand);

      updateTurnInThread(threadId, assistantTurnId, {
        content:
          result.cleanReply ||
          streamedContent ||
          (isInterrupted
            ? ''
            : extractedList.length > 0
              ? `Extracted ${extractedList.length} note${extractedList.length === 1 ? '' : 's'} — no prose reply came back.`
              : 'No reply came back. Try again.'),
        extractedArtifacts: extractedList,
        meta: {
          model: result.telemetry?.model || selectedModel.name,
          promptTokens: estPrompt,
          candidatesTokens: estCand,
          totalTokens: totalTok,
          inputTokens: estPrompt,
          outputTokens: estCand,
          durationMs: result.telemetry?.durationMs,
          timeToFirstChunkMs: result.telemetry?.timeToFirstChunkMs,
          rawMetadata: result.telemetry?.rawMetadata,
          isStreaming: false,
          streamState: isInterrupted ? 'interrupted' : 'completed',
          interrupted: isInterrupted,
        },
      });
      threadRegistry.patch(threadId, {
        lastOutcome: isInterrupted ? 'interrupted' : 'ok',
        lastActivityAt: Date.now(),
      });
      triggerReRender();
      logger.info('App', `Turn completed${isInterrupted ? ' (interrupted)' : ''}`, {
        threadId,
        model: result.telemetry?.model || selectedModel.name,
        totalTokens: totalTok,
        artifacts: extractedList.length,
        topicShifts: result.topicShift ? 1 : 0,
      });
      if (!isInterrupted) maybeRetitle(threadId);
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        const estPrompt = Math.max(
          1,
          Math.ceil(compiled?.telemetry?.tokenBreakdown?.totalTokens || 120)
        );
        const estCand = Math.max(1, Math.ceil((streamedContent?.length || 0) / 4));
        updateTurnInThread(threadId, assistantTurnId, {
          content: streamedContent || '',
          meta: {
            model: selectedModel.name,
            isStreaming: false,
            streamState: 'interrupted',
            interrupted: true,
            promptTokens: estPrompt,
            candidatesTokens: estCand,
            totalTokens: estPrompt + estCand,
            inputTokens: estPrompt,
            outputTokens: estCand,
          },
        });
        threadRegistry.patch(threadId, {
          lastOutcome: 'interrupted',
          lastActivityAt: Date.now(),
        });
        logger.info('App', 'Turn interrupted by user', {
          threadId,
          promptTokens: estPrompt,
          partialTokens: estCand,
        });
      } else {
        logger.error('App', 'Streaming turn failed', err);
        updateTurnInThread(threadId, assistantTurnId, {
          content: streamedContent || 'Error communicating with reasoning engine. Please try again.',
          meta: {
            model: selectedModel.name,
            isStreaming: false,
            streamState: 'error',
          },
        });
        threadRegistry.patch(threadId, { lastOutcome: 'error', lastActivityAt: Date.now() });
      }
      triggerReRender();
    } finally {
      jobAbortRef.current = null;
    }
  };

  // Serial queue runner: one job at a time; on completion promote the next.
  const runJob = async (job: QueueJob) => {
    activeJobRef.current = job;
    triggerReRender();
    try {
      await executeTurn(job);
    } catch (err) {
      logger.error('App', 'Queued job failed unexpectedly', err);
    } finally {
      activeJobRef.current = null;
      jobAbortRef.current = null;
      setStreamingStatus(null);
      setStreamPhase(null);
      triggerReRender();
      const next = queueRef.current.shift();
      if (next) void runJob(next);
    }
  };

  const enqueueJob = (job: QueueJob) => {
    queueRef.current.push(job);
    if (!activeJobRef.current) {
      const next = queueRef.current.shift();
      if (next) void runJob(next);
    } else {
      triggerReRender();
    }
  };

  const handleSendMessage = async (text: string) => {
    const threadId = threadRegistry.getActiveThreadId();
    if (!threadId) return;
    noteSendIntent(threadId, text);
    enqueueJob({
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      threadId,
      mode: 'new',
      text,
    });
  };

  // Cancel this thread's PENDING jobs (never touches an in-flight stream).
  const handleCancelQueued = (threadId: string) => {
    const before = queueRef.current.length;
    queueRef.current = queueRef.current.filter((j) => j.threadId !== threadId);
    const removed = before - queueRef.current.length;
    if (removed === 0) return;
    const thread = threadRegistry.getThread(threadId);
    const stillQueued = queueRef.current.some((j) => j.threadId === threadId);
    if (
      thread &&
      !stillQueued &&
      getTurnsOf(threadId).length === 0 &&
      thread.titleState === 'placeholder' &&
      thread.titleVersion === 0
    ) {
      // Nothing ever ran — drop the speculative placeholder title/preview.
      threadRegistry.patch(threadId, { title: 'New thread', preview: '' });
    }
    logger.action('App', 'Cancelled queued messages', { threadId, removed });
    triggerReRender();
  };

  // Regenerate the last assistant turn of the active thread (error/interrupted).
  const handleRetryThread = () => {
    const threadId = threadRegistry.getActiveThreadId();
    const turns = getTurnsOf(threadId);
    const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
    if (!lastAssistant) return;
    logger.action('App', 'Retry last assistant turn', { threadId, turnId: lastAssistant.id });
    enqueueJob({
      id: `job-${Date.now()}-retry`,
      threadId,
      mode: 'retry',
      turnId: lastAssistant.id,
    });
  };

  // Per-thread runtime for sidebar rows + chat header chip (derived, never persisted).
  const threadRuntimes = useMemo(() => {
    const map: Record<string, { state: ThreadRuntime; position: number }> = {};
    for (const t of threadRegistry.getThreads()) {
      map[t.id] = {
        state: deriveThreadRuntime(t, activeJobRef.current?.threadId ?? null, queueRef.current),
        position: queuePositionOf(t.id, queueRef.current),
      };
    }
    return map;
  }, [tick, threadRegistry]);
  // 1. Pre-flight Auth Gate: Loading State during initial auth probe
  if (!authInitialized) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-[#070b12] text-[#8ab1e0] font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#121c2d] border border-[#1e2e47] flex items-center justify-center text-[#e05a66] shadow-sm animate-pulse">
            <Brain className="w-6 h-6 text-[#e05a66]" />
          </div>
          <span className="text-xs font-mono text-[#526e91]">Connecting to MarkBrain...</span>
        </div>
      </div>
    );
  }

  // 2. Pre-flight Auth Gate: If user is not authenticated
  if (!currentUser) {
    return (
      <>
        <AuthGate
          onSignIn={signIn}
          onContinueLocal={continueLocal}
          onOpenServerLogs={() => setIsServerLogsOpen(true)}
        />
        <ServerLogsModal
          isOpen={isServerLogsOpen}
          onClose={() => setIsServerLogsOpen(false)}
        />
      </>
    );
  }

  // 2.5 Boot: signed in, cloud project list not resolved yet — hold the
  // loader so returning users never flash Genesis or an empty studio.
  if (cloudProjectsCount === null) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-[#070b12] text-[#8ab1e0] font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#121c2d] border border-[#1e2e47] flex items-center justify-center text-[#e05a66] shadow-sm animate-pulse">
            <Brain className="w-6 h-6 text-[#e05a66]" />
          </div>
          <span className="text-xs font-mono text-[#526e91]">Loading cloud projects...</span>
        </div>
      </div>
    );
  }

  // 3. Project Genesis: If user is authenticated but has zero cloud projects
  if (domainProjectsList.length === 0 || cloudProjectsCount === 0) {
    return (
      <>
        <ProjectGenesis
          user={currentUser}
          onCreateProject={createCloudWorkspace}
          onSignOut={signOut}
          onImportDatabase={() => importDbFileRef.current?.click()}
        />
        {dbImportInput}
        <ServerLogsModal
          isOpen={isServerLogsOpen}
          onClose={() => setIsServerLogsOpen(false)}
        />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d121c] text-[#e3edf7] font-sans relative p-0 m-0">
      {/* Extensible Left Sidebar with Floating Toggle */}
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((prev) => !prev)}
        projects={domainProjectsList}
        activeProject={activeProject}
        onSelectProject={(p) => workspace.setActiveProject(p.id)}
        selectedModel={selectedModel}
        availableModels={AVAILABLE_MODELS}
        onSelectModel={setSelectedModel}
        totalTokens={ambientTelemetry.totalTokens}
        activeView={activeView === 'graph' ? 'graph' : 'chat'}
        onChangeView={(v) => setActiveView(v)}
        opticalMode={opticalMode}
        onToggleOpticalMode={cycleOpticalMode}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenImport={() => setIsImportOpen(true)}
        onExportDatabase={handleExportDatabase}
        onImportDatabase={() => importDbFileRef.current?.click()}
        onOpenProjectLauncher={() => setIsProjectLauncherOpen(true)}
        onOpenServerLogs={() => setIsServerLogsOpen(true)}
        onSelectArtifact={(art) => setSelectedArtifactId(art.id)}
        selectedArtifactId={selectedArtifactId}
        onToggleFocus={handleToggleFocusArtifact}
        focalIds={focalArtifactIds}
        nodeTiers={compiledContext.nodeTiers}
        onChangeTierOverride={handleChangeTierOverride}
        tierOverrides={manualTierOverrides}
        onTriageArtifact={(id) => {
          logger.action('App', `Open revision triage focused on ${id}`);
          setTriageFocusId(id);
        }}
        currentUser={currentUser}
        onSignOut={signOut}
        threads={threadRegistry.getThreads()}
        activeThreadId={activeThreadId}
        threadRuntimes={threadRuntimes}
        onSelectThread={selectThread}
        onCreateThread={() => {
          createThread();
          setActiveView('chat');
        }}
        onRenameThread={(id, title) => threadRegistry.rename(id, title)}
        onDeleteThread={(id) => {
          handleCancelQueued(id);
          deleteThread(id);
        }}
      />

      {/* Main Single-Focused Viewport - ZERO TOP BAR */}
      <main className="flex-1 h-full min-h-0 min-w-0 flex flex-col overflow-hidden relative p-0 m-0">
        {/* Base Conversation & Graph Canvas (Takes 100% of vertical height) */}
        <div className="flex-1 h-full min-h-0 min-w-0 flex flex-col relative overflow-hidden p-0 m-0">
          {activeView === 'graph' ? (
            <div className="w-full h-full min-h-0 flex-1 relative flex flex-col">
              <SpatialGraph
                project={activeProject}
                onSelectArtifact={(art) => {
                  logger.action('App', `Spatial graph artifact selected: ${art.id}`);
                  setSelectedArtifactId(art.id);
                  setActiveView('chat');
                }}
                onAddEdge={handleAddEdge}
                onUpdateNodePosition={handleUpdateNodePosition}
                onBatchUpdateNodePositions={handleBatchUpdateNodePositions}
                focalIds={focalArtifactIds}
                onToggleFocus={handleToggleFocusArtifact}
                nodeTiers={compiledContext.nodeTiers}
                onOpenArtifactTree={() => setIsSidebarOpen(true)}
              />
            </div>
          ) : (
            <div className="w-full h-full min-h-0 flex-1 flex flex-col">
              <ChatErrorBoundary
                onReset={() => {
                  logger.action('App', 'Chat error boundary reset triggered');
                  triggerReRender();
                }}
                onOpenServerLogs={() => setIsServerLogsOpen(true)}
              >
                <ChatView
                  project={activeProject}
                  onSendMessage={handleSendMessage}
                  isLoading={isChatLoading}
                  streamingStatus={isChatLoading ? streamingStatus : null}
                  streamPhase={isChatLoading ? streamPhase : null}
                  onStopGeneration={handleStopGeneration}
                  threadTitle={threadRegistry.getThread(activeThreadId)?.title || 'New thread'}
                  threadTitleState={threadRegistry.getThread(activeThreadId)?.titleState || 'placeholder'}
                  threadRuntime={threadRuntimes[activeThreadId]?.state || 'idle'}
                  queuePosition={threadRuntimes[activeThreadId]?.position || 0}
                  onRenameThread={(title) => threadRegistry.rename(activeThreadId, title)}
                  onRetry={handleRetryThread}
                  onCancelQueued={() => handleCancelQueued(activeThreadId)}
                  onOpenServerLogs={() => setIsServerLogsOpen(true)}
                  onAddArtifactToProject={handleAddArtifact}
                  onSummarizeChapter={handleSummarizeChapter}
                  onToggleChapterCompressionMode={handleToggleChapterCompressionMode}
                  onDeclareChapter={handleDeclareChapter}
                  onNavigateToGraph={() => {
                    logger.action('App', 'Navigate from chat to graph view');
                    setActiveView('graph');
                  }}
                  onSelectArtifact={(art) => {
                    logger.action('App', `Chat artifact card selected: ${art.id}`);
                    setSelectedArtifactId(art.id);
                  }}
                />
              </ChatErrorBoundary>
            </div>
          )}

          {/* Import session still running while the modal is closed */}
          {importSession.running && !isImportOpen && (
            <button
              type="button"
              onClick={() => setIsImportOpen(true)}
              title="Open the import session"
              className="fixed bottom-4 left-4 z-30 px-3 py-1.5 rounded-full bg-[#0d1421]/90 backdrop-blur-md border border-[#162235] shadow-lg text-[10px] font-mono text-[#8ab1e0] hover:border-[#223552] transition-colors cursor-pointer flex items-center gap-2"
            >
              <span className="w-2 h-2 rounded-full bg-[#8ab1e0] animate-pulse" />
              <span>
                Importing…{' '}
                {importSession.rows.filter((r) => r.status === 'queued' || r.status === 'extracting').length}{' '}
                left
              </span>
            </button>
          )}

          {/* Presentation Telemetry: Floating Saturation Orb → opens the Mirror */}
          <SaturationOrb
            telemetry={ambientTelemetry}
            onClick={() => {
              logger.action('App', 'Open mirror (tap orb)');
              setIsMirrorOpen(true);
            }}
          />
          <MirrorPanel
            open={isMirrorOpen}
            onClose={() => {
              logger.action('App', 'Close mirror');
              setIsMirrorOpen(false);
            }}
            compiled={compiledContext}
            artifacts={activeProject.artifacts}
            chapters={activeProject.chapters}
            ceiling={ambientTelemetry.ceiling}
          />
        </div>

        {/* Presentation Telemetry: 5px Edge Heat Bar */}
        <EdgeHeatStrip telemetry={ambientTelemetry} />
      </main>

      {/* Live Server Telemetry & Logs Modal */}
      <ServerLogsModal
        isOpen={isServerLogsOpen}
        onClose={() => setIsServerLogsOpen(false)}
      />

      {/* Project Launcher Screen / Modal */}
      {isProjectLauncherOpen && (
        <ProjectLauncher
          projects={domainProjectsList}
          activeProjectId={activeProjectId}
          onSelectProjectAndLaunchChat={handleSelectProjectAndLaunchChat}
          onCreateProject={handleCreateProject}
          onDeleteProject={deleteWorkspace}
          onClose={() => setIsProjectLauncherOpen(false)}
          isDismissable={true}
        />
      )}

      {/* Import Modal */}
      {isImportOpen && (
        <ImportModal
          project={activeProject}
          onClose={() => setIsImportOpen(false)}
          onImportArtifact={handleAddArtifact}
          session={importSession}
          onOpenArtifact={(id) => {
            // Single-modal rule: hide import before opening the detail modal.
            setIsImportOpen(false);
            setSelectedArtifactId(id);
          }}
        />
      )}

      {/* Revision triage modal (Phase 3 — post-import duplicate/flag resolution) */}
      {triageFocusId !== null && (
        <RevisionTriageModal
          artifacts={activeProject.artifacts}
          focusId={triageFocusId}
          onClose={() => {
            logger.action('App', 'Close revision triage');
            setTriageFocusId(null);
          }}
          onKeepBoth={handleTriageKeepBoth}
          onOverwrite={handleTriageOverwrite}
          onDelete={handleTriageDelete}
        />
      )}

      {/* Export Modal */}
      {isExportOpen && (
        <ExportModal
          projects={domainProjectsList}
          activeProject={activeProject}
          onClose={() => setIsExportOpen(false)}
        />
      )}

      {/* Full-Screen Artifact Detail Modal */}
      {selectedArtifactId && (
        (() => {
          const art = activeProject.artifacts.find((a) => a.id === selectedArtifactId);
          if (!art) return null;
          return (
            <ArtifactDetailModal
              artifact={art}
              history={versioning.getHistory(art.id)}
              onClose={() => setSelectedArtifactId(null)}
              isInContext={focalArtifactIds.includes(art.id)}
              contextTier={compiledContext.nodeTiers[art.id]?.tier ?? 'culled'}
              onToggleInContext={handleToggleFocusArtifact}
              onChangeTierOverride={handleChangeTierOverride}
              tierOverride={manualTierOverrides[art.id] ?? null}
              tierReason={compiledContext.nodeTiers[art.id]?.reason}
              tierDistance={compiledContext.nodeTiers[art.id]?.distance}
            />
          );
        })()
      )}

      {/* Hidden trigger for full-database restore (Sidebar → Restore DB) */}
      {dbImportInput}
    </div>
  );
}
