import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, AlertTriangle, Trash2, X } from 'lucide-react';
import type { Artifact } from '../../types';
import type { ChatThread } from '../../domains/06-chat-threads';
import { isArtifactArchived } from '../../domains/01-artifact-document';
import {
  blockingThreadIds,
  planCleanup,
  planIsEmpty,
  type CleanupPlan,
} from '../../application/cleanupPlan';
import { logger } from '../../utils/logger';

type Lifecycle = 'active' | 'archived';
type Tab = 'chats' | 'artifacts';
type Filter = 'archived' | 'active' | 'all';

interface CleanupModalProps {
  isOpen: boolean;
  onClose: () => void;
  threads: ChatThread[];
  artifacts: Artifact[];
  onSetThreadLifecycle: (ids: string[], lifecycle: Lifecycle) => void;
  onSetArtifactLifecycle: (ids: string[], lifecycle: Lifecycle) => void;
  onApplyPlan: (plan: CleanupPlan) => void;
}

const CONFIRM_WORD = 'DELETE';

const day = (ts: number) => {
  const d = new Date(ts);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
};

const Chip: React.FC<{ lifecycle: Lifecycle; children?: React.ReactNode }> = ({
  lifecycle,
  children,
}) => (
  <span
    className={`shrink-0 px-1.5 py-0.5 rounded font-mono text-[9px] uppercase tracking-wide ${
      lifecycle === 'archived' ? 'bg-recess-2 text-[#c8a05a]' : 'bg-recess-1 text-[#7d93b3]'
    }`}
  >
    {children || lifecycle}
  </span>
);

const Row: React.FC<{
  title: string;
  meta: string;
  lifecycle: Lifecycle;
  checked: boolean;
  warn?: string;
  onToggle: () => void;
}> = ({ title, meta, lifecycle, checked, warn, onToggle }) => (
  <label
    className={`flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer transition-colors ${
      checked ? 'bg-veil-3' : 'bg-surface-2 hover:bg-surface-3'
    }`}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={onToggle}
      className="mt-0.5 w-3.5 h-3.5 shrink-0 accent-[#e05a66] cursor-pointer"
    />
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span
          className={`text-[12px] truncate ${lifecycle === 'archived' ? 'text-ink-dim' : 'text-ink'}`}
        >
          {title}
        </span>
        <Chip lifecycle={lifecycle} />
      </span>
      <span className="block text-[10px] font-mono text-[#6b82a3] mt-0.5">{meta}</span>
      {warn && (
        <span className="block text-[10px] font-mono text-[#d98a72] mt-0.5">{warn}</span>
      )}
    </span>
  </label>
);

