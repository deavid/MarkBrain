import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Artifact, ResolutionTier, TierReason } from '../../types';
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
import { renderMarkdown } from '../../utils/markdown';

interface ArtifactDetailModalProps {
  artifact: Artifact;
  onClose: () => void;
  isInContext: boolean;
  contextTier: ResolutionTier | 'culled';
  onToggleInContext: (artId: string) => void;
  onChangeTierOverride?: (artId: string, tier: ResolutionTier | null) => void;
  /** Version history from the versioning domain (source of truth — artifacts no longer embed history) */
  history?: Array<{ version: number; timestamp: number; changeSummary: string }>;
  /** Manual tier override currently forced for this artifact, if any. */
  tierOverride?: ResolutionTier | null;
  /** Why the compiled tier is what it is (pin / override / ancestor / radius / …). */
  tierReason?: TierReason;
  /** Hop distance from the nearest focal point (used in the reason chip). */
  tierDistance?: number;
}

export const ArtifactDetailModal: React.FC<ArtifactDetailModalProps> = ({
  artifact,
  onClose,
  isInContext,
  contextTier,
  onToggleInContext,
  onChangeTierOverride,
  history = [],
  tierOverride,
  tierReason,
  tierDistance,
}) => {
  const [activeTab, setActiveTab] = useState<'content' | 'metadata' | 'history'>('content');
  const [bodyView, setBodyView] = useState<'rendered' | 'raw'>('rendered');
  const [isFullscreen, setIsFullscreen] = useState(true);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const title = artifact.title || artifact.current?.t0_label || artifact.id;
  const abstract = artifact.current?.t1_abstract || '';
  const summary = artifact.current?.t2_summary || '';
  const body = artifact.current?.t3_body || '';
  const artColor = artifact.color || '#5d87b8';

  // Provenance chip: answers "why is this artifact at this tier?" at a glance.
  const reasonChip = (() => {
    switch (tierReason) {
      case 'pin':
        return {
          label: 'manual pin',
          title: 'Manually pinned — compiled at full focus regardless of distance.',
          cls: 'bg-[#0f2438] text-[#38bdf8] border-[#1d4c73]',
        };
      case 'fallback':
        return {
          label: 'auto focus',
          title: "Nothing is pinned, so the compiler fell back to its default focal point.",
          cls: 'bg-[#0a1e18] text-[#5ad49b] border-[#14372a]',
        };
      case 'override':
        return {
          label: 'forced',
          title: 'Manual tier override — this level is forced regardless of distance.',
          cls: 'bg-[#241c0d] text-[#e0b96c] border-[#4d3a24]',
        };
      case 'ancestor':
        return {
          label: 'ancestor',
          title: 'Ancestor backbone — kept at Tier ≥ 1 because it is an ancestor of a focal artifact.',
          cls: 'bg-[#1a1430] text-[#a78bfa] border-[#2f2654]',
        };
      case 'radius': {
        const hops =
          typeof tierDistance === 'number' && Number.isFinite(tierDistance)
            ? ` · ${tierDistance} hop${tierDistance === 1 ? '' : 's'}`
            : '';
        return {
          label: `auto${hops}`,
          title:
            'Automatic depth-of-field — pulled in because it sits within 3 hops of a focal point, not because you pinned it.',
          cls: 'bg-[#131d2e] text-[#8ab1e0] border-[#1a283e]',
        };
      }
      case 'culled':
        return {
          label: 'culled',
          title: 'Outside the focus radius (more than 3 hops from any focal point) — not compiled into the prompt.',
          cls: 'bg-[#1f1618] text-[#e05a66] border-[#421d22]',
        };
      default:
        return null;
    }
  })();

  const tierLabels: Record<ResolutionTier | 'culled', { name: string; desc: string }> = {
    3: { name: 'Tier 3 (Full Verbatim)', desc: 'Sharpest focus. Complete markdown body ingested into prompt.' },
    2: { name: 'Tier 2 (Summary)', desc: 'Mid focus. Key invariants and executive summary.' },
    1: { name: 'Tier 1 (Abstract)', desc: 'Low focus. High-level concept essence & boundaries.' },
    0: { name: 'Tier 0 (Index Title)', desc: 'Peripheral presence. Title and tags only.' },
    culled: { name: 'Culled (Out of Context)', desc: 'Excluded from LLM prompt window.' },
  };

  const modalNode = (
    <div className={`fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex items-center justify-center select-text w-screen h-screen ${
      isFullscreen ? 'p-0' : 'p-2 sm:p-4 md:p-6'
    }`}>
      <div
        className={`bg-[#0b1019] flex flex-col shadow-2xl overflow-hidden font-sans transition-all duration-200 ${
          isFullscreen
            ? 'w-screen h-screen rounded-none border-none'
            : 'w-full max-w-6xl h-[94vh] max-h-[94vh] rounded-2xl border border-[#1a283e]'
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
          {/* MANUAL state: what YOU chose (pin in/out of the focal window) */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onToggleInContext(artifact.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-medium border transition-all cursor-pointer ${
                isInContext
                  ? 'bg-[#0f2438] border-[#1d4c73] text-[#38bdf8] shadow-sm'
                  : 'bg-[#141924] border-[#1f2638] text-[#7185a3] hover:text-[#9bb0d1]'
              }`}
              title={
                isInContext
                  ? 'Manually pinned — click to unpin from the focal window'
                  : 'Not manually pinned — click to pin at full focus (the prompt may still include it automatically; see status)'
              }
            >
              <Pin className={`w-3.5 h-3.5 ${isInContext ? 'fill-current' : ''}`} />
              <span>{isInContext ? 'Pinned' : 'Not pinned'}</span>
            </button>

            {/* COMPUTED state: what the LLM prompt actually contains, and WHY */}
            <span className="text-[11px] font-mono text-[#556985] hidden sm:flex items-center gap-1.5 flex-wrap">
              <span>Prompt:</span>
              <strong className="text-[#a4bddf]">
                {contextTier === 'culled'
                  ? 'excluded'
                  : tierLabels[contextTier]?.name || contextTier}
              </strong>
              {reasonChip && (
                <span
                  className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold uppercase tracking-wide ${reasonChip.cls}`}
                  title={reasonChip.title}
                >
                  {reasonChip.label}
                </span>
              )}
            </span>
          </div>

          {/* Change Detail Level (Resolution Tier Override) */}
          {onChangeTierOverride && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono text-[#556985] mr-1">Force:</span>
              {([3, 2, 1, 0] as ResolutionTier[]).map((t) => {
                const isActive = tierOverride === t;
                return (
                  <button
                    key={t}
                    onClick={() => onChangeTierOverride(artifact.id, t)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-mono transition-all cursor-pointer border ${
                      isActive
                        ? 'bg-[#1d2d47] text-[#e0eeff] font-bold border-[#2d4770]'
                        : 'bg-[#0a0f19] text-[#6b82a3] border-[#131d2e] hover:bg-[#121c2e] hover:text-[#8ab1e0]'
                    }`}
                    title={`Force this artifact to ${tierLabels[t].name} in the compiled context`}
                  >
                    T{t}
                  </button>
                );
              })}
              <button
                onClick={() => onChangeTierOverride(artifact.id, null)}
                className={`px-1.5 py-1 rounded-lg text-[9px] font-mono transition-colors cursor-pointer ${
                  tierOverride == null
                    ? 'bg-[#1d2d47] text-[#e0eeff] font-bold border border-[#2d4770]'
                    : 'text-[#556985] hover:text-[#9bb0d1] border border-transparent'
                }`}
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
            Content
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
          {history.length > 0 && (
            <button
              onClick={() => setActiveTab('history')}
              className={`py-2 px-3 text-xs font-mono border-b-2 transition-colors cursor-pointer ${
                activeTab === 'history'
                  ? 'border-[#38bdf8] text-[#eef4fc] font-semibold'
                  : 'border-transparent text-[#6b82a3] hover:text-[#9bb0d1]'
              }`}
            >
              History ({history.length})
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
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#5ad49b] font-semibold">
                    Tier 3 • Full Markdown Body
                  </span>
                  <div className="flex items-center gap-0.5 bg-[#050810] border border-[#111928] rounded-lg p-0.5 shrink-0">
                    <button
                      onClick={() => setBodyView('rendered')}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors cursor-pointer ${
                        bodyView === 'rendered'
                          ? 'bg-[#1d2d47] text-[#e0eeff] font-semibold'
                          : 'text-[#6b82a3] hover:text-[#9bb0d1]'
                      }`}
                      title="Rendered markdown preview"
                    >
                      Rendered
                    </button>
                    <button
                      onClick={() => setBodyView('raw')}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors cursor-pointer ${
                        bodyView === 'raw'
                          ? 'bg-[#1d2d47] text-[#e0eeff] font-semibold'
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
                      className="md-body bg-[#050810] p-3.5 rounded-lg border border-[#0d1422]"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
                    />
                  ) : (
                    <div className="text-[11px] italic text-[#556985] bg-[#050810] p-3 rounded-lg border border-[#0d1422]">
                      No full body recorded.
                    </div>
                  )
                ) : (
                  <div className="font-mono text-[11px] whitespace-pre-wrap text-[#c4d6ed] bg-[#050810] p-3 rounded-lg border border-[#0d1422] max-h-80 overflow-y-auto">
                    {body || '# No full body recorded.'}
                  </div>
                )}
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

          {activeTab === 'history' && (
            <div className="space-y-2">
              {history.map((h, i) => (
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
            Label · Abstract · Summary · Full
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
