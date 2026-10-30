import React, { useState, useEffect, useMemo, useCallback, useSyncExternalStore } from 'react';
import { ModelOption, Artifact } from '../../types';
import type { ProjectMetadata } from '../../domains/00-workspace/types';
import { logger } from '../../utils/logger';
import { UserAvatar } from './UserAvatar';
import { ReadAloudControls } from './ReadAloudControls';
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
  ChevronRight,
  X,
  ExternalLink,
  Database,
  Terminal,
  Cloud,
  Check,

  LogOut,

  Plus,
  Save,
  RotateCcw,
  RefreshCw,
  Plane,
  Trash2,
  Settings2,
  CloudOff,
  FileArchive,
  FolderInput,
} from 'lucide-react';
import { isOfflineReplica } from '../../services/workspaceSession';
import { ChatThread, ThreadFolder, ThreadRuntime } from '../../domains/06-chat-threads';
import type { ChatRenderMode } from '../chat/chatRenderMode';
import type { UiFontScale } from '../uiFontScale';
import type { EnterSendMode } from '../chat/sendOnEnter';
import { isOnline, subscribeOnline } from '../../application/connectivity';
import { SidebarThreadTree } from './SidebarThreadTree';
import { SidebarPreferencesPanel } from './SidebarPreferencesPanel';


