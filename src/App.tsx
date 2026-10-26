import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ModelOption } from './types';
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
import { estimateArtifactCutTokens } from './domains/03-optical-compiler';
import { isAttachmentStaged } from './domains/06-chat-threads';
import type { Granularity } from './domains/granularity';
import { cycleGranularity } from './domains/granularity';
import { useImportSession } from './ui/artifacts/import/useImportSession';
import { SendQueue } from './application/sendQueue';
import { queueServerMutation } from './application/serverMutationQueue';
import { getWorkspaceMode } from './services/workspaceSession';
import type { SendQueueDeps } from './application/sendQueue';
import { chatCancel, titleThread, models as fetchModels, embedTexts } from './gateway/api';
import { loadSearchConfig, saveSearchConfig } from './domains/search/searchConfig';
import type { SearchTestbedConfig } from './domains/search/searchConfig';
import {
  scoreArtifactsAgainstDraft,
  countMissingMatches,
  splitDraftIntoClauses,
  l2Normalize,
  indexStatusFor,
} from './domains/search/draftSearchEngine';
import { QueryVectorCache } from './domains/search/queryVectorCache';
import type { QueryCacheHit } from './domains/search/queryVectorCache';
import type { ArtifactMatchResult } from './domains/search/draftSearchEngine';
import { loadProjectSearchIndex } from './services/searchIndexStore';
import type { ArtifactSearchIndexRecord } from './services/searchIndexStore';
import { indexProjectArtifacts, indexSingleArtifact, shouldIndexInBrowser } from './application/artifactIndexer';
import type { IndexAbortSignal } from './application/artifactIndexer';

