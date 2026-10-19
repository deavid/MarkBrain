import React, { useMemo, useState } from 'react';
import { Artifact } from '../../types';
import type { SemanticEdge, RelationKind } from '../../types';
import { SpatialGraph } from '../graph/SpatialGraph';
import {
  Search,
  FolderTree,
  Network,
  Menu,
  FileCode,
  Upload,
  Plus,
  Tag,
} from 'lucide-react';
import { isFlaggedArtifact } from '../../utils/importDetect';
import { logger } from '../../utils/logger';

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
}

/**
 * The LIBRARY — everything that exists, at full size (09 §3).
 *
 * Two lenses over the same set: `folders` (find things, read them) and
 * `graph` (the forest view). Neither lens decides what is sent to the model;
 * that is an attachment inside a chat, and nothing else.
 *
 * No top bar, no sticky header (hard rule): the lens switch is a floating pill.
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
}) => {
  const [lens, setLens] = useState<LibraryLens>('folders');
  const [query, setQuery] = useState('');

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
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-4 pb-24">
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
              <p className="text-xs font-mono text-[#8297b5]">
                The library is empty.
              </p>
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
              <div className="rounded-2xl border border-[#141f33] bg-[#0c1322] overflow-hidden divide-y divide-[#101a29]">
                {list.map((art) => {
                  const flagged = isFlaggedArtifact(art);
                  return (
                    <button
                      key={art.id}
                      onClick={() => (flagged ? onTriageArtifact(art.id) : onSelectArtifact(art))}
                      className="w-full text-left px-3 py-2.5 hover:bg-[#0f182a] transition-colors cursor-pointer flex items-start gap-2.5"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full mt-1 shrink-0"
                        style={{ backgroundColor: art.color || '#5d87b8' }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs font-mono font-semibold text-[#e3edf7] truncate">
                            {art.title}
                          </span>
                          {flagged && (
                            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#241c0d] text-[#e0b96c] border border-[#4d3a24] shrink-0">
                              review
                            </span>
                          )}
                        </span>
                        <span className="block text-[10px] font-mono text-[#6b82a3] line-clamp-2 mt-0.5">
                          {art.current?.description || art.current?.summary || 'No description yet.'}
                        </span>
                        {(art.tags || []).length > 0 && (
                          <span className="flex items-center gap-1 mt-1 flex-wrap">
                            <Tag className="w-2.5 h-2.5 text-[#3f4d61]" />
                            {(art.tags || []).slice(0, 4).map((t) => (
                              <span key={t} className="text-[9px] font-mono text-[#4f5f78]">
                                {t}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <FileCode className="w-3.5 h-3.5 text-[#3f4d61] shrink-0 mt-1" />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Floating controls: sidebar trigger (mobile escape hatch) + lens switch.
          Deliberately NOT a top bar. */}
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

        <button
          onClick={onOpenImport}
          className="pointer-events-auto w-9 h-9 rounded-full bg-[#0d1421]/90 backdrop-blur-md border border-[#162235] shadow-lg flex items-center justify-center text-[#8ab1e0] hover:border-[#223552] transition-colors cursor-pointer"
          title="Import into the library"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
