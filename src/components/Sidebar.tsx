import React, { useState, useEffect } from 'react';
import { Project, ModelOption, Artifact, ResolutionTier, TierReason } from '../types';
import { getTokenColor } from '../utils/tokenCalculator';
import { logger } from '../utils/logger';
import {
  Brain,
  Cpu,
  Layers,
  MessageSquare,
  Compass,
  Upload,
  Download,
  FolderTree,
  ChevronDown,
  ChevronUp,
  X,
  ExternalLink,
  Database,
  Terminal,
  Cloud,
  Check,

  LogOut,

  User as UserIcon,
  Plus,
  FolderKanban,
  Save,
  RotateCcw,
} from 'lucide-react';
import { ArtifactFolderTree } from './ArtifactFolderTree';
import { ChatThread, ThreadRuntime } from '../domains/06-chat-threads';

export type ActiveView = 'chat' | 'graph';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  projects: Project[];
  activeProject: Project;
  onSelectProject: (p: Project) => void;
  selectedModel: ModelOption;
  availableModels: ModelOption[];
  onSelectModel: (m: ModelOption) => void;
  totalTokens: number;
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  opticalMode?: 'autofocus' | 'manual' | 'myopia';
  onToggleOpticalMode?: () => void;
  onOpenExport: () => void;
  onOpenImport: () => void;
  // Full-database backup / restore (canonical format — works on any backend)
  onExportDatabase: () => void;
  onImportDatabase: () => void;
  onOpenProjectLauncher: () => void;
  onOpenServerLogs?: () => void;
  // Artifact Tree & Focus capabilities
  onSelectArtifact?: (art: Artifact) => void;
  selectedArtifactId?: string | null;
  onToggleFocus?: (artId: string) => void;
  /** Phase 3: flagged-row click in Revisions mode opens triage instead of detail. */
  onTriageArtifact?: (artId: string) => void;
  focalIds?: string[];
  nodeTiers?: Record<
    string,
    { tier: ResolutionTier | 'culled'; distance: number; reason?: TierReason }
  >;
  onChangeTierOverride?: (artId: string, tier: ResolutionTier | null) => void;
  tierOverrides?: Record<string, ResolutionTier>;
  // Firebase Auth & account
  currentUser?: { displayName?: string | null; email?: string | null; photoURL?: string | null } | null;
  onSignOut?: () => void;
  // Chat threads (per project)
  threads?: ChatThread[];
  activeThreadId?: string;
  threadRuntimes?: Record<string, { state: ThreadRuntime; position: number }>;
  onSelectThread?: (threadId: string) => void;
  onCreateThread?: () => void;
  onRenameThread?: (threadId: string, title: string) => void;
  onDeleteThread?: (threadId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onToggle,
  projects,
  activeProject,
  onSelectProject,
  selectedModel,
  availableModels,
  onSelectModel,
  totalTokens,
  activeView,
  onChangeView,
  opticalMode = 'autofocus',
  onToggleOpticalMode,
  onOpenExport,
  onOpenImport,
  onExportDatabase,
  onImportDatabase,
  onOpenProjectLauncher,
  onOpenServerLogs,
  onSelectArtifact,
  selectedArtifactId,
  onToggleFocus,
  onTriageArtifact,
  focalIds = [],
  nodeTiers = {},
  onChangeTierOverride,
  tierOverrides,
  currentUser,
  onSignOut,
  threads = [],
  activeThreadId,
  threadRuntimes = {},
  onSelectThread,
  onCreateThread,
  onRenameThread,
  onDeleteThread,
}) => {
  // Inline accordion toggles (all expand inline in document flow, guaranteeing ZERO container clipping)
  const [projectAccordionOpen, setProjectAccordionOpen] = useState(false);
  const [modelAccordionOpen, setModelAccordionOpen] = useState(false);
  const [opticalAccordionOpen, setOpticalAccordionOpen] = useState(true);
  const [cloudAccordionOpen, setCloudAccordionOpen] = useState(true);
  const [artifactsTreeOpen, setArtifactsTreeOpen] = useState(true);
  const [ioToolsOpen, setIoToolsOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(true);

  // Thread rename (double-click or context menu) + right-click menu
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [threadMenu, setThreadMenu] = useState<{ x: number; y: number; threadId: string } | null>(null);

  // Close the thread context menu on any outside pointerdown
  useEffect(() => {
    if (!threadMenu) return;
    const onPointerDown = () => setThreadMenu(null);
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [threadMenu]);

  const beginThreadRename = (t: ChatThread) => {
    setThreadMenu(null);
    setRenamingThreadId(t.id);
    setRenameDraft(t.title);
  };

  const commitThreadRename = () => {
    if (renamingThreadId && renameDraft.trim()) {
      onRenameThread?.(renamingThreadId, renameDraft.trim());
      logger.action('Sidebar', 'Renamed thread', { threadId: renamingThreadId, title: renameDraft.trim() });
    }
    setRenamingThreadId(null);
  };

  const visibleThreads = threads
    .filter((t) => t.lifecycle === 'active')
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  const runtimeDot = (state?: ThreadRuntime) => {
    if (state === 'working')
      return <span className="w-2 h-2 rounded-full bg-[#38bdf8] animate-pulse shrink-0" title="Working…" />;
    if (state === 'queued')
      return <span className="w-2 h-2 rounded-full bg-[#e0b96c] animate-pulse shrink-0" title="Queued" />;
    if (state === 'error')
      return <span className="w-2 h-2 rounded-full bg-[#f28894] shrink-0" title="Generation failed" />;
    if (state === 'interrupted')
      return (
        <span
          className="w-2 h-2 rounded-full border border-[#e0b96c] bg-transparent shrink-0"
          title="Interrupted"
        />
      );
    return null;
  };

  const colorInfo = getTokenColor(totalTokens);

  return (
    <>
      {/* Floating Toggle: The Brain Icon when sidebar is closed */}
      {!isOpen && (
        <button
          onClick={() => {
            logger.action('Sidebar', 'Open sidebar drawer');
            onToggle();
          }}
          aria-label="Open sidebar drawer"
          className="fixed top-3 left-3 z-50 flex items-center justify-center w-11 h-11 rounded-2xl bg-[#0c121e]/95 hover:bg-[#131d2e] border border-[#1a283e] text-[#e05a66] hover:text-[#ff6b78] shadow-2xl backdrop-blur-md transition-all duration-200 cursor-pointer group"
          title="Open controls, project & artifact hierarchy"
        >
          <Brain className="w-6 h-6 transition-transform group-hover:scale-110" />
        </button>
      )}

      {/* Backdrop overlay for small screens when open */}
      {isOpen && (
        <div
          onClick={() => {
            logger.action('Sidebar', 'Close sidebar via backdrop click');
            onToggle();
          }}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
        />
      )}

      {/* Unified Left Sidebar: Docked in flex layout on desktop, slide-out drawer on mobile */}
      <aside
        className={`fixed md:relative top-0 bottom-0 left-0 z-40 md:z-20 h-full bg-[#090d16]/98 md:bg-[#090d16] border-r border-[#121c2d] flex flex-col transition-all duration-200 ease-in-out text-[#d6e3f5] backdrop-blur-xl shrink-0 ${
          isOpen
            ? 'w-80 md:w-80 translate-x-0 shadow-2xl md:shadow-none'
            : '-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden md:border-r-0'
        }`}
      >
        {/* Single Scrolling Panel */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
          {/* Top Brand Header */}
          <div className="flex items-center justify-between pb-3 border-b border-[#131d2e]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#131d2d] border border-[#1e2a3e] flex items-center justify-center text-[#e05a66] shadow-sm">
                <Brain className="w-5 h-5 text-[#e05a66]" />
              </div>
              <div>
                <span className="font-bold text-sm tracking-wider text-[#eef4fc] font-mono block">
                  MarkBrain
                </span>
                <span className="text-[9px] text-[#556985] font-mono block">
                  thinking workbench
                </span>
              </div>
            </div>

            {/* Close Button: [X] inside the sidebar */}
            <button
              onClick={() => {
                logger.action('Sidebar', 'Close sidebar button clicked');
                onToggle();
              }}
              className="p-1.5 rounded-xl bg-[#0e1626] hover:bg-[#162238] text-[#7185a3] hover:text-white transition-colors cursor-pointer border border-[#162338]"
              title="Close sidebar drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Block 1: View Navigation Switcher (Dialogue Canvas vs Spatial Graph) */}
          <div className="p-1 bg-[#0c121e] border border-[#131e2e] rounded-xl flex items-center gap-1">
            <button
              onClick={() => {
                logger.action('Sidebar', 'Switch view to chat');
                onChangeView('chat');
              }}
              className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-mono font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                activeView === 'chat'
                  ? 'bg-[#18253b] text-[#8ab1e0] border border-[#223654] shadow-xs'
                  : 'text-[#5d7394] hover:text-[#c4d7f2]'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Dialogue</span>
            </button>
            <button
              onClick={() => {
                logger.action('Sidebar', 'Switch view to graph');
                onChangeView('graph');
              }}
              className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-mono font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                activeView === 'graph'
                  ? 'bg-[#18253b] text-[#8ab1e0] border border-[#223654] shadow-xs'
                  : 'text-[#5d7394] hover:text-[#c4d7f2]'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>Spatial Graph</span>
            </button>
          </div>

          {/* Block 2: Project Selector (INLINE ACCORDION - NO FLOATING CLIPPED DROPDOWN) */}
          <div className="rounded-xl bg-[#0c1322] border border-[#141f33] overflow-hidden">
            <button
              onClick={() => {
                const nextState = !projectAccordionOpen;
                logger.action('Sidebar', `Toggle project accordion: ${nextState ? 'opened' : 'closed'}`);
                setProjectAccordionOpen(nextState);
              }}
              className="w-full flex items-center justify-between p-2.5 text-left transition-colors hover:bg-[#0f182a] cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-3 h-3 rounded-full shrink-0 shadow-xs"
                  style={{ backgroundColor: activeProject.color || '#5d87b8' }}
                />
                <div className="min-w-0">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#556985] block">
                    Active Project
                  </span>
                  <span className="text-xs font-semibold text-white truncate block">
                    {activeProject.name}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[#556985]">
                <span className="text-[10px] font-mono">{projects.length} proj</span>
                {projectAccordionOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>

            {/* Inline Accordion Body */}
            {projectAccordionOpen && (
              <div className="p-2 border-t border-[#131e33] bg-[#070b12] space-y-1 animate-in fade-in duration-100">
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {projects.map((proj) => (
                    <button
                      key={proj.id}
                      onClick={() => {
                        logger.action('Sidebar', `Selected project: ${proj.name} (${proj.id})`);
                        onSelectProject(proj);
                        setProjectAccordionOpen(false);
                      }}
                      className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                        proj.id === activeProject.id
                          ? 'bg-[#182338] text-[#8ab1e0] font-semibold border border-[#223552]'
                          : 'hover:bg-[#0e1626] text-[#9bb0d1]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: proj.color || '#5d87b8' }}
                        />
                        <span className="truncate">{proj.name}</span>
                      </div>
                      {proj.id === activeProject.id && (
                        <Check className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
                      )}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => {
                    logger.action('Sidebar', 'Open Project Launcher from sidebar');
                    setProjectAccordionOpen(false);
                    onOpenProjectLauncher();
                  }}
                  className="w-full mt-1.5 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[#141d2d] hover:bg-[#1a273d] text-xs font-mono text-[#8ab1e0] transition-colors border border-[#1d2d47] cursor-pointer"
                >
                  <Plus className="w-3 h-3 text-[#e05a66]" />
                  <span>Create / Switch in Deck</span>
                </button>
              </div>
            )}
          </div>

          {/* Block 2.5: Chat Threads (per project — select / rename / delete) */}
          <div className="rounded-xl bg-[#0c1322] border border-[#141f33] overflow-hidden">
            <div className="flex items-center justify-between p-2.5">
              <button
                onClick={() => {
                  const next = !threadsOpen;
                  logger.action('Sidebar', `Toggle threads accordion: ${next ? 'opened' : 'closed'}`);
                  setThreadsOpen(next);
                }}
                className="flex items-center gap-2 min-w-0 flex-1 text-left transition-colors hover:text-white cursor-pointer"
              >
                <MessageSquare className="w-4 h-4 text-[#5ad49b] shrink-0" />
                <span className="text-xs font-semibold text-white font-mono">Threads</span>
                <span className="text-[10px] font-mono text-[#526682]">({visibleThreads.length})</span>
                <span className="flex-1" />
                {threadsOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 text-[#556985] shrink-0" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-[#556985] shrink-0" />
                )}
              </button>
              <button
                onClick={() => {
                  logger.action('Sidebar', 'Create new thread');
                  onCreateThread?.();
                }}
                className="p-1.5 ml-1 rounded-lg bg-[#141d2d] hover:bg-[#1a273d] text-[#e05a66] border border-[#1d2d47] transition-colors cursor-pointer shrink-0"
                title="New thread"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {threadsOpen && (
              <div className="border-t border-[#131e33] bg-[#070b12] animate-in fade-in duration-100">
                <div className="max-h-56 overflow-y-auto p-1 space-y-0.5">
                  {visibleThreads.length === 0 && (
                    <p className="text-[10px] font-mono text-[#526682] p-2">No threads yet.</p>
                  )}
                  {visibleThreads.map((t) => {
                    const isActive = t.id === activeThreadId;
                    const runtime = threadRuntimes[t.id];
                    return (
                      <div
                        key={t.id}
                        onClick={() => {
                          if (renamingThreadId === t.id) return;
                          logger.action('Sidebar', `Selected thread: ${t.title}`, { threadId: t.id });
                          onSelectThread?.(t.id);
                        }}
                        onDoubleClick={() => beginThreadRename(t)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setThreadMenu({ x: e.clientX, y: e.clientY, threadId: t.id });
                        }}
                        className={`w-full flex items-center gap-2 p-2 rounded-lg text-left text-xs transition-colors cursor-pointer group ${
                          isActive
                            ? 'bg-[#182338] text-[#8ab1e0] font-semibold border border-[#223552]'
                            : 'hover:bg-[#0e1626] text-[#9bb0d1] border border-transparent'
                        }`}
                        title={t.preview || t.title}
                      >
                        {renamingThreadId === t.id ? (
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={commitThreadRename}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') commitThreadRename();
                              if (e.key === 'Escape') setRenamingThreadId(null);
                            }}
                            className="flex-1 min-w-0 bg-[#080d16] border border-[#3b82f6] rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                          />
                        ) : (
                          <>
                            <span
                              className={`flex-1 min-w-0 truncate ${
                                t.titleState === 'placeholder' ? 'italic opacity-70' : ''
                              }`}
                            >
                              {t.title}
                            </span>
                            {runtime?.position > 0 && (
                              <span className="text-[9px] font-mono text-[#e0b96c] shrink-0 tabular-nums">
                                #{runtime.position}
                              </span>
                            )}
                            {runtimeDot(runtime?.state)}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Thread context menu (Rename / Delete) */}
          {threadMenu && (
            <div
              className="fixed z-[60] min-w-36 p-1.5 bg-[#0a0f19] border border-[#1a293e] rounded-xl shadow-xl animate-in fade-in duration-100"
              style={{ left: threadMenu.x, top: threadMenu.y }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  const t = threads.find((x) => x.id === threadMenu.threadId);
                  if (t) beginThreadRename(t);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-mono text-[#9bb0d1] hover:bg-[#0f1726] hover:text-white transition-colors cursor-pointer"
              >
                Rename
              </button>
              <button
                onClick={() => {
                  const id = threadMenu.threadId;
                  setThreadMenu(null);
                  if (window.confirm('Delete this thread and all of its messages? This cannot be undone.')) {
                    logger.action('Sidebar', 'Delete thread', { threadId: id });
                    onDeleteThread?.(id);
                  }
                }}
                className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-mono text-[#f28894] hover:bg-[#241417] transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          )}

          {/* Block 3: Inference Model Selector (INLINE ACCORDION - NO CONTAINER CLIPPING) */}
          <div className="rounded-xl bg-[#0c1322] border border-[#141f33] overflow-hidden">
            <button
              onClick={() => {
                const nextState = !modelAccordionOpen;
                logger.action('Sidebar', `Toggle model accordion: ${nextState ? 'opened' : 'closed'}`);
                setModelAccordionOpen(nextState);
              }}
              className="w-full flex items-center justify-between p-2.5 text-left transition-colors hover:bg-[#0f182a] cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-[#141d2d] border border-[#1e2b40] text-[#e05a66] shrink-0">
                  <Cpu className="w-4 h-4 text-[#e05a66]" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#556985] block">
                    Inference Model
                  </span>
                  <span className="text-xs font-semibold text-white truncate block">
                    {selectedModel.name}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[#556985]">
                <span className="text-[10px] font-mono text-[#38bdf8]">{selectedModel.badge}</span>
                {modelAccordionOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>

            {/* Inline Accordion Body */}
            {modelAccordionOpen && (
              <div className="p-2 border-t border-[#131e33] bg-[#070b12] space-y-1.5 animate-in fade-in duration-100">
                {availableModels.map((m) => {
                  const isSelected = m.id === selectedModel.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        logger.action('Sidebar', `Selected inference model: ${m.name} (${m.id})`);
                        onSelectModel(m);
                        setModelAccordionOpen(false);
                      }}
                      className={`w-full p-2.5 rounded-xl text-left transition-all border cursor-pointer ${
                        isSelected
                          ? 'bg-[#142338] border-[#25426e] text-white shadow-xs'
                          : 'bg-[#0a0f19] border-[#131e30] text-[#9bb0d1] hover:bg-[#0f1726]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-xs font-mono text-[#eef4fc]">{m.name}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-[#38bdf8]" />}
                        </div>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#162030] text-[#e0b96c] border border-[#22334d]">
                          {m.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#788fa8] leading-tight mb-1.5">
                        {m.description}
                      </p>
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#526a8a] border-t border-[#131d2e] pt-1">
                        <span>Latency: {m.latency}</span>
                        <span>Window: {m.contextWindow}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Block 4: Firebase Cloud Sync & Account Persistence (INLINE ACCORDION) */}
          <div className="rounded-xl bg-[#0c1322] border border-[#141f33] overflow-hidden">
            <button
              onClick={() => {
                const nextState = !cloudAccordionOpen;
                logger.action('Sidebar', `Toggle cloud sync accordion: ${nextState ? 'opened' : 'closed'}`);
                setCloudAccordionOpen(nextState);
              }}
              className="w-full flex items-center justify-between p-2.5 text-left transition-colors hover:bg-[#0f182a] cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-[#101b2a] border border-[#1c2e47] text-[#38bdf8] shrink-0">
                  <Cloud className="w-4 h-4 text-[#38bdf8]" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#556985] block">
                    Cloud Storage & Sync
                  </span>
                  <span className="text-xs font-semibold text-white truncate block">
                    {currentUser ? currentUser.displayName || 'Google Account' : 'Not signed in'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">

                {cloudAccordionOpen ? <ChevronUp className="w-3.5 h-3.5 text-[#556985]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#556985]" />}
              </div>
            </button>

            {/* Inline Accordion Body */}
            {cloudAccordionOpen && (
              <div className="p-2.5 border-t border-[#131e33] bg-[#070b12] space-y-2 animate-in fade-in duration-100">
                {currentUser && (
                  <div className="space-y-2">
                    <div className="p-2 rounded-lg bg-[#0e1726] border border-[#18263e] flex items-center gap-2.5">
                      {currentUser.photoURL ? (
                        <img
                          src={currentUser.photoURL}
                          alt={currentUser.displayName || 'User'}
                          className="w-7 h-7 rounded-full border border-[#233857]"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-[#16253c] flex items-center justify-center text-[#38bdf8]">
                          <UserIcon className="w-4 h-4" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-semibold text-white block truncate">
                          {currentUser.displayName || 'You'}
                        </span>
                        <span className="text-[10px] font-mono text-[#6c84a3] block truncate">
                          {currentUser.email}
                        </span>
                      </div>
                    </div>


                    <button
                      onClick={() => {
                        logger.action('Sidebar', 'Sign out of Firebase');
                        onSignOut?.();
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-[#241417] hover:bg-[#331a20] text-xs font-mono text-[#f28894] transition-colors border border-[#3d1f25] cursor-pointer"
                    >
                      <LogOut className="w-3 h-3" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Block 5: Optical Context Engine & Token Gauge */}
          <div className="rounded-xl bg-[#0c1322] border border-[#141f33] overflow-hidden">
            <button
              onClick={() => {
                const nextState = !opticalAccordionOpen;
                logger.action('Sidebar', `Toggle optical accordion: ${nextState ? 'opened' : 'closed'}`);
                setOpticalAccordionOpen(nextState);
              }}
              className="w-full flex items-center justify-between p-2.5 text-left transition-colors hover:bg-[#0f182a] cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-[#141d2d] border border-[#1e2b40] text-[#e0b96c] shrink-0">
                  <Layers className="w-4 h-4 text-[#e0b96c]" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#556985] block">
                    Optical Engine
                  </span>
                  <span className="text-xs font-semibold text-white capitalize block">
                    {opticalMode} Mode
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[#556985]">
                <span className={`text-[10px] font-mono font-semibold ${colorInfo.textClass}`}>
                  {totalTokens < 1000 ? totalTokens : `${Math.round(totalTokens / 1000)}k`} tok
                </span>
                {opticalAccordionOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>

            {opticalAccordionOpen && (
              <div className="p-2.5 border-t border-[#131e33] bg-[#070b12] space-y-2.5 animate-in fade-in duration-100">
                {/* Optical Mode Cycle Button */}
                {onToggleOpticalMode && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#526682] block">
                      Depth-of-Field Lens
                    </span>
                    <button
                      onClick={() => {
                        logger.action('Sidebar', 'Cycle optical mode');
                        onToggleOpticalMode();
                      }}
                      className={`w-full flex items-center justify-between p-2 rounded-xl border text-xs font-mono transition-all cursor-pointer ${
                        opticalMode === 'autofocus'
                          ? 'bg-[#0f1929] border-[#1d314d] text-[#8ab1e0]'
                          : opticalMode === 'manual'
                          ? 'bg-[#141f33] border-[#1e3252] text-[#93c5fd]'
                          : 'bg-[#241c0c] border-[#423214] text-[#e0b96c]'
                      }`}
                      title="Click to cycle optical depth-of-field mode (Autofocus -> Manual -> Myopia)"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-current" />
                        <span className="font-semibold uppercase tracking-wider text-[11px]">
                          {opticalMode === 'autofocus'
                            ? '◎ Autofocus'
                            : opticalMode === 'manual'
                            ? '⦿ Manual Focus'
                            : '◐ Myopia Mode'}
                        </span>
                      </div>
                      <span className="text-[10px] opacity-75">Cycle ↺</span>
                    </button>
                  </div>
                )}

                {/* Token Meter Summary */}
                <div className="p-2 rounded-xl bg-[#0a0f19] border border-[#131e30] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#526682]">
                      Active Token Footprint
                    </span>
                    <span className={`text-xs font-mono font-semibold ${colorInfo.textClass}`}>
                      {Math.round(totalTokens).toLocaleString()} tok
                    </span>
                  </div>
                  <div className="w-full bg-[#111929] h-1.5 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, (totalTokens / 128000) * 100)}%`,
                        backgroundColor: colorInfo.hex,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Block 6: Artifact tree */}
          <div className="rounded-xl bg-[#0c1322] border border-[#141f33] overflow-hidden">
            <button
              onClick={() => {
                const nextState = !artifactsTreeOpen;
                logger.action('Sidebar', `Toggle artifact tree accordion: ${nextState ? 'opened' : 'closed'}`);
                setArtifactsTreeOpen(nextState);
              }}
              className="w-full flex items-center justify-between p-2.5 text-left transition-colors hover:bg-[#0f182a] cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FolderTree className="w-4 h-4 text-[#8ab1e0] shrink-0" />
                <span className="text-xs font-semibold text-white font-mono">
                  Artifacts
                </span>
                <span className="text-[10px] font-mono text-[#526682]">
                  ({activeProject.artifacts.length})
                </span>
              </div>
              {artifactsTreeOpen ? <ChevronUp className="w-3.5 h-3.5 text-[#556985]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#556985]" />}
            </button>

            {artifactsTreeOpen && (
              <div className="p-2 border-t border-[#131e33] bg-[#070b12] animate-in fade-in duration-100">
                <div className="max-h-56 overflow-y-auto pr-1">
                  <ArtifactFolderTree
                    project={activeProject}
                    selectedArtifactId={selectedArtifactId}
                    onSelectArtifact={(art) => {
                      logger.action('Sidebar', `Selected artifact: ${art.title} (${art.id})`);
                      onSelectArtifact?.(art);
                    }}
                    onToggleFocus={(artId) => {
                      logger.action('Sidebar', `Toggled focus for artifact: ${artId}`);
                      onToggleFocus?.(artId);
                    }}
                    onTriageArtifact={onTriageArtifact}
                    focalIds={focalIds}
                    nodeTiers={nodeTiers}
                    onChangeTierOverride={onChangeTierOverride}
                    tierOverrides={tierOverrides}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Block 7: Import / Export Tools */}
          <div className="rounded-xl bg-[#0c1322] border border-[#141f33] overflow-hidden">
            <button
              onClick={() => {
                const nextState = !ioToolsOpen;
                logger.action('Sidebar', `Toggle I/O tools accordion: ${nextState ? 'opened' : 'closed'}`);
                setIoToolsOpen(nextState);
              }}
              className="w-full flex items-center justify-between p-2.5 text-left transition-colors hover:bg-[#0f182a] cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Database className="w-4 h-4 text-[#5ad49b] shrink-0" />
                <span className="text-xs font-semibold text-white font-mono">
                  Import / Export I/O
                </span>
              </div>
              {ioToolsOpen ? <ChevronUp className="w-3.5 h-3.5 text-[#556985]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#556985]" />}
            </button>

            {ioToolsOpen && (
              <div className="p-2.5 border-t border-[#131e33] bg-[#070b12] space-y-2 animate-in fade-in duration-100">
                <p className="text-[10px] text-[#6b82a3] leading-relaxed">
                  Backup or restore project state, artifacts, chapters, and topological graphs.
                </p>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={() => {
                      logger.action('Sidebar', 'Open Import Modal');
                      onOpenImport();
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-[#0f1726] hover:bg-[#162238] border border-[#141f33] text-xs font-mono text-[#8ab1e0] transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#e05a66]" />
                    <span>Import</span>
                  </button>
                  <button
                    onClick={() => {
                      logger.action('Sidebar', 'Open Export Modal');
                      onOpenExport();
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-[#0f1726] hover:bg-[#162238] border border-[#141f33] text-xs font-mono text-[#8ab1e0] transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#5ad49b]" />
                    <span>Export</span>
                  </button>
                  <button
                    onClick={() => {
                      logger.action('Sidebar', 'Export full database backup');
                      onExportDatabase();
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-[#0f1726] hover:bg-[#162238] border border-[#141f33] text-xs font-mono text-[#5ad49b] transition-colors cursor-pointer col-span-1"
                    title="Download every project (turns, chapters, artifacts, graph) as one JSON file"
                  >
                    <Save className="w-3.5 h-3.5 text-[#5ad49b]" />
                    <span>Backup DB</span>
                  </button>
                  <button
                    onClick={() => {
                      logger.action('Sidebar', 'Restore database from file');
                      onImportDatabase();
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-[#0f1726] hover:bg-[#162238] border border-[#141f33] text-xs font-mono text-[#8ab1e0] transition-colors cursor-pointer col-span-1"
                    title="Restore a MarkBrain database backup file into the active backend"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-[#38bdf8]" />
                    <span>Restore DB</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Block 8: Live Server Logs & Telemetry trigger */}
          {onOpenServerLogs && (
            <button
              onClick={() => {
                logger.action('Sidebar', 'Open Server Logs Modal');
                onOpenServerLogs();
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-xl border border-[#162942] bg-[#0c1626] hover:bg-[#13233c] text-left transition-colors cursor-pointer group shadow-xs"
              title="Inspect backend live streaming logs and token telemetry"
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <Terminal className="w-3.5 h-3.5 text-[#38bdf8]" />
                <span className="text-xs font-semibold font-mono text-[#9cc4f5] group-hover:text-white">
                  Server Telemetry & Logs
                </span>
              </div>
              <span className="text-[10px] font-mono text-[#52749e] px-1.5 py-0.5 rounded bg-[#070d18] border border-[#132238]">
                LIVE
              </span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
};