// Feature-slice modules — handlers/projections extracted from this file
import { useContextPayload } from './ui/context/useContextPayload';
import { groupTurnsByChapter } from './domains/02-chapter-segmentation';
import type { ProjectExportInput } from './utils/tokenCalculator';
import { createWorkspaceHandlers } from './ui/workspace/createWorkspaceHandlers';
import { useDatabaseTransfer } from './ui/workspace/useDatabaseTransfer';
import { createArtifactHandlers } from './ui/artifacts/createArtifactHandlers';
import { createGraphHandlers } from './ui/graph/createGraphHandlers';
import { createChapterHandlers, useAutoSummarizeSealedChapters } from './ui/chat/createChapterHandlers';
import { createCleanupHandlers } from './ui/cleanup/createCleanupHandlers';
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
  const [isModelSettingsOpen, setIsModelSettingsOpen] = useState(false);
  const [modelSettingsTab, setModelSettingsTab] = useState<'models' | 'keys' | 'users'>('models');
  const [isCleanupOpen, setIsCleanupOpen] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [libraryTagFilter, setLibraryTagFilter] = useState({ tag: '', seq: 0 });
  const [triageFocusId, setTriageFocusId] = useState<string | null>(null);

  const { importDbFileRef, handleExportDatabase, dbImportInput } = useDatabaseTransfer();

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
  const { compiledContext, ambientTelemetry } = useContextPayload({
    compiler,
    currentContainer,
    attachments: activeAttachments,
    tick,
  });

  // One measurer: the folder row, the chat tray and the chapter header all read
  // the counts the compiler assembles — never a second estimator. Rows for
  // artifacts already in this payload read live telemetry; untouched library
  // artifacts are measured at Full, i.e. what staging them would cost.
  const attachmentGranularityById = useMemo(() => {
    const map = new Map<string, Granularity>();
    for (const a of activeAttachments) map.set(a.artifactId, a.granularity);
    return map;
  }, [activeAttachments]);

  const artifactTitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of artifactsDomain.listArtifacts()) map[a.id] = a.title;
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactsDomain, tick]);

  const artifactSubtitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of artifactsDomain.listArtifacts()) {
      // A note without a hook still shows something useful: the old one-line
      // description is what a reader recognises it by.
      map[a.id] = a.current?.subtitle || a.current?.description || '';
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactsDomain, tick]);

  const tokensByArtifact = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of compiledContext.telemetry.attachmentBreakdown ?? []) {
      map[entry.artifactId] = entry.tokens;
    }
    // Artifacts not in this chat's payload: what staging them at Full would cost.
    for (const art of artifactsDomain.listArtifacts()) {
      if (map[art.id] !== undefined) continue;
      map[art.id] = estimateArtifactCutTokens(art, 'full');
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiledContext, artifactsDomain, tick]);

  const chapterTokens = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of compiledContext.telemetry.chapterBreakdown ?? []) {
      map[entry.chapterId] = entry.tokens;
    }
    return map;
  }, [compiledContext]);

  const stagedAttachmentCount = activeAttachments.filter(isAttachmentStaged).length;

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
  const [draftByThread, setDraftByThread] = useState<Record<string, string>>({});
  const draftText = draftByThread[activeThreadId] ?? '';
  const handleDraftTextChange = (text: string) => {
    setDraftByThread((prev) => ({ ...prev, [activeThreadId]: text }));
  };
  // A test query that is NOT the chat draft. Empty = "use the chat draft"
  // (the default); anything typed here overrides it WITHOUT touching what is
  // in the composer, so you can probe the library while a message is half-written.
  // This is the fix for the proximity box: it used to bind straight to the
  // draft and swap to a read-only <p> the instant it held a single character,
  // which made it uneditable after the first keystroke.
  const [searchQueryOverride, setSearchQueryOverride] = useState('');
  const searchQuery = searchQueryOverride.trim() || draftText;

  const [searchConfig, setSearchConfigState] = useState<SearchTestbedConfig>(() =>
    loadSearchConfig()
  );
  const handleSearchConfigChange = (patch: Partial<SearchTestbedConfig>) => {
    setSearchConfigState((prev) => {
      const next = { ...prev, ...patch };
      saveSearchConfig(next);
      return next;
    });
  };

  // LAW 2: records live in IndexedDB (markbrain-search-index), never in the
  // project snapshot — this map is a read-only view of that database.
  const [searchIndexMap, setSearchIndexMap] = useState<Map<string, ArtifactSearchIndexRecord>>(
    () => new Map()
  );
  useEffect(() => {
    let alive = true;
    loadProjectSearchIndex(projectMeta.id)
      .then((map) => {
        if (alive) setSearchIndexMap(map);
      })
      .catch((e) => logger.warn('App', 'loadProjectSearchIndex failed', e));
    return () => {
      alive = false;
    };
  }, [projectMeta.id]);

  const attachedArtifactIds = useMemo(
    // "Already attached" means COMMITTED (design 15, live 2026-10-26): staged
    // rows are not attached yet — David clicked attach-next and the row
    // teleported to the ALREADY ATTACHED bucket. A staged row keeps its
    // position in the suggested list (it wears the 'next send' badge) and
    // only descends when the send commits it.
    () => new Set(activeAttachments.filter((a) => !isAttachmentStaged(a)).map((a) => a.artifactId)),
    [activeAttachments]
  );

  const [draftResults, setDraftResults] = useState<ArtifactMatchResult[]>([]);
  // Query vectors keyed by the clause text they were embedded from: editing
  // the draft invalidates them without an API call; typing back into cached
  // text is a cache hit. The cache itself survives thread switches.
  const [queryVectors, setQueryVectors] = useState<{
    key: string;
    vectors: Float32Array[];
  } | null>(null);
  // Near-duplicate rejection: the last few queries and their vectors. Two
  // spellings of the same question must not cost two embed calls on a
  // 1,000-request/day budget.
  const queryVecCacheRef = useRef(new QueryVectorCache());
  /** What the last query-embed decision was, so the panel can show its work. */
  const [queryEmbedNote, setQueryEmbedNote] = useState<{
    match: 'exact' | 'near' | 'fresh';
    similarity?: number;
    sourceText?: string;
  } | null>(null);

  const clauseKey = useMemo(
    () => splitDraftIntoClauses(searchQuery, searchConfig.splitClauses).join('\n'),
    [searchQuery, searchConfig.splitClauses]
  );
  const clauseVectors =
    queryVectors && queryVectors.key === clauseKey ? queryVectors.vectors : null;
  const needsQueryVec = searchConfig.vecSections || searchConfig.vecQa;

  // Tier 1 — local re-score 350ms after the draft / flags / threshold / index /
  // attachment set last moved. No API calls on this path, ever.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!searchQuery.trim()) {
        setDraftResults([]);
        return;
      }
      setDraftResults(
        scoreArtifactsAgainstDraft({
          draftText: searchQuery,
          clauseVectors,
          artifacts: artifactsDomain.listArtifacts(),
          indexMap: searchIndexMap,
          attachedArtifactIds,
          config: searchConfig,
        })
      );
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchConfig, searchIndexMap, attachedArtifactIds, clauseVectors, tick]);

  // Tier 2 — one embed per 5s typing pause, only when a vec flag is on, the
  // draft is long enough to be a real query, and its clause text is uncached.
  useEffect(() => {
    if (!needsQueryVec) return;
    if (searchQuery.trim().length < 12) return;
    const clauses = splitDraftIntoClauses(searchQuery, searchConfig.splitClauses);
    if (clauses.length === 0) return;
    const key = clauses.join('\n');
    // 1. Exact, or 2. close enough to reuse on purpose. Only 3. costs a request.
    const cached: QueryCacheHit | null = queryVecCacheRef.current.get(key, getModelForSlot('embed'));
    if (cached) {
      setQueryEmbedNote({
        match: cached.match,
        similarity: cached.similarity,
        sourceText: cached.sourceText,
      });
      setQueryVectors((prev) => (prev && prev.key === key ? prev : { key, vectors: cached.vectors }));
      return;
    }
    setQueryEmbedNote(null);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      // Say it the moment it is SENT, not when it succeeds. A request that
      // 429s still cost the budget — reporting only success would make a spent
      // request look like no request at all.
      if (!cancelled) setQueryEmbedNote({ match: 'fresh' });
      embedTexts({ texts: clauses, taskType: 'RETRIEVAL_QUERY' })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { embeddings?: number[][] };
          const vectors = (data.embeddings ?? []).map((v) => new Float32Array(l2Normalize(v)));
          if (cancelled || vectors.length === 0) return;
          queryVecCacheRef.current.set(key, vectors, getModelForSlot('embed'));
          setQueryVectors({ key, vectors });
        })
        .catch((e) => {
          if (!cancelled) logger.warn('App', 'Draft query embed failed', e);
        });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, needsQueryVec, searchConfig.splitClauses]);

  const missingMatchCount = countMissingMatches(draftResults);

  // The indexing runner: one document at a time, abortable, and the finished
  // map is swapped in as a NEW Map so the 350ms tier re-scores on completion.
  const [indexProgress, setIndexProgress] = useState<{
    done: number;
    total: number;
    stage: string;
  } | null>(null);
  const indexAbortRef = useRef<IndexAbortSignal | null>(null);
  // Failures stay on screen until the next run. A count that refuses to move is
  // indistinguishable from a save that never happens unless the app says which.
  const [indexFailures, setIndexFailures] = useState<{ title: string; message: string }[]>([]);

  const handleIndexAll = (force: boolean) => {
    if (!shouldIndexInBrowser()) return; // local mode: lexical only, 0 embed calls (21F §1)
    if (indexAbortRef.current) return;
    const signal: IndexAbortSignal = { aborted: false };
    indexAbortRef.current = signal;
    const arts = artifactsDomain.listArtifacts();
    const mapCopy = new Map(searchIndexMap);
    // Straggler guard. An overlapping step can still report AFTER this run has
    // settled (a fetch that was already in flight when a sibling failed), and
    // an unguarded setIndexProgress then repaints the line with nothing left to
    // ever clear it — that is what left the UI stuck on "Indexing 16/16" after
    // it had already gone back to normal.
    let live = true;
    setIndexFailures([]);
    setIndexProgress({ done: 0, total: arts.length, stage: force ? 'Re-index requested' : 'Index requested' });
    indexProjectArtifacts(projectMeta.id, arts, mapCopy, {
      force,
      signal,
      onProgress: (done, total, stage) => {
        if (live) setIndexProgress({ done, total, stage });
      },
      // Publish per DOCUMENT, not per run. `indexedCount` and the 350ms
      // re-score both key off the Map's identity, so a single swap at the end
      // froze the counter and the ranking for the entire job.
      onIndexed: (record) => {
        if (!live) return;
        setSearchIndexMap((prev) => {
          const next = new Map(prev);
          next.set(record.artifactId, record);
          return next;
        });
      },
      onFailure: (title, message) => {
        if (live) setIndexFailures((prev) => [...prev, { title, message }]);
      },
    })
      .then((updated) => {
        if (live) setSearchIndexMap(new Map(updated));
      })
      .catch((e) => logger.warn('App', 'indexProjectArtifacts failed', e))
      .finally(() => {
        live = false;
        indexAbortRef.current = null;
        setIndexProgress(null);
      });
  };

  const handleStopIndexing = () => {
    if (indexAbortRef.current) indexAbortRef.current.aborted = true;
  };

  // Single-document runner behind the detail modal's Q&A Index tab.
  const [indexArtifactProgress, setIndexArtifactProgress] = useState<string | null>(null);
  const handleIndexArtifact = (artifactId: string) => {
    if (!shouldIndexInBrowser()) return; // local mode: lexical only (21F §1)
    if (indexArtifactProgress || indexAbortRef.current) return;
    const art = artifactsDomain.getArtifact(artifactId);
    if (!art) return;
    // Take the SAME lock the bulk runner uses. Without it one document from the
    // detail modal could index alongside "Index All" — two writers on the same
    // progress line and two Map swaps fighting each other, which is how you get
    // a line that jumps backwards and then sticks.
    const signal: IndexAbortSignal = { aborted: false };
    indexAbortRef.current = signal;
    let live = true;
    setIndexArtifactProgress('Starting…');
    indexSingleArtifact(projectMeta.id, art, (stage) => {
      if (live) setIndexArtifactProgress(stage);
    }, signal, searchIndexMap.get(art.id))
      .then((record) => {
        if (!live) return;
        // Functional update: never clobber a concurrent bulk publish.
        setSearchIndexMap((prev) => {
          const next = new Map(prev);
          next.set(record.artifactId, record);
          return next;
        });
      })
      .catch((e) => logger.warn('App', 'indexSingleArtifact failed', e))
      .finally(() => {
        live = false;
        indexAbortRef.current = null;
        setIndexArtifactProgress(null);
      });
  };

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

  const {
    handleAttachArtifact: handleAttachArtifactRaw,
    handleUnstageAttachment: handleUnstageAttachmentRaw,
    handleToggleAttachment: handleToggleAttachmentRaw,
    handleSetAttachmentGranularity: handleSetAttachmentGranularityRaw,
    handleAddArtifact,
    handleImportArtifact,
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
  const importSession = useImportSession(projectMeta, handleImportArtifact);

  const { handleUpdateNodePosition, handleBatchUpdateNodePositions, handleAddEdge } =
    createGraphHandlers({ artifactsDomain, graph });

  const { handleDeclareChapter, handleSummarizeChapter, handleSetChapterGranularity } =
    createChapterHandlers({ timeline, segmentation });
  // One rule for EVERY seal path: the manual split AND the model's own
  // <topic_shift>, which used to leave its sealed chapter at "No summary yet".
  useAutoSummarizeSealedChapters(segmentation, handleSummarizeChapter);

  const { setThreadsLifecycle, setArtifactsLifecycle, applyPlan } = createCleanupHandlers({
    artifactsDomain,
    versioning,
    graph,
    threadRegistry,
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
          onOpenServerLogs={() => setIsServerLogsOpen(true)}
        />
        <ServerLogsModal
          isOpen={isServerLogsOpen}
          onClose={() => setIsServerLogsOpen(false)}
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
        {dbImportInput}
        <ServerLogsModal
          isOpen={isServerLogsOpen}
          onClose={() => setIsServerLogsOpen(false)}
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
        onOpenProjectLauncher={() => setIsProjectLauncherOpen(true)}
        onOpenServerLogs={() => setIsServerLogsOpen(true)}
        onOpenCleanup={() => setIsCleanupOpen(true)}
        currentUser={currentUser}
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
        onClose={() => setIsServerLogsOpen(false)}
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
      {dbImportInput}

      {/* The red banner: failures severe enough that the session is lying to you */}
      <CriticalNotifications />
    </div>
  );
}
