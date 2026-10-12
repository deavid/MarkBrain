import React, { useState, useMemo } from 'react';
import { Project, Artifact } from '../types';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  Pin,
  ChevronRight,
  ChevronDown,
  Layers,
  Sparkles,
  ExternalLink,
  Search,
} from 'lucide-react';

interface ArtifactFolderTreeProps {
  project: Project;
  selectedArtifactId?: string | null;
  onSelectArtifact: (art: Artifact) => void;
  onToggleFocus?: (artId: string) => void;
  focalIds?: string[];
}

export const ArtifactFolderTree: React.FC<ArtifactFolderTreeProps> = ({
  project,
  selectedArtifactId,
  onSelectArtifact,
  onToggleFocus,
  focalIds = [],
}) => {
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({
    all: true,
    'system-spec': true,
    architecture: true,
    combat: true,
    uncategorized: true,
  });
  const [filterText, setFilterText] = useState('');

  const toggleFolder = (folderName: string) => {
    setOpenFolders((prev) => ({ ...prev, [folderName]: !prev[folderName] }));
  };

  // Group artifacts by category or primary tag
  const groupedArtifacts = useMemo(() => {
    const groups: Record<string, Artifact[]> = {};
    const filtered = project.artifacts.filter((art) => {
      if (!filterText.trim()) return true;
      const q = filterText.toLowerCase();
      return (
        art.title?.toLowerCase().includes(q) ||
        art.code?.toLowerCase().includes(q) ||
        art.category?.toLowerCase().includes(q) ||
        art.description?.toLowerCase().includes(q) ||
        (art.tags && art.tags.some((t) => t.toLowerCase().includes(q)))
      );
    });

    filtered.forEach((art) => {
      const cat = art.category || (art.tags && art.tags[0]) || 'general-specs';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(art);
    });

    return groups;
  }, [project.artifacts, filterText]);

  const categories = Object.keys(groupedArtifacts).sort();

  return (
    <div className="flex flex-col h-full bg-[#0a0f18] text-[#d6e3f5] font-mono text-xs select-none">
      {/* Search Header */}
      <div className="p-2 border-b border-[#121c2e] bg-[#0c1322]">
        <div className="relative">
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter artifacts & schemas..."
            className="w-full bg-[#070b12] border border-[#162338] rounded-lg pl-7 pr-2.5 py-1 text-[11px] text-[#e3edf7] placeholder-[#556985] focus:outline-none focus:border-[#38bdf8]/50 font-sans"
          />
          <Search className="w-3.5 h-3.5 text-[#556985] absolute left-2 top-1.5" />
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <div className="flex items-center justify-between px-1 text-[10px] text-[#556985] uppercase tracking-wider font-semibold">
          <span>Artifact Hierarchy ({project.artifacts.length})</span>
          <span>{focalIds.length} in focus</span>
        </div>

        {categories.length === 0 ? (
          <div className="p-4 text-center text-[#556985] text-xs font-sans">
            No artifacts found matching filter.
          </div>
        ) : (
          categories.map((cat) => {
            const isOpen = openFolders[cat] ?? true;
            const items = groupedArtifacts[cat];

            return (
              <div key={cat} className="space-y-0.5">
                {/* Category / Folder Header */}
                <button
                  onClick={() => toggleFolder(cat)}
                  className="w-full flex items-center gap-1.5 p-1 rounded-md hover:bg-[#121a29] text-[#8ab1e0] transition-colors text-left"
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

                {/* Artifact Items inside Folder */}
                {isOpen && (
                  <div className="ml-3 pl-2 border-l border-[#131d2e] space-y-0.5 mt-0.5">
                    {items.map((art) => {
                      const isSelected = selectedArtifactId === art.id;
                      const isFocal = focalIds.includes(art.id);
                      const artColor = art.color || '#5d87b8';

                      return (
                        <div
                          key={art.id}
                          onClick={() => onSelectArtifact(art)}
                          className={`group flex items-center justify-between p-1.5 rounded-lg text-left cursor-pointer transition-colors border ${
                            isSelected
                              ? 'bg-[#182337] border-[#293d5d] text-[#eef4fc]'
                              : 'hover:bg-[#0f1726] border-transparent text-[#9bb0d1]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {/* Color Dot Indicator */}
                            <span
                              className="w-2 h-2 rounded-full shrink-0 shadow-xs"
                              style={{ backgroundColor: artColor }}
                            />

                            <FileCode className="w-3.5 h-3.5 text-[#6c85a8] group-hover:text-[#9bb0d1] shrink-0" />

                            <div className="truncate min-w-0">
                              <span className="font-medium text-[11px] block truncate">
                                {art.title}
                              </span>
                              <span className="text-[9px] text-[#556985] block truncate">
                                {art.code || art.type}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0 ml-1">
                            {/* Focus / Pin toggle */}
                            {onToggleFocus && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleFocus(art.id);
                                }}
                                className={`p-1 rounded hover:bg-[#1a2538] transition-colors ${
                                  isFocal
                                    ? 'text-[#38bdf8] bg-[#0c1e2e]'
                                    : 'text-[#44556e] opacity-40 group-hover:opacity-100'
                                }`}
                                title={isFocal ? 'Remove from optical focus' : 'Pull into optical focus'}
                              >
                                <Pin className="w-3 h-3" />
                              </button>
                            )}
                          </div>
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
    </div>
  );
};
