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
  Volume2,
  Type,
  CornerDownLeft,

  LogOut,

  Plus,
  FolderKanban,
  Save,
  RotateCcw,
  RefreshCw,
  Plane,
  MoreHorizontal,  Trash2,
  Settings2,
  ALargeSmall,
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

/** Read-aloud voices supported by the Gemini TTS endpoint (/api/tts). */
export const TTS_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'] as const;

/** The global bubble-view switch, with the sentence that explains it on hover. */
const CHAT_RENDER_CHOICES: { mode: ChatRenderMode; label: string; hint: string }[] = [
  {
    mode: 'markdown',
    label: 'Markdown',
    hint: 'Render replies as formatted markdown (each message can still flip to Raw)',
  },
  {
    mode: 'raw',
    label: 'Raw',
    hint: 'Show the untouched markdown source of every message',
  },
];

/**
 * How big the interface text is. Phones cannot pinch-zoom (the viewport pins
 * user-scalable), so this is the only way to read at arm's length. The default
 * keeps the browser's own font-size preference; the steps scale everything.
 */
const UI_FONT_SCALE_CHOICES: { scale: UiFontScale; label: string; hint: string }[] = [
  { scale: 1, label: 'Default', hint: 'Design size — the browser font preference applies' },
  { scale: 1.15, label: 'Large', hint: '115% — a gentle step up everywhere' },
  { scale: 1.3, label: 'Larger', hint: '130% — comfortable on a phone' },
  { scale: 1.5, label: 'Largest', hint: '150% — arm\u2019s length reading' },
];

/**
 * What a bare Enter does in the composer. Only Enter is configurable here —
 * Shift+Enter always makes a new line and Ctrl/Cmd+Enter always sends, on every
 * keyboard and every viewport (including phones, where this panel is reachable
 * through the drawer).
 */
