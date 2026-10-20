import React, { useMemo, useState } from 'react';
import { Artifact } from '../../types';
import type { SemanticEdge, RelationKind } from '../../types';
import type { ChatAttachment } from '../../domains/06-chat-threads';
import { isAttachmentStaged } from '../../domains/06-chat-threads';
import type { Granularity, AttachmentVisualState } from '../../domains/granularity';
import { getAttachmentStatePalette } from '../../domains/granularity';
import { SpatialGraph } from '../graph/SpatialGraph';
import { Search, FolderTree, Network, Menu, FileCode, Upload, Plus, Tag, MessageSquare } from 'lucide-react';
import { isFlaggedArtifact } from '../../utils/importDetect';
import { logger } from '../../utils/logger';
import { AttachmentDot, GranularityChips, dotVerbLabel, formatTokens } from '../context/AttachmentControls';

export type LibraryLens = 'folders' | 'graph';

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
  /** This chat's attachments — the rows wear their state (10 §1). */
  attachments: ChatAttachment[];
  /** Cost of each artifact at its current cut in this chat (compiler's own numbers). */
  tokensByArtifact: Record<string, number>;
  /** The dot verb: not in chat → stage; staged → unstage; committed → cycle cut. */
  onToggleAttachment: (artifactId: string) => void;
  /** Unstage a staged artifact (no-op for committed ones — history has no delete key). */
  onUnstage: (artifactId: string) => void;
  onSetAttachmentGranularity: (artifactId: string, granularity: Granularity) => void;
  /** Back to the conversation (floating bubble, bottom right). */
  onReturnToChat: () => void;
}