export type ActiveView = 'chat' | 'artifacts';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  projects: ProjectMetadata[];
  activeProject: ProjectMetadata;
  artifacts: Artifact[];
  onSelectProject: (p: ProjectMetadata) => void;
  selectedModel: ModelOption;
  onSelectModel: (m: ModelOption) => void;
  /** Opens the capability-slot Model Settings popup (design-docs/16 §3.1). */
  onOpenModelSettings?: () => void;
  /** Read-aloud voice for TTS playback (selector lives here, not in the composer). */
  chosenVoice?: string;
  onSelectVoice?: (voice: string) => void;
  /** Default bubble view in the chat: rendered markdown, or the raw source. */
  chatRender?: ChatRenderMode;
  onSelectChatRender?: (mode: ChatRenderMode) => void;
  /** What a bare Enter does in the composer: send, or insert a new line. */
  enterSend?: EnterSendMode;
  /** Interface text scale (see uiFontScale.ts). */
  fontScale?: UiFontScale;
  onSelectFontScale?: (scale: UiFontScale) => void;
  onSelectEnterSend?: (mode: EnterSendMode) => void;
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  onOpenExport: () => void;
  onOpenImport: () => void;
  /** Sync now (vps mode): replay offline outbox + re-pull server state. */
  onRefreshSync?: () => void;
  /** Project ids with unsynced offline edits — amber dot on the project row. */
  unsyncedProjectIds?: string[];  onExportDatabase: () => void;
  onImportDatabase: () => void;
  /** Export every project as a plaintext .tar.gz (Package 3 §3.5). */
  onExportPlaintext: () => void;
  /** Import a plaintext .tar.gz/.tar archive (Package 3 §3.5). */
  onImportPlaintext: () => void;
  /** Sign out AND delete the local mirror of this replica (Package 3 §3.6). */
  onSignOutWipeReplica?: () => void;
  onOpenProjectLauncher: () => void;
  onOpenServerLogs?: () => void;
  currentUser?: {
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
    mode?: 'local' | 'vps';
  } | null;
  onSignOut?: () => void;
  /** Connected mode: drop to the isolated Local Workspace without hitting the gate. */
  onSwitchToLocal?: () => void;
  threads?: ChatThread[];
  folders?: ThreadFolder[];
  activeThreadId?: string;
  threadRuntimes?: Record<string, { state: ThreadRuntime; position: number }>;
  onSelectThread?: (threadId: string) => void;
  onCreateThread?: (folderId?: string | null) => void;
  onRenameThread?: (threadId: string, title: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onMoveThread?: (threadId: string, folderId: string | null) => void;
  onArchiveThread?: (threadId: string) => void;
  onUnarchiveThread?: (threadId: string) => void;
  onCreateFolder?: (name: string) => void;
  onRenameFolder?: (folderId: string, name: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onReorderFolders?: (dragId: string, targetId: string) => void;
  onSuggestTitle?: (threadId: string) => void;
  /** "New since you left" brightness bump — cleared on open. */
  unreadThreadIds?: string[];
  onOpenCleanup?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onToggle,
  projects,
  activeProject,
  artifacts,
  onSelectProject,
  selectedModel,
  onSelectModel,
  onOpenModelSettings,
  chosenVoice = 'Kore',
  onSelectVoice,
  chatRender = 'markdown',
  onSelectChatRender,
  enterSend = 'send',
  fontScale = 1,
  onSelectFontScale,
  onSelectEnterSend,
  activeView,
  onChangeView,
  onOpenExport,
  onOpenImport,
  onExportDatabase,
  onImportDatabase,
  onExportPlaintext,
  onImportPlaintext,
  onSignOutWipeReplica,
  onOpenProjectLauncher,
  onOpenServerLogs,
  onRefreshSync,
  unsyncedProjectIds = [],
  currentUser,
  onSignOut,
  onSwitchToLocal,
  threads = [],
  folders = [],
  activeThreadId,
  threadRuntimes = {},
  onSelectThread,
  onCreateThread,
  onRenameThread,
  onDeleteThread,
  onMoveThread,
  onArchiveThread,
  onUnarchiveThread,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onReorderFolders,
  onSuggestTitle,
  unreadThreadIds = [],
  onOpenCleanup,
}) => {
  // Accordion toggles expand inline in document flow, which guarantees the panels can never be clipped.
  const [projectAccordionOpen, setProjectAccordionOpen] = useState(false);
  // Sync-now spinner: spins for the whole refresh, minimum 200ms so a fast
  // sync still reads as "something happened" (David: make it spin, stop on
  // completion, at least 200ms).
  const [syncSpinning, setSyncSpinning] = useState(false);
  const syncNow = useCallback(async () => {
    if (syncSpinning || !onRefreshSync) return;
    setSyncSpinning(true);
    const startedAt = Date.now();
    try {
      await onRefreshSync();
    } finally {
      const remaining = Math.max(0, 200 - (Date.now() - startedAt));
      window.setTimeout(() => setSyncSpinning(false), remaining);
    }
  }, [syncSpinning, onRefreshSync]);  const [accountOpen, setAccountOpen] = useState(false);
  // Connectivity flip: swaps the sync icon for the airplane and disables the
  // network-only affordances (see connectivity.ts for what onLine does and
  // does not promise).
  const online = useSyncExternalStore(subscribeOnline, isOnline);
  const [ioToolsOpen, setIoToolsOpen] = useState(false);
  return (
    <>
      {!isOpen && (
        <button
          onClick={() => {
            logger.action('Sidebar', 'Open sidebar drawer');
            onToggle();
          }}
          aria-label="Open sidebar drawer"
          className="fixed top-3 left-3 z-50 flex items-center justify-center w-11 h-11 rounded-2xl bg-surface-3 hover:bg-surface-4 text-brand hover:text-[#ff6b78] shadow-pop transition-colors duration-200 cursor-pointer group"
          title="Open controls, project & artifact hierarchy"
        >
          <Brain className="w-6 h-6 transition-transform group-hover:scale-110" />
        </button>
      )}

      {isOpen && (
        <div
          onClick={() => {
            logger.action('Sidebar', 'Close sidebar via backdrop click');
            onToggle();
          }}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
        />
      )}

      <aside
        className={`fixed md:relative top-0 bottom-0 left-0 z-40 md:z-20 h-full bg-surface-1/98 md:bg-surface-1 flex flex-col transition-all duration-200 ease-in-out text-ink backdrop-blur-xl shrink-0 ${
          isOpen
            ? 'w-[85vw] max-w-[350px] md:w-[350px] translate-x-0 shadow-2xl md:shadow-none'
            : '-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden'
        }`}
      >
        <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
          {/* Brand + identity: one flat row at the top, avatar opens a popover
              with the address and Sign Out. No card, no accordion, no divider
              rule — the gap below is the separator. */}
          <div className="relative flex items-center gap-2 px-1">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Brain className="w-4 h-4 text-brand shrink-0" />
              <span className="font-semibold text-sm tracking-wide text-ink font-mono truncate">
                MarkBrain
              </span>
            </div>

            <button
              onClick={() => {
                logger.action('Sidebar', `Toggle account popover: ${!accountOpen ? 'opened' : 'closed'}`);
                setAccountOpen((v) => !v);
              }}
              aria-expanded={accountOpen}
              aria-label="Account and sync"
              title={currentUser?.email || 'Local workspace'}
              className="p-0.5 rounded-full hover:bg-surface-3 transition-colors cursor-pointer shrink-0"
            >
              <UserAvatar src={currentUser?.photoURL} />
            </button>

            {currentUser?.mode === 'vps' && isOfflineReplica() && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-0 text-10 font-mono text-[#c9a978] shrink-0"
                title="Opened from the copy on this device — the server is not connected"
              >
                <CloudOff className="w-3 h-3" />
                Offline replica
              </span>
            )}

            <button
              onClick={() => {
                logger.action('Sidebar', 'Close sidebar button clicked');
                onToggle();
              }}
              className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-3 transition-colors cursor-pointer shrink-0"
              title="Close sidebar drawer"
            >
              <X className="w-4 h-4" />
            </button>

            {accountOpen && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl bg-surface-4 p-1.5 shadow-pop animate-in fade-in slide-in-from-top-1 duration-100">
                <div className="px-2.5 py-1.5">
                  <span className="text-xs font-semibold text-ink block truncate">
                    {currentUser?.mode === 'vps'
                      ? currentUser.email || 'Connected workspace'
                      : 'Local Workspace'}
                  </span>
                  <span className="text-10 font-mono text-ink-mute block truncate">
                    {currentUser?.mode === 'vps'
                      ? 'connected · synced to server'
                      : currentUser?.email || 'this device only'}
                  </span>
                </div>
                {currentUser?.mode === 'local' && (
                  <button
                    onClick={() => {
                      logger.action('Sidebar', 'Sign in to Server (return to gate)');
                      setAccountOpen(false);
                      onSignOut?.();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono text-[#8ab1e0] hover:bg-surface-3 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign in to Server…</span>
                  </button>
                )}
                {currentUser?.mode === 'vps' && (
                  <>
                    <button
                      onClick={() => {
                        logger.action('Sidebar', 'Switch to Local Workspace');
                        setAccountOpen(false);
                        onSwitchToLocal?.();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono text-ink hover:bg-surface-3 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Switch to Local Workspace</span>
                    </button>
                    <button
                      onClick={() => {
                        logger.action('Sidebar', 'Sign out (return to gate)');
                        setAccountOpen(false);
                        onSignOut?.();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono text-[#f28894] hover:bg-surface-3 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                    <div className="px-2.5 pb-1 pt-1">
                      <span className="text-10 leading-relaxed text-ink-mute block">
                        Signing out keeps the copy of your workspace on this device. You can open it from the sign-in screen without the server.
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        if (!window.confirm('Sign out and ERASE the copy of your workspace on this device? Everything not synced to the server is lost. This cannot be undone.')) return;
                        logger.action('Sidebar', 'Sign out & wipe local copy');
                        setAccountOpen(false);
                        onSignOutWipeReplica?.();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono text-[#f28894] hover:bg-surface-3 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Sign out &amp; erase this device's copy</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="p-1 bg-recess-1 shadow-well rounded-xl flex items-center gap-1">
            <button
              onClick={() => {
                logger.action('Sidebar', 'Switch view to chat');
                onChangeView('chat');
              }}
              className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-mono font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                activeView === 'chat'
                  ? 'bg-veil-2 shadow-lift text-ink'
                  : 'text-ink-faint hover:text-ink-dim hover:bg-veil-1'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Chat</span>
            </button>
            <button
              onClick={() => {
                logger.action('Sidebar', 'Switch view to artifacts');
                onChangeView('artifacts');
              }}
              className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-mono font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                activeView === 'artifacts'
                  ? 'bg-veil-2 shadow-lift text-ink'
                  : 'text-ink-faint hover:text-ink-dim hover:bg-veil-1'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                Artifacts{artifacts.length > 0 ? ` · ${artifacts.length}` : ''}
              </span>
            </button>
          </div>

          <div className="rounded-xl bg-surface-2 p-1.5">
            {/* Refresh sits OUTSIDE the toggle button — no nested buttons. */}
            <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const nextState = !projectAccordionOpen;
                logger.action('Sidebar', `Toggle project accordion: ${nextState ? 'opened' : 'closed'}`);
                setProjectAccordionOpen(nextState);
              }}
              className="flex-1 min-w-0 flex items-center justify-between pl-1.5 pr-1 py-2 rounded-lg text-left transition-colors hover:bg-surface-3 cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-3 h-3 rounded-full shrink-0 shadow-xs"
                  style={{ backgroundColor: activeProject.color || '#5d87b8' }}
                />
                <div className="min-w-0">
                  <span className="text-10 font-mono uppercase tracking-wider text-ink-mute block">
                    Active Project
                  </span>
                  <span className="text-xs font-semibold text-ink truncate block">
                    {activeProject.name}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[#556985]">
                <span className="text-10 font-mono">{projects.length} proj</span>
                {projectAccordionOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>            </button>
            {onRefreshSync && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!online) return;
                  void syncNow();
                }}
                disabled={!online}
                title={
                  online
                    ? 'Sync now — push offline edits, pull server changes'
                    : 'Offline — edits queue locally and sync when you reconnect'
                }
                aria-label={online ? 'Sync now' : 'Offline'}
                className={`p-1.5 rounded-lg text-[#556985] hover:bg-surface-3 transition-colors shrink-0 ${
                  online ? 'hover:text-ink cursor-pointer' : 'cursor-default'
                }`}
              >
                {online ? (
                  <RefreshCw className={`w-3.5 h-3.5 ${syncSpinning ? 'animate-spin' : ''}`} />
                ) : (
                  <Plane className="w-3.5 h-3.5 text-[#e0b96c]" />
                )}
              </button>
            )}
            </div>

            {projectAccordionOpen && (
              <div className="mt-0.5 pb-1.5 space-y-0.5 animate-in fade-in duration-100">
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
                          ? 'bg-veil-2 text-ink font-semibold shadow-[inset_2px_0_0_#38bdf8]'
                          : 'hover:bg-veil-1 text-ink-dim'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: proj.color || '#5d87b8' }}
                        />
                        <span className="truncate">{proj.name}</span>
                      </div>
                      {unsyncedProjectIds.includes(proj.id) && (
                        <span
                          className="ml-1 w-2 h-2 rounded-full bg-amber-400 shrink-0"
                          title="Unsynced changes — will sync when back online"
                        />
                      )}                      {proj.id === activeProject.id && (
                        <Check className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
                      )}
                    </button>
                  ))}
                </div>

                {!isOfflineReplica() && (
                <button
                  onClick={() => {
                    logger.action('Sidebar', 'Open Project Launcher from sidebar');
                    setProjectAccordionOpen(false);
                    onOpenProjectLauncher();
                  }}
                  className="w-full mt-1.5 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-recess-1 shadow-well hover:bg-recess-2 text-xs font-mono text-ink-dim transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3 text-[#e05a66]" />
                  <span>Create / Switch in Deck</span>
                </button>
                )}
              </div>
            )}
          </div>


          <SidebarThreadTree
            threads={threads}
            folders={folders}
            activeThreadId={activeThreadId}
            threadRuntimes={threadRuntimes}
            unreadThreadIds={unreadThreadIds}
            onSelectThread={onSelectThread}
            onCreateThread={onCreateThread}
            onRenameThread={onRenameThread}
            onDeleteThread={onDeleteThread}
            onMoveThread={onMoveThread}
            onArchiveThread={onArchiveThread}
            onUnarchiveThread={onUnarchiveThread}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            onReorderFolders={onReorderFolders}
            onSuggestTitle={onSuggestTitle}
          />


          <div className="rounded-xl bg-surface-2 p-1.5">
            <button
              onClick={() => {
                logger.action('Sidebar', 'Open model settings');
                onOpenModelSettings?.();
              }}
              data-testid="open-model-settings"
              title="Model settings — one model per lane"
              className="w-full flex items-center gap-2.5 pl-1.5 pr-2 py-2 rounded-lg text-left transition-colors hover:bg-surface-3 cursor-pointer"
            >
              <div className="w-7 h-7 rounded-lg bg-recess-1 shadow-well flex items-center justify-center shrink-0">
                <Cpu className="w-4 h-4 text-[#e05a66]" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-10 font-mono uppercase tracking-wider text-ink-mute block">
                  Inference Model
                </span>
                <span className="text-xs font-semibold text-ink truncate block">
                  {selectedModel.name}
                </span>
              </div>
              <Settings2 className="w-3.5 h-3.5 shrink-0 text-[#556985]" />
            </button>
          </div>


          <SidebarPreferencesPanel
            chatRender={chatRender}
            onSelectChatRender={onSelectChatRender}
            fontScale={fontScale}
            onSelectFontScale={onSelectFontScale}
            enterSend={enterSend}
            onSelectEnterSend={onSelectEnterSend}
            chosenVoice={chosenVoice}
            onSelectVoice={onSelectVoice}
          />


          <div className="rounded-xl bg-surface-2 p-1.5">
            <button
              onClick={() => {
                const nextState = !ioToolsOpen;
                logger.action('Sidebar', `Toggle I/O tools accordion: ${nextState ? 'opened' : 'closed'}`);
                setIoToolsOpen(nextState);
              }}
              className="w-full flex items-center justify-between pl-1.5 pr-1 py-2 rounded-lg text-left transition-colors hover:bg-surface-3 cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Database className="w-4 h-4 text-[#5ad49b] shrink-0" />
                <span className="text-xs font-semibold text-ink font-mono">
                  Import / Export I/O
                </span>
              </div>
              {ioToolsOpen ? <ChevronUp className="w-3.5 h-3.5 text-[#556985]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#556985]" />}
            </button>

            {ioToolsOpen && (
              <div className="mt-0.5 pb-1.5 space-y-2 animate-in fade-in duration-100">
                <p className="text-10 text-[#6b82a3] leading-relaxed">
                  Backup or restore project state, artifacts, chapters, and topological graphs.
                </p>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {!isOfflineReplica() && (
                  <button
                    onClick={() => {
                      logger.action('Sidebar', 'Open Import Modal');
                      onOpenImport();
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-recess-1 shadow-well hover:bg-recess-2 text-xs font-mono text-[#8ab1e0] transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#e05a66]" />
                    <span>Import</span>
                  </button>
                  )}
                  <button
                    onClick={() => {
                      logger.action('Sidebar', 'Open Export Modal');
                      onOpenExport();
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-recess-1 shadow-well hover:bg-recess-2 text-xs font-mono text-[#8ab1e0] transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#5ad49b]" />
                    <span>Export</span>
                  </button>
                  <button
                    onClick={() => {
                      logger.action('Sidebar', 'Export full database backup');
                      onExportDatabase();
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-recess-1 shadow-well hover:bg-recess-2 text-xs font-mono text-[#5ad49b] transition-colors cursor-pointer col-span-1"
                    title="Download every project (turns, chapters, artifacts, graph) as one JSON file"
                  >
                    <Save className="w-3.5 h-3.5 text-[#5ad49b]" />
                    <span>Backup DB</span>
                  </button>
                  {!isOfflineReplica() && (
                  <button
                    onClick={() => {
                      logger.action('Sidebar', 'Restore database from file');
                      onImportDatabase();
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-recess-1 shadow-well hover:bg-recess-2 text-xs font-mono text-[#8ab1e0] transition-colors cursor-pointer col-span-1"
                    title="Restore a MarkBrain database backup file into the active backend"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-[#38bdf8]" />
                    <span>Restore DB</span>
                  </button>
                  )}
                  <button
                    onClick={() => {
                      logger.action('Sidebar', 'Export plaintext backup (.tar.gz)');
                      onExportPlaintext();
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-recess-1 shadow-well hover:bg-recess-2 text-xs font-mono text-[#5ad49b] transition-colors cursor-pointer col-span-2"
                    title="Download every project as a folder of readable files (JSON + Markdown) in a .tar.gz"
                  >
                    <FileArchive className="w-3.5 h-3.5 text-[#5ad49b]" />
                    <span>Plaintext backup (.tar.gz)</span>
                  </button>
                  {!isOfflineReplica() && (
                  <button
                    onClick={() => {
                      logger.action('Sidebar', 'Import plaintext archive');
                      onImportPlaintext();
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-recess-1 shadow-well hover:bg-recess-2 text-xs font-mono text-[#8ab1e0] transition-colors cursor-pointer col-span-2"
                    title="Import projects from a plaintext .tar.gz (or .tar) backup"
                  >
                    <FolderInput className="w-3.5 h-3.5 text-[#38bdf8]" />
                    <span>Import plaintext</span>
                  </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {onOpenCleanup && !isOfflineReplica() && (
            <button
              onClick={() => {
                logger.action('Sidebar', 'Open Cleanup tool');
                onOpenCleanup();
              }}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-surface-2 hover:bg-veil-1 text-left transition-colors cursor-pointer group"
              title="Archive chats and artifacts in bulk, then delete the archived ones for good"
            >
              <div className="flex items-center gap-2">
                <Trash2 className="w-3.5 h-3.5 text-[#b08a5a]" />
                <span className="text-xs font-semibold font-mono text-[#c9a978] group-hover:text-ink">
                  Cleanup
                </span>
              </div>
              <span className="text-10 font-mono text-[#6b82a3] px-1.5 py-0.5 rounded bg-surface-0">
                archive → delete
              </span>
            </button>
          )}

          {onOpenServerLogs && (
            <button
              onClick={() => {
                if (!online) return;
                logger.action('Sidebar', 'Open Server Logs Modal');
                onOpenServerLogs();
              }}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-surface-2 hover:bg-veil-1 text-left transition-colors group ${
                online ? 'cursor-pointer' : 'cursor-default opacity-60'
              }`}
              title={
                online
                  ? 'Inspect backend live streaming logs and token telemetry'
                  : 'Offline — telemetry needs a connection'
              }
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <Terminal className="w-3.5 h-3.5 text-[#38bdf8]" />
                <span className="text-xs font-semibold font-mono text-[#9cc4f5] group-hover:text-ink">
                  Server Telemetry & Logs
                </span>
              </div>
              <span className="text-10 font-mono text-[#52749e] px-1.5 py-0.5 rounded bg-surface-0">
                LIVE
              </span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
};