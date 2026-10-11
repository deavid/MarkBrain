import React from 'react';
import { Layers, MessageSquare, Compass, Gauge, FolderKanban } from 'lucide-react';
import { ActiveView } from './Header';
import { getTokenColor } from '../utils/tokenCalculator';

interface MobileNavProps {
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  totalTokens: number;
  onOpenProjectLauncher: () => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  activeView,
  onChangeView,
  totalTokens,
  onOpenProjectLauncher,
}) => {
  const tokenColor = getTokenColor(totalTokens);

  const tabs: Array<{ id: ActiveView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'graph', label: 'Graph', icon: Compass },
    { id: 'artifacts', label: 'YAML Specs', icon: Layers },
    { id: 'tokens', label: 'Tokens', icon: Gauge },
  ];

  return (
    <nav className="md:hidden shrink-0 z-40 bg-[#0b1018] border-t border-[#080d15] px-2 py-1 flex items-center justify-around h-12 landscape:h-9">
      {/* 1-Tap Projects Switcher */}
      <button
        onClick={onOpenProjectLauncher}
        className="flex flex-col landscape:flex-row items-center gap-0.5 landscape:gap-1.5 py-0.5 px-2 rounded-lg text-[#8ab1e0] hover:text-white transition-all"
        title="Open Project Launcher"
      >
        <FolderKanban className="w-3.5 h-3.5 text-[#e05a66]" />
        <span className="text-[10px] tracking-tight">Projects</span>
      </button>

      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeView === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => onChangeView(tab.id)}
            className={`flex flex-col landscape:flex-row items-center gap-0.5 landscape:gap-1.5 py-0.5 px-2 rounded-lg transition-all relative ${
              isActive
                ? 'text-[#f28894] font-semibold'
                : 'text-[#778dae] hover:text-[#c4d5f2]'
            }`}
          >
            <div className="relative">
              <Icon className="w-3.5 h-3.5" />
              {tab.id === 'tokens' && (
                <span
                  className="absolute -top-1 -right-1.5 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: tokenColor.hex }}
                />
              )}
            </div>
            <span className="text-[10px] tracking-tight">{tab.label}</span>
            {isActive && (
              <span className="w-1 h-1 rounded-full bg-[#e05a66] absolute -bottom-0.5" />
            )}
          </button>
        );
      })}
    </nav>
  );
};
