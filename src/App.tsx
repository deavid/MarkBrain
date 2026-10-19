import { useState, useEffect, useCallback, useRef } from 'react';
import { ModelOption } from './types';
import { FALLBACK_MODEL } from './data/models';
import { Sidebar, ActiveView } from './ui/workspace/Sidebar';
import { SpatialGraph } from './ui/graph/SpatialGraph';
import { ChatView } from './ui/chat/ChatView';
import { ChatErrorBoundary } from './ui/workspace/ChatErrorBoundary';
import { AuthGate } from './ui/workspace/AuthGate';
import { BootSplash } from './ui/workspace/BootSplash';
import { ProjectGenesis } from './ui/workspace/ProjectGenesis';
import { ProjectLauncher } from './ui/workspace/ProjectLauncher';
import { ServerLogsModal } from './ui/workspace/ServerLogsModal';
import { ArtifactDetailModal } from './ui/artifacts/ArtifactDetailModal';
import { ImportModal } from './ui/artifacts/ImportModal';
import { ExportModal } from './ui/artifacts/ExportModal';
import { RevisionTriageModal } from './ui/artifacts/RevisionTriageModal';
import { ThreadSwitcher } from './ui/chat/ThreadSwitcher';
import { SaturationOrb } from './ui/context/SaturationOrb';
import { EdgeHeatStrip } from './ui/context/EdgeHeatStrip';
import { MirrorPanel } from './ui/context/MirrorPanel';
import { logger } from './utils/logger';
import { useDomains } from './domains/DomainRegistry';
import { useImportSession } from './ui/artifacts/import/useImportSession';
import { SendQueue } from './application/sendQueue';
import type { SendQueueDeps } from './application/sendQueue';
import { chatCancel, titleThread, models as fetchModels } from './gateway/api';

