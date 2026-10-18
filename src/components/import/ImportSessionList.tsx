import React, { useState, useEffect } from 'react';
import { serializeArtifactToYamlDoc } from '../../utils/yamlArtifactParser';
import { estimateTokens } from '../../utils/tokenCalculator';
import { ImportRow } from './useImportSession';
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  X,
  ArrowRight,
  Sparkles,
  ChevronDown,
  Trash2,
} from 'lucide-react';

interface ImportSessionListProps {
  rows: ImportRow[];
  running: boolean;
  onRetry: (rowId: string) => void;
  onDismiss: (rowId: string) => void;
  onCancelRemaining: () => void;
  onOpenArtifact: (artifactId: string) => void;
  onParentOverride: (rowId: string, value: string) => void;
}

const STATUS_DOT: Record<ImportRow['status'], { color: string; label: string }> = {
  queued: { color: 'bg-[#627794]', label: 'queued' },
  extracting: { color: 'bg-[#8ab1e0]', label: 'extracting' },
  landed: { color: 'bg-emerald-400', label: 'landed' },
  failed: { color: 'bg-red-400', label: 'failed' },
  canceled: { color: 'bg-[#3a4a63]', label: 'canceled' },
};

export const ImportSessionList: React.FC<ImportSessionListProps> = ({
  rows,
  running,
  onRetry,
  onDismiss,
  onCancelRemaining,
  onOpenArtifact,
  onParentOverride,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'fields' | 'raw_yaml'>('fields');
  // Two-step remove: first tap arms (red circle), second tap dismisses the row.
  // Auto-disarms so a stray click never leaves a hot trashcan around.
  const [armedId, setArmedId] = useState<string | null>(null);

  useEffect(() => {
    if (!armedId) return;
    const t = setTimeout(() => setArmedId(null), 2600);
    return () => clearTimeout(t);
  }, [armedId]);

  if (rows.length === 0) return null;

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.status] += 1;
      acc.words += r.words;
      return acc;
    },
    { queued: 0, extracting: 0, landed: 0, failed: 0, canceled: 0, words: 0 }
  );
  const pending = counts.queued + counts.extracting;
  const tokens = rows.reduce((sum, r) => sum + estimateTokens(r.content), 0);

  const toggle = (id: string) => {
    setExpandedId((cur) => (cur === id ? null : id));
    setPreviewMode('fields');
  };

  return (
    <div className="space-y-2">
      {/* Session summary bar — size awareness, no ceremony */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#102419] border border-[#0d2a1b] rounded-xl text-[10px] font-mono">
        <span className="text-[#6ee7b7]">
          {rows.length} file{rows.length === 1 ? '' : 's'} · {counts.landed} landed
          {counts.failed > 0 ? ` · ${counts.failed} failed` : ''}
          {counts.canceled > 0 ? ` · ${counts.canceled} canceled` : ''}
          {pending > 0 ? ` · ${pending} pending` : ''} · {counts.words} words · ~{tokens} tokens
        </span>
        {counts.queued > 0 && (
          <button
            type="button"
            onClick={onCancelRemaining}
            className="shrink-0 px-2 py-0.5 rounded bg-[#1e2a3f] hover:bg-[#2a3b58] text-[#8ab1e0] transition-colors cursor-pointer"
          >
            Cancel queued
          </button>
        )}
      </div>

      {/* Rows */}
      <div className="space-y-1.5">
        {rows.map((row) => {
          const dot = STATUS_DOT[row.status];
          const isExpanded = expandedId === row.id;
          const isBusyExtracting = row.status === 'extracting';
          return (
            <div
              key={row.id}
              className="bg-[#0d121c] border border-[#080d15] rounded-xl overflow-hidden"
            >
              {/* Row header — click to inspect */}
              <div
                onClick={() => row.status !== 'extracting' && toggle(row.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && row.status !== 'extracting') {
                    e.preventDefault();
                    toggle(row.id);
                  }
                }}
                className={`flex items-center gap-2.5 px-3 py-2 ${
                  row.status !== 'extracting'
                    ? 'cursor-pointer hover:bg-[#131b29]'
                    : 'cursor-default'
                } transition-colors`}
              >
                {/* Disclosure chevron — ▼ collapsed, flips to ▲ when expanded */}
                {row.status !== 'extracting' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(row.id);
                    }}
                    title={isExpanded ? 'Hide details' : 'Show details'}
                    aria-label={isExpanded ? 'Hide details' : 'Show details'}
                    className="shrink-0 p-0.5 rounded hover:bg-[#1a2538] text-[#627794] hover:text-[#9bb0d1] cursor-pointer"
                  >
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
                <span className={`w-2 h-2 rounded-full shrink-0 ${dot.color} ${isBusyExtracting ? 'animate-pulse' : ''}`} />
                <span className="text-[11px] font-mono text-[#c2d1e0] truncate flex-1 min-w-0">
                  {row.fileName}
                </span>
                {/* Two-step remove — left of the lane badge, per UX review */}
                {(row.status === 'landed' || row.status === 'failed' || row.status === 'canceled') && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (armedId === row.id) {
                        onDismiss(row.id);
                        setArmedId(null);
                      } else {
                        setArmedId(row.id);
                      }
                    }}
                    title={
                      armedId === row.id
                        ? 'Click again to remove this row (the artifact stays in the workspace)'
                        : 'Remove from list — first click arms, second click confirms (artifacts stay in the workspace)'
                    }
                    aria-label="Remove row"
                    className={`shrink-0 p-1 rounded-full cursor-pointer transition-colors ${
                      armedId === row.id
                        ? 'bg-red-500/25 text-red-400 ring-1 ring-red-500/60'
                        : 'text-[#627794] hover:text-[#869ab8] hover:bg-[#1a2538]'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                {row.lane && (
                  <span
                    className={`shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                      row.lane === 'frontmatter'
                        ? 'bg-[#0d2a1b] border-[#143a26] text-[#6ee7b7]'
                        : 'bg-[#142033] border-[#080d15] text-[#8ab1e0]'
                    }`}
                    title={
                      row.lane === 'frontmatter'
                        ? 'Frontmatter found — landed instantly, no model call'
                        : 'No frontmatter — Gemini extraction lane'
                    }
                  >
                    {row.lane === 'frontmatter' ? 'yaml ⚡' : 'gemini'}
                  </span>
                )}
                {row.flag && (
                  <span
                    className="shrink-0 max-w-[150px] truncate text-[9px] font-mono px-1.5 py-0.5 rounded border bg-[#2a1f0d] border-[#4a3a16] text-[#f0c674]"
                    title={`Flagged as ${row.flag.type} of “${row.flag.targetTitle}” (${row.flag.reason}) — auto-linked for post-import triage; nothing was overwritten`}
                  >
                    ⚑ → {row.flag.targetTitle}
                  </span>
                )}
                <span className="shrink-0 text-[9px] font-mono text-[#5f7491]">
                  {row.words > 0 ? `${row.words}w` : ''}
                </span>
                <span className={`shrink-0 text-[9px] font-mono ${row.status === 'landed' ? 'text-emerald-400' : row.status === 'failed' ? 'text-red-400' : isBusyExtracting ? 'text-[#8ab1e0]' : 'text-[#627794]'}`}>
                  {dot.label}
                </span>
              </div>

              {/* In-place inspector — never a second modal (single-modal rule) */}
              {isExpanded && (
                <div className="border-t border-[#080d15] px-3 py-2.5 space-y-2 bg-[#0a0e17]/60">
                  {/* Phase-4 per-row parent override — any non-landed status (retry path matters). */}
                  {row.status !== 'landed' && (
                    <input
                      type="text"
                      placeholder="Parent override (slug) — beats frontmatter & batch at land…"
                      value={row.parentOverride || ''}
                      onChange={(e) => onParentOverride(row.id, e.target.value)}
                      className="w-full bg-[#141b29] border border-[#080d15] rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-[#8ab1e0] focus:outline-none focus:border-[#e05a66]/50"
                    />
                  )}

                  {row.status === 'failed' && (
                    <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#f7aab3] bg-[#261317] border border-[#3d161d] rounded-lg p-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{row.error || 'Import failed'}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onRetry(row.id)}
                        className="shrink-0 px-2 py-0.5 rounded bg-[#1e2a3f] hover:bg-[#2a3b58] text-[#8ab1e0] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Retry</span>
                      </button>
                    </div>
                  )}

                  {row.status === 'canceled' && (
                    <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#7d93b3]">
                      <span>Canceled before processing.</span>
                      <button
                        type="button"
                        onClick={() => onRetry(row.id)}
                        className="px-2 py-0.5 rounded bg-[#1e2a3f] hover:bg-[#2a3b58] text-[#8ab1e0] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Queue again</span>
                      </button>
                    </div>
                  )}

                  {row.status === 'landed' && row.artifact ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono text-[#e05a66] uppercase font-bold inline-flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          Landed artifact
                        </span>
                        <div className="flex items-center gap-2">
                          <div className="flex bg-[#141b29] p-0.5 rounded-lg border border-[#080d15] text-[10px] font-mono">
                            <button
                              type="button"
                              onClick={() => setPreviewMode('fields')}
                              className={`px-2 py-0.5 rounded transition-colors ${
                                previewMode === 'fields' ? 'bg-[#e05a66] text-white' : 'text-[#7d93b3]'
                              }`}
                            >
                              Fields
                            </button>
                            <button
                              type="button"
                              onClick={() => setPreviewMode('raw_yaml')}
                              className={`px-2 py-0.5 rounded transition-colors ${
                                previewMode === 'raw_yaml' ? 'bg-[#e05a66] text-white' : 'text-[#7d93b3]'
                              }`}
                            >
                              Raw YAML+MD
                            </button>
                          </div>
                          {row.artifactId && (
                            <button
                              type="button"
                              onClick={() => onOpenArtifact(row.artifactId!)}
                              className="px-2 py-1 rounded bg-[#1e2a3f] hover:bg-[#2a3b58] text-[#8ab1e0] text-[10px] font-mono inline-flex items-center gap-1 cursor-pointer"
                              title="Open the full artifact modal for editing"
                            >
                              <span>Open full artifact</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {previewMode === 'raw_yaml' ? (
                        <pre className="bg-[#090d14] p-3 rounded-lg border border-[#080d15] text-[11px] font-mono text-[#cbd5e1] max-h-72 overflow-y-auto whitespace-pre-wrap">
                          {serializeArtifactToYamlDoc(row.artifact)}
                        </pre>
                      ) : (
                        <div className="space-y-2">
                          <div className="text-xs font-mono text-[#eef4fc] font-semibold">
                            {row.artifact.title}
                          </div>
                          {row.artifact.current?.t1_abstract && (
                            <div className="text-[11px] text-[#8297b5]">
                              {row.artifact.current.t1_abstract}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1.5">
                            {(row.artifact.tags || []).map((tag) => (
                              <span
                                key={tag}
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#1e2a3f] text-[#8ab1e0] border border-[#080d15]"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                          <pre className="bg-[#090d14] p-2.5 rounded-lg border border-[#080d15] text-[11px] font-mono text-[#9bb0d1] max-h-56 overflow-y-auto whitespace-pre-wrap">
                            {(row.artifact.current?.t3_body || '').slice(0, 4000)}
                            {(row.artifact.current?.t3_body || '').length > 4000 ? '\n…' : ''}
                          </pre>
                        </div>
                      )}
                    </>
                  ) : (
                    row.status !== 'failed' &&
                    row.status !== 'canceled' && (
                      <pre className="bg-[#090d14] p-2.5 rounded-lg border border-[#080d15] text-[11px] font-mono text-[#5f7491] max-h-48 overflow-y-auto whitespace-pre-wrap">
                        {row.content.slice(0, 2000)}
                        {row.content.length > 2000 ? '\n…' : ''}
                      </pre>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {running && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-[#8ab1e0] px-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>
            {counts.extracting > 0
              ? 'Gemini extracting… one at a time — add more files any time.'
              : 'Processing queue… add more files any time.'}
          </span>
        </div>
      )}
    </div>
  );
};