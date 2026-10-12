import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Project,
  Artifact,
  GraphNode,
  GraphEdge,
  Chapter,
  ChatMessage,
  ModelOption,
  AbstractionLevel,
  ArtifactVersion,
  ResolutionTier,
  getMellowPastelColor,
} from './types';
import { AVAILABLE_MODELS } from './data/initialData';
import { serializeArtifactToYamlDoc } from './utils/yamlArtifactParser';
import { ActiveView } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { SpatialGraph } from './components/SpatialGraph';
import { ChatView } from './components/ChatView';
import { ImportModal } from './components/ImportModal';
import { ExportModal } from './components/ExportModal';
import { ProjectLauncher } from './components/ProjectLauncher';
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
  } = useDomains();

  // Tick state to force re-render on domain events
  const [, setTick] = useState(0);
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

  // Model selection
  const [selectedModel, setSelectedModel] = useState<ModelOption>(AVAILABLE_MODELS[1]); // Gemini 3.8 Flash

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isProjectLauncherOpen, setIsProjectLauncherOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  // Chat loading state
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Pinned Focal Artifacts & Tier Overrides
  const focalArtifactIds = currentContainer?.focalArtifactIds || [];
  const manualTierOverrides = currentContainer?.tierOverrides || {};

  const handleToggleFocusArtifact = (artId: string) => {
    if (!currentContainer) return;
    const prev = currentContainer.focalArtifactIds || [];
    const next = prev.includes(artId) ? prev.filter((id) => id !== artId) : [...prev, artId];
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
      tokenCeiling: ceiling,
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
        boundaryRules: 'Cross-repo linking bridges high-concept architecture specs.',
        currentChapterId: container?.activeChapterId || '',
        chapters: [],
        artifacts: [],
        nodes: [],
        edges: [],
      } as Project;
    });
  }, [workspace]);

  // Construct active Project model snapshot for child UI components
  const activeProject: Project = useMemo(() => {
    const meta = currentContainer?.metadata;
    const domainArtifacts = artifactsDomain.listArtifacts();
    const domainChapters = segmentation.listChapters();
    const domainEdges = graph.listEdges();

    const chapters: Chapter[] = domainChapters.map((c) => {
      const turns = timeline.getTurnSlice(c.startIndex, c.endIndex);
      const messages: ChatMessage[] = turns.map((t) => ({
        id: t.id,
        chapterId: c.id,
        role: t.role,
        content: t.content,
        timestamp: new Date(t.timestamp).toISOString(),
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

    return {
      id: activeProjectId,
      name: meta?.name || 'Workspace',
      codeName: meta?.codeName || 'workspace',
      description: meta?.description || '',
      color: meta?.color || '#be3a49',
      icon: 'Layers',
      boundaryRules: 'Cross-repo linking bridges high-concept architecture specs.',
      currentChapterId: currentContainer?.activeChapterId || chapters[0]?.id || '',
      chapters,
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
        title: art.title || art.current?.t0_label || 'Untitled',
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
        title: art.title || art.current?.t0_label || 'Untitled',
        resolution,
      });
    });
  };

  // Update Artifact Content (auto-records version history in domain)
  const handleUpdateArtifactContent = (artifactId: string, newContent: string) => {
    const art = artifactsDomain.getArtifact(artifactId);
    if (art) {
      versioning.recordRevision(art.id, newContent, 'Direct manual specification edit');
      const updated = artifactsDomain.getArtifact(artifactId);
      if (updated) {
        artifactsDomain.upsertArtifact({
          ...updated,
          id: updated.id,
          title: updated.title || updated.current?.t0_label || 'Untitled',
          yamlDocument: serializeArtifactToYamlDoc(updated),
        });
      }
    }
  };

  // Non-Destructive Version Rollback
  const handleRestoreArtifactVersion = (
    artifactId: string,
    targetVersion: ArtifactVersion
  ) => {
    const art = artifactsDomain.getArtifact(artifactId);
    if (art) {
      versioning.rollback(art.id, targetVersion.version);
      const updated = artifactsDomain.getArtifact(artifactId);
      if (updated) {
        artifactsDomain.upsertArtifact({
          ...updated,
          id: updated.id,
          title: updated.title || updated.current?.t0_label || 'Untitled',
          yamlDocument: serializeArtifactToYamlDoc(updated),
        });
      }
    }
  };

  // Add New Artifact
  const handleAddArtifact = (newArt: Artifact) => {
    const artWithYaml: Artifact = {
      ...newArt,
      yamlDocument: serializeArtifactToYamlDoc(newArt),
    };
    artifactsDomain.upsertArtifact({
      ...artWithYaml,
      id: artWithYaml.id,
      title: artWithYaml.title || artWithYaml.current?.t0_label || 'Untitled',
    });
    setSelectedArtifactId(artWithYaml.id);
  };

  // Declare New Chapter
  const handleDeclareChapter = (
    _messageId: string,
    title: string
  ) => {
    const currentTurnsCount = timeline.listTurns().length;
    segmentation.declareNewChapter(title, currentTurnsCount, 'User split chapter boundary');
  };

  // Summarize Chapter
  const handleSummarizeChapter = async (chapterId: string) => {
    const activeChap = segmentation.getActiveChapter();
    if (!activeChap) return;

    try {
      const turns = timeline.getTurnSlice(activeChap.startIndex, activeChap.endIndex);
      const res = await fetch('/api/summarize-chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: activeChap.title,
          messages: turns.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = await res.json();
      segmentation.updateSummary(chapterId, data.summary);
    } catch (err) {
      console.error('Failed to summarize chapter:', err);
    }
  };

  // Toggle Chapter Compression
  const handleToggleChapterCompressionMode = (
    _chapterId: string,
    _mode: 'summary' | 'full' | 'dropped'
  ) => {
    // Retained for component contract compatibility
  };

  // Handle Send Message via Domain Engine
  const handleSendMessage = async (text: string) => {
    // 1. Append User Turn to Timeline
    timeline.appendTurn('user', text);

    setIsChatLoading(true);

    try {
      // 2. Compile optical context
      const compiled = compiler.compile({
        focalIds: focalList,
        opticalMode,
        tokenCeiling: currentContainer?.tokenCeiling || 32000,
        tierOverrides: manualTierOverrides,
      });

      // 3. Send POST /api/chat
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel.id,
          projectTitle: activeProject.name,
          compiledPrompt: compiled.compiledPrompt,
          systemInstruction: compiled.systemInstruction,
        }),
      });

      const data = await res.json();
      const rawText = data.rawReply || data.reply || '';

      // 4. Demux stream turn using stream protocol domain
      const parsedTurn = stream.demuxFullTurn(rawText);
      const cleanReplyText = parsedTurn.cleanContent || data.reply || 'Synthesized architecture verified.';

      // 5. If topic shift detected, declare new chapter
      if (parsedTurn.topicShift) {
        const currentTurnsCount = timeline.listTurns().length;
        segmentation.declareNewChapter(
          parsedTurn.topicShift.title,
          currentTurnsCount,
          parsedTurn.topicShift.abstract
        );
      }

      // 6. If artifact upserts present, process upserts in artifacts domain
      if (parsedTurn.artifactUpserts.length > 0) {
        parsedTurn.artifactUpserts.forEach((u, idx) => {
          const code = u.id || u.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
          const existing = artifactsDomain.getArtifact(code) || artifactsDomain.getArtifact(u.id);

          if (existing) {
            versioning.recordRevision(
              existing.id,
              u.content.t3_body,
              `Synthesized update from chat: ${u.content.t1_abstract}`
            );
          } else {
            const now = Date.now();
            const artTitle = u.title || 'Synthesized Artifact';
            const artDesc = u.content.t1_abstract || 'Synthesized specification.';
            const artSumm = u.content.t2_summary || artDesc;
            const artContent = u.content.t3_body || `# ${artTitle}\n\nSynthesized specification.`;
            const artColor = getMellowPastelColor(code);

            const activeChap = segmentation.getActiveChapter();
            const chapId = activeChap ? activeChap.id : 'chap-1';

            const newArtifact: Artifact = {
              id: u.id || `art-${now}-${idx}`,
              workspace_id: activeProjectId,
              projectId: activeProjectId,
              code,
              title: artTitle,
              type: u.type || 'document',
              category: 'system-spec',
              color: artColor,
              description: artDesc,
              summary: artSumm,
              content: artContent,
              created_at: now,
              updated_at: now,
              current: {
                t0_label: artTitle,
                t1_abstract: artDesc,
                t2_summary: artSumm,
                t3_body: artContent,
              },
              revisions: [],
              relations: [{ target_artifact_id: chapId, kind: 'born_from' }],
              provenance: {
                origin_chapter_id: chapId,
                mutation_chapter_ids: [],
              },
              graph: {
                is_high_concept: false,
                x: 300 + idx * 180,
                y: 200 + idx * 40,
              },
              isHighConcept: false,
              resolution: 'full',
              history: [
                {
                  version: 1,
                  timestamp: new Date().toISOString(),
                  changeSummary: 'Initial synthesis from architectural chat session',
                  content: artContent,
                },
              ],
              tags: ['chat-synthesized', u.type || 'architecture'],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            newArtifact.yamlDocument = serializeArtifactToYamlDoc(newArtifact);
            artifactsDomain.upsertArtifact({
              ...newArtifact,
              id: newArtifact.id,
              title: newArtifact.title,
            });
          }
        });
      }

      // 7. If links present, add edges in graph domain
      if (parsedTurn.links.length > 0) {
        parsedTurn.links.forEach((link) => {
          graph.addEdge(link.source, link.target, link.kind, 1.0);
        });
      }

      // 8. Append Assistant Turn to Timeline
      const extractedList = parsedTurn.artifactUpserts.map((u) => ({
        title: u.title,
        type: u.type,
        abstract: u.content.t1_abstract,
        summary: u.content.t2_summary,
        content: u.content.t3_body,
        highConcept: false,
      }));

      timeline.appendTurn('assistant', cleanReplyText, extractedList);
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setIsChatLoading(false);
    }
  };

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
        onOpenProjectLauncher={() => setIsProjectLauncherOpen(true)}
        onSelectArtifact={(art) => setSelectedArtifactId(art.id)}
        selectedArtifactId={selectedArtifactId}
        onToggleFocus={handleToggleFocusArtifact}
        focalIds={focalArtifactIds}
        nodeTiers={compiledContext.nodeTiers}
        onChangeTierOverride={handleChangeTierOverride}
      />

      {/* Main Single-Focused Viewport */}
      <main className="flex-1 h-full flex overflow-hidden relative p-0 m-0">
        {/* Base Conversation Canvas */}
        <div className="flex-1 h-full relative overflow-hidden p-0 m-0">
          {activeView === 'graph' ? (
            <div className="w-full h-full relative">
              <SpatialGraph
                project={activeProject}
                onSelectArtifact={(art) => {
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
            <div className="w-full h-full">
              <ChatView
                project={activeProject}
                onSendMessage={handleSendMessage}
                isLoading={isChatLoading}
                onAddArtifactToProject={handleAddArtifact}
                onSummarizeChapter={handleSummarizeChapter}
                onToggleChapterCompressionMode={handleToggleChapterCompressionMode}
                onDeclareChapter={handleDeclareChapter}
                onNavigateToGraph={() => setActiveView('graph')}
              />
            </div>
          )}

          {/* Presentation Telemetry: Floating Saturation Orb */}
          <SaturationOrb telemetry={ambientTelemetry} onClick={cycleOpticalMode} />
        </div>

        {/* Presentation Telemetry: 5px Edge Heat Bar */}
        <EdgeHeatStrip telemetry={ambientTelemetry} />
      </main>

      {/* Project Launcher Screen / Modal */}
      {isProjectLauncherOpen && (
        <ProjectLauncher
          projects={domainProjectsList}
          activeProjectId={activeProjectId}
          onSelectProjectAndLaunchChat={handleSelectProjectAndLaunchChat}
          onCreateProject={handleCreateProject}
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
    </div>
  );
}
