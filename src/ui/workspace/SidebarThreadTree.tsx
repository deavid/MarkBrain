/**
 * The thread tree: the threads accordion with the inbox, folders, archived
 * section, drag & drop, and the per-thread / per-folder context menus.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Database,
  FolderKanban,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { logger } from '../../utils/logger';
import { ChatThread, ThreadFolder, ThreadRuntime } from '../../domains/06-chat-threads';

export interface SidebarThreadTreeProps {
  threads: ChatThread[];
  folders: ThreadFolder[];
  activeThreadId?: string;
  threadRuntimes: Record<string, { state: ThreadRuntime; position: number }>;
  /** "New since you left" brightness bump — cleared on open. */
  unreadThreadIds: string[];
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
}

export const SidebarThreadTree: React.FC<SidebarThreadTreeProps> = ({
  threads,
  folders,
  activeThreadId,
  threadRuntimes,
  unreadThreadIds,
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
}) => {
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
    </>
  );
};
