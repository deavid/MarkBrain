import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Artifact, ResolutionTier } from '../types';
import {
  X,
  FileCode,
  Pin,
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

interface ArtifactDetailModalProps {
  artifact: Artifact;
  onClose: () => void;
  isInContext: boolean;
  contextTier: ResolutionTier | 'culled';
  onToggleInContext: (artId: string) => void;
  onChangeTierOverride?: (artId: string, tier: ResolutionTier | null) => void;
}

export const ArtifactDetailModal: React.FC<ArtifactDetailModalProps> = ({
  artifact,
  onClose,
  isInContext,
  contextTier,
  onToggleInContext,
  onChangeTierOverride,
}) => {
  const [activeTab, setActiveTab] = useState<'content' | 'metadata' | 'history'>('content');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const title = artifact.title || artifact.current?.t0_label || artifact.id;
  const abstract = artifact.description || artifact.current?.t1_abstract || '';
  const summary = artifact.summary || artifact.current?.t2_summary || '';
  const body = artifact.content || artifact.current?.t3_body || '';
  const artColor = artifact.color || '#5d87b8';

  const tierLabels: Record<ResolutionTier | 'culled', { name: string; desc: string }> = {
    3: { name: 'Tier 3 (Full Verbatim)', desc: 'Sharpest focus. Complete markdown body ingested into prompt.' },
    2: { name: 'Tier 2 (Summary)', desc: 'Mid focus. Key invariants and executive summary.' },
    1: { name: 'Tier 1 (Abstract)', desc: 'Low focus. High-level concept essence & boundaries.' },
    0: { name: 'Tier 0 (Index Title)', desc: 'Peripheral presence. Title and tags only.' },
    culled: { name: 'Culled (Out of Context)', desc: 'Excluded from LLM prompt window.' },
  };

  const modalNode = (
    <div className={`fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center select-text ${
      isFullscreen ? 'p-0' : 'p-2 sm:p-4 md:p-6'
    }`}>
      <div
        className={`bg-[#0b1019] border border-[#1a283e] flex flex-col shadow-2xl overflow-hidden font-sans transition-all duration-200 ${
          isFullscreen
            ? 'w-full h-full rounded-none border-none'
            : 'w-full max-w-5xl h-[92vh] max-h-[92vh] rounded-2xl'
        }`}
      >
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-[#141f33] bg-[#0e1626] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
              style={{ backgroundColor: artColor }}
            />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-[#eef4fc] font-mono truncate">
                {title}
              </h2>
              <div className="flex items-center gap-2 text-[10px] font-mono text-[#6b82a3] mt-0.5">
                <span className="px-1.5 py-0.2 rounded bg-[#070c14] border border-[#141d2e] text-[#8ab1e0]">
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
            {/* Fullscreen Toggle */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1.5 rounded-xl bg-[#141d2e] hover:bg-[#1f2b42] text-[#869ab8] hover:text-white transition-colors cursor-pointer"
              title={isFullscreen ? 'Restore standard view' : 'Maximize to whole screen'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-[#141d2e] hover:bg-[#1f2b42] text-[#869ab8] hover:text-white transition-colors cursor-pointer"
              title="Close modal (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Action Toolbar: In/Out of context & Detail Level */}
        <div className="p-3 bg-[#080d16] border-b border-[#131d2f] flex flex-wrap items-center justify-between gap-2.5">
          {/* Toggle In/Out Context */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleInContext(artifact.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-medium border transition-all cursor-pointer ${
                isInContext
                  ? 'bg-[#0f2438] border-[#1d4c73] text-[#38bdf8] shadow-sm'
                  : 'bg-[#141924] border-[#1f2638] text-[#7185a3] hover:text-[#9bb0d1]'
              }`}
            >
              <Pin className={`w-3.5 h-3.5 ${isInContext ? 'fill-current' : ''}`} />
              <span>{isInContext ? 'In Context (Focal)' : 'Out of Focus'}</span>
            </button>

            <span className="text-[11px] font-mono text-[#556985] hidden sm:inline">
              Current: <strong className="text-[#a4bddf]">{tierLabels[contextTier]?.name || contextTier}</strong>
            </span>
          </div>

          {/* Change Detail Level (Resolution Tier Override) */}
          {onChangeTierOverride && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono text-[#556985] mr-1">Tier:</span>
              {([3, 2, 1, 0] as ResolutionTier[]).map((t) => {
                const isActive = contextTier === t;
                return (
                  <button
                    key={t}
                    onClick={() => onChangeTierOverride(artifact.id, t)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-mono transition-all cursor-pointer border ${
                      isActive
                        ? 'bg-[#1d2d47] text-[#e0eeff] font-bold border-[#2d4770]'
                        : 'bg-[#0a0f19] text-[#6b82a3] border-[#131d2e] hover:bg-[#121c2e] hover:text-[#8ab1e0]'
                    }`}
                    title={tierLabels[t].desc}
                  >
                    T{t}
                  </button>
                );
              })}
              <button
                onClick={() => onChangeTierOverride(artifact.id, null)}
                className="px-1.5 py-1 rounded-lg text-[9px] font-mono text-[#556985] hover:text-[#9bb0d1]"
                title="Reset tier to automatic depth-of-field calculation"
              >
                Auto
              </button>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-[#121c2d] bg-[#0c121e] px-3 gap-2">
          <button
            onClick={() => setActiveTab('content')}
            className={`py-2 px-3 text-xs font-mono border-b-2 transition-colors cursor-pointer ${
              activeTab === 'content'
                ? 'border-[#38bdf8] text-[#eef4fc] font-semibold'
                : 'border-transparent text-[#6b82a3] hover:text-[#9bb0d1]'
            }`}
          >
            Specification Content
          </button>
          <button
            onClick={() => setActiveTab('metadata')}
            className={`py-2 px-3 text-xs font-mono border-b-2 transition-colors cursor-pointer ${
              activeTab === 'metadata'
                ? 'border-[#38bdf8] text-[#eef4fc] font-semibold'
                : 'border-transparent text-[#6b82a3] hover:text-[#9bb0d1]'
            }`}
          >
            Tier Fields & YAML
          </button>
          {artifact.history && artifact.history.length > 0 && (
            <button
              onClick={() => setActiveTab('history')}
              className={`py-2 px-3 text-xs font-mono border-b-2 transition-colors cursor-pointer ${
                activeTab === 'history'
                  ? 'border-[#38bdf8] text-[#eef4fc] font-semibold'
                  : 'border-transparent text-[#6b82a3] hover:text-[#9bb0d1]'
              }`}
            >
              History ({artifact.history.length})
            </button>
          )}
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-[#cad8eb] leading-relaxed">
          {activeTab === 'content' && (
            <div className="space-y-4">
              {/* Executive Abstract */}
              {abstract && (
                <div className="p-3 rounded-xl bg-[#0e1626] border border-[#16233a] space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#8ab1e0] font-semibold block">
                    Tier 1 • Abstract
                  </span>
                  <p className="text-[#b5cae6] text-[11px] leading-relaxed">{abstract}</p>
                </div>
              )}

              {/* Summary */}
              {summary && (
                <div className="p-3 rounded-xl bg-[#0e1626] border border-[#16233a] space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#e0b96c] font-semibold block">
                    Tier 2 • Executive Summary
                  </span>
                  <div className="text-[#cad8eb] text-[11px] whitespace-pre-wrap leading-relaxed">
                    {summary}
                  </div>
                </div>
              )}

              {/* Full Markdown Body */}
              <div className="p-3.5 rounded-xl bg-[#080d16] border border-[#111928] space-y-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#5ad49b] font-semibold block">
                  Tier 3 • Full Markdown Body
                </span>
                <div className="font-mono text-[11px] whitespace-pre-wrap text-[#c4d6ed] bg-[#050810] p-3 rounded-lg border border-[#0d1422] max-h-80 overflow-y-auto">
                  {body || '# No full body recorded.'}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'metadata' && (
            <div className="space-y-3 font-mono text-[11px]">
              <div className="grid grid-cols-2 gap-2 bg-[#080d16] p-3 rounded-xl border border-[#121c2d]">
                <div>
                  <span className="text-[10px] text-[#556985] block">Artifact ID:</span>
                  <span className="text-[#8ab1e0]">{artifact.id}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#556985] block">Code Identifier:</span>
                  <span className="text-[#8ab1e0]">{artifact.code || 'None'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#556985] block">High Concept:</span>
                  <span className={artifact.isHighConcept ? 'text-[#e05a66]' : 'text-[#6b82a3]'}>
                    {artifact.isHighConcept ? 'Yes (Core Anchor)' : 'No (Component)'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[#556985] block">Category:</span>
                  <span className="text-[#cad8eb]">{artifact.category || 'general'}</span>
                </div>
              </div>

              {artifact.tags && artifact.tags.length > 0 && (
                <div className="p-3 rounded-xl bg-[#080d16] border border-[#121c2d] space-y-1.5">
                  <span className="text-[10px] text-[#556985] block">Graph Tags:</span>
                  <div className="flex flex-wrap gap-1">
                    {artifact.tags.map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded bg-[#131d2e] text-[#8ab1e0] border border-[#1a283e] text-[10px]"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {artifact.yamlDocument && (
                <div className="space-y-1">
                  <span className="text-[10px] text-[#556985] block">Raw YAML Document:</span>
                  <pre className="bg-[#050810] p-3 rounded-xl border border-[#0e1624] text-[10px] text-[#86a2c9] overflow-x-auto max-h-56">
                    {artifact.yamlDocument}
                  </pre>
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && artifact.history && (
            <div className="space-y-2">
              {artifact.history.map((h, i) => (
                <div
                  key={i}
                  className="p-3 rounded-xl bg-[#080d16] border border-[#121c2d] space-y-1 font-mono text-[11px]"
                >
                  <div className="flex items-center justify-between text-[#8ab1e0]">
                    <span className="font-bold">v{h.version}</span>
                    <span className="text-[10px] text-[#556985]">
                      {new Date(h.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[#a4bddf]">{h.changeSummary}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[#141f33] bg-[#0c121e] flex items-center justify-between">
          <span className="text-[10px] font-mono text-[#556985]">
            Optical Context Engine • Multi-Resolution Artifact Model
          </span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl bg-[#182337] hover:bg-[#22334d] text-xs font-mono text-[#8ab1e0] transition-colors cursor-pointer"
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