/**
 * The LIBRARY — everything that exists, at full size (09 §3).
 *
 * It is also the PICKER (10 §3): the dot on each row is the verb, the row
 * turns bright when staged, and the four-word chip row steers granularity
 * without opening the detail modal. There is no second attachment modal.
 *
 * Two lenses over the same set: `folders` (find things, steer them) and
 * `graph` (the forest view). Neither lens decides what is sent to the model;
 * that is an attachment inside a chat, and nothing else.
 *
 * No top bar, no sticky header (hard rule): a clearance spacer scrolls away
 * at the top, and the controls float.
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
}) => {
  const [lens, setLens] = useState<LibraryLens>('folders');
  const [query, setQuery] = useState('');

  const attachmentByArtifact = useMemo(() => {
    const map = new Map<string, ChatAttachment>();
    for (const att of attachments) map.set(att.artifactId, att);
    return map;
  }, [attachments]);

  const stagedCount = useMemo(
    () => attachments.filter(isAttachmentStaged).length,
    [attachments]
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = artifacts.filter((a) => {
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
  }, [artifacts, query]);

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
        />
      ) : (
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-4 pb-28">
          {/* In-flow clearance for the floating pills — scrolls away with the
              content (never sticky/fixed; phones need every pixel back). */}
          <div
            data-testid="scroll-top-clearance"
            aria-hidden="true"
            className="h-10 shrink-0 border-b border-[#162234]/80 -mt-3 mb-1"
          />

          {/* Search + actions */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#556985]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search artifacts…"
                className="w-full min-h-[34px] pl-8 pr-2 rounded-xl bg-[#0c1322] border border-[#141f33] text-xs font-mono text-[#d6e3f5] placeholder-[#4f5f78] focus:outline-none focus:border-[#223552]"
              />
            </div>
            <button
              onClick={onOpenImport}
              className="flex items-center gap-1.5 min-h-[34px] px-2.5 rounded-xl bg-[#0c1322] border border-[#141f33] text-[10px] font-mono text-[#8ab1e0] hover:border-[#223552] transition-colors cursor-pointer shrink-0"
              title="Import documents into the library"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Import</span>
            </button>
          </div>

          {artifacts.length === 0 && (
            <div className="rounded-2xl border border-[#141f33] bg-[#0c1322] p-6 text-center space-y-2">
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
              <div className="rounded-2xl border border-[#141f33] overflow-hidden divide-y divide-[#0a1120]">
                {list.map((art) => {
                  const flagged = isFlaggedArtifact(art);
                  const att = attachmentByArtifact.get(art.id);
                  const state: AttachmentVisualState = !att
                    ? 'unstaged'
                    : isAttachmentStaged(att)
                      ? 'staged'
                      : att.granularity;
                  const palette = getAttachmentStatePalette(state);
                  const tokens = tokensByArtifact[art.id] ?? 0;
                  const committed = att !== undefined && !isAttachmentStaged(att);
                  const isStaged = state === 'staged';
                  return (
                    <div
                      key={art.id}
                      data-state={state}
                      data-artifact-id={art.id}
                      onClick={() => (flagged ? onTriageArtifact(art.id) : onSelectArtifact(art))}
                      className={`w-full text-left px-3 py-2.5 transition-colors cursor-pointer flex items-start gap-2.5 ${palette.rowClass}`}
                    >
                      <span className="mt-0.5">
                        <AttachmentDot
                          state={state}
                          onClick={() => onToggleAttachment(art.id)}
                          label={dotVerbLabel(state, art.title)}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-xs font-mono truncate ${palette.titleTextClass}`}>
                            {art.title}
                          </span>
                          {flagged && (
                            <span className={`text-[9px] font-mono px-1 py-0.2 rounded border ${palette.tagClass}`}>
                              review
                            </span>
                          )}
                          {committed && (
                            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border ${palette.tagClass}`}>
                              Turn {typeof att!.turnIndex === 'number' ? att!.turnIndex + 1 : 1}
                            </span>
                          )}
                          {isStaged && (
                            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border ${palette.tagClass}`}>
                              next send
                            </span>
                          )}
                        </span>
                        <span className={`block text-[10px] font-mono line-clamp-2 mt-0.5 ${palette.subTextClass}`}>
                          {art.current?.description || art.current?.summary || 'No description yet.'}
                        </span>
                        {(art.tags || []).length > 0 && (
                          <span className="flex items-center gap-1 mt-1 flex-wrap">
                            <Tag className="w-2.5 h-2.5 shrink-0 opacity-70" />
                            {(art.tags || []).slice(0, 4).map((t) => (
                              <span key={t} className={`text-[9px] font-mono ${palette.subTextClass}`}>
                                {t}
                              </span>
                            ))}
                          </span>
                        )}
                        {/* The four words, right on the row — no modal needed. */}
                        {(isStaged || committed) && (
                          <span className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <GranularityChips
                              value={att!.granularity}
                              label={`Granularity for ${art.title}`}
                              state={state}
                              compact
                              onChange={(g) => onSetAttachmentGranularity(art.id, g)}
                            />
                            <span className={`text-[9px] font-mono ${palette.subTextClass}`}>
                              {formatTokens(tokens)} tok
                            </span>
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 mt-1 flex flex-col items-end gap-1">
                        {isStaged ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUnstage(art.id);
                            }}
                            aria-label={`Unstage "${art.title}"`}
                            className={`min-h-[24px] px-2 rounded border text-[10px] font-mono cursor-pointer ${palette.inactiveChipClass}`}
                          >
                            Unstage
                          </button>
                        ) : (
                          /* No chips on an untouched row: the token count is the
                             only readout (what staging it at Full would cost). */
                          <span className={`text-[9px] font-mono ${palette.subTextClass}`}>
                            {formatTokens(tokens)} tok
                          </span>
                        )}
                        <FileCode className="w-3.5 h-3.5 opacity-50" />
                      </span>
                    </div>
                  );
                })}
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
          className="pointer-events-auto w-9 h-9 rounded-full bg-[#0d1421]/90 backdrop-blur-md border border-[#162235] shadow-lg flex items-center justify-center text-[#8ab1e0] hover:border-[#223552] transition-colors cursor-pointer"
          title="Open sidebar"
        >
          <Menu className="w-4 h-4" />
        </button>

        <div className="pointer-events-auto flex items-center gap-0.5 p-0.5 rounded-full bg-[#0d1421]/90 backdrop-blur-md border border-[#162235] shadow-lg">
          <button
            onClick={() => {
              logger.action('Artifacts', 'Library lens: folders');
              setLens('folders');
            }}
            className={`flex items-center gap-1.5 min-h-[30px] px-3 rounded-full text-[10px] font-mono transition-colors cursor-pointer ${
              lens === 'folders' ? 'bg-[#18253b] text-[#8ab1e0]' : 'text-[#5d7394]'
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
              lens === 'graph' ? 'bg-[#18253b] text-[#8ab1e0]' : 'text-[#5d7394]'
            }`}
          >
            <Network className="w-3 h-3" /> Graph
          </button>
        </div>

        {/* Back to the conversation. The badge says how much is armed. */}
        <button
          onClick={onReturnToChat}
          data-testid="back-to-chat"
          className="pointer-events-auto relative w-9 h-9 rounded-full bg-[#0d1421]/90 backdrop-blur-md border border-[#162235] shadow-lg flex items-center justify-center text-[#8ab1e0] hover:border-[#223552] transition-colors cursor-pointer"
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
