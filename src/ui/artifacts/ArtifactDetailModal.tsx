import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Artifact, SemanticEdge } from '../../types';
import type { Granularity } from '../../domains/granularity';
import { GRANULARITY_LABEL, GRANULARITY_ORDER } from '../../domains/granularity';
import { getGranularityChipClass } from '../context/attachmentPalette';
import type { ChatThread, ChatAttachment } from '../../domains/06-chat-threads/types';
import { KNOWN_RELATION_KINDS } from '../../../shared/types/graph';
import {
  ARTIFACT_CATEGORIES,
  categoryLabel,
  normalizeCategory,
  normalizeSlug,
  slugTaken,
} from '../../utils/artifactTaxonomy';

import {
  X,
  Plus,
  ExternalLink,
  Tag,
  Check,
  Eye,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { renderMarkdown } from '../../utils/markdown';
import { formatAttachmentProvenance } from '../context/AttachmentControls';
import type { ArtifactSearchIndexRecord, GeneratedQaPair } from '../../services/searchIndexStore';
import type { ArtifactRevision } from '../../domains/01-artifact-versioning/types';
import { diffLines, diffStats } from '../../utils/lineDiff';
import { Download, Pencil, Save, RotateCcw, RefreshCw, MessageSquare, Unlink, Link2 } from 'lucide-react';

type TabId = 'body' | 'overview' | 'relationships' | 'chats' | 'history' | 'qa';

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
  /** Saves a manual edit (title + all four layers). Records the revision + stale flag. */
  onSaveEdit?: (patch: {
    title: string;
    subtitle: string;
    body: string;
    description?: string;
    summary?: string;
  }) => void;
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
  // ── BUG-006 redesign: relationships, chats, identity ─────────────────────
  /** Every edge in the workspace; this tab filters to the ones incident to this artifact. */
  edges?: SemanticEdge[];
  /** The rest of the workspace's artifacts — link candidates and title lookups. */
  artifacts?: Artifact[];
  onAddEdge?: (targetId: string, kind: string) => void;
  onRemoveEdge?: (edgeId: string) => void;
  /** Jump the modal to another artifact (click a connected title). */
  onOpenArtifact?: (artifactId: string) => void;
  /** Applies a validated, unique slug rename (records the old slug as previousCode). */
  onRenameCode?: (code: string) => void;
  onSetCategory?: (category: string) => void;
  onSetTags?: (tags: string[]) => void;
  /** Every thread in the project — for the Chats tab. */
  threads?: ChatThread[];
  /** Every attachment entry in the project, tagged with its thread. */
  chatAttachments?: Array<ChatAttachment & { threadId: string }>;
  /** Steer the granularity of this artifact inside a specific chat. */
  onSetThreadAttachmentGranularity?: (threadId: string, artifactId: string, g: Granularity) => void;
  /** Test/story hook: which tab is open first. */
  initialTab?: TabId;
}

