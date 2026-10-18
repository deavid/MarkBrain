import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, CornerDownLeft } from 'lucide-react';
import { ChatThread, ThreadFolder, ThreadRuntime } from '../domains/06-chat-threads';

interface ThreadSwitcherProps {
  threads: ChatThread[];
  folders: ThreadFolder[];
  threadRuntimes: Record<string, { state: ThreadRuntime; position: number }>;
  activeThreadId?: string;
  onSelect: (threadId: string) => void;
  onNewThread: () => void;
  onClose: () => void;
}

const dotClass = (state?: ThreadRuntime): string => {
  if (state === 'working') return 'bg-[#38bdf8] animate-pulse';
  if (state === 'queued') return 'bg-[#e0b96c] animate-pulse';
  if (state === 'error') return 'bg-[#f28894]';
  if (state === 'interrupted') return 'border border-[#e0b96c] bg-transparent';
  return 'bg-transparent';
};

/**
 * Quick switcher (Ctrl/Cmd+K): fuzzy-search threads + folder names.
 * Archived threads are included, dimmed. Arrow keys + Enter navigate.
 */
export const ThreadSwitcher: React.FC<ThreadSwitcherProps> = ({
  threads,
  folders,
  threadRuntimes,
  activeThreadId,
  onSelect,
  onNewThread,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const folderName = (id: string | null) =>
    id ? folders.find((f) => f.id === id)?.name ?? '' : 'Inbox';

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...threads].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    if (!q) return sorted;
    const tokens = q.split(/\s+/);
    return sorted.filter((t) => {
      const hay = `${t.title} ${t.preview} ${folderName(t.folderId)}`.toLowerCase();
      return tokens.every((tok) => hay.includes(tok));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, folders, query]);

  // New-thread action is row 0 conceptually, but keep results as threads only
  // and render "+ New thread" above them — cursor indexes results directly.
  useEffect(() => setCursor(0), [query]);

  // Keep the cursor row in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const commit = (t: ChatThread) => {
    onSelect(t.id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const t = results[cursor];
      if (t) commit(t);
      else onNewThread(), onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-xs flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div
        className="w-full max-w-xl bg-[#0a0f19] border border-[#1a293e] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-[#131e33]">
          <Search className="w-4 h-4 text-[#556985] shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads & folders…"
            className="flex-1 bg-transparent text-sm text-white placeholder-[#50637f] focus:outline-none"
          />
          <span className="text-[9px] font-mono text-[#455770] border border-[#162234] rounded px-1.5 py-0.5">
            esc
          </span>
        </div>

        {/* New thread action */}
        <button
          onClick={() => {
            onNewThread();
            onClose();
          }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-mono text-[#5ad49b] hover:bg-[#0e1626] transition-colors cursor-pointer border-b border-[#101827]"
        >
          <Plus className="w-3.5 h-3.5 shrink-0" />
          <span>New thread</span>
        </button>

        {/* Results */}
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="text-xs font-mono text-[#556985] p-3 text-center">No matching threads.</p>
          )}
          {results.map((t, idx) => {
            const runtime = threadRuntimes[t.id];
            const archived = t.lifecycle === 'archived';
            return (
              <button
                key={t.id}
                data-idx={idx}
                onClick={() => commit(t)}
                onMouseEnter={() => setCursor(idx)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                  idx === cursor ? 'bg-[#182338]' : 'hover:bg-[#0e1626]'
                } ${archived ? 'opacity-50' : ''}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass(runtime?.state)}`} />
                <div className="min-w-0 flex-1">
                  <span className="text-xs text-[#eef4fc] truncate block font-medium">
                    {t.title}
                    {t.id === activeThreadId && (
                      <span className="ml-2 text-[9px] font-mono text-[#38bdf8]">current</span>
                    )}
                    {archived && (
                      <span className="ml-2 text-[9px] font-mono text-[#7d93b3]">archived</span>
                    )}
                  </span>
                  <span className="text-[10px] font-mono text-[#556985] truncate block">
                    {folderName(t.folderId)}
                    {t.preview ? ` · ${t.preview}` : ''}
                  </span>
                </div>
                {idx === cursor && (
                  <CornerDownLeft className="w-3.5 h-3.5 text-[#556985] shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Hints */}
        <div className="px-3.5 py-2 border-t border-[#131e33] flex items-center gap-3 text-[9px] font-mono text-[#455770]">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto">includes archived (dimmed)</span>
        </div>
      </div>
    </div>
  );
};