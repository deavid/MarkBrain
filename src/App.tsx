/**
 * App — the top-level shell: auth gate, view switching, modals, and the
 * wiring between the domains and the chat/workspace UI. (Phase 6: two unused
 * projection bindings left over from Phase 5 are gone.)
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ModelOption, Artifact } from './types';
import { FALLBACK_MODEL } from './data/models';
import { loadModelConfig, saveModelConfig, getModelForSlot, resolveChatModelOption } from './data/modelConfig';
import { Sidebar, ActiveView } from './ui/workspace/Sidebar';
import { ChatView } from './ui/chat/ChatView';
import { ChatErrorBoundary } from './ui/workspace/ChatErrorBoundary';
import { AuthGate } from './ui/workspace/AuthGate';
import { BootSplash } from './ui/workspace/BootSplash';
import { ProjectGenesis } from './ui/workspace/ProjectGenesis';
import { ProjectLauncher } from './ui/workspace/ProjectLauncher';
import { ServerLogsModal } from './ui/workspace/ServerLogsModal';
import { ApiCallInspectorModal } from './ui/workspace/ApiCallInspectorModal';
import { resolveCallForInspector, fetchCallRecord } from './services/inspectCallLog';
import type { ApiCallLog } from './domains/callLogTypes';
import { ModelSettingsModal } from './ui/workspace/ModelSettingsModal';
import { CriticalNotifications } from './ui/system/CriticalNotifications';
import { ArtifactDetailModal } from './ui/artifacts/ArtifactDetailModal';
import { ArtifactsLibraryView } from './ui/artifacts/ArtifactsLibraryView';
import type { LibraryLens } from './ui/artifacts/ArtifactsLibraryView';
import { ImportModal } from './ui/artifacts/ImportModal';
import { ExportModal } from './ui/artifacts/ExportModal';
import { RevisionTriageModal } from './ui/artifacts/RevisionTriageModal';
import { CleanupModal } from './ui/cleanup/CleanupModal';
import { ThreadSwitcher } from './ui/chat/ThreadSwitcher';
import { loadChatRenderMode, saveChatRenderMode } from './ui/chat/chatRenderMode';
import type { ChatRenderMode } from './ui/chat/chatRenderMode';
import { applyUiFontScale, loadUiFontScale, saveUiFontScale } from './ui/uiFontScale';
import type { UiFontScale } from './ui/uiFontScale';
import { loadEnterSendMode, saveEnterSendMode } from './ui/chat/sendOnEnter';
import type { EnterSendMode } from './ui/chat/sendOnEnter';
import { SaturationOrb } from './ui/context/SaturationOrb';
import { EdgeHeatStrip } from './ui/context/EdgeHeatStrip';
import { MirrorPanel } from './ui/context/MirrorPanel';
import { logger } from './utils/logger';
import { MAX_CONTEXT_TOKENS } from './utils/contextWindow';
import { useDomains } from './domains/DomainRegistry';
import { isAttachmentStaged } from './domains/06-chat-threads';
import { resolveCapabilities } from './domains/06-chat-threads/types';
import { contentHash } from './utils/contentHash';
import type { Granularity } from './domains/granularity';
import { cycleGranularity } from './domains/granularity';
import { useImportSession } from './ui/artifacts/import/useImportSession';
import { SendQueue } from './application/sendQueue';
import { queueServerMutation } from './application/serverMutationQueue';
import { getWorkspaceMode } from './services/workspaceSession';
import type { SendQueueDeps } from './application/sendQueue';
import { chatCancel, titleThread, models as fetchModels } from './gateway/api';
import { indexStatusFor } from './domains/search/draftSearchEngine';
import { shouldIndexInBrowser } from './application/artifactIndexer';


// Feature-slice modules — handlers/projections extracted from this file
import { useContextPayload } from './ui/context/useContextPayload';
import { groupTurnsByChapter } from './domains/02-chapter-segmentation';
import type { ProjectExportInput } from './utils/projectExporters';
import { createWorkspaceHandlers } from './ui/workspace/createWorkspaceHandlers';
import { useDatabaseTransfer } from './ui/workspace/useDatabaseTransfer';
import { exportProjectTarGz } from './domains/plaintextTree';
import { createArtifactHandlers } from './ui/artifacts/createArtifactHandlers';
import { createGraphHandlers } from './ui/graph/createGraphHandlers';
import { createChapterHandlers, useAutoSummarizeSealedChapters } from './ui/chat/createChapterHandlers';
import { createCleanupHandlers } from './ui/cleanup/createCleanupHandlers';
import { useThreadUi } from './ui/chat/useThreadUi';
import { useThreadSwitcher } from './ui/chat/useThreadSwitcher';
import { createSuggestTitle } from './ui/chat/createSuggestTitle';
import { useProjectProjections } from './application/useProjectProjections';
import { useComposerDrafts } from './application/useComposerDrafts';
import { useDraftProximitySearch } from './application/useDraftProximitySearch';
import { useSearchIndexing } from './application/useSearchIndexing';

export default function App() {
  const {
    workspace,
    timeline,
    artifacts: artifactsDomain,
    versioning,
    graph,
    segmentation,
    recalibration,
    compiler,
    stream,
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
  } = useDomains();
  const [tick, setTick] = useState(0);
  const triggerReRender = useCallback(() => setTick((t) => t + 1), []);

  // Design 23 §4: server jobs reconcile into drafts whenever a vps project
  // loads — a lost failed HEAD must materialize with its exits, or it
  // silently FIFO-blocks every later send ("chat never sends").
  useEffect(() => {
    if (!authInitialized || !currentUser || getWorkspaceMode() !== 'vps') return;
    const projectId = workspace.getActiveProjectId();
    if (!projectId) return;
    void sendQueueRef.current?.reconcileServerJobs(projectId);
    // NO `tick` here: reconcile ends in triggerReRender() → a tick dep would
    // re-run the effect → fetch /jobs → re-render → forever (a ~100 req/s
    // hot loop, found live 2026-10-25). Session/auth/project changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authInitialized, currentUser, workspace]);

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

  const activeProjectId = workspace.getActiveProjectId();
  const currentContainer = workspace.getProject(activeProjectId);

  // Server-owned catalog (GET /api/models). FALLBACK_MODEL keeps the picker populated
  // while it is in flight or if it fails. The sidebar lists CHAT-capable models only
  // (capability lanes live in the Model settings popup — design-docs/16 §3.1).
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([FALLBACK_MODEL]);

  useEffect(() => {
    let alive = true;
    fetchModels()
      .then((data) => {
        const list = data?.models;
        if (!alive || !Array.isArray(list) || list.length === 0) return; // keep fallback
        const chatModels = list.filter((m) => !m.capabilities || m.capabilities.includes('chat'));
        const usable = chatModels.length > 0 ? chatModels : list;
        setAvailableModels(usable);
      })
      .catch((e) => logger.warn('App', 'GET /api/models failed — keeping fallback model', e));
    return () => {
      alive = false;
    };
  }, []);

  const handleSelectModel = (m: ModelOption) => {
    // The chat slot is the ONLY store (modelConfig) — sends and the sidebar
    // both resolve through resolveChatModelOption on every read.
    saveModelConfig({ ...loadModelConfig(), chat: m.id });
    logger.action('App', `Chat slot model set to ${m.name} (${m.id})`);
    triggerReRender();
  };

  const [activeView, setActiveView] = useState<ActiveView>('chat');

  const [chosenVoice, setChosenVoice] = useState('Kore');

  // Reading preference for chat bubbles, restored from this browser and saved
  // on every flip (see chatRenderMode.ts for why it is not workspace data).
  const [chatRender, setChatRender] = useState<ChatRenderMode>(() => loadChatRenderMode());
  const handleSelectChatRender = (mode: ChatRenderMode) => {
    logger.action('App', `Chat text mode set to ${mode}`);
    setChatRender(mode);
    saveChatRenderMode(mode);
  };

  // How big the interface text is. A reading preference in this browser,
  // restored on load and saved on every flip (see uiFontScale.ts) — and the
  // only zoom a phone gets, since the viewport pins user-scalable.
  const [fontScale, setFontScale] = useState<UiFontScale>(() => loadUiFontScale());
  const handleSelectFontScale = (scale: UiFontScale) => {
    logger.action('App', `Text size set to ${scale}`);
    setFontScale(scale);
    saveUiFontScale(scale);
  };
  useEffect(() => {
    applyUiFontScale(fontScale);
  }, [fontScale]);

  // Whether a bare Enter sends or makes a new line. A typing preference in this
  // browser, restored on load and saved on every flip (see sendOnEnter.ts).
  // Shift+Enter and Ctrl/Cmd+Enter are not governed by it — they are fixed.
  const [enterSend, setEnterSend] = useState<EnterSendMode>(() => loadEnterSendMode());
  const handleSelectEnterSend = (mode: EnterSendMode) => {
    logger.action('App', `Enter key mode set to ${mode}`);
    setEnterSend(mode);
    saveEnterSendMode(mode);
  };

  // Default-open on desktop, default-closed on phones so the drawer+backdrop
  // doesn't bury the composer on first load.
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [isProjectLauncherOpen, setIsProjectLauncherOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isMirrorOpen, setIsMirrorOpen] = useState(false);
  const [isServerLogsOpen, setIsServerLogsOpen] = useState(false);
  /** Per-message receipts: open the flight recorder pre-filtered to one job. */
  const [serverLogsJob, setServerLogsJob] = useState<string | undefined>(undefined);
  // The inspector (David 2026-10-30): the ONE place for recorded calls.
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  // The full recorded row — fetched from the call-log store when the
  // inspector opens, so the modal renders the EXACT call that was clicked.
  const [inspectedCall, setInspectedCall] = useState<ApiCallLog | null>(null);
  const [inspectedAttempts, setInspectedAttempts] = useState<ApiCallLog[]>([]);
  const [isModelSettingsOpen, setIsModelSettingsOpen] = useState(false);
  const [modelSettingsTab, setModelSettingsTab] = useState<'models' | 'keys' | 'users'>('models');
  const [isCleanupOpen, setIsCleanupOpen] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [libraryTagFilter, setLibraryTagFilter] = useState({ tag: '', seq: 0 });
  const [triageFocusId, setTriageFocusId] = useState<string | null>(null);

  const { importDbFileRef, handleExportDatabase, dbImportInput, handleExportPlaintext, importPlaintextFileRef, plaintextImportInput } = useDatabaseTransfer();

  const { handleSelectProjectAndLaunchChat, handleCreateProject } = createWorkspaceHandlers({
    workspace,
    currentContainer,
    triggerReRender,
    setActiveView,
    setIsProjectLauncherOpen,
  });

  // Queue orchestration lives in application/sendQueue.ts; App holds only the
  // presentation state it drives.
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [streamPhase, setStreamPhase] = useState<'waiting' | 'streaming' | null>(null);

  const queueDepsRef = useRef<SendQueueDeps | null>(null);
  const sendQueueRef = useRef<SendQueue | null>(null);
  if (!sendQueueRef.current) sendQueueRef.current = new SendQueue(() => queueDepsRef.current!);
  const sendQueue = sendQueueRef.current;

  const activeThreadId = threadRegistry.getActiveThreadId();
  const isChatLoading = sendQueue.getActiveJob()?.threadId === activeThreadId;

  const {
    handleStopGeneration,
    handleSendMessage,
    handleCancelQueued,
    threadRuntimes,
    unreadThreadIds,
    markThreadUnread,
    clearThreadUnread,
  } = useThreadUi({ sendQueue, threadRegistry, tick });

  // The payload for THIS chat: its attachments (each at its cut) and its
  // chapters. Nothing is included by proximity — an artifact is attached, or it
  // is not in the payload at all.
  const activeAttachments = threadRegistry.getAttachments(activeThreadId);
  const resolvedCapabilities = resolveCapabilities(
    threadRegistry.getThread(activeThreadId),
    currentContainer?.metadata?.capabilities
  );
  const { compiledContext, ambientTelemetry } = useContextPayload({
    compiler,
    currentContainer,
    attachments: activeAttachments,
    tick,
    capabilities: resolvedCapabilities,
  });

  const {
    artifactTitles,
    artifactSubtitles,
    tokensByArtifact,
    chapterTokens,
  } = useProjectProjections({ artifactsDomain, compiledContext, activeAttachments, tick });

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
  // ── Draft-proximity testbed (design-docs/15) ─────────────────────────────
  // LAW 4: the unsent draft lives HERE, keyed by thread. ChatView unmounts
  // when [+ Attach] opens the library; the query must survive that trip.
  const { draftText, handleDraftTextChange } = useComposerDrafts(activeThreadId);

  const {
    searchQueryOverride,
    setSearchQueryOverride,
    searchConfig,
    handleSearchConfigChange,
    searchIndexMap,
    setSearchIndexMap,
    draftResults,
    queryEmbedNote,
    missingMatchCount,
  } = useDraftProximitySearch({
    draftText,
    artifactsDomain,
    projectId: projectMeta.id,
    activeAttachments,
    tick,
  });

  const {
    indexProgress,
    indexFailures,
    handleIndexAll,
    handleStopIndexing,
    indexArtifactProgress,
    handleIndexArtifact,
  } = useSearchIndexing({
    projectId: projectMeta.id,
    artifactsDomain,
    setSearchIndexMap,
    searchIndexMap,
  });

  // The [+ Attach] match badge routes straight into the Proximity lens.
  const [externalLens, setExternalLens] = useState<{ lens: LibraryLens; seq: number }>({
    lens: 'folders',
    seq: 0,
  });
  const handleOpenArtifactsWithProximity = () => {
    logger.action('App', 'Attach badge → open library (proximity)', {
      matches: missingMatchCount,
    });
    setExternalLens((prev) => ({ lens: 'proximity', seq: prev.seq + 1 }));
    setActiveView('artifacts');
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

  // Package 28 §3.5: single-project plaintext backup, assembled exactly like
  // the persist worker assembles a save (compose re-flattens the threads).
  const handleExportProjectTarGz = useCallback(async () => {
    const composed = threadRegistry.compose(timeline.allTurns(), segmentation.allChapters());
    const container = workspace.getProject(projectMeta.id);
    const snapshot = {
      projectId: projectMeta.id,
      turns: composed.turns,
      chapters: composed.chapters,
      threads: composed.threads,
      folders: composed.folders,
      activeThreadId: composed.activeThreadId,
      artifacts: domainArtifacts,
      edges: domainEdges,
      revisions: versioning.getAllRevisions(),
      name: container?.metadata.name,
      codeName: container?.metadata.codeName,
      description: container?.metadata.description,
      color: container?.metadata.color,
      ...(container?.metadata.capabilities ? { capabilities: container.metadata.capabilities } : {}),
      updatedAt: Date.now(),
    };
    const bytes = await exportProjectTarGz(snapshot);
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/gzip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectMeta.codeName || projectMeta.id}.tar.gz`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    logger.info('App', `Plaintext project archive downloaded (${projectMeta.codeName || projectMeta.id})`);
  }, [threadRegistry, timeline, segmentation, workspace, versioning, projectMeta, domainArtifacts, domainEdges]);

  const {
    handleAttachArtifact: handleAttachArtifactRaw,
    handleUnstageAttachment: handleUnstageAttachmentRaw,
    handleToggleAttachment: handleToggleAttachmentRaw,
    handleSetAttachmentGranularity: handleSetAttachmentGranularityRaw,
    handleAddArtifact,
    handleImportArtifact,
    handleManualArtifactEdit,
    handleRevertArtifact,
    handleRefreshLayers,
    handleTriageKeepBoth,
    handleTriageOverwrite,
    handleTriageDelete,
  } = createArtifactHandlers({
    artifactsDomain,
    versioning,
    graph,
    workspace,
    threadRegistry,
    activeThreadId,
    activeProjectId,
    currentContainer,
    triggerReRender,
    selectedArtifactId,
    setSelectedArtifactId,
    triageFocusId,
    setTriageFocusId,
  });

  // + New Note (Package 1 §1.8): a fresh document with a birth revision,
  // selected on creation. The id mints like the import path's.
  const handleNewNote = (title: string, body: string) => {
    const now = Date.now();
    const id = `art-${now}-${Math.floor(Math.random() * 10000)}`;
    handleAddArtifact({
      id,
      code: id,
      title: title || 'Untitled',
      workspaceId: activeProjectId,
      type: 'document',
      category: 'note',
      isHighConcept: false,
      current: { subtitle: '', description: '', summary: '', body },
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
  };

  // Design 23 §2.1.2: while the thread's head draft is `queued` (nothing
  // sending), the DRAFT's attachment snapshot is the SOURCE OF TRUTH for the
  // un-sent payload — every attach verb edits it via updateDraftAttachments,
  // which mirrors the staged subset back into the thread registry so
  // commitStagedAttachments welds exactly this payload. Frozen draft (sending/
  // failed/stopped) or no draft → the registry staged set arms the NEXT send.
  const editableDraft = sendQueue.getEditableDraftForThread(activeThreadId);
  const handleToggleAttachment = (artifactId: string) => {
    if (!editableDraft) return handleToggleAttachmentRaw(artifactId);
    sendQueue.updateDraftAttachments(editableDraft.id, (list) => {
      const existing = list.find((a) => a.artifactId === artifactId);
      if (!existing) {
        return [
          ...list,
          { artifactId, granularity: 'full', addedAt: Date.now(), turnIndex: null, turnId: null },
        ];
      }
      if (isAttachmentStaged(existing)) return list.filter((a) => a.artifactId !== artifactId);
      return list.map((a) =>
        a.artifactId === artifactId ? { ...a, granularity: cycleGranularity(a.granularity) } : a
      );
    });
  };
  const handleAttachArtifact = (artifactId: string) => {
    if (!editableDraft) return handleAttachArtifactRaw(artifactId);
    sendQueue.updateDraftAttachments(editableDraft.id, (list) =>
      list.some((a) => a.artifactId === artifactId)
        ? list
        : [...list, { artifactId, granularity: 'full', addedAt: Date.now(), turnIndex: null, turnId: null }]
    );
  };
  const handleUnstageAttachment = (artifactId: string) => {
    if (!editableDraft) return handleUnstageAttachmentRaw(artifactId);
    sendQueue.updateDraftAttachments(editableDraft.id, (list) =>
      list.filter((a) => !(isAttachmentStaged(a) && a.artifactId === artifactId))
    );
  };
  const handleSetAttachmentGranularity = (artifactId: string, granularity: Granularity) => {
    if (!editableDraft) return handleSetAttachmentGranularityRaw(artifactId, granularity);
    sendQueue.updateDraftAttachments(editableDraft.id, (list) =>
      list.map((a) => (a.artifactId === artifactId ? { ...a, granularity } : a))
    );
  };

  // Session lives at App level: closing ImportModal keeps the queue processing.
  const importSession = useImportSession(projectMeta, handleImportArtifact, (content) => {
    // Pre-LLM dedup: the landed body IS the file text, so the same content
    // hash means this file was already imported — skip it, no model call.
    const hash = contentHash(content);
    return artifactsDomain.listArtifacts().some((a) => contentHash(a.current?.body || '') === hash);
  });

  const { handleUpdateNodePosition, handleBatchUpdateNodePositions, handleAddEdge } =
    createGraphHandlers({ artifactsDomain, graph });

  const {
    handleDeclareChapter,
    handleSummarizeChapter,
    handleSetChapterGranularity,
    handleMergeChapter,
    handleShiftBoundary,
    handleRecalibrateChapter,
  } = createChapterHandlers({ timeline, segmentation, recalibration });
  // One rule for EVERY seal path: the manual split AND the model's own
  // <topic_shift>, which used to leave its sealed chapter at "No summary yet".
  useAutoSummarizeSealedChapters(segmentation, handleSummarizeChapter);

  const { setThreadsLifecycle, setArtifactsLifecycle, applyPlan } = createCleanupHandlers({
    artifactsDomain,
    versioning,
    graph,
    threadRegistry,
    workspace,
    deleteThread,
    triggerReRender,
    onArtifactPurged: (id) => {
      setSelectedArtifactId((cur) => (cur === id ? null : cur));
      setTriageFocusId((cur) => (cur === id ? null : cur));
    },
  });

  // Re-published each render; sendQueue snapshots deps + getContext() when a chain starts.
  const requestAutoTitle = (
    messages: Array<{ role: string; content: string }>,
    version: number
  ): Promise<string | null> =>
    titleThread({ messages, version, model: getModelForSlot('title') })
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
    graph,
    triggerReRender,
    setStreamingStatus,
    setStreamPhase,
    markThreadUnread,
    requestAutoTitle,
    postChatCancel,
    confirm: (message: string) => window.confirm(message),
    getContext: () => ({
      // Per-call slot resolution: choosing 3.8 in the popup means the NEXT
      // request goes to 3.8 — no stale React snapshot (see resolveChatModelOption).
      model: resolveChatModelOption(availableModels, FALLBACK_MODEL),
      projectId: activeProjectId,
      projectTitle: projectMeta.name,
      tokenCeiling: currentContainer?.tokenCeiling || MAX_CONTEXT_TOKENS,
      // Project-default capability toggles (Package 2): the thread override
      // is applied per-send inside the queue.
      capabilities: resolveCapabilities(null, projectMeta.capabilities),
    }),
  };

  const { isSwitcherOpen, setIsSwitcherOpen } = useThreadSwitcher({
    createThread,
    threadRegistry,
    setActiveView,
  });

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
          onVpsLogin={signIn}
          onContinueLocal={continueLocal}
          onOpenOfflineReplica={openOfflineReplica}
          knownReplicas={knownReplicas}
          onOpenServerLogs={() => setIsServerLogsOpen(true)}
        />
        <ServerLogsModal
          isOpen={isServerLogsOpen}
          onClose={() => { setIsServerLogsOpen(false); setServerLogsJob(undefined); }}
        />
        <CriticalNotifications />
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
        {dbImportInput}{plaintextImportInput}
        <ServerLogsModal
          isOpen={isServerLogsOpen}
          onClose={() => { setIsServerLogsOpen(false); setServerLogsJob(undefined); }}
        />
        <CriticalNotifications />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-0 text-ink font-sans relative p-0 m-0">
      {/* Extensible Left Sidebar with Floating Toggle */}
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((prev) => !prev)}
        projects={domainProjectsList}
        activeProject={projectMeta}
        artifacts={domainArtifacts}
        onSelectProject={(p) => workspace.setActiveProject(p.id)}
        selectedModel={resolveChatModelOption(availableModels, FALLBACK_MODEL)}
        onSelectModel={handleSelectModel}
        onOpenModelSettings={() => setIsModelSettingsOpen(true)}
        chosenVoice={chosenVoice}
        onSelectVoice={setChosenVoice}
        chatRender={chatRender}
        onSelectChatRender={handleSelectChatRender}
        enterSend={enterSend}
        onSelectEnterSend={handleSelectEnterSend}
        fontScale={fontScale}
        onSelectFontScale={handleSelectFontScale}
        activeView={activeView}
        onChangeView={(v) => setActiveView(v)}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenImport={() => setIsImportOpen(true)}
        onExportDatabase={handleExportDatabase}
        onImportDatabase={() => importDbFileRef.current?.click()}
        onExportPlaintext={handleExportPlaintext}
        onImportPlaintext={() => importPlaintextFileRef.current?.click()}
        onSignOutWipeReplica={signOutWipeReplica}
        onOpenProjectLauncher={() => setIsProjectLauncherOpen(true)}
        onOpenServerLogs={() => setIsServerLogsOpen(true)}
        onOpenCleanup={() => setIsCleanupOpen(true)}
        onRefreshSync={currentUser?.mode === 'vps' ? refreshFromServer : undefined}
        unsyncedProjectIds={currentUser?.mode === 'vps' ? unsyncedProjectIds : []}        currentUser={currentUser}
        onSignOut={signOut}
        onSwitchToLocal={continueLocal}
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
        onDeleteFolder={(id) => {
          queueServerMutation(workspace.getActiveProjectId(), { op: 'deleteFolder', folderId: id });
          threadRegistry.deleteFolder(id);
        }}
        onReorderFolders={(dragId, targetId) => threadRegistry.reorderFolderBefore(dragId, targetId)}
        onSuggestTitle={handleSuggestTitle}
        unreadThreadIds={unreadThreadIds}
      />

      {/* Main Single-Focused Viewport - ZERO TOP BAR */}
      <main className="flex-1 h-full min-h-0 min-w-0 flex flex-col overflow-hidden relative p-0 m-0">
        {/* Base Conversation & Graph Canvas (Takes 100% of vertical height) */}
        <div className="flex-1 h-full min-h-0 min-w-0 flex flex-col relative overflow-hidden p-0 m-0">
          {activeView === 'artifacts' ? (
            <ArtifactsLibraryView
              projectId={projectMeta.id}
              artifacts={domainArtifacts}
              edges={domainEdges}
              onSelectArtifact={(art) => {
                logger.action('Artifacts', `Open artifact ${art.id} from the library`);
                setSelectedArtifactId(art.id);
              }}
              onAddEdge={handleAddEdge}
              onUpdateNodePosition={handleUpdateNodePosition}
              onBatchUpdateNodePositions={handleBatchUpdateNodePositions}
              onOpenImport={() => setIsImportOpen(true)}
              onNewNote={handleNewNote}
              onTriageArtifact={(id) => {
                logger.action('App', `Open revision triage focused on ${id}`);
                setTriageFocusId(id);
              }}
              attachments={activeAttachments}
              tokensByArtifact={tokensByArtifact}
              onToggleAttachment={handleToggleAttachment}
              onUnstage={handleUnstageAttachment}
              onSetAttachmentGranularity={handleSetAttachmentGranularity}
              onReturnToChat={() => setActiveView('chat')}
              externalTagFilter={libraryTagFilter}
              draftText={draftText}
              onDraftTextChange={handleDraftTextChange}
              searchQueryOverride={searchQueryOverride}
              onSearchQueryOverrideChange={setSearchQueryOverride}
              searchConfig={searchConfig}
              onSearchConfigChange={handleSearchConfigChange}
              searchIndexMap={searchIndexMap}
              draftResults={draftResults}
              indexProgress={shouldIndexInBrowser() ? indexProgress : null}
              semanticIndexingEnabled={shouldIndexInBrowser()}
              indexFailures={indexFailures}
              queryEmbedNote={queryEmbedNote}
              onIndexAll={handleIndexAll}
              onStopIndexing={handleStopIndexing}
              externalLens={externalLens}
            />
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
                  onOpenKeySettings={() => {
                    setModelSettingsTab('keys');
                    setIsModelSettingsOpen(true);
                  }}
                  isLoading={isChatLoading}
                  streamingStatus={isChatLoading ? streamingStatus : null}
                  streamPhase={isChatLoading ? streamPhase : null}
                  onStopGeneration={handleStopGeneration}
                  onInspectCall={async (callId) => {
                    const target = await resolveCallForInspector(callId);
                    setInspectedCall(target.call);
                    setInspectedAttempts(target.attempts);
                    setIsInspectorOpen(true);
                  }}
                  threadTitle={threadRegistry.getThread(activeThreadId)?.title || 'New thread'}
                  threadTitleState={threadRegistry.getThread(activeThreadId)?.titleState || 'placeholder'}
                  threadArchived={threadRegistry.getThread(activeThreadId)?.lifecycle === 'archived'}
                  onSuggestTitle={() => handleSuggestTitle(activeThreadId)}
                  onRenameTitle={(title) => {
                    logger.action('App', 'Renamed thread from the chat title', { title });
                    threadRegistry.rename(activeThreadId, title);
                    triggerReRender();
                  }}
                  onUnarchive={() => threadRegistry.setThreadLifecycle(activeThreadId, 'active')}
                  drafts={sendQueue.getDraftsForThread(activeThreadId)}
                  onRetryDraft={(id) => sendQueue.retryDraft(id)}
                  onStoreAsIsDraft={(id) => sendQueue.storeAsIsDraft(id)}
                  onDiscardDraft={(id) => sendQueue.discardDraft(id)}
                  onRegenerateLast={() => sendQueue.regenerateLastReply()}
                  onOpenServerLogs={() => setIsServerLogsOpen(true)}
                  onAddArtifactToProject={handleAddArtifact}
                  onSummarizeChapter={handleSummarizeChapter}
                  onDeclareChapter={handleDeclareChapter}
                  onSetChapterGranularity={handleSetChapterGranularity}
                  projectCapabilities={projectMeta.capabilities}
                  onSetProjectCapabilities={(caps) => {
                    logger.action('App', 'Set chat capabilities (project)', caps);
                    workspace.updateMetadata(activeProjectId, { capabilities: caps });
                    triggerReRender();
                  }}
                  onMergeChapter={handleMergeChapter}
                  onShiftBoundary={handleShiftBoundary}
                  onRecalibrateChapter={handleRecalibrateChapter}
                  attachments={activeAttachments}
                  tokensByArtifact={tokensByArtifact}
                  chapterTokens={chapterTokens}
                  artifactTitles={artifactTitles}
                  artifactSubtitles={artifactSubtitles}
                  onToggleAttachment={handleToggleAttachment}
                  onUnstageAttachment={handleUnstageAttachment}
                  onSetAttachmentGranularity={handleSetAttachmentGranularity}
                  onOpenArtifacts={() => setActiveView('artifacts')}
                  draftText={draftText}
                  onDraftTextChange={handleDraftTextChange}
                  missingMatchCount={missingMatchCount}
                  onOpenArtifactsWithProximity={handleOpenArtifactsWithProximity}
                  chosenVoice={chosenVoice}
                  chatRender={chatRender}
                  enterSend={enterSend}
                  onOpenArtifact={(id) => {
                    logger.action('App', `Open artifact ${id} from an attachment row`);
                    setSelectedArtifactId(id);
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
              className="fixed bottom-4 left-4 z-30 px-3 py-1.5 rounded-full bg-surface-3/95 backdrop-blur-md shadow-lg text-10 font-mono text-ink-dim hover:text-ink hover:bg-surface-4 transition-colors cursor-pointer flex items-center gap-2"
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
            capabilities={resolveCapabilities(threadRegistry.getThread(activeThreadId), projectMeta.capabilities)}
            artifacts={domainArtifacts}
            chapters={chapterGroups}
            ceiling={ambientTelemetry.ceiling}
            onSetAttachmentGranularity={handleSetAttachmentGranularity}
            onSetChapterGranularity={handleSetChapterGranularity}
            attachments={activeAttachments}
            onOpenArtifacts={() => {
              logger.action('App', 'Mirror → open artifacts library');
              setIsMirrorOpen(false);
              setActiveView('artifacts');
            }}
            onUnstageAttachment={handleUnstageAttachment}
            onOpenArtifact={(id) => {
              logger.action('App', `Mirror → open artifact ${id}`);
              setIsMirrorOpen(false);
              setSelectedArtifactId(id);
            }}
          />
        </div>

        {/* Presentation Telemetry: 5px Edge Heat Bar */}
        <EdgeHeatStrip telemetry={ambientTelemetry} />
      </main>

      {/* Cleanup: bulk archive/unarchive, permanent delete of the archived */}
      {isCleanupOpen && (
        <CleanupModal
          isOpen={isCleanupOpen}
          onClose={() => setIsCleanupOpen(false)}
          threads={threadRegistry.getThreads()}
          artifacts={domainArtifacts}
          onSetThreadLifecycle={setThreadsLifecycle}
          onSetArtifactLifecycle={setArtifactsLifecycle}
          onApplyPlan={applyPlan}
        />
      )}

      {/* Live Server Telemetry & Logs Modal */}
      <ServerLogsModal
        isOpen={isServerLogsOpen}
        onClose={() => { setIsServerLogsOpen(false); setServerLogsJob(undefined); }}
      />

      {/* The one true API call inspector (David 2026-10-30): opens on the
          EXACT recorded call that a message or failed draft links to. */}
      <ApiCallInspectorModal
        isOpen={isInspectorOpen}
        call={inspectedCall}
        attempts={inspectedAttempts}
        onSelectAttempt={async (attemptId) => setInspectedCall(await fetchCallRecord(attemptId))}
        onClose={() => setIsInspectorOpen(false)}
      />

      {/* Capability-slot model picker (design-docs/16 §3.1) */}
      <ModelSettingsModal
        isOpen={isModelSettingsOpen}
        onClose={() => setIsModelSettingsOpen(false)}
        initialTab={modelSettingsTab}
        catalog={availableModels}
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
          onEditProject={(projectId, patch) => {
            workspace.updateMetadata(projectId, patch);
            triggerReRender();
            logger.action('App', 'Project metadata updated', { projectId });
          }}
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

      {/* Post-import duplicate/flag resolution */}
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
          onExportProjectTarGz={handleExportProjectTarGz}
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
              layersStale={typeof art.layersStaleAt === 'number'}
              onSaveEdit={(patch) => handleManualArtifactEdit(art.id, patch)}
              onRevert={(version) => handleRevertArtifact(art.id, version)}
              onRefreshLayers={() => handleRefreshLayers(art.id)}
              onOpenThread={(threadId) => {
                setSelectedArtifactId(null);
                selectThread(threadId);
              }}
              getThreadTitle={(threadId) => threadRegistry.getThread(threadId)?.title || null}
              onClose={() => setSelectedArtifactId(null)}
              attachmentGranularity={
                activeAttachments.find((a) => a.artifactId === art.id)?.granularity ?? null
              }
              attachmentStaged={
                activeAttachments.find((a) => a.artifactId === art.id)?.turnIndex === null
              }
              attachmentTurnIndex={
                activeAttachments.find((a) => a.artifactId === art.id)?.turnIndex ?? null
              }
              onFilterByTag={(tag) => {
                setLibraryTagFilter((f) => ({ tag, seq: f.seq + 1 }));
                setSelectedArtifactId(null);
              }}
              onAttach={handleAttachArtifact}
              onUnstage={handleUnstageAttachment}
              onSetAttachmentGranularity={handleSetAttachmentGranularity}
              indexRecord={searchIndexMap.get(art.id) ?? null}
              indexStatus={indexStatusFor(art, searchIndexMap, getModelForSlot('embed'))}
              onIndexArtifact={() => handleIndexArtifact(art.id)}
              indexArtifactProgress={indexArtifactProgress}
            />
          );
        })()
      )}

      {/* Hidden trigger for full-database restore (Sidebar → Restore DB) */}
      {dbImportInput}{plaintextImportInput}

      {/* The red banner: failures severe enough that the session is lying to you */}
      <CriticalNotifications />
    </div>
  );
}