const TAB_LABELS: Array<{ id: TabId; label: string }> = [
  { id: 'body', label: 'Body' },
  { id: 'overview', label: 'Overview & Layers' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'chats', label: 'Chats' },
  { id: 'history', label: 'History' },
  { id: 'qa', label: 'Q&A Index' },
];

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
  edges = [],
  artifacts = [],
  onAddEdge,
  onRemoveEdge,
  onOpenArtifact,
  onRenameCode,
  onSetCategory,
  onSetTags,
  threads = [],
  chatAttachments = [],
  onSetThreadAttachmentGranularity,
  initialTab,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? 'body');
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
  // The single scroll container: switching tabs snaps it back to the top so
  // the freshly-selected tab always starts visible.
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Overview tab drafts (BUG-006 §3 tab 2: everything editable, nothing collapsed)
  const [metaDraft, setMetaDraft] = useState({
    title: '',
    subtitle: '',
    description: '',
    summary: '',
    code: '',
    category: 'note',
    tags: [] as string[],
    newTag: '',
  });
  const [metaError, setMetaError] = useState<string | null>(null);
  useEffect(() => {
    setMetaDraft({
      title: artifact.title || '',
      subtitle: artifact.current?.subtitle || '',
      description: artifact.current?.description || '',
      summary: artifact.current?.summary || '',
      code: artifact.code || '',
      category: normalizeCategory(artifact.category),
      tags: [...(artifact.tags || [])],
      newTag: '',
    });
    setMetaError(null);
  }, [artifact.id, artifact.updatedAt, artifact.title, artifact.code]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const title = artifact.title || artifact.code || artifact.id;
  const provenance = formatAttachmentProvenance(attachmentTurnIndex);
  const subtitle = artifact.current?.subtitle || '';
  const description = artifact.current?.description || '';
  const summary = artifact.current?.summary || '';
  const body = artifact.current?.body || '';

  // ── Relationships (BUG-006 §3 tab 3)
  const incidentEdges = useMemo(
    () => edges.filter((e) => e.sourceId === artifact.id || e.targetId === artifact.id),
    [edges, artifact.id]
  );
  const linkedIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of incidentEdges) {
      s.add(e.sourceId === artifact.id ? e.targetId : e.sourceId);
    }
    return s;
  }, [incidentEdges, artifact.id]);
  const artifactTitle = (id: string) =>
    artifacts.find((a) => a.id === id)?.title || artifacts.find((a) => a.id === id)?.code || id;

  // Similarity search (§3 tab 3 bottom): shared tags weigh most, then title
  // word overlap. Already-linked artifacts are excluded from candidates.
  const [relQuery, setRelQuery] = useState('');
  const similarCandidates = useMemo(() => {
    const q = relQuery.trim().toLowerCase();
    const titleWords = new Set(
      (artifact.title || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
    );
    const scored = artifacts
      .filter((a) => a.id !== artifact.id && !linkedIds.has(a.id))
      .map((a) => {
        const sharedTags = (a.tags || []).filter((t) => (artifact.tags || []).includes(t)).length;
        const otherWords = new Set(
          (a.title || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
        );
        let overlap = 0;
        for (const w of otherWords) if (titleWords.has(w)) overlap++;
        const textHit =
          q.length > 0 &&
          ((a.title || '').toLowerCase().includes(q) ||
            (a.tags || []).some((t) => t.toLowerCase().includes(q)) ||
            (a.current?.body || '').toLowerCase().includes(q));
        const score = sharedTags * 3 + overlap + (textHit ? 5 : 0);
        return { artifact: a, sharedTags, overlap, textHit, score };
      })
      .filter((c) => (q.length > 0 ? c.textHit || c.score > 0 : true))
      .sort((x, y) => y.score - x.score)
      .slice(0, 8);
    return scored;
  }, [artifacts, artifact.id, artifact.title, artifact.tags, linkedIds, relQuery]);
  const [candidateKind, setCandidateKind] = useState<string>('relates_to');

  // ── Chats (BUG-006 §3 tab 4)
  const chatUsages = useMemo(
    () =>
      chatAttachments
        .filter((a) => a.artifactId === artifact.id)
        .map((a) => ({
          ...a,
          threadTitle: threads.find((t) => t.id === a.threadId)?.title || 'Untitled chat',
        }))
        .sort((x, y) => y.addedAt - x.addedAt),
    [chatAttachments, threads, artifact.id]
  );

  // ── Overview save: apply every changed field through its own door.
  const saveOverview = () => {
    const code = normalizeSlug(metaDraft.code);
    if (!code) {
      setMetaError('The slug cannot be empty.');
      return;
    }
    if (code !== (artifact.code || '') && slugTaken(code, artifacts, artifact.id)) {
      setMetaError(`"${code}.md" is already used by another artifact in this project.`);
      return;
    }
    setMetaError(null);
    if (code !== (artifact.code || '') && onRenameCode) onRenameCode(code);
    if (metaDraft.category !== normalizeCategory(artifact.category) && onSetCategory) {
      onSetCategory(metaDraft.category);
    }
    const tagsChanged =
      metaDraft.tags.length !== (artifact.tags || []).length ||
      metaDraft.tags.some((t, i) => t !== (artifact.tags || [])[i]);
    if (tagsChanged && onSetTags) onSetTags(metaDraft.tags);
    if (onSaveEdit) {
      onSaveEdit({
        title: metaDraft.title.trim() || title,
        subtitle: metaDraft.subtitle,
        body,
        description: metaDraft.description,
        summary: metaDraft.summary,
      });
    }
  };

  const metaDirty =
    metaDraft.title !== (artifact.title || '') ||
    metaDraft.subtitle !== subtitle ||
    metaDraft.description !== description ||
    metaDraft.summary !== summary ||
    normalizeSlug(metaDraft.code) !== (artifact.code || '') ||
    metaDraft.category !== normalizeCategory(artifact.category) ||
    metaDraft.tags.join(',') !== (artifact.tags || []).join(',');

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
        <div className="p-2 sm:p-3 bg-surface-3 flex items-center justify-between gap-2 shrink-0">
          {/* ONE slim pinned row (David, 2026-11-01): title + slug badge + the
              four icons. Everything else — attach strip, category badge, tabs,
              content — scrolls. On a landscape phone this takes 44px instead
              of the 207px the old three-band header + Done bar ate. */}
          <h2 className="text-sm sm:text-base font-bold text-ink font-mono truncate min-w-0 flex-1">
            {title}
          </h2>
          {/* BUG-006 §4: the slug is the ONE visible identifier, shown as the
              filename the model reads. It rides the pinned row but truncates
              at ~30% so a long slug can never squeeze the title off-screen.
              The internal UUID is never displayed anywhere. */}
          <span className="shrink-0 max-w-[30%] truncate px-1.5 py-0.2 rounded bg-surface-0 text-10 font-mono text-[#6b82a3]">
            {artifact.code || 'unnamed'}.md
          </span>

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
                  setActiveTab('body');
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
              className="hidden sm:flex p-1.5 rounded-xl bg-surface-2 hover:bg-surface-4 text-[#869ab8] hover:text-ink transition-colors cursor-pointer"
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

        {/* ONE scroll container (David, 2026-11-01): attach strip, category
            badge, tab strip and tab content all scroll together. Switching
            tabs resets the scroll so the new tab starts at its top. */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="p-3 bg-surface-1 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="px-1.5 py-0.2 rounded bg-surface-3 text-10 font-mono text-[#6b82a3] shrink-0">
              {categoryLabel(artifact.category)}
            </span>
            {attachmentGranularity === null ? (
              <div className="flex items-center gap-2 flex-wrap min-w-0">
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
                Not in this chat's payload.
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
        </div>

        <div className="flex bg-surface-1 px-3 gap-2 overflow-x-auto">
          {TAB_LABELS.map((t) => {
            const count =              t.id === 'relationships'
                ? incidentEdges.length
                : t.id === 'chats'
                  ? chatUsages.length
                  : t.id === 'history'
                    ? Math.max(history.length, 1)
                    : t.id === 'qa'
                      ? (indexRecord?.qaPairs.length ?? 0)
                      : null;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTab(t.id);
                  // A tab is a lookup action: the freshly-selected tab starts
                  // visible. Reading (Body) is the only surface you scroll.
                  scrollRef.current?.scrollTo({ top: 0 });
                }}
                data-testid={t.id === 'qa' ? 'tab-qa-index' : undefined}
                className={`py-2 px-3 text-xs font-mono border-b-2 whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === t.id
                    ? 'border-accent text-ink font-semibold'
                    : 'border-transparent text-ink-mute hover:text-ink-dim'
                }`}
              >
                {t.label}
                {count !== null ? ` (${count})` : ''}
              </button>
            );
          })}
        </div>

        <div className="p-4 space-y-4 text-xs text-[#cad8eb] leading-relaxed">
          {/* ── Tab 1: Body ─────────────────────────────────────────────── */}
          {activeTab === 'body' && (
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

          {/* ── Tab 2: Overview & Layers — everything editable, nothing collapsed ── */}
          {activeTab === 'overview' && (
            <div className="space-y-3" data-testid="overview-tab">
              <div className="space-y-1">
                <label className="text-10 font-mono uppercase tracking-wider text-[#79ca4b] font-semibold block">
                  Title
                </label>
                <input
                  value={metaDraft.title}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, title: e.target.value }))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-surface-1 text-xs text-ink font-mono outline-none focus:ring-1 focus:ring-accent"
                  data-testid="overview-title-input"
                />
              </div>

              <div className="space-y-1">
                <label className="text-10 font-mono uppercase tracking-wider text-[#8ab1e0] font-semibold block">
                  Slug — the file name the model reads
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    value={metaDraft.code}
                    onChange={(e) =>
                      setMetaDraft((d) => ({ ...d, code: normalizeSlug(e.target.value) }))
                    }
                    className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-1 text-xs text-[#9be07c] font-mono outline-none focus:ring-1 focus:ring-accent"
                    data-testid="overview-slug-input"
                  />
                  <span className="text-10 font-mono text-[#556985]">.md</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-10 font-mono uppercase tracking-wider text-[#8ab1e0] font-semibold block">
                  Category
                </label>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {ARTIFACT_CATEGORIES.map((c) => {
                    const active = metaDraft.category === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setMetaDraft((d) => ({ ...d, category: c.value }))}
                        data-category={c.value}
                        className={`text-left px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                          active
                            ? 'border-accent bg-surface-2'
                            : 'border-transparent bg-surface-1 hover:bg-surface-2'
                        }`}
                      >
                        <span className={`text-11 font-semibold ${active ? 'text-[#67e8f9]' : 'text-ink'}`}>
                          {c.label}
                        </span>
                        <span className="block text-10 text-ink-mute leading-snug">
                          {c.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-10 font-mono uppercase tracking-wider text-[#8ab1e0] font-semibold block flex items-center gap-1">
                  <Tag className="w-3 h-3" /> Tags
                </label>
                <div className="flex flex-wrap gap-1 items-center">
                  {metaDraft.tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 min-h-[24px] px-2 rounded bg-surface-3 text-ink-dim text-10 font-mono"
                    >
                      #{t}
                      <button
                        type="button"
                        onClick={() =>
                          setMetaDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== t) }))
                        }
                        className="text-[#6b82a3] hover:text-ink cursor-pointer"
                        title={`Remove tag #${t}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    value={metaDraft.newTag}
                    placeholder="add #tag…"
                    onChange={(e) => setMetaDraft((d) => ({ ...d, newTag: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const t = metaDraft.newTag.trim().replace(/^#/, '');
                        if (t && !metaDraft.tags.includes(t)) {
                          setMetaDraft((d) => ({ ...d, tags: [...d.tags, t], newTag: '' }));
                        }
                      }
                    }}
                    className="min-h-[24px] px-2 rounded bg-surface-1 text-10 font-mono text-ink outline-none focus:ring-1 focus:ring-accent w-28"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-10 font-mono uppercase tracking-wider text-[#79ca4b] font-semibold block">
                    Subtitle (ships with the title)
                  </label>
                  {layersStale && (
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
                  )}
                </div>
                <input
                  value={metaDraft.subtitle}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, subtitle: e.target.value }))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-surface-1 text-xs text-ink italic outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-10 font-mono uppercase tracking-wider text-[#8ab1e0] font-semibold block">
                  Description
                </label>
                <textarea
                  value={metaDraft.description}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, description: e.target.value }))}
                  rows={4}
                  className="w-full px-2.5 py-2 rounded-lg bg-surface-1 text-11 text-[#c4d6ed] outline-none focus:ring-1 focus:ring-accent resize-y"
                />
              </div>

              <div className="space-y-1">
                <label className="text-10 font-mono uppercase tracking-wider text-[#e0b96c] font-semibold block">
                  Summary
                </label>
                <textarea
                  value={metaDraft.summary}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, summary: e.target.value }))}
                  rows={6}
                  className="w-full px-2.5 py-2 rounded-lg bg-surface-1 text-11 text-[#c4d6ed] outline-none focus:ring-1 focus:ring-accent resize-y"
                />
              </div>

              {layersStale && (
                <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-wash-warn/40" data-testid="stale-layers-badge">
                  <span className="text-11 font-mono text-[#f0c674]">
                    Summary layers out of date — they don't match the body anymore.
                  </span>
                </div>
              )}
              {refreshError && (
                <span className="text-10 font-mono text-[#f7aab3]" data-testid="refresh-layers-error">
                  {refreshError}
                </span>
              )}

              {metaError && (
                <div className="p-2.5 rounded-lg bg-wash-danger/30 text-11 font-mono text-[#f7aab3]" data-testid="overview-slug-error">
                  {metaError}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={saveOverview}
                  disabled={!metaDirty}
                  data-testid="overview-save"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-surface-0 text-xs font-mono font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-default"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save overview
                </button>
                {metaDirty && (
                  <button
                    onClick={() =>
                      setMetaDraft({
                        title: artifact.title || '',
                        subtitle: artifact.current?.subtitle || '',
                        description: artifact.current?.description || '',
                        summary: artifact.current?.summary || '',
                        code: artifact.code || '',
                        category: normalizeCategory(artifact.category),
                        tags: [...(artifact.tags || [])],
                        newTag: '',
                      })
                    }
                    className="px-3 py-1.5 rounded-lg bg-surface-3 text-[#8ab1e0] text-xs font-mono hover:bg-surface-4 transition-colors cursor-pointer"
                  >
                    Discard changes
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Tab 3: Relationships ────────────────────────────────────── */}
          {activeTab === 'relationships' && (
            <div className="space-y-4" data-testid="relationships-tab">
              <div className="space-y-1.5">
                <span className="text-10 font-mono uppercase tracking-wider text-[#5ad49b] font-semibold block px-1">
                  Connected artifacts ({incidentEdges.length})
                </span>
                {incidentEdges.length === 0 ? (
                  <div className="p-4 rounded-lg bg-surface-1 text-center text-11 font-mono text-ink-dim">
                    No connections yet — link one below.
                  </div>
                ) : (
                  incidentEdges.map((e) => {
                    const outgoing = e.sourceId === artifact.id;
                    const otherId = outgoing ? e.targetId : e.sourceId;
                    return (
                      <div
                        key={e.id}
                        className="p-2.5 rounded-lg bg-surface-1 flex flex-wrap items-center gap-2 text-11"
                      >
                        {/* This document is always the LEFT end, labelled as a
                            compact "self" chip; direction flows through the
                            arrows (flipped for incoming/backward links). */}
                        <span
                          className="px-1.5 py-0.5 rounded bg-surface-3 text-10 font-mono font-semibold text-[#8ab1e0] shrink-0"
                          title={title}
                        >
                          self
                        </span>
                        <span
                          className={`text-[#556985] text-base leading-none font-bold ${outgoing ? '' : 'inline-block rotate-180'}`}
                          aria-hidden="true"
                        >
                          &#x279c;
                        </span>
                        <select
                          value={e.kind}
                          onChange={(ev) => {
                            // Re-author the edge kind: remove + re-add with the
                            // same endpoints (the domain has no kind-update op).
                            if (!onRemoveEdge || !onAddEdge) return;
                            onRemoveEdge(e.id);
                            onAddEdge(otherId, ev.target.value);
                          }}
                          className="px-1.5 py-0.5 rounded bg-surface-2 text-10 font-mono text-[#8ab1e0] outline-none cursor-pointer"
                          title="Relation kind"
                        >
                          {Array.from(new Set([...KNOWN_RELATION_KINDS, e.kind])).map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        <span
                          className={`text-[#556985] text-base leading-none font-bold ${outgoing ? '' : 'inline-block rotate-180'}`}
                          aria-hidden="true"
                        >
                          &#x279c;
                        </span>
                        <button
                          onClick={() => onOpenArtifact?.(otherId)}
                          className="text-ink font-semibold min-w-0 flex-1 text-left truncate hover:text-[#67e8f9] cursor-pointer underline-offset-2 hover:underline"
                          title={artifactTitle(otherId)}
                        >
                          {artifactTitle(otherId)}
                        </button>
                        <button
                          onClick={() => onRemoveEdge?.(e.id)}
                          data-testid={`unlink-${e.id}`}
                          className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-3 hover:bg-surface-4 text-[#f7aab3] text-10 transition-colors cursor-pointer shrink-0"
                          title="Remove this connection"
                        >
                          <Unlink className="w-3 h-3" />
                          Unlink
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="space-y-1.5">
                <span className="text-10 font-mono uppercase tracking-wider text-[#8ab1e0] font-semibold block px-1">
                  Find & link related notes
                </span>
                <input
                  value={relQuery}
                  onChange={(e) => setRelQuery(e.target.value)}
                  placeholder="Search by title, #tag, or body text…"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-surface-1 text-xs text-ink outline-none focus:ring-1 focus:ring-accent"
                  data-testid="similarity-search-input"
                />
                {similarCandidates.length === 0 ? (
                  <div className="p-3 rounded-lg bg-surface-1 text-center text-11 font-mono text-ink-dim">
                    {relQuery
                      ? 'Nothing matches that search.'
                      : 'Everything is already linked, or there is nothing else in this project yet.'}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {similarCandidates.map((c) => (
                      <div
                        key={c.artifact.id}
                        className="p-2.5 rounded-lg bg-surface-1 flex flex-wrap items-center gap-2 text-11"
                      >
                        <div className="min-w-0 flex-1">
                          <button
                            onClick={() => onOpenArtifact?.(c.artifact.id)}
                            className="text-ink font-semibold truncate block hover:text-[#67e8f9] cursor-pointer"
                          >
                            {c.artifact.title || c.artifact.code}
                          </button>
                          <span className="text-10 font-mono text-[#556985]">
                            {categoryLabel(c.artifact.category)}
                            {c.sharedTags > 0 && ` · ${c.sharedTags} shared tag${c.sharedTags === 1 ? '' : 's'}`}
                            {c.overlap > 0 && ` · title overlap`}
                            {c.textHit && ' · text match'}
                          </span>
                        </div>
                        <select
                          value={candidateKind}
                          onChange={(e) => setCandidateKind(e.target.value)}
                          className="px-1.5 py-0.5 rounded bg-surface-2 text-10 font-mono text-[#8ab1e0] outline-none cursor-pointer"
                          title="Relation kind for the new link"
                        >
                          {KNOWN_RELATION_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => onAddEdge?.(c.artifact.id, candidateKind)}
                          data-testid={`link-candidate-${c.artifact.id}`}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-3 hover:bg-surface-4 text-[#67e8f9] text-10 transition-colors cursor-pointer"
                          title="Connect this artifact"
                        >
                          <Link2 className="w-3 h-3" />
                          Link
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Tab 4: Chats ────────────────────────────────────────────── */}
          {activeTab === 'chats' && (
            <div className="space-y-1.5" data-testid="chats-tab">
              {chatUsages.length === 0 ? (
                <div className="p-4 rounded-lg bg-surface-1 text-center space-y-2">
                  <p className="text-11 font-mono text-ink-dim">
                    Not attached to any chat in this project yet.
                  </p>
                  <button
                    onClick={() => onAttach(artifact.id)}
                    className="px-3 py-1.5 rounded-lg bg-surface-3 hover:bg-surface-4 text-[#67e8f9] text-11 font-mono transition-colors cursor-pointer"
                  >
                    Stage for the current chat
                  </button>
                </div>
              ) : (
                chatUsages.map((u) => (
                  <div key={u.threadId} className="p-2.5 rounded-lg bg-surface-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-11">
                      <button
                        onClick={() => onOpenThread?.(u.threadId)}
                        className="text-ink font-semibold hover:text-[#67e8f9] cursor-pointer truncate"
                        title="Open this chat"
                      >
                        {u.threadTitle}
                      </button>
                      <span className="text-10 font-mono text-[#556985]">
                        {u.turnIndex === null ? 'Staged for next send' : `Attached at msg #${(u.turnIndex ?? 0) + 1}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-10 font-mono text-[#556985] mr-1">Sent as:</span>
                      {GRANULARITY_ORDER.map((g) => {
                        const isActive = u.granularity === g;
                        return (
                          <button
                            key={g}
                            onClick={() => onSetThreadAttachmentGranularity?.(u.threadId, artifact.id, g)}
                            data-testid={`chat-cut-${u.threadId}-${g}`}
                            className={`min-h-[24px] px-2 rounded-md text-10 font-mono transition-colors cursor-pointer ${getGranularityChipClass(g, isActive)}`}
                          >
                            {GRANULARITY_LABEL[g]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Tab 5: History — ALWAYS visible, v1 never missing ────────── */}
          {activeTab === 'history' && (
            <div className="space-y-2">
              {history.length === 0 && (
                <div className="p-3 rounded-lg bg-surface-1 space-y-1 font-mono text-11" data-testid="revision-row-1">
                  <div className="flex items-center justify-between gap-2 text-[#8ab1e0]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold shrink-0">v1</span>
                      <span className="text-9 px-1.5 py-0.5 rounded shrink-0 bg-wash-success text-[#6ee7b7]">
                        Initial version
                      </span>
                    </div>
                    <span className="text-10 text-[#556985] shrink-0">
                      {new Date(artifact.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-10 text-[#556985]">
                    The note as it was created. New versions appear here after every edit or AI
                    save.
                  </div>
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

          {/* ── Tab 6: Q&A Index ────────────────────────────────────────── */}
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
        </div>
        </div>{/* ── end ONE scroll container ── */}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modalNode as unknown as React.ReactElement;
  return createPortal(modalNode, document.body);
};