export const CleanupModal: React.FC<CleanupModalProps> = ({
  isOpen,
  onClose,
  threads,
  artifacts,
  onSetThreadLifecycle,
  onSetArtifactLifecycle,
  onApplyPlan,
}) => {
  const [tab, setTab] = useState<Tab>('chats');
  const [filter, setFilter] = useState<Filter>('archived');
  const [chatIds, setChatIds] = useState<Set<string>>(new Set());
  const [artifactIds, setArtifactIds] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<'browse' | 'confirm'>('browse');
  const [cascade, setCascade] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) return;
    setPhase('browse');
    setCascade(false);
    setTyped('');
  }, [isOpen]);

  const referencingChats = useMemo(() => {
    const map = new Map<string, ChatThread[]>();
    artifacts.forEach((a) => map.set(a.id, []));
    threads.forEach((t) =>
      (t.attachments || []).forEach((att) => {
        const list = map.get(att.artifactId);
        if (list) list.push(t);
      })
    );
    return map;
  }, [threads, artifacts]);

  const plan = useMemo(
    () =>
      planCleanup({
        threadIds: Array.from(chatIds),
        artifactIds: Array.from(artifactIds),
        threads,
        artifacts,
        deleteReferencingArchivedChats: cascade,
      }),
    [chatIds, artifactIds, threads, artifacts, cascade]
  );

  const rows = useMemo(() => {
    if (tab === 'chats') {
      return threads
        .filter((t) => filter === 'all' || t.lifecycle === filter)
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
        .map((t) => ({
          id: t.id,
          title: t.title || 'Untitled chat',
          lifecycle: t.lifecycle,
          meta: `${t.lifecycle === 'archived' ? 'archived' : 'active'} · last active ${day(t.lastActivityAt)} · ${t.attachments?.length || 0} attachment(s)`,
          warn: undefined as string | undefined,
        }));
    }
    return artifacts
      .filter((a) => filter === 'all' || (a.lifecycle ?? 'active') === filter)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((a) => {
        const refs = referencingChats.get(a.id) || [];
        const active = refs.filter((t) => t.lifecycle !== 'archived');
        return {
          id: a.id,
          title: a.title || a.code || a.id,
          lifecycle: (a.lifecycle ?? 'active') as Lifecycle,
          meta: `${a.category || 'note'} · updated ${day(a.updatedAt)} · pointed at by ${refs.length} chat(s)`,
          warn: active.length
            ? `Cannot be deleted: ${active.map((t) => `“${t.title}”`).join(', ')} still active`
            : undefined,
        };
      });
  }, [tab, filter, threads, artifacts, referencingChats]);

  const selected = tab === 'chats' ? chatIds : artifactIds;
  const setSelected = tab === 'chats' ? setChatIds : setArtifactIds;
  const archivedSelectedCount = rows.filter((r) => selected.has(r.id) && r.lifecycle === 'archived')
    .length;
  const blockedChatIds = blockingThreadIds(plan);
  const detachedChatCount = plan.detach.reduce((n, d) => n + d.threadIds.length, 0);
  const archivedCount = {
    chats: threads.filter((t) => t.lifecycle === 'archived').length,
    artifacts: artifacts.filter(isArtifactArchived).length,
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectAllShown = () => {
    const ids = rows.map((r) => r.id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    const next = new Set(selected);
    ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
    setSelected(next);
  };

  const archiveSelection = (ids: string[], lifecycle: Lifecycle) => {
    if (ids.length === 0) return;
    if (tab === 'chats') onSetThreadLifecycle(ids, lifecycle);
    else onSetArtifactLifecycle(ids, lifecycle);
    setSelected(new Set());
  };

  const apply = () => {
    logger.action('Cleanup', `Permanent delete confirmed: ${plan.artifactsToDelete.length} artifact(s), ${plan.threadsToDelete.length + plan.cascadeThreads.length} chat(s)`, {
      cascade,
    });
    onApplyPlan(plan);
    setChatIds(new Set());
    setArtifactIds(new Set());
    setTyped('');
    setCascade(false);
    setPhase('browse');
    onClose();
  };

  if (!isOpen) return null;

  const selectedIds = Array.from(selected);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-surface-0/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cleanup tool"
        className="bg-surface-1 rounded-2xl max-w-[560px] w-full max-h-[90vh] flex flex-col shadow-2xl text-ink overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 p-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight">
              {phase === 'confirm' ? 'Delete permanently' : 'Cleanup'}
            </h2>
            <p className="text-[11px] text-ink-mute mt-1 leading-relaxed">
              {phase === 'confirm'
                ? 'This removes data from the project for good. There is no undo.'
                : 'Archive is the door: only archived items can be deleted. Nothing is removed from the project until you confirm.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="shrink-0 w-7 h-7 rounded-lg bg-surface-2 hover:bg-surface-3 flex items-center justify-center text-ink-dim hover:text-ink transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {phase === 'browse' ? (
          <>
            <div className="flex items-center gap-1.5 px-4">
              {(['chats', 'artifacts'] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTab(t);
                    setSelected(new Set());
                  }}
                  className={`px-3 py-1.5 rounded-lg font-mono text-[11px] capitalize transition-colors cursor-pointer ${
                    tab === t ? 'bg-veil-3 text-ink' : 'bg-surface-2 text-ink-dim hover:bg-surface-3'
                  }`}
                >
                  {t} · {archivedCount[t]} archived
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 px-4 pt-3 pb-2">
              <div className="flex items-center gap-1">
                {(['archived', 'active', 'all'] as Filter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`px-2 py-1 rounded font-mono text-[10px] transition-colors cursor-pointer ${
                      filter === f ? 'bg-recess-2 text-ink' : 'text-ink-mute hover:text-ink'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={selectAllShown}
                className="ml-auto font-mono text-[10px] text-[#8ab1e0] hover:text-ink transition-colors cursor-pointer"
              >
                {rows.length > 0 && rows.every((r) => selected.has(r.id))
                  ? 'clear all'
                  : 'select all shown'}
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3 space-y-1.5">
              {rows.length === 0 && (
                <p className="text-[11px] font-mono text-[#6b82a3] p-3">
                  Nothing {filter === 'all' ? '' : filter} in {tab}.
                </p>
              )}
              {rows.map((r) => (
                <Row
                  key={r.id}
                  title={r.title}
                  meta={r.meta}
                  lifecycle={r.lifecycle}
                  checked={selected.has(r.id)}
                  warn={r.warn}
                  onToggle={() => toggle(r.id)}
                />
              ))}
            </div>

            <div className="border-t border-line-soft p-3 flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[10px] text-ink-mute">
                {selectedIds.length} selected · {archivedSelectedCount} deletable
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={selectedIds.length === 0}
                  onClick={() => archiveSelection(selectedIds, 'archived')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-recess-1 shadow-well hover:bg-recess-2 disabled:opacity-40 disabled:hover:bg-recess-1 text-[11px] font-mono text-[#8ab1e0] transition-colors cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>Archive</span>
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length === 0}
                  onClick={() => archiveSelection(selectedIds, 'active')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-recess-1 shadow-well hover:bg-recess-2 disabled:opacity-40 disabled:hover:bg-recess-1 text-[11px] font-mono text-[#8ab1e0] transition-colors cursor-pointer"
                >
                  <ArchiveRestore className="w-3.5 h-3.5" />
                  <span>Unarchive</span>
                </button>
                <button
                  type="button"
                  disabled={archivedSelectedCount === 0}
                  onClick={() => setPhase('confirm')}
                  title={
                    archivedSelectedCount === 0
                      ? 'Only archived items can be deleted — archive the selection first'
                      : 'Review, then confirm'
                  }
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-wash-danger shadow-well hover:bg-[#3a1c26] disabled:opacity-40 disabled:hover:bg-wash-danger text-[11px] font-mono text-[#e79a9a] transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete…</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3 space-y-3">
              <div className="rounded-xl bg-surface-2 p-3 space-y-1.5">
                <p className="text-[11px] font-mono text-[#c8a05a] uppercase tracking-wide">
                  About to be destroyed
                </p>
                {plan.threadsToDelete.length > 0 && (
                  <p className="text-[12px]">
                    {plan.threadsToDelete.length} chat(s) with their messages and chapters
                  </p>
                )}
                {plan.artifactsToDelete.length > 0 && (
                  <p className="text-[12px]">
                    {plan.artifactsToDelete.length} artifact(s) with their revision history, graph
                    edges and chat attachments
                  </p>
                )}
                {plan.cascadeThreads.length > 0 && (
                  <p className="text-[12px] text-[#d98a72]">
                    + {plan.cascadeThreads.length} archived chat(s) that used them (your cascade
                    choice)
                  </p>
                )}
              </div>

              {plan.skipped.length > 0 && (
                <div className="rounded-xl bg-wash-danger p-3 space-y-1.5">
                  <p className="text-[11px] font-mono text-[#e79a9a] uppercase tracking-wide">
                    Kept back
                  </p>
                  {plan.skipped.map((s) => (
                    <p key={`${s.kind}-${s.id}`} className="text-[11px] text-[#e2b3b3] leading-relaxed">
                      {s.kind === 'thread' ? 'Chat' : 'Artifact'} “{s.title}”{' '}
                      {s.reason === 'not-archived'
                        ? 'is still active — archive it first.'
                        : s.reason === 'referenced-by-active-chat'
                          ? `is used by ${s.blockers?.length} active chat(s).`
                          : 'no longer exists.'}
                    </p>
                  ))}
                  {blockedChatIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onSetThreadLifecycle(blockedChatIds, 'archived')}
                      className="mt-1 px-2.5 py-1.5 rounded-lg bg-recess-2 hover:bg-veil-3 text-[11px] font-mono text-[#8ab1e0] transition-colors cursor-pointer"
                    >
                      Archive those {blockedChatIds.length} chat(s)
                    </button>
                  )}
                </div>
              )}

              {detachedChatCount > 0 && (
                <label className="flex items-start gap-2.5 rounded-xl bg-surface-2 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cascade}
                    onChange={() => setCascade((v) => !v)}
                    className="mt-0.5 w-3.5 h-3.5 shrink-0 accent-[#e05a66] cursor-pointer"
                  />
                  <span className="text-[11px] text-ink-dim leading-relaxed">
                    Also delete the {detachedChatCount} archived chat(s) that use these artifacts.
                    Unchecked, they survive and simply lose the attachment.
                  </span>
                </label>
              )}

              <div className="space-y-1.5">
                <p className="text-[11px] text-ink-mute">
                  Type <span className="font-mono text-[#e79a9a]">{CONFIRM_WORD}</span> to confirm.
                </p>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={CONFIRM_WORD}
                  className="w-full h-9 px-2.5 rounded-lg bg-surface-0 font-mono text-[12px] text-ink placeholder:text-[#3f4d61] outline-none focus:ring-1 focus:ring-[#e05a66]/60"
                />
              </div>
            </div>

            <div className="border-t border-line-soft p-3 flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setPhase('browse');
                  setTyped('');
                }}
                className="px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-[11px] font-mono text-ink-dim transition-colors cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                disabled={typed.trim() !== CONFIRM_WORD || planIsEmpty(plan)}
                onClick={apply}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#e05a66] hover:bg-[#c94b57] disabled:opacity-40 disabled:hover:bg-[#e05a66] text-[11px] font-mono text-[#1a0d12] font-semibold transition-colors cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Delete permanently</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};
