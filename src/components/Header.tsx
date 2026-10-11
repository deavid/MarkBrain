import React, { useState } from 'react';
import { Project, ModelOption } from '../types';
import { getTokenColor } from '../utils/tokenCalculator';
import {
  Layers,
  Download,
  Upload,
  ChevronDown,
  Cpu,
  Brain,
  MessageSquare,
  Compass,
  Gauge,
  FolderKanban,
  Plus,
} from 'lucide-react';

export type ActiveView = 'chat' | 'graph' | 'artifacts' | 'tokens';

interface HeaderProps {
  projects: Project[];
  activeProject: Project;
  onSelectProject: (p: Project) => void;
  selectedModel: ModelOption;
  availableModels: ModelOption[];
  onSelectModel: (m: ModelOption) => void;
  totalTokens: number;
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  onOpenExport: () => void;
  onOpenImport: () => void;
  onOpenProjectLauncher: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  projects,
  activeProject,
  onSelectProject,
  selectedModel,
  availableModels,
  onSelectModel,
  totalTokens,
  activeView,
  onChangeView,
  onOpenExport,
  onOpenImport,
  onOpenProjectLauncher,
}) => {
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const colorInfo = getTokenColor(totalTokens);

  const viewTabs: Array<{ id: ActiveView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'graph', label: 'Graph', icon: Compass },
    { id: 'artifacts', label: 'YAML Specs', icon: Layers },
    { id: 'tokens', label: 'Tokens', icon: Gauge },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#0f1522]/95 backdrop-blur-md border-b border-[#080d15] px-2.5 py-1.5 sm:px-4">
      <div className="flex items-center justify-between gap-2">
        {/* Left: Brand & Project Selector */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onOpenProjectLauncher}
            className="flex items-center gap-1.5 shrink-0 text-left cursor-pointer group"
            title="Open Project Deck"
          >
            <div className="w-7 h-7 rounded-lg bg-[#141d2d] border border-[#0a0f18] group-hover:border-[#e05a66]/50 flex items-center justify-center text-[#e05a66] shadow-sm transition-colors">
              <Brain className="w-4 h-4 text-[#e05a66]" />
            </div>
            <span className="font-bold text-xs tracking-wider text-[#eef4fc] hidden sm:inline font-mono">
              MarkBrain
            </span>
          </button>

          <div className="h-4 w-[1px] bg-[#0c121d] hidden sm:block" />

          {/* Project Switcher Pill */}
          <div className="relative">
            <button
              onClick={() => {
                setProjectDropdownOpen(!projectDropdownOpen);
                setModelDropdownOpen(false);
              }}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#121927] hover:bg-[#182236] border border-[#090e18] text-left text-xs font-medium text-[#c4d5f2] max-w-[130px] sm:max-w-[200px] truncate transition-colors"
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: activeProject.color || '#5d87b8' }}
              />
              <span className="truncate">{activeProject.name}</span>
              <ChevronDown className="w-3 h-3 text-[#778dae] shrink-0" />
            </button>

            {projectDropdownOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-64 bg-[#111724] border border-[#080c14] rounded-xl shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="flex items-center justify-between px-2 py-1 border-b border-[#0b1019]">
                  <span className="text-[10px] font-semibold text-[#778dae] uppercase tracking-wider font-mono">
                    Projects ({projects.length})
                  </span>
                  <button
                    onClick={() => {
                      setProjectDropdownOpen(false);
                      onOpenProjectLauncher();
                    }}
                    className="text-[10px] text-[#e05a66] hover:underline flex items-center gap-1 font-mono"
                  >
                    <Plus className="w-2.5 h-2.5" />
                    <span>New</span>
                  </button>
                </div>

                <div className="max-h-56 overflow-y-auto space-y-0.5 py-1">
                  {projects.map((proj) => (
                    <button
                      key={proj.id}
                      onClick={() => {
                        onSelectProject(proj);
                        setProjectDropdownOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs transition-colors ${
                        proj.id === activeProject.id
                          ? 'bg-[#1e1317] text-[#f2949f] font-semibold'
                          : 'hover:bg-[#151e2e] text-[#b8cce8]'
                      }`}
                    >
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: proj.color || '#5d87b8' }}
                      />
                      <span className="truncate flex-1">{proj.name}</span>
                    </button>
                  ))}
                </div>

                <div className="p-1 pt-1.5 border-t border-[#0b1019]">
                  <button
                    onClick={() => {
                      setProjectDropdownOpen(false);
                      onOpenProjectLauncher();
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[#141c2c] hover:bg-[#1a253a] text-xs font-mono text-[#8ab1e0] transition-colors border border-[#0a0f18]"
                  >
                    <FolderKanban className="w-3.5 h-3.5 text-[#e05a66]" />
                    <span>Open Projects Deck</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center: View Switcher */}
        <nav className="flex items-center gap-0.5 bg-[#0b1018] p-0.5 rounded-lg border border-[#080d15]">
          {viewTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeView === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => onChangeView(tab.id)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-[#1f1317] text-[#f28894] shadow-sm font-semibold'
                    : 'text-[#879bb8] hover:text-[#e0ecfc] hover:bg-[#141b27]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right: Model & Token Footprint Badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Model Selector */}
          <div className="relative">
            <button
              onClick={() => {
                setModelDropdownOpen(!modelDropdownOpen);
                setProjectDropdownOpen(false);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#121927] hover:bg-[#182236] border border-[#090e18] text-xs font-mono text-[#b5c9e6] transition-colors"
              title="Select LLM Inference Model"
            >
              <Cpu className="w-3.5 h-3.5 text-[#e05a66] shrink-0" />
              <span className="hidden lg:inline text-xs font-sans">
                {selectedModel.name.replace('Gemini ', '')}
              </span>
              <span className="lg:hidden text-[11px]">
                {selectedModel.id.includes('lite') ? 'Lite' : selectedModel.id.includes('pro') ? 'Pro' : 'Flash'}
              </span>
              <ChevronDown className="w-3 h-3 text-[#778dae]" />
            </button>

            {modelDropdownOpen && (
              <div className="absolute top-full right-0 mt-1.5 w-64 bg-[#111724] border border-[#080c14] rounded-xl shadow-2xl p-1 z-50">
                <div className="px-2 py-1 text-[10px] font-semibold text-[#778dae] uppercase tracking-wider font-mono">
                  Inference Model
                </div>
                {availableModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onSelectModel(m);
                      setModelDropdownOpen(false);
                    }}
                    className={`w-full flex flex-col gap-0.5 p-2 rounded-lg text-left transition-colors ${
                      m.id === selectedModel.id
                        ? 'bg-[#1f1317] text-[#f28894] font-semibold'
                        : 'hover:bg-[#151e2e] text-[#b8cce8]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span>{m.name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#162030] text-[#e0b96c] font-mono">
                        {m.badge}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Token Meter */}
          <button
            onClick={() => onChangeView('tokens')}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border border-[#090e18] text-xs font-mono transition-all ${colorInfo.badgeBg} ${colorInfo.textClass}`}
            title={`Active Context: ${totalTokens.toLocaleString()} tokens`}
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: colorInfo.hex }}
            />
            <span className="font-semibold">{Math.round(totalTokens / 1000)}k</span>
          </button>

          {/* Import / Export compact icons */}
          <button
            onClick={onOpenImport}
            className="p-1 rounded-lg hover:bg-[#161f30] text-[#9bb0d1] transition-colors"
            title="Import from Google Drive or Markdown"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onOpenExport}
            className="p-1 rounded-lg hover:bg-[#161f30] text-[#9bb0d1] transition-colors"
            title="Export JSON, Markdown, YAML"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
