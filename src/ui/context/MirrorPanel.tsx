import React, { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import type { Artifact, ChapterTurns } from '../../types';
import type { Granularity } from '../../domains/granularity';
import { GRANULARITY_LABEL, GRANULARITY_ORDER, cutIncludes } from '../../domains/granularity';
import { estimateTokens } from '../../utils/estimateTokens';
import { computeAmbientColor } from './ambientTelemetry';

/**
 * Mirror v1 (MOBILE_UX_SPEC.md §5): "Show me what the LLM will see."
 *
 * It is the payload, in send order:
 *   1. totals vs ceiling
 *   2. attached artifacts — each at its granularity (the row IS the cut)
 *   3. chapters — each at its granularity, in chat order
 *   4. raw payload (literal compiledPrompt + systemInstruction)
 *
 * The mirror is no longer read-only: granularity is the one knob, and this is
 * where you turn it. There is no pin, no reason badge, no out/culled section —
 * an artifact is attached or it is not in the payload at all.
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
      granularityDistribution?: Record<Granularity, number>;
      /** Compiler's per-artifact numbers — absent only on pre-breakdown payloads. */
      attachmentBreakdown?: Array<{
        artifactId: string;
        title: string;
        granularity: Granularity;
        tokens: number;
      }>;
      /** Compiler's per-chapter numbers — absent only on pre-breakdown payloads. */
      chapterBreakdown?: Array<{
        chapterId: string;
        title: string;
        granularity: Granularity;
        tokens: number;
      }>;
    };
  };
  artifacts: Artifact[];
  /** Chapters with their turns — the shared selector (02-chapter-segmentation/selectors). */
  chapters: ChapterTurns[];
  ceiling: number;
  onSetAttachmentGranularity: (artifactId: string, granularity: Granularity) => void;
  onSetChapterGranularity: (chapterId: string, granularity: Granularity) => void;
  onOpenAttachmentPicker: () => void;
}

/** Four-word control — the only knob. 24px tall: clears the touch rule. */
const GranularityChips: React.FC<{
  value: Granularity;
  onChange: (g: Granularity) => void;
  label: string;
}> = ({ value, onChange, label }) => (
  <div className="flex items-center gap-1">
    {GRANULARITY_ORDER.map((g) => {
      const active = g === value;
      return (
        <button
          key={g}
          onClick={() => onChange(g)}
          aria-label={`${label}: ${GRANULARITY_LABEL[g]}`}
          aria-pressed={active}
          className={`min-h-[24px] px-1.5 py-0.5 rounded text-[10px] border cursor-pointer transition-colors ${
            active
              ? 'border-[#2f4a6b] bg-[#16273c] text-[#9dc2ec]'
              : 'border-[#162132] text-[#5d748f] hover:text-[#8ab1e0]'
          }`}
        >
          {GRANULARITY_LABEL[g]}
        </button>
      );
    })}
  </div>
);

