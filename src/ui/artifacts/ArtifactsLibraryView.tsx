import React, { useMemo, useState, useEffect } from 'react';
import { Artifact } from '../../types';
import type { SemanticEdge, RelationKind } from '../../types';
import type { ChatAttachment } from '../../domains/06-chat-threads';
import { isAttachmentStaged } from '../../domains/06-chat-threads';
import type { Granularity, AttachmentVisualState } from '../../domains/granularity';
import { SpatialGraph } from '../graph/SpatialGraph';
import { Search, FolderTree, Network, Menu, Upload, MessageSquare, X, Crosshair } from 'lucide-react';
import { isFlaggedArtifact } from '../../utils/importDetect';
import { logger } from '../../utils/logger';
import { AttachmentRow, formatAttachmentProvenance } from '../context/AttachmentControls';
import { isArtifactArchived } from '../../domains/01-artifact-document';
import type { SearchTestbedConfig, SearchMethodFlag } from '../../domains/search/searchConfig';
import { SEARCH_METHOD_FLAGS, THRESHOLD_MIN, THRESHOLD_MAX } from '../../domains/search/searchConfig';
import type { ArtifactMatchResult, MatchMethod } from '../../domains/search/draftSearchEngine';
import type { ArtifactSearchIndexRecord } from '../../services/searchIndexStore';
import { isIndexStale } from '../../application/artifactIndexer';

export type LibraryLens = 'folders' | 'graph' | 'proximity';

interface IndexProgress {
  done: number;
  total: number;
  stage: string;
}

interface ArtifactsLibraryViewProps {
  projectId: string;
  artifacts: Artifact[];
  edges: SemanticEdge[];
  onSelectArtifact: (artifact: Artifact) => void;
  onAddEdge: (sourceId: string, targetId: string, kind: RelationKind, weight?: number) => void;
  onUpdateNodePosition: (artifactId: string, x: number, y: number) => void;
  onBatchUpdateNodePositions: (positions: Array<{ artifactId: string; x: number; y: number }>) => void;
  onOpenSidebar: () => void;
  onOpenImport: () => void;
  onTriageArtifact: (artifactId: string) => void;
  attachments: ChatAttachment[];
  tokensByArtifact: Record<string, number>;
  onToggleAttachment: (artifactId: string) => void;
  onUnstage: (artifactId: string) => void;
  onSetAttachmentGranularity: (artifactId: string, granularity: Granularity) => void;
  onReturnToChat: () => void;
  /** Bumped by App when a tag is clicked outside this view (graph is here, detail modal is not). */
  externalTagFilter?: { tag: string; seq: number };
  // ── Draft-proximity testbed (design-docs/15) ─────────────────────────────
  /** The unsent chat draft (LAW 4) — the DEFAULT query, not a second search box. */
  draftText: string;
  onDraftTextChange: (text: string) => void;
  /**
   * A test query typed here, which OVERRIDES the chat draft without touching it.
   * Empty = "use the chat draft". This is what makes the box editable: it used to
   * bind straight to the draft and flip to a read-only <p> the moment it held one
   * character, so it could not be edited past the first keystroke.
   */
  searchQueryOverride: string;
  onSearchQueryOverrideChange: (text: string) => void;
  searchConfig: SearchTestbedConfig;
  onSearchConfigChange: (patch: Partial<SearchTestbedConfig>) => void;
  /** View of IndexedDB `markbrain-search-index` (LAW 2) — never the snapshot. */
  searchIndexMap: Map<string, ArtifactSearchIndexRecord>;
  /** Live scores from App's 350ms tier; sorted best-first, archived excluded. */
  draftResults: ArtifactMatchResult[];
  indexProgress: IndexProgress | null;
  /** Notes that could not be indexed. Stays until the next run — see the panel. */
  indexFailures?: { title: string; message: string }[];
  /** Last query-embed decision: fresh, or reused from a previous query. */
  queryEmbedNote?: {
    match: 'exact' | 'near' | 'fresh';
    similarity?: number;
    sourceText?: string;
  } | null;
  onIndexAll: (force: boolean) => void;
  onStopIndexing: () => void;
  /** Bumped by App when the [+ Attach] match badge routes here — force the lens. */
  externalLens?: { lens: LibraryLens; seq: number };
}

