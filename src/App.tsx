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
import { SaturationOrb } from './domains/04-presentation/telemetry/SaturationOrb';
import { EdgeHeatStrip } from './domains/04-presentation/telemetry/EdgeHeatStrip';
import { AmbientTelemetryData } from './domains/04-presentation/telemetry/ambientTelemetry';

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

    return () => {
      unsubWorkspace();
      unsubTimeline();
      unsubArtifacts();
      unsubVersioning();
      unsubGraph();
      unsubSegmentation();
    };
  }, [
    workspace,
    timeline,
    artifactsDomain,
    versioning,
    graph,
    segmentation,
    triggerReRender,
  ]);

  // Active Project ID from Workspace Domain
  const activeProjectId = workspace.getActiveProjectId();
  const currentContainer = workspace.getProject(activeProjectId);

  // Model selection (default to fast Gemini 3.1 Flash Lite)
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isProjectLauncherOpen, setIsProjectLauncherOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isServerLogsOpen, setIsServerLogsOpen] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

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

  // Chat loading & live streaming status state
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);

  // Active AbortController ref for canceling in-flight streams
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStopGeneration = useCallback(() => {
    logger.action('App', 'Stop generation');
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsChatLoading(false);
    setStreamingStatus(null);
    fetch('/api/chat/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Stop button pressed by user' }),
    }).catch((e) => logger.warn('App', 'POST /api/chat/cancel failed', e));
  }, []);

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

  // Compile Optical Context through compiler domain
  const focalList = useMemo(() => {
    return [
      ...(selectedArtifactId ? [selectedArtifactId] : []),
      ...focalArtifactIds,
    ];
  }, [selectedArtifactId, focalArtifactIds]);

  const compiledContext = useMemo(() => {
    return compiler.compile({
      focalIds: focalList,
      opticalMode,
      tokenCeiling: currentContainer?.tokenCeiling || 32000,
      tierOverrides: manualTierOverrides,
    });
  }, [compiler, focalList, opticalMode, currentContainer?.tokenCeiling, manualTierOverrides]);

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
    artifactsDomain.upsertArtifact({
      id: newArt.id,
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
      createdAt: newArt.createdAt ?? Date.now(),
      updatedAt: newArt.updatedAt ?? Date.now(),
      graph: newArt.graph,
      resolution: newArt.resolution,
    });
    setSelectedArtifactId(newArt.id);
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

  // Handle Send Message via Domain Engine with Live SSE Streaming & Cancellation
  const handleSendMessage = async (text: string) => {
    // 1. Append User Turn to Timeline & immediately trigger re-render so it never disappears
    timeline.appendTurn('user', text);
    triggerReRender();

    setIsChatLoading(true);
    setStreamingStatus(`Connecting to ${selectedModel.name}...`);

    // 2. Append in-flight Assistant Turn to Timeline & force immediate render
    const assistantTurn = timeline.appendTurn('assistant', '', [], {
      model: selectedModel.name,
      isStreaming: true,
      streamState: 'connecting',
    });
    triggerReRender();

    // Setup fresh AbortController for cancelability
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // 3. Compile optical context from domains
      const compiled = compiler.compile({
        focalIds: focalList,
        opticalMode,
        tokenCeiling: currentContainer?.tokenCeiling || 32000,
        tierOverrides: manualTierOverrides,
      });

      // 4. Stream chat turn via Stream Protocol Domain with abort signal
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
            timeline.updateTurn(assistantTurn.id, {
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
            timeline.updateTurn(assistantTurn.id, {
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
            const currentTurnsCount = timeline.count();
            segmentation.declareNewChapter(
              shift.title,
              currentTurnsCount,
              shift.abstract
            );
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

      // 5. Finalize assistant turn with clean reply, extracted artifacts, and real Gemini API telemetry
      const extractedList = result.artifacts.map((u) => ({
        title: u.title,
        type: u.type,
        abstract: u.content.t1_abstract,
        summary: u.content.t2_summary,
        content: u.content.t3_body,
        highConcept: false,
      }));

      const isInterrupted = controller.signal.aborted;
      const estPrompt = result.telemetry?.promptTokens ?? Math.max(1, Math.ceil((compiled.compiledPrompt?.length || 0) / 4));
      const estCand = result.telemetry?.candidatesTokens ?? Math.max(1, Math.ceil(((result.cleanReply || assistantTurn.content)?.length || 0) / 4));
      const totalTok = result.telemetry?.totalTokens ?? (estPrompt + estCand);

      timeline.updateTurn(assistantTurn.id, {
        content: result.cleanReply || assistantTurn.content || (isInterrupted ? '' : 'No reply came back. Try again.'),
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
      triggerReRender();
      logger.info('App', `Turn completed${isInterrupted ? ' (interrupted)' : ''}`, {
        model: result.telemetry?.model || selectedModel.name,
        totalTokens: totalTok,
        artifacts: extractedList.length,
        topicShifts: result.topicShift ? 1 : 0,
      });
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        const estPrompt = Math.max(1, Math.ceil((compiledContext.telemetry.tokenBreakdown.totalTokens || 120)));
        const estCand = Math.max(1, Math.ceil((assistantTurn.content?.length || 0) / 4));
        timeline.updateTurn(assistantTurn.id, {
          content: assistantTurn.content || '',
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
        logger.info('App', 'Turn interrupted by user', { promptTokens: estPrompt, partialTokens: estCand });
      } else {
        logger.error('App', 'Streaming turn failed', err);
        timeline.updateTurn(assistantTurn.id, {
          content: assistantTurn.content || 'Error communicating with reasoning engine. Please try again.',
          meta: {
            model: selectedModel.name,
            isStreaming: false,
            streamState: 'error',
          },
        });
      }
      triggerReRender();
    } finally {
      setIsChatLoading(false);
      setStreamingStatus(null);
      abortControllerRef.current = null;
      triggerReRender();
    }
  };

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
        currentUser={currentUser}
        onSignOut={signOut}
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
                  streamingStatus={streamingStatus}
                  onStopGeneration={handleStopGeneration}
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

          {/* Presentation Telemetry: Floating Saturation Orb */}
          <SaturationOrb telemetry={ambientTelemetry} onClick={cycleOpticalMode} />
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
            />
          );
        })()
      )}

      {/* Hidden trigger for full-database restore (Sidebar → Restore DB) */}
      {dbImportInput}
    </div>
  );
}
