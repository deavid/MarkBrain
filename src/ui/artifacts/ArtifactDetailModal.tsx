import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Artifact } from '../../types';
import type { Granularity } from '../../domains/granularity';
import { GRANULARITY_LABEL, GRANULARITY_ORDER, getGranularityChipClass } from '../../domains/granularity';
import {
  X,
  FileCode,
  Pin,
  Plus,
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
  /**
   * This artifact's attachment to the ACTIVE chat, or null when it is not
   * attached. Granularity lives on the attachment (per chat) — never on the
   * artifact. `staged` = armed for the next send (removable); a committed
   * attachment is history and only its granularity stays steerable.
   */
  attachmentGranularity: Granularity | null;
  attachmentStaged?: boolean;
  onAttach: (artifactId: string) => void;
  onUnstage?: (artifactId: string) => void;
  onSetAttachmentGranularity: (artifactId: string, granularity: Granularity) => void;
  /** Version history from the versioning domain (source of truth — artifacts no longer embed history) */
  history?: Array<{ version: number; timestamp: number; changeSummary: string }>;
}

export const ArtifactDetailModal: React.FC<ArtifactDetailModalProps> = ({
  artifact,
  onClose,
  attachmentGranularity,
  attachmentStaged = false,
  onAttach,
  onUnstage,
  onSetAttachmentGranularity,
  history = [],
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

  const title = artifact.title || artifact.title || artifact.id;
  const description = artifact.current?.description || '';
  const summary = artifact.current?.summary || '';
  const body = artifact.current?.body || '';
  const artColor = artifact.color || '#5d87b8';

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

        {/* Attachment toolbar — the ONLY context control, and it belongs to
            THIS chat. Three states: not in chat (stage it), staged (rides the
            next send, removable), committed (on a turn — no detach, only the
            cut). */}
        <div className="p-3 bg-[#080d16] border-b border-[#131d2f] flex flex-wrap items-center justify-between gap-2.5">
          {attachmentGranularity === null ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => onAttach(artifact.id)}
                data-testid="attach-from-detail"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-medium border bg-[#0a1a22] border-[#0e7490]/50 text-[#67e8f9] hover:border-[#67e8f9] transition-colors cursor-pointer"
                title="Stage this artifact for the next message"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Stage for next message</span>
              </button>
              <span className="text-[11px] font-mono text-[#556985]">
                Not in this chat&apos;s payload.
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[11px] font-mono ${attachmentStaged ? 'text-[#67e8f9]' : 'text-[#556985]'}`}
                >
                  {attachmentStaged ? 'Staged for next send ·' : 'In this chat at'}
                </span>
                <strong className="text-[11px] font-mono text-[#a4bddf]">
                  {GRANULARITY_LABEL[attachmentGranularity]}
                </strong>
                {attachmentStaged && (
                  <button
                    onClick={() => onUnstage?.(artifact.id)}
                    data-testid="unstage-from-detail"
                    className="min-h-[24px] px-2 rounded-lg text-[10px] font-mono bg-[#0a1a22] border border-[#0e7490]/50 text-[#67e8f9] hover:border-[#67e8f9] cursor-pointer"
                    title="Remove from the next send (still staged, not sent)"
                  >
                    Unstage
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-mono text-[#556985] mr-1">Send:</span>
                {GRANULARITY_ORDER.map((g) => {
                  const isActive = attachmentGranularity === g;
                  return (
                    <button
                      key={g}
                      onClick={() => onSetAttachmentGranularity(artifact.id, g)}
                      data-granularity={g}
                      className={`min-h-[24px] px-2 rounded-lg text-[10px] font-mono transition-all cursor-pointer border ${getGranularityChipClass(g, isActive)}`}
                    >
                      {GRANULARITY_LABEL[g]}
                    </button>
                  );
                })}
              </div>
            </>
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
            Layers & YAML
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
              {/* Description layer */}
              {description && (
                <div className="p-3 rounded-xl bg-[#0e1626] border border-[#16233a] space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#8ab1e0] font-semibold block">
                    Description
                  </span>
                  <p className="text-[#b5cae6] text-[11px] leading-relaxed">{description}</p>
                </div>
              )}

              {/* Summary */}
              {summary && (
                <div className="p-3 rounded-xl bg-[#0e1626] border border-[#16233a] space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#e0b96c] font-semibold block">
                    Summary
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
                    Body
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
            Title · Description · Summary · Full
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
