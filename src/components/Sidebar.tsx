import React, { useState } from 'react';
import { Project, ModelOption, Artifact } from '../types';
import { getTokenColor } from '../utils/tokenCalculator';
import {
  Brain,
  Cpu,
  Layers,
  MessageSquare,
  Compass,
  Upload,
  Download,
  FolderTree,
  ChevronDown,
  ChevronUp,
  Sliders,
  ExternalLink,
  ChevronRight,
  Database,
  Eye,
} from 'lucide-react';
import { ActiveView } from './Header';
import { ArtifactFolderTree } from './ArtifactFolderTree';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  projects: Project[];
  activeProject: Project;
  onSelectProject: (p: Project) => void;
  selectedModel: ModelOption;
  availableModels: ModelOption[];
  onSelectModel: (m: ModelOption) => void;
  totalTokens: number;
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  opticalMode?: 'autofocus' | 'manual' | 'myopia';
  onToggleOpticalMode?: () => void;
  onOpenExport: () => void;
  onOpenImport: () => void;
  onOpenProjectLauncher: () => void;
  // Artifact Tree & Focus capabilities
  onSelectArtifact?: (art: Artifact) => void;
  selectedArtifactId?: string | null;
  onToggleFocus?: (artId: string) => void;
  focalIds?: string[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onToggle,
  projects,
  activeProject,
  onSelectProject,
  selectedModel,
  availableModels,
  onSelectModel,
  totalTokens,
  activeView,
  onChangeView,
  opticalMode = 'autofocus',
  onToggleOpticalMode,
  onOpenExport,
  onOpenImport,
  onOpenProjectLauncher,
  onSelectArtifact,
  selectedArtifactId,
  onToggleFocus,
  focalIds = [],
}) => {
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  // Accordion block states inside sidebar: Roll up / roll down
  const [perspectiveOpen, setPerspectiveOpen] = useState(true);
  const [opticalEngineOpen, setOpticalEngineOpen] = useState(true);
  const [artifactsTreeOpen, setArtifactsTreeOpen] = useState(true);
  const [ioToolsOpen, setIoToolsOpen] = useState(false);

  const colorInfo = getTokenColor(totalTokens);

  return (
    <>
      {/* Floating Toggle: The Brain Icon Itself (Bigger, NO arrow) */}
      <button
        onClick={onToggle}
        aria-label={isOpen ? 'Close sidebar drawer' : 'Open controls & artifacts drawer'}
        className={`fixed top-3 z-50 flex items-center justify-center w-11 h-11 rounded-2xl bg-[#0c121e]/95 hover:bg-[#131d2e] border border-[#1a283e] text-[#e05a66] hover:text-[#ff6b78] shadow-2xl backdrop-blur-md transition-all duration-200 cursor-pointer group ${
          isOpen ? 'left-72' : 'left-3'
        }`}
        title={isOpen ? 'Close sidebar' : 'Open controls, project & artifact hierarchy'}
      >
        <Brain className="w-6 h-6 transition-transform group-hover:scale-110" />
      </button>

      {/* Backdrop overlay for small screens when open */}
      {isOpen && (
        <div
          onClick={onToggle}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
        />
      )}

      {/* Slide-out Left Sidebar Drawer */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 w-72 bg-[#090d16]/98 border-r border-[#121c2d] flex flex-col transition-transform duration-200 ease-in-out text-[#d6e3f5] backdrop-blur-xl ${
          isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        {/* Top of Sidebar: Current Project Display - Clicking opens Project Selector in new page/modal */}
        <div className="p-3.5 border-b border-[#121c2d] bg-[#0c1322]">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#556985] mb-1 flex items-center justify-between">
            <span>Current Project</span>
            <span className="text-[9px] text-[#38bdf8] font-mono">Click to switch</span>
          </div>

          <button
            onClick={onOpenProjectLauncher}
            className="w-full flex items-center justify-between p-2 rounded-xl bg-[#080d16] hover:bg-[#101827] border border-[#162338] text-left transition-colors group cursor-pointer"
            title="Click to open project selector page"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                style={{ backgroundColor: activeProject.color || '#5d87b8' }}
              />
              <div className="min-w-0 truncate">
                <span className="font-bold text-xs sm:text-sm text-[#eef4fc] group-hover:text-white font-mono block truncate">
                  {activeProject.name}
                </span>
                <span className="text-[10px] text-[#6b82a3] font-mono block truncate">
                  {activeProject.chapters.length} chapters • {activeProject.artifacts.length} artifacts
                </span>
              </div>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-[#556985] group-hover:text-[#38bdf8] shrink-0 ml-1.5 transition-colors" />
          </button>
        </div>

        {/* Scrollable Content with Roll Up / Roll Down Blocks */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
          {/* Block 1: Perspective (Chat vs Graph) */}
          <div className="rounded-xl border border-[#131d2e] bg-[#0a0f19] overflow-hidden">
            <button
              onClick={() => setPerspectiveOpen(!perspectiveOpen)}
              className="w-full flex items-center justify-between p-2.5 bg-[#0e1626] hover:bg-[#121c2e] text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-[#38bdf8]" />
                <span className="text-xs font-semibold font-mono uppercase tracking-wider text-[#9bb0d1]">
                  Perspective
                </span>
              </div>
              {perspectiveOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-[#556985]" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-[#556985]" />
              )}
            </button>

            {perspectiveOpen && (
              <div className="p-2 space-y-2">
                <div className="grid grid-cols-2 gap-1.5 bg-[#060a12] p-1 rounded-xl border border-[#0f1726]">
                  <button
                    onClick={() => onChangeView('chat')}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                      activeView === 'chat'
                        ? 'bg-[#182338] text-[#eef4fc] font-semibold border border-[#243552]'
                        : 'text-[#627794] hover:text-[#9bb0d1]'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#e05a66]" />
                    <span>Chat</span>
                  </button>
                  <button
                    onClick={() => onChangeView('graph')}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                      activeView === 'graph'
                        ? 'bg-[#182338] text-[#eef4fc] font-semibold border border-[#243552]'
                        : 'text-[#627794] hover:text-[#9bb0d1]'
                    }`}
                  >
                    <Compass className="w-3.5 h-3.5 text-[#5ad49b]" />
                    <span>Graph</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Block 2: Artifacts Folder Tree (Requested: Tree of artifacts for regular operations) */}
          <div className="rounded-xl border border-[#131d2e] bg-[#0a0f19] overflow-hidden">
            <button
              onClick={() => setArtifactsTreeOpen(!artifactsTreeOpen)}
              className="w-full flex items-center justify-between p-2.5 bg-[#0e1626] hover:bg-[#121c2e] text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <FolderTree className="w-3.5 h-3.5 text-[#e0b96c]" />
                <span className="text-xs font-semibold font-mono uppercase tracking-wider text-[#9bb0d1]">
                  Artifacts Tree ({activeProject.artifacts.length})
                </span>
              </div>
              {artifactsTreeOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-[#556985]" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-[#556985]" />
              )}
            </button>

            {artifactsTreeOpen && (
              <div className="h-64 border-t border-[#121c2e]">
                <ArtifactFolderTree
                  project={activeProject}
                  selectedArtifactId={selectedArtifactId}
                  onSelectArtifact={(art) => {
                    if (onSelectArtifact) onSelectArtifact(art);
                  }}
                  onToggleFocus={onToggleFocus}
                  focalIds={focalIds}
                />
              </div>
            )}
          </div>

          {/* Block 3: Optical Context Engine & Inference */}
          <div className="rounded-xl border border-[#131d2e] bg-[#0a0f19] overflow-hidden">
            <button
              onClick={() => setOpticalEngineOpen(!opticalEngineOpen)}
              className="w-full flex items-center justify-between p-2.5 bg-[#0e1626] hover:bg-[#121c2e] text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-[#e05a66]" />
                <span className="text-xs font-semibold font-mono uppercase tracking-wider text-[#9bb0d1]">
                  Context Engine
                </span>
              </div>
              {opticalEngineOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-[#556985]" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-[#556985]" />
              )}
            </button>

            {opticalEngineOpen && (
              <div className="p-2.5 space-y-3">
                {/* Optical Mode Cycle Button */}
                {onToggleOpticalMode && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#526682] block">
                      Optical Focus Mode
                    </span>
                    <button
                      onClick={onToggleOpticalMode}
                      className={`w-full flex items-center justify-between p-2 rounded-xl border text-xs font-mono transition-all cursor-pointer ${
                        opticalMode === 'autofocus'
                          ? 'bg-[#0f1929] border-[#1d314d] text-[#8ab1e0]'
                          : opticalMode === 'manual'
                          ? 'bg-[#141f33] border-[#1e3252] text-[#93c5fd]'
                          : 'bg-[#241c0c] border-[#423214] text-[#e0b96c]'
                      }`}
                      title="Click to cycle optical depth-of-field mode (Autofocus -> Manual -> Myopia)"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-current" />
                        <span className="font-semibold uppercase tracking-wider text-[11px]">
                          {opticalMode === 'autofocus'
                            ? '◎ Autofocus'
                            : opticalMode === 'manual'
                            ? '⦿ Manual Focus'
                            : '◐ Myopia Mode'}
                        </span>
                      </div>
                      <span className="text-[10px] opacity-75">Cycle ↺</span>
                    </button>
                  </div>
                )}

                {/* Token Meter Summary */}
                <div className="p-2 rounded-xl bg-[#070b12] border border-[#101826] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#526682]">
                      Compiled Footprint
                    </span>
                    <span className={`text-xs font-mono font-semibold ${colorInfo.textClass}`}>
                      {Math.round(totalTokens).toLocaleString()} tok
                    </span>
                  </div>
                  <div className="w-full bg-[#111929] h-1.5 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, (totalTokens / 128000) * 100)}%`,
                        backgroundColor: colorInfo.hex,
                      }}
                    />
                  </div>
                </div>

                {/* Inference Model Selector */}
                <div className="space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#526682] block">
                    Inference Model
                  </span>
                  <div className="relative">
                    <button
                      onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                      className="w-full flex items-center justify-between p-2 rounded-xl bg-[#0d1422] border border-[#141f33] text-xs font-mono text-[#b5c9e6] hover:border-[#1e2e4a] transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Cpu className="w-3.5 h-3.5 text-[#e05a66] shrink-0" />
                        <span className="truncate">{selectedModel.name}</span>
                      </div>
                      <ChevronDown className="w-3 h-3 text-[#647999] shrink-0" />
                    </button>

                    {modelDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-[#0f1726] border border-[#162238] rounded-xl shadow-2xl p-1 z-50 space-y-0.5">
                        {availableModels.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              onSelectModel(m);
                              setModelDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs font-mono transition-colors cursor-pointer ${
                              m.id === selectedModel.id
                                ? 'bg-[#24151a] text-[#f28894] font-semibold'
                                : 'text-[#9bb0d1] hover:bg-[#162236]'
                            }`}
                          >
                            <span className="truncate">{m.name}</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#0b1019] text-[#e0b96c]">
                              {m.badge}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Block 4: Import / Export inside sidebar roll up / roll down panel */}
          <div className="rounded-xl border border-[#131d2e] bg-[#0a0f19] overflow-hidden">
            <button
              onClick={() => setIoToolsOpen(!ioToolsOpen)}
              className="w-full flex items-center justify-between p-2.5 bg-[#0e1626] hover:bg-[#121c2e] text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-[#8ab1e0]" />
                <span className="text-xs font-semibold font-mono uppercase tracking-wider text-[#9bb0d1]">
                  Import / Export
                </span>
              </div>
              {ioToolsOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-[#556985]" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-[#556985]" />
              )}
            </button>

            {ioToolsOpen && (
              <div className="p-2.5 space-y-2">
                <p className="text-[10px] text-[#6b82a3] leading-relaxed">
                  Backup or synchronize project state, artifacts, chapters, and spatial graphs.
                </p>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={onOpenImport}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-[#0f1726] hover:bg-[#162238] border border-[#141f33] text-xs font-mono text-[#8ab1e0] transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#e05a66]" />
                    <span>Import</span>
                  </button>
                  <button
                    onClick={onOpenExport}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-[#0f1726] hover:bg-[#162238] border border-[#141f33] text-xs font-mono text-[#8ab1e0] transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#5ad49b]" />
                    <span>Export</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