const METHOD_LABELS: Record<SearchMethodFlag, string> = {
  ftsSections: 'FTS: Sections',
  ftsQa: 'FTS: Q&A',
  vecSections: 'Vec: Sections',
  vecQa: 'Vec: Q&A',
  splitClauses: 'Split Clauses',
};

const METHOD_ABBR: Record<MatchMethod, string> = {
  ftsSections: 'fts-sec',
  ftsQa: 'fts-qa',
  vecSections: 'vec-sec',
  vecQa: 'vec-qa',
};

/**
 * The library — everything that exists — and the picker: the same view is where
 * a chat's attachments are chosen. The ROW is the verb (stage / unstage / cycle
 * the cut), the four words sit on the row, and the arrow-out opens the detail
 * popup.
 *
 * Three lenses over one set: `folders` (find things, steer them), `graph` (the
 * forest view), and `proximity` (rank everything against the unsent chat draft
 * and compare retrieval methods — a testbed, never an auto-injector; LAW 1).
 * None of the lenses decides what is sent: that is an attachment inside a
 * chat, and nothing else.
 *
 * No top bar and no sticky header. The clearance spacer scrolls away; controls
 * float. Adding a fixed bar here has been tried and rejected twice.
 */
export const ArtifactsLibraryView: React.FC<ArtifactsLibraryViewProps> = ({
  projectId,
  artifacts,
  edges,
  onSelectArtifact,
  onAddEdge,
  onUpdateNodePosition,
  onBatchUpdateNodePositions,
  onOpenSidebar,
  onOpenImport,
  onTriageArtifact,
  attachments,
  tokensByArtifact,
  onToggleAttachment,
  onUnstage,
  onSetAttachmentGranularity,
  onReturnToChat,
  externalTagFilter,
  draftText,
  onDraftTextChange,
  searchQueryOverride,
  onSearchQueryOverrideChange,
  searchConfig,
  onSearchConfigChange,
  searchIndexMap,
  draftResults,
  indexProgress,
  indexFailures = [],
  queryEmbedNote = null,
  onIndexAll,
  onStopIndexing,
  externalLens,
}) => {
  const [lens, setLens] = useState<LibraryLens>('folders');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const filterToTag = (tag: string) => {
    setLens('folders');
    setQuery('');
    setTagFilter(tag);
  };

  useEffect(() => {
    if (externalTagFilter?.tag) filterToTag(externalTagFilter.tag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTagFilter?.seq]);

  // The attach badge on [+ Attach] routes straight into this lens (LAW 1:
  // it only ever *shows* matches — nothing is staged by opening the view).
  useEffect(() => {
    if (externalLens && externalLens.seq > 0) setLens(externalLens.lens);
  }, [externalLens?.seq, externalLens?.lens]);

  const attachmentByArtifact = useMemo(() => {
    const map = new Map<string, ChatAttachment>();
    for (const att of attachments) map.set(att.artifactId, att);
    return map;
  }, [attachments]);

  const stagedCount = useMemo(
    () => attachments.filter(isAttachmentStaged).length,
    [attachments]
  );

  const matchById = useMemo(() => {
    const map = new Map<string, ArtifactMatchResult>();
    for (const r of draftResults) map.set(r.artifactId, r);
    return map;
  }, [draftResults]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = artifacts.filter((a) => {
      if (tagFilter && !(a.tags || []).includes(tagFilter)) return false;
      if (!q) return true;
      return (
        (a.title || '').toLowerCase().includes(q) ||
        (a.current?.description || '').toLowerCase().includes(q) ||
        (a.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    });
    const byCategory = new Map<string, Artifact[]>();
    for (const art of matches) {
      const key = art.category || 'note';
      const list = byCategory.get(key) || [];
      list.push(art);
      byCategory.set(key, list);
    }
    return Array.from(byCategory.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [artifacts, query, tagFilter]);

  // ── Proximity lens data ──────────────────────────────────────────────────
  const suggested = useMemo(
    () => draftResults.filter((r) => r.aboveThreshold && !r.isAlreadyAttached),
    [draftResults]
  );
  const others = useMemo(
    () => draftResults.filter((r) => !(r.aboveThreshold && !r.isAlreadyAttached)),
    [draftResults]
  );
  const indexedCount = useMemo(
    () => artifacts.filter((a) => !isIndexStale(searchIndexMap, projectId, a)).length,
    [artifacts, searchIndexMap, projectId]
  );

  const toggleMethod = (flag: SearchMethodFlag) => {
    onSearchConfigChange({ [flag]: !searchConfig[flag] } as Partial<SearchTestbedConfig>);
  };

  const rowBadge = (
    att: ChatAttachment | undefined,
    match: ArtifactMatchResult | undefined,
    isStaged: boolean
  ): string | undefined => {
    if (isStaged) return 'next send';
    if (att) return formatAttachmentProvenance(att.turnIndex)?.badge;
    // Unattached and above threshold: the folders lens surfaces the match
    // without leaving the tree. Staged/committed rows keep their own badges.
    if (match?.aboveThreshold) return `match ${Math.round(match.bestScore * 100)}%`;
    return undefined;
  };

  const renderRow = (art: Artifact, match?: ArtifactMatchResult) => {
    const flagged = isFlaggedArtifact(art);
    const att = attachmentByArtifact.get(art.id);
    const state: AttachmentVisualState = !att
      ? 'unstaged'
      : isAttachmentStaged(att)
        ? 'staged'
        : att.granularity;
    const tokens = tokensByArtifact[art.id] ?? 0;
    const isStaged = state === 'staged';
    return (
      <AttachmentRow
        key={art.id}
        artifactId={art.id}
        state={state}
        title={art.title}
        tokens={tokens}
        granularity={att?.granularity ?? 'full'}
        subtitle={art.current?.subtitle || art.current?.description || ''}
        tags={art.tags || []}
        flagged={flagged}
        archived={isArtifactArchived(art)}
        badge={rowBadge(att, match, isStaged)}
        onToggle={() => onToggleAttachment(art.id)}
        onSetGranularity={att ? (g) => onSetAttachmentGranularity(art.id, g) : undefined}
        onUnstage={isStaged ? () => onUnstage(art.id) : undefined}
        onOpenDetail={() => (flagged ? onTriageArtifact(art.id) : onSelectArtifact(art))}
      />
    );
  };

  /** One result: the row, then the X-Ray line that says WHY it scored. */
  const renderProximityRow = (r: ArtifactMatchResult) => {
    const art = artifacts.find((a) => a.id === r.artifactId);
    if (!art) return null;
    const methodBits = (Object.keys(METHOD_ABBR) as MatchMethod[])
      .filter((m) => r.methodScores[m] !== undefined)
      .map((m) => `${METHOD_ABBR[m]}: ${(r.methodScores[m] as number).toFixed(2)}`)
      .join(' · ');
    return (
      <div key={r.artifactId} data-artifact-match={r.artifactId} className="space-y-1">
        {renderRow(art, r)}
        <div
          data-testid="xray"
          className="bg-recess-1 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-ink-dim space-y-0.5"
        >
          <div>
            Score: {r.bestScore.toFixed(2)} [{methodBits}] · idx: {r.indexStatus}
            {r.winningMethod ? ` · win: ${METHOD_ABBR[r.winningMethod]}` : ''}
          </div>
          {r.matchedQa ? (
            <div>
              Matched Q ({r.matchedQa.sectionHeading}): "{r.matchedQa.question}" → "
              {r.matchedQa.answer}"
            </div>
          ) : r.matchedSectionHeading ? (
            <div>
              Matched Section ({r.matchedSectionHeading}): "{r.matchedSnippet}"
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const proximityBody = (
    <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-4 pb-28">
      <div
        data-testid="scroll-top-clearance"
        aria-hidden="true"
        className="h-10 shrink-0 -mt-3 mb-1"
      />

      {/* 1. The query. The chat draft is the DEFAULT; the box below overrides it
          without ever touching the composer. Both are visible at once so you can
          write a probe AND see the contents you are probing against. The box is
          ALWAYS editable — the old build bound it to the draft and swapped to a
          read-only <p> the moment it held one character, so it died on the first
          keystroke. */}
      {draftText.trim() && (
        <div className="bg-surface-2 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#556985]">
              Chat draft — {searchQueryOverride.trim() ? 'ignored' : 'in use'}
            </span>
            <button
              onClick={() => onDraftTextChange('')}
              className="text-[10px] font-mono text-[#5d7394] hover:text-ink transition-colors cursor-pointer"
              title="Clear the draft (also clears the chat composer)"
            >
              Clear
            </button>
          </div>
          <p className="text-xs text-ink-dim whitespace-pre-wrap break-words">{draftText}</p>
        </div>
      )}

      <div className="bg-surface-2 rounded-xl p-3 space-y-1.5">
        <label
          htmlFor="proximity-test-query"
          className="block text-[10px] font-mono uppercase tracking-wider text-[#556985]"
        >
          {searchQueryOverride.trim() ? 'Query override' : 'Query — blank uses the chat draft'}
        </label>
        <input
          id="proximity-test-query"
          data-testid="proximity-test-query"
          value={searchQueryOverride}
          onChange={(e) => onSearchQueryOverrideChange(e.target.value)}
          placeholder={draftText.trim() ? 'type to override the chat draft' : 'e.g. how do fluids tile?'}
          className="w-full min-h-[34px] px-2.5 rounded-lg bg-recess-1 text-xs font-mono text-ink placeholder:text-ink-faint focus:outline-none focus:bg-recess-2 shadow-well"
        />
        {searchQueryOverride.trim() && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono text-[#556985]">
              Overriding the chat draft
            </span>
            <button
              onClick={() => onSearchQueryOverrideChange('')}
              className="text-[10px] font-mono text-[#5d7394] hover:text-ink transition-colors cursor-pointer"
              title="Drop the override and query from the chat draft again"
            >
              Use chat draft
            </button>
          </div>
        )}
        {/* Show the embed decision. On a 1,000-request/day budget the question
            "did that cost me one?" should never require the network tab. */}
        {queryEmbedNote && (
          <p
            className="text-[10px] font-mono text-[#556985] truncate"
            data-testid="query-embed-note"
            title={
              queryEmbedNote.match === 'near' && queryEmbedNote.sourceText
                ? `Reused the vectors for: ${queryEmbedNote.sourceText}`
                : undefined
            }
          >
            {queryEmbedNote.match === 'fresh' && 'query embed: 1 request sent'}
            {queryEmbedNote.match === 'exact' && 'query embed: none — exact repeat'}
            {queryEmbedNote.match === 'near' &&
              `query embed: none — reused a ${Math.round(
                (queryEmbedNote.similarity ?? 0) * 100
              )}% match`}
          </p>
        )}
      </div>

      {/* 2. Method toggles — the whole point of the testbed: flip one, watch
          the ranking move. Threshold and flag flips re-score with ZERO API
          calls (App's cache is keyed by clause text). */}
      <div className="flex flex-wrap gap-1.5" data-testid="method-toggles">
        {SEARCH_METHOD_FLAGS.map((flag) => (
          <button
            key={flag}
            type="button"
            aria-pressed={searchConfig[flag]}
            data-testid={`method-${flag}`}
            onClick={() => toggleMethod(flag)}
            className={`min-h-[28px] px-2.5 rounded-full text-[10px] font-mono transition-colors cursor-pointer ${
              searchConfig[flag]
                ? 'bg-veil-2 shadow-lift text-[#8ab1e0]'
                : 'bg-surface-2 text-[#5d7394] hover:text-ink-dim'
            }`}
          >
            {METHOD_LABELS[flag]}
          </button>
        ))}
      </div>

      {/* 3. Threshold — live, and the count under it is the badge's twin. */}
      <div className="bg-surface-2 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between text-[11px] font-mono text-ink-dim">
          <span>Threshold</span>
          <span data-testid="threshold-readout">{searchConfig.threshold.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={THRESHOLD_MIN}
          max={THRESHOLD_MAX}
          step={0.05}
          value={searchConfig.threshold}
          onChange={(e) => onSearchConfigChange({ threshold: Number(e.target.value) })}
          className="w-full accent-[#2563eb] cursor-pointer"
          aria-label="Score threshold"
        />
        <p className="text-[10px] font-mono text-[#556985]" data-testid="suggested-count">
          {suggested.length} unattached note{suggested.length === 1 ? '' : 's'} above threshold
        </p>
      </div>

      {/* 4. Index status + runner. Q&A and vectors live only in IndexedDB
          (LAW 2); this button is the only thing that writes them. */}
      <div className="bg-surface-2 rounded-xl p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-mono text-ink-dim" data-testid="index-status">
            Indexed: {indexedCount} / {artifacts.length} notes
          </span>
          <span className="flex-1" />
          <button
            type="button"
            disabled={Boolean(indexProgress)}
            onClick={() => onIndexAll(false)}
            data-testid="index-all-unindexed"
            className="min-h-[28px] px-2.5 rounded-full bg-veil-1 shadow-lift hover:bg-veil-2 text-[10px] font-mono text-ink-dim hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
            title="Generate Q&A + embeddings for notes that have none or whose text changed"
          >
            Index All Unindexed
          </button>
          <button
            type="button"
            disabled={Boolean(indexProgress)}
            onClick={() => onIndexAll(true)}
            data-testid="index-reindex-all"
            className="min-h-[28px] px-2.5 rounded-full bg-veil-1 shadow-lift hover:bg-veil-2 text-[10px] font-mono text-ink-dim hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
            title="Rebuild every note's Q&A and embeddings from scratch"
          >
            Re-index All
          </button>
          {indexProgress && (
            <button
              type="button"
              onClick={onStopIndexing}
              data-testid="index-stop"
              className="min-h-[28px] px-2.5 rounded-full bg-surface-4 text-[#e0b96c] text-[10px] font-mono transition-colors cursor-pointer"
            >
              Stop
            </button>
          )}
        </div>
        {indexProgress && (
          <div className="space-y-1.5" data-testid="index-progress">
            <div className="flex items-center gap-2 min-w-0">
              {/* A breathing dot, not a spinning ring: the unit of work is a
                  network round-trip we cannot measure, so rotation would be
                  decoration. A pulse says "still alive" without inventing a
                  progress we do not have. */}
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#67e8f9] opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#67e8f9]" />
              </span>
              <p className="text-[10px] font-mono text-[#8ab1e0] flex-1 min-w-0 truncate">
                {indexProgress.total > 0
                  ? `Indexing ${Math.min(indexProgress.done + 1, indexProgress.total)}/${indexProgress.total}: ${indexProgress.stage}`
                  : indexProgress.stage}
              </p>
            </div>
            {indexProgress.total > 0 && (
              <div
                className="h-1 rounded-full bg-veil-2 overflow-hidden"
                role="progressbar"
                aria-valuenow={indexProgress.done}
                aria-valuemin={0}
                aria-valuemax={indexProgress.total}
                aria-label="Indexing progress"
              >
                <div
                  className="h-full rounded-full bg-[#67e8f9] transition-[width] duration-500 ease-out"
                  style={{
                    width: `${Math.round((indexProgress.done / indexProgress.total) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Failures are first-class. A count that will not move is
            indistinguishable from a save that never happened unless the app
            says which — this is what made "8 / 24" look like a storage bug. */}
        {indexFailures.length > 0 && (
          <div
            className="rounded-lg bg-[#3a1616] ring-1 ring-[#f45a56]/40 p-2.5 space-y-1"
            data-testid="index-failures"
          >
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#f28894]">
              {indexFailures.length} note{indexFailures.length === 1 ? '' : 's'} could not be
              indexed — nothing was saved for them
            </p>
            <ul className="space-y-0.5">
              {indexFailures.slice(0, 4).map((f) => (
                <li key={f.title} className="text-[10px] font-mono text-[#c9a2a2] truncate">
                  {f.title} — {f.message}
                </li>
              ))}
              {indexFailures.length > 4 && (
                <li className="text-[10px] font-mono text-[#c9a2a2]">
                  …and {indexFailures.length - 4} more
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* 5. The flat ranking — suggested first, everything else underneath. */}
      {draftResults.length === 0 && (
        <div className="rounded-xl bg-surface-2 p-6 text-center space-y-2">
          <Crosshair className="w-6 h-6 text-[#4f5f78] mx-auto" />
          <p className="text-xs font-mono text-[#8297b5]">Nothing scored yet.</p>
          <p className="text-[10px] font-mono text-[#4f5f78]">
            Type a draft in chat (or a test query above) to rank the library against it.
          </p>
        </div>
      )}

      {suggested.length > 0 && (
        <section className="space-y-1.5" data-testid="proximity-suggested">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#556985]">
              Suggested to Attach (Above Threshold)
            </span>
            <span className="text-[10px] font-mono text-[#3f4d61]">{suggested.length}</span>
          </div>
          <div className="rounded-xl bg-surface-2 p-1 space-y-1">
            {suggested.map(renderProximityRow)}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section className="space-y-1.5" data-testid="proximity-others">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#556985]">
              Below Threshold / Already Attached
            </span>
            <span className="text-[10px] font-mono text-[#3f4d61]">{others.length}</span>
          </div>
          <div className="rounded-xl bg-surface-2 p-1 space-y-1">
            {others.map(renderProximityRow)}
          </div>
        </section>
      )}
    </div>
  );

  return (
    <div className="relative w-full h-full min-h-0 flex-1 flex flex-col overflow-hidden">
      {lens === 'graph' ? (
        <SpatialGraph
          projectId={projectId}
          artifacts={artifacts}
          edges={edges}
          onSelectArtifact={onSelectArtifact}
          onAddEdge={onAddEdge}
          onUpdateNodePosition={onUpdateNodePosition}
          onBatchUpdateNodePositions={onBatchUpdateNodePositions}
          onFilterByTag={filterToTag}
        />
      ) : lens === 'proximity' ? (
        proximityBody
      ) : (
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-4 pb-28">
          {/* In-flow clearance for the floating pills — scrolls away with the
              content (never sticky/fixed; phones need every pixel back). */}
          <div
            data-testid="scroll-top-clearance"
            aria-hidden="true"
            className="h-10 shrink-0 -mt-3 mb-1"
          />

          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#556985]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search artifacts…"
                className="w-full min-h-[34px] pl-8 pr-2 rounded-xl bg-recess-1 text-xs font-mono text-ink placeholder:text-ink-faint focus:outline-none focus:bg-recess-2 shadow-well"
              />
            </div>
            {tagFilter && (
              <button
                onClick={() => setTagFilter(null)}
                data-testid="tag-filter-clear"
                className="flex items-center gap-1 min-h-[34px] px-2 rounded-xl bg-veil-2 shadow-lift text-[10px] font-mono text-[#8ab1e0] hover:text-ink transition-colors cursor-pointer shrink-0"
                title="Clear the tag filter"
              >
                #{tagFilter} <X className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={onOpenImport}
              className="flex items-center gap-1.5 min-h-[34px] px-2.5 rounded-xl bg-veil-1 shadow-lift hover:bg-veil-2 text-[10px] font-mono text-ink-dim hover:text-ink transition-colors cursor-pointer shrink-0"
              title="Import documents into the library"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Import</span>
            </button>
          </div>

          {artifacts.length === 0 && (
            <div className="rounded-xl bg-surface-2 p-6 text-center space-y-2">
              <FolderTree className="w-6 h-6 text-[#4f5f78] mx-auto" />
              <p className="text-xs font-mono text-[#8297b5]">The library is empty.</p>
              <p className="text-[10px] font-mono text-[#4f5f78]">
                Import a document, or extract something from a chat.
              </p>
            </div>
          )}

          {groups.map(([category, list]) => (
            <section key={category} className="space-y-1.5">
              <div className="flex items-center gap-2 px-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#556985]">
                  {category}
                </span>
                <span className="text-[10px] font-mono text-[#3f4d61]">{list.length}</span>
              </div>
              <div className="rounded-xl bg-surface-2 p-1 space-y-1">
                {list.map((art) => renderRow(art, matchById.get(art.id)))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Floating controls: sidebar trigger (mobile escape hatch) + lens switch +
          back-to-chat bubble. Deliberately NOT a top bar. */}
      <div className="absolute bottom-4 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
        <button
          onClick={onOpenSidebar}
          className="pointer-events-auto w-9 h-9 rounded-full bg-surface-3/95 backdrop-blur-md shadow-pop flex items-center justify-center text-ink-dim hover:text-ink hover:bg-surface-4 transition-colors cursor-pointer"
          title="Open sidebar"
        >
          <Menu className="w-4 h-4" />
        </button>

        <div className="pointer-events-auto flex items-center gap-0.5 p-0.5 rounded-full bg-surface-3/95 backdrop-blur-md shadow-pop">
          <button
            onClick={() => {
              logger.action('Artifacts', 'Library lens: folders');
              setLens('folders');
            }}
            className={`flex items-center gap-1.5 min-h-[30px] px-3 rounded-full text-[10px] font-mono transition-colors cursor-pointer ${
              lens === 'folders' ? 'bg-veil-2 shadow-lift text-[#8ab1e0]' : 'text-[#5d7394] hover:text-ink-dim'
            }`}
          >
            <FolderTree className="w-3 h-3" /> Folders
          </button>
          <button
            onClick={() => {
              logger.action('Artifacts', 'Library lens: graph');
              setLens('graph');
            }}
            className={`flex items-center gap-1.5 min-h-[30px] px-3 rounded-full text-[10px] font-mono transition-colors cursor-pointer ${
              lens === 'graph' ? 'bg-veil-2 shadow-lift text-[#8ab1e0]' : 'text-[#5d7394] hover:text-ink-dim'
            }`}
          >
            <Network className="w-3 h-3" /> Graph
          </button>
          <button
            onClick={() => {
              logger.action('Artifacts', 'Library lens: proximity');
              setLens('proximity');
            }}
            data-testid="lens-proximity"
            aria-pressed={lens === 'proximity'}
            className={`flex items-center gap-1.5 min-h-[30px] px-3 rounded-full text-[10px] font-mono transition-colors cursor-pointer ${
              lens === 'proximity' ? 'bg-veil-2 shadow-lift text-[#8ab1e0]' : 'text-[#5d7394] hover:text-ink-dim'
            }`}
          >
            <Crosshair className="w-3 h-3" /> Proximity
          </button>
        </div>

        <button
          onClick={onReturnToChat}
          data-testid="back-to-chat"
          className="pointer-events-auto relative w-9 h-9 rounded-full bg-surface-3/95 backdrop-blur-md shadow-pop flex items-center justify-center text-ink-dim hover:text-ink hover:bg-surface-4 transition-colors cursor-pointer"
          title={stagedCount > 0 ? `Back to chat — ${stagedCount} staged` : 'Back to chat'}
          aria-label={stagedCount > 0 ? `Back to chat, ${stagedCount} staged` : 'Back to chat'}
        >
          <MessageSquare className="w-4 h-4" />
          {stagedCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[#67e8f9] text-[#06131f] text-[9px] font-mono font-bold flex items-center justify-center">
              {stagedCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
};