export const MirrorPanel: React.FC<MirrorPanelProps> = ({
  open,
  onClose,
  compiled,
  artifacts,
  chapters,
  ceiling,
  onSetAttachmentGranularity,
  onSetChapterGranularity,
  onOpenAttachmentPicker,
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
  const dist = compiled.telemetry.granularityDistribution;
  const ratio = Math.min(1, tb.totalTokens / Math.max(1, ceiling));
  const color = computeAmbientColor(ratio);

  const byId = new Map(artifacts.map((a) => [a.id, a]));

  // Attachments: exactly the compiler's substrate order. A dangling entry
  // (artifact deleted mid-render) is skipped and simply shows as gone.
  const attachmentRows = (compiled.telemetry.attachmentBreakdown ?? [])
    .map((entry) => ({ entry, artifact: byId.get(entry.artifactId) }))
    .filter((row) => Boolean(row.artifact));

  // Chapters: the compiler's per-chapter entries, keyed back to the selector
  // rows so the row can say what the cut actually contains.
  const chapterById = new Map((compiled.telemetry.chapterBreakdown ?? []).map((e) => [e.chapterId, e]));
  const chapterRows = chapters.map(({ chapter, turns }) => {
    const entry = chapterById.get(chapter.id);
    const granularity: Granularity = chapter.granularity ?? (entry?.granularity ?? 'full');
    // Fallback only for payloads compiled before chapterBreakdown existed.
    const tokens = entry
      ? entry.tokens
      : estimateTokens(
          [
            chapter.title,
            cutIncludes(granularity, 'description') ? chapter.description : '',
            cutIncludes(granularity, 'summary') ? chapter.summary : '',
            cutIncludes(granularity, 'body')
              ? turns.map((t) => t.content).join('\n\n')
              : '',
          ]
            .filter(Boolean)
            .join('\n\n')
        );
    return { chapter, granularity, tokens, turnCount: turns.length };
  });

  const cutSummary = (g: Granularity, turnCount: number): string => {
    const parts = ['title'];
    if (cutIncludes(g, 'description')) parts.push('description');
    if (cutIncludes(g, 'summary')) parts.push('summary');
    if (cutIncludes(g, 'body')) parts.push(`${turnCount} turn${turnCount === 1 ? '' : 's'} verbatim`);
    return parts.join(' + ');
  };

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
              <span style={{ color: color.hex }}>
                <span className="text-[#556985]">est.</span> {tb.totalTokens.toLocaleString()} / {ceiling.toLocaleString()} tok
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[#0a0f18] overflow-hidden border border-[#131d2e]">
              <div className="h-full rounded-full transition-all" style={{ width: `${ratio * 100}%`, backgroundColor: color.hex }} />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#8297b5]">
              <span>system {tb.systemTokens}</span>
              <span>artifacts {tb.substrateTokens}</span>
              <span>chapters {tb.historyTokens}</span>
            </div>
            {dist && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#556985]">
                <span className="text-[#e05a66]">■ full {dist.full}</span>
                <span className="text-[#e0b96c]">■ summary {dist.summary}</span>
                <span className="text-[#5ad49b]">■ description {dist.description}</span>
                <span className="text-[#5d87b8]">■ title {dist.title}</span>
              </div>
            )}
          </section>

          {/* 2 · Attachments */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-[#6b82a3]">2 · Attached artifacts</span>
              <button
                onClick={onOpenAttachmentPicker}
                title="Attach an artifact to this chat"
                className="flex items-center gap-1 min-h-[24px] px-2 rounded border border-[#1d2d44] text-[10px] text-[#8ab1e0] hover:bg-[#162132] cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Attach
              </button>
            </div>
            {attachmentRows.length === 0 && (
              <p className="text-[#4f5f78]">
                Nothing attached — this chat sends its chapters only.
              </p>
            )}
            {attachmentRows.map(({ entry, artifact }) => (
              <div key={entry.artifactId} className="py-1.5 border-b border-[#0e1522] last:border-0 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[#cad8eb]">{artifact!.title}</span>
                  <span className="text-[10px] text-[#556985] shrink-0">{entry.tokens} tok</span>
                </div>
                <GranularityChips
                  value={entry.granularity}
                  label={`Granularity for ${artifact!.title}`}
                  onChange={(g) => onSetAttachmentGranularity(entry.artifactId, g)}
                />
              </div>
            ))}
          </section>

          {/* 3 · Chapters — send order */}
          <section className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-[#6b82a3]">3 · Chapters, in send order</div>
            {chapterRows.map((c, i) => (
              <div key={c.chapter.id} className="py-1.5 border-b border-[#0e1522] last:border-0 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] text-[#4f5f78] mr-1.5">{i + 1}.</span>
                    <span className="text-[#cad8eb]">{c.chapter.title}</span>
                    <div className="text-[10px] text-[#556985] ml-5">{cutSummary(c.granularity, c.turnCount)}</div>
                  </div>
                  <span className="text-[10px] text-[#8297b5] shrink-0 mt-0.5">{c.tokens} tok</span>
                </div>
                <GranularityChips
                  value={c.granularity}
                  label={`Granularity for chapter ${c.chapter.title}`}
                  onChange={(g) => onSetChapterGranularity(c.chapter.id, g)}
                />
              </div>
            ))}
          </section>

          {/* 4 · Raw payload — the literal 1:1 */}
          <section className="space-y-1.5">
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="flex items-center gap-1 min-h-[24px] text-[10px] uppercase tracking-wider text-[#6b82a3] hover:text-[#8ab1e0] cursor-pointer"
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
