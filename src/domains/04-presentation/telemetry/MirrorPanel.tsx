import React, { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import { Artifact, Chapter } from '../../../types';
import { estimateTokens, getArtifactTokenVariants } from '../../../utils/tokenCalculator';
import { computeAmbientColor } from './ambientTelemetry';

/**
 * Mirror v1 (MOBILE_UX_SPEC.md §5): "Show me what the LLM will see."
 * One panel, opened by tapping the orb:
 *   1. totals vs ceiling (the orb's stats — first brick)
 *   2. notes in context, tier + tokens (knowledge_substrate order)
 *   3. chapters in send order with token counts (full turns vs summary,
 *      exactly how 03-optical-compiler will emit them)
 *   4. raw payload — the literal compiledPrompt + systemInstruction (1:1)
 */
interface MirrorPanelProps {
  open: boolean;
  onClose: () => void;
  compiled: {
    compiledPrompt: string;
    systemInstruction: string;
    telemetry: {
      tokenBreakdown: {
        systemTokens: number;
        substrateTokens: number;
        historyTokens: number;
        totalTokens: number;
      };
      nodeDistribution: {
        tier3Count: number;
        tier2Count: number;
        tier1Count: number;
        tier0Count: number;
        culledCount: number;
      };
    };
    nodeTiers: Record<string, { tier: number | 'culled'; distance: number }>;
  };
  artifacts: Artifact[];
  chapters: Chapter[];
  ceiling: number;
}

const TIER_LABEL: Record<string, string> = {
  3: 'Full',
  2: 'Summary',
  1: 'Abstract',
  0: 'Label',
  culled: 'Out',
};
const TIER_CLASS: Record<string, string> = {
  3: 'text-[#e05a66]',
  2: 'text-[#e0b96c]',
  1: 'text-[#5ad49b]',
  0: 'text-[#5d87b8]',
  culled: 'text-[#4f5f78]',
};

export const MirrorPanel: React.FC<MirrorPanelProps> = ({
  open,
  onClose,
  compiled,
  artifacts,
  chapters,
  ceiling,
}) => {
  const [showRaw, setShowRaw] = useState(false);

  // Close on Escape — consistent with ArtifactDetailModal/ExportModal/ImportModal.
  // Guarded because this panel stays mounted while closed.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const tb = compiled.telemetry.tokenBreakdown;
  const dist = compiled.telemetry.nodeDistribution;
  const ratio = Math.min(1, tb.totalTokens / Math.max(1, ceiling));
  const color = computeAmbientColor(ratio);

  // Notes: exactly the substrate order — culled excluded, counted out
  const inContext = artifacts.filter((a) => {
    const t = compiled.nodeTiers[a.id]?.tier;
    return t !== undefined && t !== 'culled';
  });
  const outCount = artifacts.length - inContext.length;

  // Chapters: same rule as 03-optical-compiler — active/last = full turns,
  // completed = summary only
  const chapterRows = chapters.map((c, i) => {
    const isOngoing = c.status === 'active' || i === chapters.length - 1;
    const tokens = isOngoing
      ? c.messages.reduce((n, m) => n + estimateTokens(m.content), 0)
      : estimateTokens(c.summary || `Recap of ${c.title}.`);
    return { id: c.id, title: c.title, isOngoing, tokens, turns: c.messages.length, summary: c.summary };
  });

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0e17]/85 backdrop-blur-sm flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-[#101724] border border-[#080d15] rounded-2xl max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl text-[#e3edf7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-[#080d15] flex items-center justify-between shrink-0 bg-[#0d131f] rounded-t-2xl">
          <div>
            <h2 className="text-sm font-bold font-mono">What the LLM will see</h2>
            <p className="text-[10px] text-[#6b82a3] font-mono mt-0.5">Mirror · same order, same contents</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#162132] cursor-pointer" title="Close mirror">
            <X className="w-4 h-4 text-[#8ab1e0]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-mono">
          {/* 1 · Totals */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-[#6b82a3]">1 · Payload</span>
              <span style={{ color: color.hex }}>{tb.totalTokens.toLocaleString()} / {ceiling.toLocaleString()} tok</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#0a0f18] overflow-hidden border border-[#131d2e]">
              <div className="h-full rounded-full transition-all" style={{ width: `${ratio * 100}%`, backgroundColor: color.hex }} />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#8297b5]">
              <span>system {tb.systemTokens}</span>
              <span>notes {tb.substrateTokens}</span>
              <span>chapters {tb.historyTokens}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#556985]">
              <span className="text-[#e05a66]">■ full {dist.tier3Count}</span>
              <span className="text-[#e0b96c]">■ summary {dist.tier2Count}</span>
              <span className="text-[#5ad49b]">■ abstract {dist.tier1Count}</span>
              <span className="text-[#5d87b8]">■ label {dist.tier0Count}</span>
              <span className="text-[#4f5f78]">■ out {dist.culledCount}</span>
            </div>
          </section>

          {/* 2 · Notes (knowledge_substrate) */}
          <section className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-[#6b82a3]">2 · Notes in context</div>
            {inContext.length === 0 && <p className="text-[#4f5f78]">No notes in context.</p>}
            {inContext.map((a) => {
              const tier = compiled.nodeTiers[a.id]?.tier ?? 'culled';
              const v = getArtifactTokenVariants(a);
              const tokens =
                tier === 3 ? v.full : tier === 2 ? v.summary : tier === 1 ? v.description : v.title;
              return (
                <div key={a.id} className="flex items-center justify-between gap-2 py-0.5 border-b border-[#0e1522] last:border-0">
                  <span className="truncate text-[#cad8eb]">{a.title}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] ${TIER_CLASS[String(tier)]}`}>{TIER_LABEL[String(tier)]}</span>
                    <span className="text-[10px] text-[#556985] w-12 text-right">{tokens} tok</span>
                  </span>
                </div>
              );
            })}
            {outCount > 0 && <p className="text-[10px] text-[#4f5f78]">{outCount} note{outCount === 1 ? '' : 's'} out of context</p>}
          </section>

          {/* 3 · Chapters (conversation_chapters) — send order */}
          <section className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-[#6b82a3]">3 · Chapters, in send order</div>
            {chapterRows.map((c, i) => (
              <div key={c.id} className="flex items-start justify-between gap-2 py-1 border-b border-[#0e1522] last:border-0">
                <div className="min-w-0">
                  <span className="text-[10px] text-[#4f5f78] mr-1.5">{i + 1}.</span>
                  <span className="text-[#cad8eb]">{c.title}</span>
                  <div className="text-[10px] text-[#556985] ml-5">
                    {c.isOngoing
                      ? `full · ${c.turns} turn${c.turns === 1 ? '' : 's'} verbatim`
                      : c.summary
                        ? 'summary only'
                        : 'summary (recap fallback)'}
                  </div>
                </div>
                <span className="text-[10px] text-[#8297b5] shrink-0 mt-0.5">{c.tokens} tok</span>
              </div>
            ))}
          </section>

          {/* 4 · Raw payload — the literal 1:1 */}
          <section className="space-y-1.5">
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#6b82a3] hover:text-[#8ab1e0] cursor-pointer"
            >
              {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              4 · Raw payload (literal)
            </button>
            {showRaw && (
              <div className="space-y-2">
                <pre className="bg-[#050810] p-2.5 rounded-xl border border-[#0e1624] text-[10px] text-[#86a2c9] overflow-x-auto max-h-48 whitespace-pre-wrap break-words">
{compiled.systemInstruction}
                </pre>
                <pre className="bg-[#050810] p-2.5 rounded-xl border border-[#0e1624] text-[10px] text-[#86a2c9] overflow-x-auto max-h-64 whitespace-pre-wrap break-words">
{compiled.compiledPrompt}
                </pre>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