// Feature-slice modules — handlers/projections extracted from this file
import { useOpticalContext } from './ui/context/useOpticalContext';
import { groupTurnsByChapter } from './domains/02-chapter-segmentation';
import type { ProjectExportInput } from './utils/tokenCalculator';
import { createWorkspaceHandlers } from './ui/workspace/createWorkspaceHandlers';
import { useDatabaseTransfer } from './ui/workspace/useDatabaseTransfer';
import { createArtifactHandlers } from './ui/artifacts/createArtifactHandlers';
import { createGraphHandlers } from './ui/graph/createGraphHandlers';
import { createChapterHandlers } from './ui/chat/createChapterHandlers';
import { useThreadUi } from './ui/chat/useThreadUi';
import { useThreadSwitcher } from './ui/chat/useThreadSwitcher';
import { createSuggestTitle } from './ui/chat/createSuggestTitle';

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

  // Model catalog — server-owned (GET /api/models, unauthenticated), fetched
  // once on boot. Until it lands — or if it fails — the picker renders
  // [FALLBACK_MODEL], the same always-populated state the old static list had
  // (failure never becomes visible where it wasn't before).
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([FALLBACK_MODEL]);
  const [selectedModel, setSelectedModel] = useState<ModelOption>(FALLBACK_MODEL);

  useEffect(() => {
    let alive = true;
    fetchModels()
      .then((data) => {
        const list = data?.models;
        if (!alive || !Array.isArray(list) || list.length === 0) return; // keep fallback
        setAvailableModels(list);
        setSelectedModel((prev) =>
          list.find((m) => m.id === prev.id) ?? // preserve any user choice
            list.find((m) => m.id === data.default) ?? // catalog default
            list[0]
        );
      })
      .catch((e) => logger.warn('App', 'GET /api/models failed — keeping fallback model', e));
    return () => {
      alive = false;
    };
  }, []);

  // Optical Mode state from current container or default
  const opticalMode = currentContainer?.opticalMode || 'autofocus';

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

  // Full-database backup / restore trigger + handlers → ui/workspace slice
  const { importDbFileRef, handleExportDatabase, dbImportInput } = useDatabaseTransfer();

  // Workspace/project CRUD + optical-mode handlers → ui/workspace slice
  const { cycleOpticalMode, handleSelectProjectAndLaunchChat, handleCreateProject } =
    createWorkspaceHandlers({
      workspace,
      currentContainer,
      triggerReRender,
      setActiveView,
      setIsProjectLauncherOpen,
      opticalMode,
    });

  // ── Serial generation queue ────────────────────────────────────────────────
  // One stream at a time (Gemini quota + serial by design). Sends in other
  // threads enqueue; queued sends within one thread buffer-append (each job =
  // one user turn + one assistant turn when it starts).
  // Orchestration (queue refs, pump, executeTurn, title pipeline, handlers)
  // lives in application/sendQueue.ts. This component keeps only PRESENTATION
  // state: streamingStatus/streamPhase are ChatView display strings, driven by
  // the queue through injected setters; the re-render tick stays here too.
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [streamPhase, setStreamPhase] = useState<'waiting' | 'streaming' | null>(null);

  // Queue-owned refs (pending jobs / active job / abort controller) moved into
  // the module. Deps are re-published on every render (publish block below);
  // the queue snapshots deps + render context when a chain starts.
  const queueDepsRef = useRef<SendQueueDeps | null>(null);
  const sendQueueRef = useRef<SendQueue | null>(null);
  if (!sendQueueRef.current) sendQueueRef.current = new SendQueue(() => queueDepsRef.current!);
  const sendQueue = sendQueueRef.current;

  // Derived (queue refs aren't reactive — every queue mutation calls triggerReRender)
  const activeThreadId = threadRegistry.getActiveThreadId();
  const isChatLoading = sendQueue.getActiveJob()?.threadId === activeThreadId;

  // Queue presentation wrappers + per-thread runtimes + unread tracking → ui/chat slice
  const {
    handleStopGeneration,
    handleSendMessage,
    handleCancelQueued,
    handleRetryThread,
    threadRuntimes,
    unreadThreadIds,
    markThreadUnread,
    clearThreadUnread,
  } = useThreadUi({ sendQueue, threadRegistry, tick });

  // Pinned Focal Artifacts & Tier Overrides
  const focalArtifactIds = currentContainer?.focalArtifactIds || [];
  const manualTierOverrides = currentContainer?.tierOverrides || {};

  // Optical Context compile + ambient telemetry → ui/context slice
  const { compiledContext, ambientTelemetry } = useOpticalContext({
    compiler,
    currentContainer,
    focalArtifactIds,
    manualTierOverrides,
    opticalMode,
    tick,
  });

  // Domain reads + selectors — NO projection layer (08_UNIFIED_DATA_MODEL.md D6).
  // tick re-derives after domain events; shapes below are domain types and the
  // chapter-turns selector output, so the mirror/compiler read the same bytes.
  const domainProjectsList = workspace.listProjects();
  const projectMeta = currentContainer?.metadata ?? {
    id: activeProjectId || 'default-workspace',
    name: 'Untitled Project',
    codeName: 'IDEAS',
    description: 'A space for thinking out loud.',
    color: '#3b82f6',
    createdAt: 0,
    updatedAt: 0,
  };
  const chapterGroups = groupTurnsByChapter(timeline, segmentation, projectMeta.id);
  const domainArtifacts = artifactsDomain.listArtifacts();
  const domainEdges = graph.listEdges();
  void tick; // re-render trigger for domain events
  const activeProjectExport: ProjectExportInput = {
    meta: projectMeta,
    artifacts: domainArtifacts,
    chapters: chapterGroups,
    edges: domainEdges,
  };

  // Artifact CRUD / pin & tier overrides / import landing / Phase-3 triage
  // → ui/artifacts slice (same handler names ChatView/Sidebar/modals already bind)
  const {
    handleToggleFocusArtifact,
    handleChangeTierOverride,
    handleAddArtifact,
    handleImportArtifact,
    handleTriageKeepBoth,
    handleTriageOverwrite,
    handleTriageDelete,
  } = createArtifactHandlers({
    artifactsDomain,
    versioning,
    workspace,
    activeProjectId,
    currentContainer,
    triggerReRender,
    selectedArtifactId,
    setSelectedArtifactId,
    triageFocusId,
    setTriageFocusId,
  });

  // Session lives at App level: closing ImportModal keeps the queue processing.
  const importSession = useImportSession(projectMeta, handleImportArtifact);

  // Graph node/edge handlers → ui/graph slice
  const { handleUpdateNodePosition, handleBatchUpdateNodePositions, handleAddEdge } =
    createGraphHandlers({ artifactsDomain, graph });

  // Chapter declare/summarize handlers → ui/chat slice
  const { handleDeclareChapter, handleSummarizeChapter } =
    createChapterHandlers({ timeline, segmentation });

  // ── Publish deps for application/sendQueue.ts ──────────────────────────────
  // Re-assigned every render; the queue snapshots deps + getContext() when a
  // chain starts (same closure semantics the inline implementation had).
  // Call sites stay in App.tsx; both POSTs now go through gateway/api.ts.
  const requestAutoTitle = (
    messages: Array<{ role: string; content: string }>,
    version: number
  ): Promise<string | null> =>
    titleThread({ messages, version })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: any) => data?.title ?? null);

  const postChatCancel = (reason: string) => {
    chatCancel(reason).catch((e) => logger.warn('App', 'POST /api/chat/cancel failed', e));
  };

  queueDepsRef.current = {
    threadRegistry,
    timeline,
    segmentation,
    artifacts: artifactsDomain,
    versioning,
    compiler,
    stream,
    triggerReRender,
    setStreamingStatus,
    setStreamPhase,
    markThreadUnread,
    requestAutoTitle,
    postChatCancel,
    confirm: (message: string) => window.confirm(message),
    getContext: () => ({
      model: selectedModel,
      projectId: activeProjectId,
      projectTitle: projectMeta.name,
      focalIds: focalArtifactIds,
      opticalMode,
      tokenCeiling: currentContainer?.tokenCeiling || 32000,
      tierOverrides: manualTierOverrides,
    }),
  };

  // Quick switcher open-state + Cmd/Ctrl+K/N/Shift+A shortcuts → ui/chat slice
  const { isSwitcherOpen, setIsSwitcherOpen } = useThreadSwitcher({
    createThread,
    threadRegistry,
    setActiveView,
  });

  // User-initiated title suggestion (POST /api/title-thread via gateway)
  const handleSuggestTitle = createSuggestTitle({ sendQueue, threadRegistry, triggerReRender });

  // 1. Pre-flight Auth Gate: Loading State during initial auth probe
  if (!authInitialized) {
    return <BootSplash label="Connecting to MarkBrain..." />;
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
    return <BootSplash label="Loading cloud projects..." />;
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
        activeProject={projectMeta}
        artifacts={domainArtifacts}
        tokenCeiling={currentContainer?.tokenCeiling || 32000}
        onSelectProject={(p) => workspace.setActiveProject(p.id)}
        selectedModel={selectedModel}
        availableModels={availableModels}
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
        folders={threadRegistry.getFolders()}
        activeThreadId={activeThreadId}
        threadRuntimes={threadRuntimes}
        onSelectThread={(id) => {
          clearThreadUnread(id);
          selectThread(id);
        }}
        onCreateThread={(folderId) => {
          const id = createThread();
          if (folderId) threadRegistry.patch(id, { folderId });
          setActiveView('chat');
        }}
        onRenameThread={(id, title) => threadRegistry.rename(id, title)}
        onDeleteThread={(id) => {
          handleCancelQueued(id);
          deleteThread(id);
        }}
        onMoveThread={(id, folderId) => threadRegistry.moveThreadToFolder(id, folderId)}
        onArchiveThread={(id) => threadRegistry.setThreadLifecycle(id, 'archived')}
        onUnarchiveThread={(id) => threadRegistry.setThreadLifecycle(id, 'active')}
        onCreateFolder={(name) => threadRegistry.createFolder(name)}
        onRenameFolder={(id, name) => threadRegistry.renameFolder(id, name)}
        onDeleteFolder={(id) => threadRegistry.deleteFolder(id)}
        onReorderFolders={(dragId, targetId) => threadRegistry.reorderFolderBefore(dragId, targetId)}
        onSuggestTitle={handleSuggestTitle}
        unreadThreadIds={unreadThreadIds}
      />

      {/* Main Single-Focused Viewport - ZERO TOP BAR */}
      <main className="flex-1 h-full min-h-0 min-w-0 flex flex-col overflow-hidden relative p-0 m-0">
        {/* Base Conversation & Graph Canvas (Takes 100% of vertical height) */}
        <div className="flex-1 h-full min-h-0 min-w-0 flex flex-col relative overflow-hidden p-0 m-0">
          {activeView === 'graph' ? (
            <div className="w-full h-full min-h-0 flex-1 relative flex flex-col">
              <SpatialGraph
                projectId={projectMeta.id}
                artifacts={domainArtifacts}
                edges={domainEdges}
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
                  project={projectMeta}
                  chapters={chapterGroups}
                  onSendMessage={handleSendMessage}
                  isLoading={isChatLoading}
                  streamingStatus={isChatLoading ? streamingStatus : null}
                  streamPhase={isChatLoading ? streamPhase : null}
                  onStopGeneration={handleStopGeneration}
                  threadTitle={threadRegistry.getThread(activeThreadId)?.title || 'New thread'}
                  threadTitleState={threadRegistry.getThread(activeThreadId)?.titleState || 'placeholder'}
                  threadArchived={threadRegistry.getThread(activeThreadId)?.lifecycle === 'archived'}
                  threadRuntime={threadRuntimes[activeThreadId]?.state || 'idle'}
                  queuePosition={threadRuntimes[activeThreadId]?.position || 0}
                  onSuggestTitle={() => handleSuggestTitle(activeThreadId)}
                  onUnarchive={() => threadRegistry.setThreadLifecycle(activeThreadId, 'active')}
                  onRetry={handleRetryThread}
                  onCancelQueued={() => handleCancelQueued(activeThreadId)}
                  onOpenServerLogs={() => setIsServerLogsOpen(true)}
                  onAddArtifactToProject={handleAddArtifact}
                  onSummarizeChapter={handleSummarizeChapter}
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
            artifacts={domainArtifacts}
            chapters={chapterGroups}
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

      {/* Quick thread switcher (Cmd/Ctrl+K) — archived included, dimmed */}
      {isSwitcherOpen && (
        <ThreadSwitcher
          threads={threadRegistry.getThreads()}
          folders={threadRegistry.getFolders()}
          threadRuntimes={threadRuntimes}
          activeThreadId={activeThreadId}
          onSelect={(id) => {
            clearThreadUnread(id);
            selectThread(id);
          }}
          onNewThread={() => {
            createThread();
            setActiveView('chat');
          }}
          onClose={() => setIsSwitcherOpen(false)}
        />
      )}

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
          project={projectMeta}
          artifacts={domainArtifacts}
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
          artifacts={domainArtifacts}
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
          activeProject={activeProjectExport}
          onClose={() => setIsExportOpen(false)}
        />
      )}

      {/* Full-Screen Artifact Detail Modal */}
      {selectedArtifactId && (
        (() => {
          const art = domainArtifacts.find((a) => a.id === selectedArtifactId);
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
