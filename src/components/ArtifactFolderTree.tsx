import React, { useState, useMemo } from 'react';
import { Project, Artifact, ResolutionTier } from '../types';
import {
  Folder,
  FolderOpen,
  FileCode,
  Pin,
  ChevronRight,
  ChevronDown,
  Search,
  MoreVertical,
  Maximize2,
  Minimize2,
  Sliders,
  Check,
  Eye,
  Sparkles,
  Layers,
  Filter,
} from 'lucide-react';
import { ArtifactDetailModal } from './ArtifactDetailModal';

export type ArtifactFilterMode = 'all' | 'in_context' | 'out_of_context';

interface ArtifactFolderTreeProps {
  project: Project;
  selectedArtifactId?: string | null;
  onSelectArtifact: (art: Artifact) => void;
  onToggleFocus?: (artId: string) => void;
  focalIds?: string[];
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  nodeTiers?: Record<string, { tier: ResolutionTier | 'culled'; distance: number }>;
  onChangeTierOverride?: (artId: string, tier: ResolutionTier | null) => void;
}

export const ArtifactFolderTree: React.FC<ArtifactFolderTreeProps> = ({
  project,
  selectedArtifactId,
  onSelectArtifact,
  onToggleFocus,
  focalIds = [],
  isMaximized = false,
  onToggleMaximize,
  nodeTiers = {},
  onChangeTierOverride,
}) => {
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({
    all: true,
    'note': true,
    architecture: true,
    combat: true,
    uncategorized: true,
  });
  const [filterText, setFilterText] = useState('');
  const [contextFilter, setContextFilter] = useState<ArtifactFilterMode>('all');
  const [activeMenuArtifactId, setActiveMenuArtifactId] = useState<string | null>(null);
  const [modalArtifact, setModalArtifact] = useState<Artifact | null>(null);

  const toggleFolder = (folderName: string) => {
    setOpenFolders((prev) => ({ ...prev, [folderName]: !prev[folderName] }));
  };

  // Determine which artifacts are currently in context
  const inContextArtifactIds = useMemo(() => {
    const ids = new Set<string>();
    // An artifact is in context if its tier is assigned (0, 1, 2, 3) and not 'culled',
    // or if it is in focalIds
    project.artifacts.forEach((art) => {
      const tierInfo = nodeTiers[art.id];
      if (focalIds.includes(art.id)) {
        ids.add(art.id);
      } else if (tierInfo && tierInfo.tier !== 'culled') {
        ids.add(art.id);
      }
    });
    return ids;
  }, [project.artifacts, nodeTiers, focalIds]);

  // Filter and group artifacts
  const filteredArtifacts = useMemo(() => {
    return project.artifacts.filter((art) => {
      // 1. Text filter
      if (filterText.trim()) {
        const q = filterText.toLowerCase();
        const matchesText =
          art.title?.toLowerCase().includes(q) ||
          art.code?.toLowerCase().includes(q) ||
          art.category?.toLowerCase().includes(q) ||
          art.current?.t1_abstract?.toLowerCase().includes(q) ||
          (art.tags && art.tags.some((t) => t.toLowerCase().includes(q)));
        if (!matchesText) return false;
      }

      // 2. Context status filter
      if (contextFilter === 'in_context') {
        return inContextArtifactIds.has(art.id);
      }
      if (contextFilter === 'out_of_context') {
        return !inContextArtifactIds.has(art.id);
      }
      return true;
    });
  }, [project.artifacts, filterText, contextFilter, inContextArtifactIds]);

  // Group by category
  const groupedArtifacts = useMemo(() => {
    const groups: Record<string, Artifact[]> = {};
    filteredArtifacts.forEach((art) => {
      const cat = art.category || (art.tags && art.tags[0]) || 'uncategorized';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(art);
    });
    return groups;
  }, [filteredArtifacts]);

  const categories = Object.keys(groupedArtifacts).sort();

  return (
    <div className="flex flex-col h-full bg-[#0a0f18] text-[#d6e3f5] font-mono text-xs select-none relative">
      {/* Search & Filter Header */}
      <div className="p-2 border-b border-[#121c2e] bg-[#0c1322] space-y-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search notes..."
              className="w-full bg-[#070b12] border border-[#162338] rounded-lg pl-7 pr-2 py-1 text-[11px] text-[#e3edf7] placeholder-[#556985] focus:outline-none focus:border-[#38bdf8]/50 font-sans"
            />
            <Search className="w-3.5 h-3.5 text-[#556985] absolute left-2 top-1.5" />
          </div>

          {/* Maximize / Minimize button if available */}
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="p-1.5 rounded-lg bg-[#141e30] hover:bg-[#1b2840] text-[#8ab1e0] transition-colors border border-[#1a283e] cursor-pointer"
              title={isMaximized ? 'Minimize tree height' : 'Maximize tree to fit height'}
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* Filter by In-Context / Related pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[10px]">
          <button
            onClick={() => setContextFilter('all')}
            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer shrink-0 ${
              contextFilter === 'all'
                ? 'bg-[#18253a] text-[#38bdf8] font-semibold border border-[#233754]'
                : 'bg-[#070b12] text-[#6b82a3] hover:text-[#9bb0d1]'
            }`}
          >
            All ({project.artifacts.length})
          </button>
          <button
            onClick={() => setContextFilter('in_context')}
            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer shrink-0 ${
              contextFilter === 'in_context'
                ? 'bg-[#102a3d] text-[#38bdf8] font-semibold border border-[#1d4d6e]'
                : 'bg-[#070b12] text-[#6b82a3] hover:text-[#9bb0d1]'
            }`}
          >
            In Context ({inContextArtifactIds.size})
          </button>
          <button
            onClick={() => setContextFilter('out_of_context')}
            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer shrink-0 ${
              contextFilter === 'out_of_context'
                ? 'bg-[#1f1618] text-[#e05a66] font-semibold border border-[#421d22]'
                : 'bg-[#070b12] text-[#6b82a3] hover:text-[#9bb0d1]'
            }`}
          >
            Out ({project.artifacts.length - inContextArtifactIds.size})
          </button>
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {categories.length === 0 ? (
          <div className="p-4 text-center text-[#556985] text-xs font-sans">
            No artifacts found matching active filters.
          </div>
        ) : (
          categories.map((cat) => {
            const isOpen = openFolders[cat] ?? true;
            const items = groupedArtifacts[cat];

            return (
              <div key={cat} className="space-y-0.5">
                {/* Category Header */}
                <button
                  onClick={() => toggleFolder(cat)}
                  className="w-full flex items-center gap-1.5 p-1 rounded-md hover:bg-[#121a29] text-[#8ab1e0] transition-colors text-left cursor-pointer"
                >
                  {isOpen ? (
                    <ChevronDown className="w-3 h-3 text-[#556985]" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-[#556985]" />
                  )}
                  {isOpen ? (
                    <FolderOpen className="w-3.5 h-3.5 text-[#e0b96c]" />
                  ) : (
                    <Folder className="w-3.5 h-3.5 text-[#e0b96c]" />
                  )}
                  <span className="font-semibold text-[11px] tracking-wide capitalize truncate flex-1">
                    {cat.replace(/-/g, ' ')}
                  </span>
                  <span className="text-[9px] text-[#556985] px-1 rounded bg-[#070b14]">
                    {items.length}
                  </span>
                </button>

                {/* Items */}
                {isOpen && (
                  <div className="ml-3 pl-2 border-l border-[#131d2e] space-y-0.5 mt-0.5">
                    {items.map((art) => {
                      const isSelected = selectedArtifactId === art.id;
                      const isInContext = inContextArtifactIds.has(art.id);
                      const isFocal = focalIds.includes(art.id);
                      const artColor = art.color || '#5d87b8';
                      const tierInfo = nodeTiers[art.id];
                      const currentTier = tierInfo ? tierInfo.tier : 'culled';
                      const isMenuOpen = activeMenuArtifactId === art.id;

                      return (
                        <div
                          key={art.id}
                          className={`group relative flex items-center justify-between p-1.5 rounded-lg text-left transition-all border ${
                            isSelected
                              ? 'bg-[#182337] border-[#293d5d] text-[#eef4fc]'
                              : 'hover:bg-[#0f1726] border-transparent text-[#9bb0d1]'
                          }`}
                        >
                          {/* Main Clickable row (clicking opens Detail Modal / Focus) */}
                          <div
                            onClick={() => {
                              onSelectArtifact(art);
                              setModalArtifact(art);
                            }}
                            className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0 shadow-xs"
                              style={{ backgroundColor: artColor }}
                              title={`Color code: ${artColor}`}
                            />

                            <FileCode className="w-3.5 h-3.5 text-[#6c85a8] group-hover:text-[#9bb0d1] shrink-0" />

                            <div className="truncate min-w-0 flex-1">
                              <span className="font-medium text-[11px] block truncate">
                                {art.title}
                              </span>
                              <div className="flex items-center gap-1.5 text-[9px] text-[#556985] truncate">
                                <span>{art.code || art.type}</span>
                                {isInContext && (
                                  <span className="px-1 rounded bg-[#0a1e2e] text-[#38bdf8] font-semibold border border-[#14324a]">
                                    {isFocal ? 'Focal T3' : `T${currentTier}`}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Quick Actions & Vertical Three Dots Menu Button */}
                          <div className="flex items-center gap-1 shrink-0 ml-1">
                            {/* Pin / Focus quick toggle */}
                            {onToggleFocus && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleFocus(art.id);
                                }}
                                className={`p-1 rounded hover:bg-[#1a2538] transition-colors cursor-pointer ${
                                  isFocal
                                    ? 'text-[#38bdf8] bg-[#0c1e2e]'
                                    : 'text-[#44556e] opacity-40 group-hover:opacity-100'
                                }`}
                                title={isFocal ? 'Remove from optical focus' : 'Pull into optical focus'}
                              >
                                <Pin className={`w-3 h-3 ${isFocal ? 'fill-current' : ''}`} />
                              </button>
                            )}

                            {/* Three Dots Button for context actions */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuArtifactId(isMenuOpen ? null : art.id);
                              }}
                              className="p-1 rounded hover:bg-[#1a2538] text-[#6b82a3] hover:text-[#eef4fc] transition-colors cursor-pointer"
                              title="More options (change detail level, view fields)"
                            >
                              <MoreVertical className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Popup Dropdown Menu for Artifact Options */}
                          {isMenuOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute top-full right-0 mt-1 w-52 bg-[#0d1422] border border-[#1a283e] rounded-xl shadow-2xl p-1.5 z-40 space-y-1 font-mono text-[11px] animate-in fade-in zoom-in-95 duration-100"
                            >
                              <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-[#556985] font-semibold border-b border-[#141e30]">
                                Context & Detail Level
                              </div>

                              {/* Action: Toggle in/out of context */}
                              <button
                                onClick={() => {
                                  if (onToggleFocus) onToggleFocus(art.id);
                                  setActiveMenuArtifactId(null);
                                }}
                                className="w-full flex items-center justify-between p-1.5 rounded-lg text-left hover:bg-[#152033] text-[#cad8eb] transition-colors cursor-pointer"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Pin className="w-3 h-3 text-[#38bdf8]" />
                                  <span>{isFocal ? 'Remove from Focus' : 'Put in Focus (Focal)'}</span>
                                </span>
                                {isFocal && <Check className="w-3 h-3 text-[#38bdf8]" />}
                              </button>

                              {/* Action: Detail Level Quick Selector */}
                              {onChangeTierOverride && (
                                <div className="p-1.5 bg-[#080d16] rounded-lg border border-[#121c2e] space-y-1">
                                  <span className="text-[9px] text-[#556985] block">Force Context Level:</span>
                                  <div className="grid grid-cols-4 gap-1 text-[10px]">
                                    {([3, 2, 1, 0] as ResolutionTier[]).map((t) => (
                                      <button
                                        key={t}
                                        onClick={() => {
                                          onChangeTierOverride(art.id, t);
                                          setActiveMenuArtifactId(null);
                                        }}
                                        className={`py-1 rounded text-center transition-colors cursor-pointer ${
                                          currentTier === t
                                            ? 'bg-[#1e2f4a] text-[#38bdf8] font-bold border border-[#2b446b]'
                                            : 'bg-[#0f1726] text-[#7185a3] hover:text-white'
                                        }`}
                                      >
                                        T{t}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Action: View Details Modal */}
                              <button
                                onClick={() => {
                                  setModalArtifact(art);
                                  setActiveMenuArtifactId(null);
                                }}
                                className="w-full flex items-center gap-1.5 p-1.5 rounded-lg text-left hover:bg-[#152033] text-[#8ab1e0] transition-colors cursor-pointer"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Inspect Fields & Details</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Artifact Details Popup Modal */}
      {modalArtifact && (
        <ArtifactDetailModal
          artifact={modalArtifact}
          onClose={() => setModalArtifact(null)}
          isInContext={inContextArtifactIds.has(modalArtifact.id)}
          contextTier={nodeTiers[modalArtifact.id]?.tier ?? 'culled'}
          onToggleInContext={(artId) => {
            if (onToggleFocus) onToggleFocus(artId);
          }}
          onChangeTierOverride={onChangeTierOverride}
        />
      )}
    </div>
  );
};
