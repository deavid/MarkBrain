import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Artifact } from '../../types';
import type { Granularity } from '../../domains/granularity';
import { GRANULARITY_LABEL, GRANULARITY_ORDER } from '../../domains/granularity';
import { getGranularityChipClass } from '../context/attachmentPalette';

/** A metadata field card that starts COLLAPSED (2026-10-25: the description
 * and summary are long; opening the modal must not dump 10k tokens of text).
 * Header row always visible; click to expand. */
function CollapsibleField({
  label,
  labelClass,
  children,
}: {
  label: string;
  labelClass: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-3 rounded-lg bg-surface-2 space-y-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 cursor-pointer"
        aria-expanded={open}
      >
        <span className={`text-10 font-mono uppercase tracking-wider font-semibold block ${labelClass}`}>
          {label}
        </span>
        <span className="text-9 font-mono text-[#6b82a3] shrink-0">{open ? '− hide' : '+ show'}</span>
      </button>
      {open && children}
    </div>
  );
}
import {
  X,
  FileCode,
  Pin,
  Plus,
  ExternalLink,
  Layers,
  Sparkles,
  Tag,
  Clock,
  Sliders,
  Check,
  Eye,
  FileText,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { renderMarkdown } from '../../utils/markdown';
import { formatAttachmentProvenance } from '../context/AttachmentControls';
import type { ArtifactSearchIndexRecord, GeneratedQaPair } from '../../services/searchIndexStore';
import type { ArtifactRevision } from '../../domains/01-artifact-versioning/types';
import { diffLines, diffStats } from '../../utils/lineDiff';
import { Download, Pencil, Save, RotateCcw, RefreshCw, MessageSquare } from 'lucide-react';

interface ArtifactDetailModalProps {
  artifact: Artifact;
  onClose: () => void;
  /**
   * This artifact's attachment to the ACTIVE chat, or null when it is not
   * attached. Granularity lives on the attachment (per chat) — never on the
   * artifact. `staged` = armed for the next send (removable); a committed
   * attachment is history and only its granularity stays steerable.
   */
  attachmentGranularity: Granularity | null;
  attachmentStaged?: boolean;
  /** Where it sits in the timeline: `msg N`, or null when staged. */
  attachmentTurnIndex?: number | null;
  onAttach: (artifactId: string) => void;
  onUnstage?: (artifactId: string) => void;
  onSetAttachmentGranularity: (artifactId: string, granularity: Granularity) => void;
  /** Full revision history from the versioning domain (title + all four layers per revision). */
  history?: ArtifactRevision[];
  /** True when the summary layers no longer match the body (manual body edit). */
  layersStale?: boolean;
  /** Saves a manual edit (title + subtitle + body). Records the revision + stale flag. */
  onSaveEdit?: (patch: { title: string; subtitle: string; body: string }) => void;
  /** Reverts title + all four layers to the given revision (records the discarded state first). */
  onRevert?: (version: number) => void;
  /** Regenerates subtitle/description/summary from the current body. Returns an error message or null. */
  onRefreshLayers?: () => Promise<string | null>;
  /** Closes the modal and opens the chat a revision came from. */
  onOpenThread?: (threadId: string) => void;
  /** Thread title lookup for the History actor chip (`AI · chat "…" msg #N`). */
  getThreadTitle?: (threadId: string) => string | null;
  /** Closes the modal and filters the library folder tree to this tag. */
  onFilterByTag?: (tag: string) => void;
  // ── Q&A Index tab (design-docs/15, step 9) ───────────────────────────────
  /** This artifact's record in IndexedDB `markbrain-search-index` (LAW 2). */
  indexRecord?: ArtifactSearchIndexRecord | null;
  /** 'missing' | 'stale' | 'ready' — same derivation the scorer uses. */
  indexStatus?: 'missing' | 'stale' | 'ready';
  /** Rebuild THIS artifact's Q&A + embeddings (the single-doc index button). */
  onIndexArtifact?: () => void;
  /** Live stage text while onIndexArtifact runs; null when idle. */
  indexArtifactProgress?: string | null;
}

export const ArtifactDetailModal: React.FC<ArtifactDetailModalProps> = ({
  artifact,
  onClose,
  attachmentGranularity,
  attachmentStaged = false,
  attachmentTurnIndex = null,
  onAttach,
  onUnstage,
  onSetAttachmentGranularity,
  history = [],
  layersStale = false,
  onSaveEdit,
  onRevert,
  onRefreshLayers,
  onOpenThread,
  getThreadTitle,
  onFilterByTag,
  indexRecord = null,
  indexStatus = 'missing',
  onIndexArtifact,
  indexArtifactProgress = null,
}) => {
  const [activeTab, setActiveTab] = useState<'content' | 'qa' | 'metadata' | 'history'>('content');
  // Manual edit state (Package 1 §1.6): pencil toggles the form; Cancel
  // discards; Save hands the patch to the caller (which records the revision).
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSubtitle, setDraftSubtitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Per-revision diff view: the version whose body diff is expanded, or null.
  const [openDiffVersion, setOpenDiffVersion] = useState<number | null>(null);

  // Q&A pairs grouped by the section they were generated from — reading order
  // mirrors the document, so the tab is browsable, not a raw dump.
  const qaGroups = useMemo(() => {
    const map = new Map<string, GeneratedQaPair[]>();
    for (const qa of indexRecord?.qaPairs ?? []) {
      const list = map.get(qa.sectionHeading) ?? [];
      list.push(qa);
      map.set(qa.sectionHeading, list);
    }
    return Array.from(map.entries());
  }, [indexRecord]);
  const [bodyView, setBodyView] = useState<'rendered' | 'raw'>('rendered');
  const [isFullscreen, setIsFullscreen] = useState(true);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const title = artifact.title || artifact.title || artifact.id;
  const provenance = formatAttachmentProvenance(attachmentTurnIndex);
  const subtitle = artifact.current?.subtitle || '';
  const description = artifact.current?.description || '';
  const summary = artifact.current?.summary || '';
  const body = artifact.current?.body || '';
  const artColor = artifact.color || '#5d87b8';

  const modalNode = (
    <div className={`fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex items-center justify-center select-text w-screen h-screen ${
      isFullscreen ? 'p-0' : 'p-2 sm:p-4 md:p-6'
    }`}>
      <div
        className={`bg-surface-0 flex flex-col shadow-2xl overflow-hidden font-sans transition-all duration-200 ${
          isFullscreen
            ? 'w-screen h-screen rounded-none'
            : 'w-full max-w-6xl h-[94vh] max-h-[94vh] rounded-2xl'
        }`}
      >
        <div className="p-3 sm:p-4 bg-surface-3 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
              style={{ backgroundColor: artColor }}
            />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-ink font-mono truncate">
                {title}
              </h2>
              <div className="flex items-center gap-2 text-10 font-mono text-[#6b82a3] mt-0.5">
                <span className="px-1.5 py-0.2 rounded bg-surface-0 text-ink-dim">
                  {artifact.code || artifact.type}
                </span>
                <span>•</span>
                <span>{artifact.category || 'specification'}</span>
                <span>•</span>
                <span style={{ color: artColor }}>{artColor}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => {
                if (editing) {
                  setEditing(false);
                } else {
                  setDraftTitle(title);
                  setDraftSubtitle(subtitle);
                  setDraftBody(body);
                  setEditing(true);
                  setActiveTab('content');
                }
              }}
              className={`p-1.5 rounded-xl transition-colors cursor-pointer ${
                editing
                  ? 'bg-accent text-surface-0'
                  : 'bg-surface-2 hover:bg-surface-4 text-[#869ab8] hover:text-ink'
              }`}
              title={editing ? 'Cancel editing' : 'Edit this note'}
            >
              {editing ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
            </button>

            <button
              onClick={() => {
                const blob = new Blob([artifact.current?.body || ''], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${artifact.code || artifact.id}.md`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="p-1.5 rounded-xl bg-surface-2 hover:bg-surface-4 text-[#869ab8] hover:text-ink transition-colors cursor-pointer"
              title="Download this note as a .md file"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1.5 rounded-xl bg-surface-2 hover:bg-surface-4 text-[#869ab8] hover:text-ink transition-colors cursor-pointer"
              title={isFullscreen ? 'Restore standard view' : 'Maximize to whole screen'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-surface-2 hover:bg-surface-4 text-[#869ab8] hover:text-ink transition-colors cursor-pointer"
              title="Close modal (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Attachment toolbar — the ONLY context control, and it belongs to
            THIS chat. Three states: not in chat (stage it), staged (rides the
            next send, removable), committed (on a turn — no detach, only the
            cut). */}
        <div className="p-3 bg-surface-1 flex flex-wrap items-center justify-between gap-2.5">
          {attachmentGranularity === null ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => onAttach(artifact.id)}
                data-testid="attach-from-detail"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-surface-3 text-[#67e8f9] hover:bg-[#0f3340] transition-colors cursor-pointer"
                title="Stage this artifact for the next message"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Stage for next message</span>
              </button>
              <span className="text-11 font-mono text-[#556985]">
                Not in this chat&apos;s payload.
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-11 font-mono ${attachmentStaged ? 'text-[#38bdf8]' : 'text-[#758ca8]'}`}
                >
                  {attachmentStaged ? 'Staged for next send ·' : 'In this chat at'}
                </span>
                <strong className="text-11 font-mono text-[#a4bddf]">
                  {GRANULARITY_LABEL[attachmentGranularity]}
                </strong>
                {!attachmentStaged && provenance && (
                  <span className="text-11 font-mono text-[#758ca8]" title={provenance.title}>
                    · {provenance.badge}
                  </span>
                )}
                {attachmentStaged && (
                  <button
                    onClick={() => onUnstage?.(artifact.id)}
                    data-testid="unstage-from-detail"
                    className="min-h-[24px] px-2 rounded-lg text-10 font-mono bg-surface-3 text-[#67e8f9] hover:bg-[#0f3340] cursor-pointer"
                    title="Remove from the next send (still staged, not sent)"
                  >
                    Unstage
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-10 font-mono text-[#556985] mr-1">Send:</span>
                {GRANULARITY_ORDER.map((g) => {
                  const isActive = attachmentGranularity === g;
                  return (
                    <button
                      key={g}
                      onClick={() => onSetAttachmentGranularity(artifact.id, g)}
                      data-granularity={g}
                      className={`min-h-[24px] px-2 rounded-md text-10 font-mono transition-colors cursor-pointer ${getGranularityChipClass(g, isActive)}`}
                    >
                      {GRANULARITY_LABEL[g]}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex bg-surface-1 px-3 gap-2">
          <button
            onClick={() => setActiveTab('content')}
            className={`py-2 px-3 text-xs font-mono border-b-2 transition-colors cursor-pointer ${
              activeTab === 'content'
                ? 'border-accent text-ink font-semibold'
                : 'border-transparent text-ink-mute hover:text-ink-dim'
            }`}
          >
            Content
          </button>
          <button
            onClick={() => setActiveTab('qa')}
            data-testid="tab-qa-index"
            className={`py-2 px-3 text-xs font-mono border-b-2 transition-colors cursor-pointer ${
              activeTab === 'qa'
                ? 'border-accent text-ink font-semibold'
                : 'border-transparent text-ink-mute hover:text-ink-dim'
            }`}
          >
            Q&A Index ({indexRecord?.qaPairs.length ?? 0})
          </button>
          <button
            onClick={() => setActiveTab('metadata')}
            className={`py-2 px-3 text-xs font-mono border-b-2 transition-colors cursor-pointer ${
              activeTab === 'metadata'
                ? 'border-accent text-ink font-semibold'
                : 'border-transparent text-ink-mute hover:text-ink-dim'
            }`}
          >
            Layers & YAML
          </button>
          {history.length > 0 && (
            <button
              onClick={() => setActiveTab('history')}
              className={`py-2 px-3 text-xs font-mono border-b-2 transition-colors cursor-pointer ${
                activeTab === 'history'
                  ? 'border-accent text-ink font-semibold'
                  : 'border-transparent text-ink-mute hover:text-ink-dim'
              }`}
            >
              History ({history.length})
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-[#cad8eb] leading-relaxed">
          {activeTab === 'content' && (
            <div className="space-y-4">
              {editing ? (
                <div className="space-y-3" data-testid="artifact-edit-form">
                  <div className="space-y-1">
                    <label className="text-10 font-mono uppercase tracking-wider text-[#79ca4b] font-semibold block">
                      Title
                    </label>
                    <input
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-surface-1 text-xs text-ink font-mono outline-none focus:ring-1 focus:ring-accent"
                      data-testid="edit-title-input"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-10 font-mono uppercase tracking-wider text-[#79ca4b] font-semibold block">
                      Subtitle (the hook that travels with the title)
                    </label>
                    <input
                      value={draftSubtitle}
                      onChange={(e) => setDraftSubtitle(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-surface-1 text-xs text-ink italic outline-none focus:ring-1 focus:ring-accent"
                      data-testid="edit-subtitle-input"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-10 font-mono uppercase tracking-wider text-[#5ad49b] font-semibold block">
                      Body (markdown)
                    </label>
                    <textarea
                      value={draftBody}
                      onChange={(e) => setDraftBody(e.target.value)}
                      rows={18}
                      className="w-full px-2.5 py-2 rounded-lg bg-surface-1 font-mono text-11 text-[#c4d6ed] outline-none focus:ring-1 focus:ring-accent resize-y"
                      data-testid="edit-body-textarea"
                    />
                    <p className="text-10 font-mono text-[#556985]">
                      Saving snapshots the current version to History. If the body changes, the
                      description and summary will be marked out of date until refreshed.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        onSaveEdit?.({ title: draftTitle, subtitle: draftSubtitle, body: draftBody });
                        setEditing(false);
                      }}
                      data-testid="save-edit"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-surface-0 text-xs font-mono font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Save
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="px-3 py-1.5 rounded-lg bg-surface-3 text-[#8ab1e0] text-xs font-mono hover:bg-surface-4 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {layersStale && (
                    <div
                      className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-wash-warn/40"
                      data-testid="stale-layers-badge"
                    >
                      <span className="text-11 font-mono text-[#f0c674]">
                        Summary layers out of date — they don&apos;t match the body anymore.
                      </span>
                      <button
                        onClick={async () => {
                          if (!onRefreshLayers || refreshing) return;
                          setRefreshing(true);
                          setRefreshError(null);
                          const err = await onRefreshLayers();
                          setRefreshing(false);
                          if (err) setRefreshError(err);
                        }}
                        disabled={refreshing}
                        data-testid="refresh-layers"
                        className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface-3 hover:bg-surface-4 text-[#f0c674] text-10 font-mono transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
                        title="Regenerate the description and summary from the current body"
                      >
                        <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                        {refreshing ? 'Refreshing…' : 'Refresh layers'}
                      </button>
                      {refreshError && (
                        <span className="text-10 font-mono text-[#f7aab3]" data-testid="refresh-layers-error">
                          {refreshError}
                        </span>
                      )}
                    </div>
                  )}
              {subtitle && (
                <CollapsibleField label="Subtitle (ships with the title)" labelClass="text-[#79ca4b]">
                  <div
                    className="md-body italic"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(subtitle) }}
                  />
                </CollapsibleField>
              )}

              {description && (
                <CollapsibleField label="Description" labelClass="text-[#8ab1e0]">
                  <div
                    className="md-body"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(description) }}
                  />
                </CollapsibleField>
              )}

              {summary && (
                <CollapsibleField label="Summary" labelClass="text-[#e0b96c]">
                  <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }} />
                </CollapsibleField>
              )}

              <div className="p-3.5 rounded-lg bg-surface-1 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-10 font-mono uppercase tracking-wider text-[#5ad49b] font-semibold">
                    Body
                  </span>
                  <div className="flex items-center gap-0.5 bg-surface-0 rounded-lg p-0.5 shrink-0">
                    <button
                      onClick={() => setBodyView('rendered')}
                      className={`px-2 py-0.5 rounded-md text-10 font-mono transition-colors cursor-pointer ${
                        bodyView === 'rendered'
                          ? 'bg-surface-4 text-[#e0eeff] font-semibold'
                          : 'text-[#6b82a3] hover:text-[#9bb0d1]'
                      }`}
                      title="Rendered markdown preview"
                    >
                      Rendered
                    </button>
                    <button
                      onClick={() => setBodyView('raw')}
                      className={`px-2 py-0.5 rounded-md text-10 font-mono transition-colors cursor-pointer ${
                        bodyView === 'raw'
                          ? 'bg-surface-4 text-[#e0eeff] font-semibold'
                          : 'text-[#6b82a3] hover:text-[#9bb0d1]'
                      }`}
                      title="Raw markdown source"
                    >
                      Raw
                    </button>
                  </div>
                </div>
                {bodyView === 'rendered' ? (
                  body ? (
                    <div
                      className="md-body bg-surface-0 p-3.5 rounded-lg"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
                    />
                  ) : (
                    <div className="text-11 italic text-ink-faint bg-surface-0 p-3 rounded-lg">
                      No full body recorded.
                    </div>
                  )
                ) : (
                  <div className="font-mono text-11 whitespace-pre-wrap text-[#c4d6ed] bg-surface-0 p-3 rounded-lg max-h-80 overflow-y-auto">
                    {body || '# No full body recorded.'}
                  </div>
                )}
              </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'qa' && (
            <div className="space-y-3" data-testid="qa-index-body">
              <div className="p-3 rounded-lg bg-surface-2 space-y-2 font-mono text-11">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span data-testid="qa-index-status" className="text-ink-dim">
                    {indexStatus === 'ready'
                      ? `Indexed · ${indexRecord?.qaPairs.length ?? 0} Q&A pairs · ${indexRecord?.sectionVectors.length ?? 0} section vectors`
                      : indexStatus === 'stale'
                        ? 'Stale (document edited…)'
                        : 'Not indexed yet'}
                  </span>
                  <button
                    type="button"
                    onClick={onIndexArtifact}
                    disabled={!onIndexArtifact || Boolean(indexArtifactProgress)}
                    data-testid="index-artifact"
                    className="min-h-[26px] px-2.5 rounded-full bg-veil-1 shadow-lift hover:bg-veil-2 text-10 font-mono text-ink-dim hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
                    title={
                      indexRecord
                        ? 'Rebuild this note’s Q&A and embeddings in the search index'
                        : 'Generate Q&A and embeddings for this note in the search index'
                    }
                  >
                    {indexArtifactProgress
                      ? indexArtifactProgress
                      : indexRecord
                        ? 'Regenerate Q&A & Embeddings'
                        : 'Index'}
                  </button>
                </div>
                <p className="text-10 text-[#556985]">
                  Lives in IndexedDB (markbrain-search-index), never in the project
                  snapshot — rebuildable at any time.
                </p>
              </div>

              {qaGroups.length === 0 ? (
                <div className="p-4 rounded-lg bg-surface-1 text-center space-y-1">
                  <p className="text-11 font-mono text-ink-dim">No Q&A pairs yet.</p>
                  <p className="text-10 font-mono text-[#556985]">
                    Press Index to generate them from this document’s sections.
                  </p>
                </div>
              ) : (
                qaGroups.map(([heading, list]) => (
                  <section key={heading} className="space-y-1.5">
                    <span className="text-10 font-mono uppercase tracking-wider text-[#556985] block px-1">
                      {heading}
                    </span>
                    <div className="rounded-lg bg-surface-1 p-1 space-y-1">
                      {list.map((qa) => (
                        <div key={qa.id} className="p-2.5 rounded-md bg-surface-2 space-y-1">
                          <div className="text-11 text-ink font-semibold">{qa.question}</div>
                          <div className="text-11 text-[#a4bddf]">{qa.answer}</div>
                          {qa.keywords.length > 0 && (
                            <div className="text-10 text-[#556985] font-mono">
                              {qa.keywords.join(' · ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
          )}

          {activeTab === 'metadata' && (
            <div className="space-y-3 font-mono text-11">
              <div className="grid grid-cols-2 gap-2 bg-surface-1 p-3 rounded-lg">
                <div>
                  <span className="text-10 text-[#556985] block">Artifact ID:</span>
                  <span className="text-[#8ab1e0]">{artifact.id}</span>
                </div>
                <div>
                  <span className="text-10 text-[#556985] block">Code Identifier:</span>
                  <span className="text-[#8ab1e0]">{artifact.code || 'None'}</span>
                </div>
                <div>
                  <span className="text-10 text-[#556985] block">High Concept:</span>
                  <span className={artifact.isHighConcept ? 'text-[#e05a66]' : 'text-[#6b82a3]'}>
                    {artifact.isHighConcept ? 'Yes (Core Anchor)' : 'No (Component)'}
                  </span>
                </div>
                <div>
                  <span className="text-10 text-[#556985] block">Category:</span>
                  <span className="text-[#cad8eb]">{artifact.category || 'general'}</span>
                </div>
              </div>

              {artifact.tags && artifact.tags.length > 0 && (
                <div className="p-3 rounded-lg bg-surface-1 space-y-1.5">
                  <span className="text-10 text-[#556985] block">Graph Tags:</span>
                  <div className="flex flex-wrap gap-1">
                    {artifact.tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onFilterByTag?.(t)}
                        disabled={!onFilterByTag}
                        title={`Filter the library by #${t}`}
                        className="inline-flex items-center min-h-[24px] px-2 rounded bg-surface-3 hover:bg-veil-2 hover:text-ink text-ink-dim text-10 cursor-pointer disabled:cursor-default transition-colors"
                      >
                        #{t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {artifact.yamlDocument && (
                <div className="space-y-1">
                  <span className="text-10 text-[#556985] block">Raw YAML Document:</span>
                  <pre className="bg-surface-0 p-3 rounded-lg text-10 text-[#86a2c9] overflow-x-auto max-h-56">
                    {artifact.yamlDocument}
                  </pre>
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-2">
              {history.length === 0 && (
                <div className="p-4 rounded-lg bg-surface-1 text-center text-11 font-mono text-ink-dim">
                  No earlier versions of this note yet.
                </div>
              )}
              {history.map((h, i) => {
                const prev = i > 0 ? history[i - 1] : null;
                const diffOpen = openDiffVersion === h.version;
                const lines = diffOpen ? diffLines(prev?.layers?.body || '', h.layers?.body || '') : [];
                const stats = diffOpen ? diffStats(lines) : null;
                const actorLabel =
                  h.actor === 'user'
                    ? 'Manual edit'
                    : h.provenance?.threadId
                      ? `AI · chat "${getThreadTitle?.(h.provenance.threadId) || 'chat'}"${
                          typeof h.provenance.turnIndex === 'number' ? ` msg #${h.provenance.turnIndex}` : ''
                        }`
                      : 'AI';
                return (
                  <div key={h.version} className="p-3 rounded-lg bg-surface-1 space-y-1.5 font-mono text-11" data-testid={`revision-row-${h.version}`}>
                    <div className="flex items-center justify-between gap-2 text-[#8ab1e0]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold shrink-0">v{h.version}</span>
                        <span
                          className={`text-9 px-1.5 py-0.5 rounded shrink-0 ${
                            h.actor === 'user' ? 'bg-wash-success text-[#6ee7b7]' : 'bg-surface-4 text-[#8ab1e0]'
                          }`}
                        >
                          {actorLabel}
                        </span>
                        <span className="text-[#a4bddf] truncate">{h.changeSummary}</span>
                      </div>
                      <span className="text-10 text-[#556985] shrink-0">
                        {new Date(h.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setOpenDiffVersion(diffOpen ? null : h.version)}
                        data-testid={`view-diff-${h.version}`}
                        className="px-2 py-0.5 rounded-md bg-surface-3 hover:bg-surface-4 text-[#8ab1e0] text-10 transition-colors cursor-pointer"
                        title={prev ? 'Show what this version changed in the body' : 'This is the first recorded version'}
                      >
                        {diffOpen ? 'Hide diff' : 'View diff'}
                        {stats && <span className="ml-1 text-[#556985]">+{stats.added}/−{stats.removed}</span>}
                      </button>
                      {onRevert && (
                        <button
                          onClick={() => onRevert(h.version)}
                          data-testid={`revert-${h.version}`}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-3 hover:bg-surface-4 text-[#e0b96c] text-10 transition-colors cursor-pointer"
                          title={`Restore the note to v${h.version} (title and all layers together). The current state is kept in History first.`}
                        >
                          <RotateCcw className="w-3 h-3" />
                          Revert to this version
                        </button>
                      )}
                      {h.provenance?.threadId && onOpenThread && (
                        <button
                          onClick={() => onOpenThread(h.provenance!.threadId!)}
                          data-testid={`open-chat-${h.version}`}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-3 hover:bg-surface-4 text-[#67e8f9] text-10 transition-colors cursor-pointer"
                          title="Open the chat this version came from"
                        >
                          <MessageSquare className="w-3 h-3" />
                          Open chat
                        </button>
                      )}
                    </div>
                    {diffOpen && (
                      <div className="bg-surface-0 rounded-lg overflow-auto max-h-72 text-10 font-mono leading-relaxed" data-testid={`diff-${h.version}`}>
                        {lines.map((l, li) => (
                          <div
                            key={li}
                            className={
                              l.type === 'add'
                                ? 'bg-wash-success text-[#6ee7b7] whitespace-pre-wrap px-2'
                                : l.type === 'del'
                                  ? 'bg-wash-danger text-[#f7aab3] whitespace-pre-wrap px-2'
                                  : 'text-[#8297b5] whitespace-pre-wrap px-2'
                            }
                          >
                            {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}
                            {l.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-3 bg-surface-2 flex items-center justify-between">
          <span className="text-10 font-mono text-[#556985]">
            Title · Description · Summary · Full
          </span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl bg-surface-3 hover:bg-surface-5 text-xs font-mono text-[#8ab1e0] transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modalNode, document.body);
};