const ENTER_SEND_CHOICES: { mode: EnterSendMode; label: string; hint: string }[] = [
  {
    mode: 'send',
    label: 'Sends',
    hint: 'Enter sends the message · Shift+Enter makes a new line · Ctrl+Enter always sends',
  },
  {
    mode: 'newline',
    label: 'New line',
    hint: 'Enter makes a new line · Ctrl+Enter sends',
  },
];

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
  const [threadsOpen, setThreadsOpen] = useState(true);

  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [threadMenu, setThreadMenu] = useState<{ x: number; y: number; threadId: string } | null>(null);
  const [menuMoveOpen, setMenuMoveOpen] = useState(false);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
  const [folderNameBox, setFolderNameBox] = useState<{ mode: 'create' | 'rename'; folderId?: string } | null>(null);
  const [folderDraft, setFolderDraft] = useState('');
  // Fold state per folder (default open; only explicit folds stay closed)
  const [folderOpen, setFolderOpen] = useState<Record<string, boolean>>({});
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const unreadSet = useMemo(() => new Set(unreadThreadIds), [unreadThreadIds]);

  const DRAG_THREAD = 'application/x-markbrain-thread';
  const DRAG_FOLDER = 'application/x-markbrain-folder';

  useEffect(() => {
    if (!threadMenu && !folderMenu) return;
    const onPointerDown = () => {
      setThreadMenu(null);
      setFolderMenu(null);
      setMenuMoveOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [threadMenu, folderMenu]);

  const beginThreadRename = (t: ChatThread) => {
    setThreadMenu(null);
    setMenuMoveOpen(false);
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

  const beginFolderNameBox = (mode: 'create' | 'rename', folderId?: string, current?: string) => {
    setFolderMenu(null);
    setFolderNameBox({ mode, folderId });
    setFolderDraft(current ?? '');
  };

  const commitFolderName = () => {
    const box = folderNameBox;
    setFolderNameBox(null);
    if (!box) return;
    const name = folderDraft.trim();
    if (!name) return;
    if (box.mode === 'create') {
      logger.action('Sidebar', 'Created folder', { name });
      onCreateFolder?.(name);
    } else if (box.folderId) {
      logger.action('Sidebar', 'Renamed folder', { folderId: box.folderId, name });
      onRenameFolder?.(box.folderId, name);
    }
  };

  const byActivity = (a: ChatThread, b: ChatThread) => b.lastActivityAt - a.lastActivityAt;
  const activeThreads = threads.filter((t) => t.lifecycle === 'active');
  const archivedThreads = threads.filter((t) => t.lifecycle === 'archived').sort(byActivity);
  const inboxThreads = activeThreads.filter((t) => !t.folderId).sort(byActivity);
  const foldersSorted = [...folders].sort((a, b) => a.order - b.order);
  const threadsInFolder = (folderId: string) =>
    activeThreads.filter((t) => t.folderId === folderId).sort(byActivity);

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
          className="w-2 h-2 rounded-full ring-1 ring-[#e0b96c] bg-transparent shrink-0"
          title="Interrupted"
        />
      );
    return null;
  };

  const renderThreadRow = (t: ChatThread, opts: { dimmed?: boolean } = {}) => {
    const isActive = t.id === activeThreadId;
    const runtime = threadRuntimes[t.id];
    return (
      <div
        key={t.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_THREAD, t.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const draggedThread = e.dataTransfer.getData(DRAG_THREAD);
          setDragOverTarget(null);
          if (draggedThread && draggedThread !== t.id) {
            logger.action('Sidebar', 'Move thread via row drop', { threadId: draggedThread, folderId: t.folderId });
            onMoveThread?.(draggedThread, t.folderId);
          }
        }}
        onClick={() => {
          if (renamingThreadId === t.id) return;
          logger.action('Sidebar', `Selected thread: ${t.title}`, { threadId: t.id });
          onSelectThread?.(t.id);
        }}
        onDoubleClick={() => beginThreadRename(t)}
        onContextMenu={(e) => {
          e.preventDefault();
          setFolderMenu(null);
          setThreadMenu({ x: e.clientX, y: e.clientY, threadId: t.id });
        }}
        className={`w-full flex items-center gap-2 min-h-[30px] pl-2 pr-1 py-1 rounded-md text-left text-xs transition-colors cursor-pointer group select-none ${
          isActive
            ? 'bg-veil-2 text-ink font-medium shadow-[inset_2px_0_0_#38bdf8]'
            : unreadSet.has(t.id)
              ? 'text-ink font-medium hover:bg-veil-1'
              : 'text-ink-dim hover:bg-veil-1 hover:text-ink'
        } ${opts.dimmed ? 'opacity-70' : ''}`}
        title={`${t.preview || t.title}${opts.dimmed ? ' (archived)' : ''}`}
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
            className="flex-1 min-w-0 bg-recess-2 shadow-well rounded-md px-1.5 py-0.5 text-xs text-ink focus:outline-none"
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
              <span className="text-9 font-mono text-[#e0b96c] shrink-0 tabular-nums">
                #{runtime.position}
              </span>
            )}
            {runtimeDot(runtime?.state)}

            {/* Row actions. Archiving and deleting must never be reachable only
                by right-click or by dragging onto "Archived" — neither exists on
                a touch screen. This button is the path on every device. */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setFolderMenu(null);
                setThreadMenu({
                  x: Math.max(8, Math.min(r.left, window.innerWidth - 176)),
                  y: r.bottom + 4,
                  threadId: t.id,
                });
              }}
              aria-label={`Actions for ${t.title}`}
              title="Thread actions"
              className={`p-1 -mr-0.5 rounded text-ink-faint hover:text-ink hover:bg-surface-4 transition-colors cursor-pointer shrink-0 ${
                isActive
                  ? 'opacity-100'
                  : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100'
              }`}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    );
  };

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

          <div className="rounded-xl bg-surface-2 p-1.5">
            {/* Header row. Order is deliberate: label · new folder · new thread ·
                chevron LAST, so the collapse affordance is the final glyph on
                the right and never sits in the middle of the action cluster. */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => {
                  const next = !threadsOpen;
                  logger.action('Sidebar', `Toggle threads accordion: ${next ? 'opened' : 'closed'}`);
                  setThreadsOpen(next);
                }}
                className="flex items-center gap-2 min-w-0 flex-1 pl-1.5 pr-1 py-2 rounded-lg text-left transition-colors hover:bg-surface-3 cursor-pointer"
              >
                <span className="text-10 font-mono uppercase tracking-wider text-ink-mute">
                  Threads
                </span>
                <span className="text-10 font-mono text-ink-faint/70 tabular-nums">
                  {activeThreads.length}
                </span>
              </button>
              <button
                onClick={() => {
                  logger.action('Sidebar', 'New folder');
                  beginFolderNameBox('create');
                }}
                className="p-1.5 rounded-lg text-ink-faint hover:text-ink-dim hover:bg-surface-3 transition-colors cursor-pointer shrink-0"
                title="New folder"
              >
                <FolderKanban className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  logger.action('Sidebar', 'Create new thread');
                  onCreateThread?.();
                }}
                className="p-1.5 rounded-lg text-ink-faint hover:text-brand hover:bg-surface-3 transition-colors cursor-pointer shrink-0"
                title="New thread"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  const next = !threadsOpen;
                  logger.action('Sidebar', `Toggle threads accordion: ${next ? 'opened' : 'closed'}`);
                  setThreadsOpen(next);
                }}
                aria-expanded={threadsOpen}
                aria-label={threadsOpen ? 'Collapse threads' : 'Expand threads'}
                className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-3 transition-colors cursor-pointer shrink-0"
              >
                {threadsOpen ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {threadsOpen && (
              <div className="animate-in fade-in duration-100">
                <div
                  className="max-h-72 overflow-y-auto p-1 space-y-0.5"
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverTarget !== 'inbox') setDragOverTarget('inbox');
                  }}
                  onDragLeave={() => setDragOverTarget((d) => (d === 'inbox' ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const threadId = e.dataTransfer.getData(DRAG_THREAD);
                    setDragOverTarget(null);
                    if (threadId) {
                      logger.action('Sidebar', 'Drop → Inbox', { threadId });
                      onMoveThread?.(threadId, null);
                    }
                  }}
                >
                  {folderNameBox && folderNameBox.mode === 'create' && (
                    <div className="p-1">
                      <input
                        autoFocus
                        value={folderDraft}
                        placeholder="Folder name…"
                        onChange={(e) => setFolderDraft(e.target.value)}
                        onBlur={commitFolderName}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') commitFolderName();
                          if (e.key === 'Escape') setFolderNameBox(null);
                        }}
                        className="w-full bg-recess-2 shadow-well rounded-md px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
                      />
                    </div>
                  )}

                  <div
                    className={`flex items-center gap-1.5 px-1.5 pt-1 pb-0.5 rounded ${
                      dragOverTarget === 'inbox' ? 'ring-1 ring-[#38bdf8]/70 bg-surface-2' : ''
                    }`}
                  >
                    <span className="text-9 font-mono uppercase tracking-wider text-ink-mute">
                      Inbox
                    </span>
                    <span className="text-9 font-mono text-[#455770]">({inboxThreads.length})</span>
                  </div>
                  {inboxThreads.map((t) => renderThreadRow(t))}
                  {inboxThreads.length === 0 && !folderNameBox && (
                    <p className="text-9 font-mono text-[#455770] px-2 py-1">Drop threads here</p>
                  )}

                  {foldersSorted.map((f) => {
                    const open = folderOpen[f.id] !== false;
                    const fThreads = threadsInFolder(f.id);
                    const isRenaming =
                      folderNameBox?.mode === 'rename' && folderNameBox.folderId === f.id;
                    return (
                      <div
                        key={f.id}
                        className={`rounded-lg ${
                          dragOverTarget === f.id ? 'ring-1 ring-[#38bdf8]/70 bg-surface-2' : ''
                        }`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverTarget(f.id);
                        }}
                        onDragLeave={() => setDragOverTarget((d) => (d === f.id ? null : d))}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const threadId = e.dataTransfer.getData(DRAG_THREAD);
                          const draggedFolder = e.dataTransfer.getData(DRAG_FOLDER);
                          setDragOverTarget(null);
                          if (threadId) {
                            logger.action('Sidebar', `Drop → folder ${f.name}`, { threadId });
                            onMoveThread?.(threadId, f.id);
                          } else if (draggedFolder && draggedFolder !== f.id) {
                            logger.action('Sidebar', 'Reorder folder', { dragId: draggedFolder, targetId: f.id });
                            onReorderFolders?.(draggedFolder, f.id);
                          }
                        }}
                      >
                        <div
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_FOLDER, f.id);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onClick={() => setFolderOpen((p) => ({ ...p, [f.id]: !open }))}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (!isRenaming) beginFolderNameBox('rename', f.id, f.name);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setThreadMenu(null);
                            setFolderMenu({ x: e.clientX, y: e.clientY, folderId: f.id });
                          }}
                          className="w-full flex items-center gap-1.5 min-h-[30px] px-2 py-1 rounded-md text-xs text-ink-dim hover:bg-surface-3 hover:text-ink cursor-pointer select-none"
                          title="Click to fold · double-click to rename · drag to reorder · right-click for actions"
                        >
                          {open ? (
                            <ChevronDown className="w-3 h-3 text-[#556985] shrink-0" />
                          ) : (
                            <ChevronUp className="w-3 h-3 text-[#556985] shrink-0" />
                          )}
                          <FolderKanban className="w-3.5 h-3.5 text-[#8ab1e0] shrink-0" />
                          {isRenaming ? (
                            <input
                              autoFocus
                              value={folderDraft}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setFolderDraft(e.target.value)}
                              onBlur={commitFolderName}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter') commitFolderName();
                                if (e.key === 'Escape') setFolderNameBox(null);
                              }}
                              className="flex-1 min-w-0 bg-recess-2 shadow-well rounded-md px-1.5 py-0.5 text-xs text-ink focus:outline-none"
                            />
                          ) : (
                            <span className="flex-1 min-w-0 truncate font-semibold">{f.name}</span>
                          )}
                          <span className="text-9 font-mono text-[#526682]">({fThreads.length})</span>
                        </div>
                        {open && (
                          <div className="pl-2 space-y-0.5 mt-0.5">
                            {fThreads.map((t) => renderThreadRow(t))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {archivedThreads.length > 0 && (
                    <div
                      className={`mt-1 rounded-lg ${
                        dragOverTarget === 'archived' ? 'ring-1 ring-[#e0b96c]/70 bg-surface-1' : ''
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverTarget('archived');
                      }}
                      onDragLeave={() => setDragOverTarget((d) => (d === 'archived' ? null : d))}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const threadId = e.dataTransfer.getData(DRAG_THREAD);
                        setDragOverTarget(null);
                        if (threadId) {
                          logger.action('Sidebar', 'Drop → Archived', { threadId });
                          onArchiveThread?.(threadId);
                        }
                      }}
                    >
                      <button
                        onClick={() => setArchivedOpen((v) => !v)}
                        className="w-full flex items-center gap-1.5 min-h-[30px] px-2 py-1 rounded-md text-xs text-ink-mute hover:bg-surface-3 hover:text-ink-dim cursor-pointer select-none"
                        title="Archived threads — click to expand"
                      >
                        {archivedOpen ? (
                          <ChevronDown className="w-3 h-3 text-[#556985] shrink-0" />
                        ) : (
                          <ChevronUp className="w-3 h-3 text-[#556985] shrink-0" />
                        )}
                        <Database className="w-3.5 h-3.5 text-[#556985] shrink-0" />
                        <span className="flex-1 text-left">Archived</span>
                        <span className="text-9 font-mono text-[#526682]">
                          ({archivedThreads.length})
                        </span>
                      </button>
                      {archivedOpen && (
                        <div className="space-y-0.5 opacity-75 mt-0.5">
                          {archivedThreads.map((t) => renderThreadRow(t, { dimmed: true }))}
                        </div>
                      )}
                    </div>
                  )}

                  {threads.length === 0 && (
                    <p className="text-10 font-mono text-[#526682] p-2">No threads yet.</p>
                  )}

                </div>
              </div>
            )}
          </div>

          {threadMenu && (
            <div
              className="fixed z-[60] min-w-40 p-1.5 bg-surface-4 rounded-xl shadow-pop animate-in fade-in duration-100"
              style={{ left: threadMenu.x, top: threadMenu.y }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {(() => {
                const t = threads.find((x) => x.id === threadMenu.threadId);
                return (
                  <>
                    <button
                      onClick={() => {
                        if (t) beginThreadRename(t);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-mono text-[#9bb0d1] hover:bg-surface-3 hover:text-ink transition-colors cursor-pointer"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => {
                        const id = threadMenu.threadId;
                        setThreadMenu(null);
                        if (t) {
                          logger.action('Sidebar', 'Suggest new title', { threadId: id });
                          onSuggestTitle?.(id);
                        }
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-mono text-[#9bb0d1] hover:bg-surface-3 hover:text-ink transition-colors cursor-pointer"
                    >
                      Suggest new title
                    </button>
                    <button
                      onClick={() => setMenuMoveOpen((v) => !v)}
                      className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-mono text-[#9bb0d1] hover:bg-surface-3 hover:text-ink transition-colors cursor-pointer flex items-center justify-between"
                    >
                      <span>Move to…</span>
                      <ChevronRight className="w-3 h-3 text-[#556985]" />
                    </button>
                    {menuMoveOpen && t && (
                      <div className="mt-0.5 mb-1 ml-3 pl-2 border-l border-line-soft space-y-0.5">
                        <button
                          onClick={() => {
                            onMoveThread?.(t.id, null);
                            setThreadMenu(null);
                            setMenuMoveOpen(false);
                          }}
                          className={`w-full px-2 py-1 rounded text-left text-11 font-mono transition-colors cursor-pointer ${
                            !t.folderId ? 'text-[#38bdf8]' : 'text-[#9bb0d1] hover:bg-surface-3 hover:text-ink'
                          }`}
                        >
                          Inbox
                        </button>
                        {foldersSorted.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => {
                              onMoveThread?.(t.id, f.id);
                              setThreadMenu(null);
                              setMenuMoveOpen(false);
                            }}
                            className={`w-full px-2 py-1 rounded text-left text-11 font-mono transition-colors cursor-pointer truncate ${
                              t.folderId === f.id
                                ? 'text-[#38bdf8]'
                                : 'text-[#9bb0d1] hover:bg-surface-3 hover:text-ink'
                            }`}
                          >
                            {f.name}
                          </button>
                        ))}
                        {foldersSorted.length === 0 && (
                          <p className="text-10 text-[#455770] px-2 py-0.5">No folders yet</p>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        if (!t) return;
                        if (t.lifecycle === 'archived') {
                          logger.action('Sidebar', 'Unarchive thread', { threadId: t.id });
                          onUnarchiveThread?.(t.id);
                        } else {
                          logger.action('Sidebar', 'Archive thread', { threadId: t.id });
                          onArchiveThread?.(t.id);
                        }
                        setThreadMenu(null);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-mono text-[#9bb0d1] hover:bg-surface-3 hover:text-ink transition-colors cursor-pointer"
                    >
                      {t?.lifecycle === 'archived' ? 'Unarchive' : 'Archive'}
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
                      className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-mono text-[#f28894] hover:bg-surface-3 transition-colors cursor-pointer"
                    >
                      Delete
                    </button>
                  </>
                );
              })()}
            </div>
          )}

          {folderMenu && (
            <div
              className="fixed z-[60] min-w-40 p-1.5 bg-surface-4 rounded-xl shadow-pop animate-in fade-in duration-100"
              style={{ left: folderMenu.x, top: folderMenu.y }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {(() => {
                const f = folders.find((x) => x.id === folderMenu.folderId);
                if (!f) return null;
                const fCount = threadsInFolder(f.id).length;
                return (
                  <>
                    <button
                      onClick={() => beginFolderNameBox('rename', f.id, f.name)}
                      className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-mono text-[#9bb0d1] hover:bg-surface-3 hover:text-ink transition-colors cursor-pointer"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => {
                        setFolderMenu(null);
                        logger.action('Sidebar', 'New thread in folder', { folderId: f.id });
                        onCreateThread?.(f.id);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-mono text-[#9bb0d1] hover:bg-surface-3 hover:text-ink transition-colors cursor-pointer"
                    >
                      New thread here
                    </button>
                    <button
                      onClick={() => {
                        const id = folderMenu.folderId;
                        setFolderMenu(null);
                        if (fCount > 0) {
                          window.alert(`"${f.name}" is not empty — move or delete its threads first.`);
                        } else if (window.confirm(`Delete folder "${f.name}"?`)) {
                          logger.action('Sidebar', 'Delete folder', { folderId: id });
                          onDeleteFolder?.(id);
                        }
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-mono text-[#f28894] hover:bg-surface-3 transition-colors cursor-pointer"
                    >
                      Delete folder
                    </button>
                  </>
                );
              })()}
            </div>
          )}

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

          {/* Reading preference, not project data: it sits next to the model
              picker because it is how you read what that model says. Every
              bubble still carries its own Raw toggle — this is just the
              default they start from. */}
          <div className="rounded-xl bg-surface-2 p-1.5">
            <div className="flex items-center gap-2.5 p-2.5 pb-1.5">
              <div className="w-7 h-7 rounded-lg bg-recess-1 shadow-well flex items-center justify-center shrink-0">
                <Type className="w-4 h-4 text-[#38bdf8]" />
              </div>
              <div className="min-w-0">
                <span className="text-10 font-mono uppercase tracking-wider text-ink-mute block">
                  Chat text
                </span>
                <span className="text-xs font-semibold text-ink truncate block">
                  {chatRender === 'raw' ? 'Raw markdown' : 'Rendered markdown'}
                </span>
              </div>
            </div>
            <div className="px-1.5 pb-1.5 flex items-center gap-1">
              {CHAT_RENDER_CHOICES.map((choice) => {
                const isSelected = choice.mode === chatRender;
                return (
                  <button
                    key={choice.mode}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`Chat text: ${choice.label}`}
                    onClick={() => {
                      logger.action('Sidebar', `Chat text mode: ${choice.mode}`);
                      onSelectChatRender?.(choice.mode);
                    }}
                    title={choice.hint}
                    className={`flex-1 min-h-[26px] px-2.5 rounded-full text-10 font-mono transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-veil-3 shadow-lift text-ink font-semibold'
                        : 'text-ink-faint hover:bg-veil-1 hover:text-ink-dim'
                    }`}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Text size. A reading preference like the two above; on a phone
              it is the only zoom there is, since the viewport pins
              user-scalable. The steps move every rem-sized text class through
              the root font size, plus the few px rules via --ui-scale. */}
          <div className="rounded-xl bg-surface-2 p-1.5">
            <div className="flex items-center gap-2.5 p-2.5 pb-1.5">
              <div className="w-7 h-7 rounded-lg bg-recess-1 shadow-well flex items-center justify-center shrink-0">
                <ALargeSmall className="w-4 h-4 text-[#9be07c]" />
              </div>
              <div className="min-w-0">
                <span className="text-10 font-mono uppercase tracking-wider text-ink-mute block">
                  Text size
                </span>
                <span className="text-xs font-semibold text-ink truncate block">
                  {UI_FONT_SCALE_CHOICES.find((c) => c.scale === fontScale)?.label ?? 'Default'}
                </span>
              </div>
            </div>
            <div className="px-1.5 pb-1.5 flex items-center gap-1">
              {UI_FONT_SCALE_CHOICES.map((choice) => {
                const isSelected = choice.scale === fontScale;
                return (
                  <button
                    key={choice.scale}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`Text size: ${choice.label}`}
                    data-testid={`font-scale-${choice.scale}`}
                    onClick={() => {
                      logger.action('Sidebar', `Text size: ${choice.scale}`);
                      onSelectFontScale?.(choice.scale);
                    }}
                    title={choice.hint}
                    className={`flex-1 min-h-[26px] px-2 rounded-full text-10 font-mono transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-veil-3 shadow-lift text-ink font-semibold'
                        : 'text-ink-faint hover:bg-veil-1 hover:text-ink-dim'
                    }`}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Send-on-Enter preference. Another typing preference, so it sits
              with the others and is reachable on a phone through the drawer —
              which is the point of putting it here rather than in the composer.
              Shift+Enter and Ctrl/Cmd+Enter are NOT offered as choices: they are
              not preferences, they are the floor. */}
          <div className="rounded-xl bg-surface-2 p-1.5">
            <div className="flex items-center gap-2.5 p-2.5 pb-1.5">
              <div className="w-7 h-7 rounded-lg bg-recess-1 shadow-well flex items-center justify-center shrink-0">
                <CornerDownLeft className="w-4 h-4 text-[#e0b96c]" />
              </div>
              <div className="min-w-0">
                <span className="text-10 font-mono uppercase tracking-wider text-ink-mute block">
                  Send on Enter
                </span>
                <span className="text-xs font-semibold text-ink truncate block">
                  {enterSend === 'send' ? 'Enter sends' : 'Enter makes a new line'}
                </span>
              </div>
            </div>
            <div className="px-1.5 pb-1.5 flex items-center gap-1">
              {ENTER_SEND_CHOICES.map((choice) => {
                const isSelected = choice.mode === enterSend;
                return (
                  <button
                    key={choice.mode}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`Send on Enter: ${choice.label}`}
                    data-testid={`enter-send-${choice.mode}`}
                    onClick={() => {
                      logger.action('Sidebar', `Send on Enter: ${choice.mode}`);
                      onSelectEnterSend?.(choice.mode);
                    }}
                    title={choice.hint}
                    className={`flex-1 min-h-[26px] px-2.5 rounded-full text-10 font-mono transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-veil-3 shadow-lift text-ink font-semibold'
                        : 'text-ink-faint hover:bg-veil-1 hover:text-ink-dim'
                    }`}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Block 3.5: Read-aloud voice (moved out of the chat composer —
              on a 350px phone the composer belongs to typing, not settings).
              Read-only replica: TTS is a server job — nothing to read aloud. */}
          {!isOfflineReplica() && (
          <div className="rounded-xl bg-surface-2 p-1.5">
            <div className="flex items-center justify-between p-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-recess-1 shadow-well flex items-center justify-center shrink-0">
                  <Volume2 className="w-4 h-4 text-[#5ad49b]" />
                </div>
                <div className="min-w-0">
                  <span className="text-10 font-mono uppercase tracking-wider text-ink-mute block">
                    Read-aloud voice
                  </span>
                  <span className="text-xs font-semibold text-ink truncate block">{chosenVoice}</span>
                </div>
              </div>
            </div>
            <ReadAloudControls />
            <div className="px-1.5 pb-1.5 flex items-center gap-1 flex-wrap">
              {TTS_VOICES.map((v) => {
                const isSelected = v === chosenVoice;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`Read-aloud voice ${v}`}
                    onClick={() => {
                      logger.action('Sidebar', `Selected TTS voice: ${v}`);
                      onSelectVoice?.(v);
                    }}
                    className={`min-h-[26px] px-2.5 rounded-full text-10 font-mono transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-veil-3 shadow-lift text-ink font-semibold'
                        : 'text-ink-faint hover:bg-veil-1 hover:text-ink-dim'
                    }`}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
          )}

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
