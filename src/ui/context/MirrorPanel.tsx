import React, { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronUp, Plus, Maximize2, Minimize2, Copy, Check } from 'lucide-react';
import type { Artifact, ChapterTurns } from '../../types';
import type { ChatAttachment } from '../../domains/06-chat-threads';
import { isAttachmentStaged } from '../../domains/06-chat-threads';
import type { Granularity } from '../../domains/granularity';
import { cutIncludes } from '../../domains/granularity';
import { estimateTokens } from '../../utils/estimateTokens';
import { saturationFillFraction } from '../../utils/contextWindow';
import { renderMarkdown } from '../../utils/markdown';
import { ATTACHMENT_STATE_PALETTE } from '../../domains/granularity';
import { computeAmbientColor } from './ambientTelemetry';
import {
  AttachmentRow,
  GranularityChips,
  formatAttachmentProvenance,
} from './AttachmentControls';

/**
 * The mirror: show me what the model will see, in send order — totals against
 * the window, attachments (each at its cut), chapters (each at its cut), then
 * the literal system instruction and compiled payload as separate tabs with a
 * full-screen mode, because a 73k-token prompt cannot be read in a 448px column.
 *
 * The fill curve is the same cube-root the rail uses: on a 1M window a linear
 * bar reads empty until the very end, and the whole point of the mirror is that
 * you can SEE the pressure building.
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
        /** true = staged for the next send (not welded to a turn yet). */
        staged?: boolean;
        turnIndex?: number | null;
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
  chapters: ChapterTurns[];
  ceiling: number;
  attachments: ChatAttachment[];
  onSetAttachmentGranularity: (artifactId: string, granularity: Granularity) => void;
  onSetChapterGranularity: (chapterId: string, granularity: Granularity) => void;
  onOpenArtifacts: () => void;
  onUnstageAttachment: (artifactId: string) => void;
  onOpenArtifact?: (artifactId: string) => void;
}

type MirrorTab = 'artifacts' | 'chapters' | 'system' | 'payload';

const TABS: Array<{ id: MirrorTab; label: string }> = [
  { id: 'artifacts', label: 'Attached artifacts' },
  { id: 'chapters', label: 'Chapters, in send order' },
  { id: 'system', label: 'System Message' },
  { id: 'payload', label: 'Raw payload' },
];

export const MirrorPanel: React.FC<MirrorPanelProps> = ({
  open,
  onClose,
  compiled,
  artifacts,
  chapters,
  ceiling,
  attachments,
  onSetAttachmentGranularity,
  onSetChapterGranularity,
  onOpenArtifacts,
  onUnstageAttachment,
  onOpenArtifact,
}) => {
  const [activeTab, setActiveTab] = useState<MirrorTab>('artifacts');
  const [fullscreen, setFullscreen] = useState(false);
  const [systemRaw, setSystemRaw] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        setTimeout(() => setCopied(null), 1600);
      },
      () => setCopied(null)
    );
  };

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
  // One curve for both readings: bar width AND its colour. A linear 1M-budget
  // threshold would only warn at 500k, which is one send too late.
  const colorRatio = saturationFillFraction(tb.totalTokens, ceiling);
  const ambient = computeAmbientColor(colorRatio);

  const byId = new Map(artifacts.map((a) => [a.id, a]));

  // Attachments: exactly the compiler's substrate order. A dangling entry
  // (artifact deleted mid-render) is skipped and simply shows as gone.
  const attachmentRows = (compiled.telemetry.attachmentBreakdown ?? [])
    .map((entry) => ({ entry, artifact: byId.get(entry.artifactId) }))
    .filter((row) => Boolean(row.artifact));

  // Staged rows ride the next send (removable); committed rows are history.
  // Read the live attachment list when the telemetry predates the staged flag.
  const stagedIds = new Set(attachments.filter(isAttachmentStaged).map((a) => a.artifactId));
  const stagedRows = attachmentRows.filter(
    ({ entry }) => entry.staged === true || stagedIds.has(entry.artifactId)
  );
  const committedRows = attachmentRows.filter(
    ({ entry }) => entry.staged !== true && !stagedIds.has(entry.artifactId)
  );

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

  const tabCount = (id: MirrorTab): string => {
    if (id === 'artifacts') return `${attachmentRows.length}`;
    if (id === 'chapters') return `${chapterRows.length}`;
    if (id === 'system') return `${tb.systemTokens} tok`;
    return `${tb.substrateTokens + tb.historyTokens} tok`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-surface-0/85 backdrop-blur-sm flex items-center justify-center p-3" onClick={onClose}>
      <div
        className={`bg-surface-2 flex flex-col shadow-pop text-ink transition-all duration-150 ${
          fullscreen
            ? 'w-screen h-screen rounded-none max-w-none'
            : 'max-w-2xl w-full max-h-[88vh] rounded-2xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 flex items-center justify-between shrink-0 bg-surface-3 rounded-t-2xl">
          <div>
            <h2 className="text-sm font-bold font-mono">What the LLM will see</h2>
            <p className="text-[10px] text-[#6b82a3] font-mono mt-0.5">Mirror · same order, same contents</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setFullscreen(!fullscreen)}
              className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-4 text-[#869ab8] hover:text-ink transition-colors cursor-pointer"
              title={fullscreen ? 'Restore standard view' : 'Maximize to whole screen'}
            >
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-3 cursor-pointer" title="Close mirror">
              <X className="w-4 h-4 text-[#8ab1e0]" />
            </button>
          </div>
        </div>

        {/* 1 · Payload — always on screen, whatever tab you are reading. */}
        <div className="px-4 pt-3 shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-[#6b82a3]">1 · Payload</span>
            <span style={{ color: ambient.hex }}>
              <span className="text-[#556985]">est.</span> {tb.totalTokens.toLocaleString()} / {ceiling.toLocaleString()} tok
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-0 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              data-mirror-fill-pct={colorRatio * 100}
              style={{ width: `${colorRatio * 100}%`, backgroundColor: ambient.hex }}
            />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#8297b5]">
            <span>system {tb.systemTokens}</span>
            <span>artifacts {tb.substrateTokens}</span>
            <span>chapters {tb.historyTokens}</span>
          </div>
          {dist && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#556985]">
              <span style={{ color: ATTACHMENT_STATE_PALETTE.full.hex }}>■ full {dist.full}</span>
              <span style={{ color: ATTACHMENT_STATE_PALETTE.summary.hex }}>■ summary {dist.summary}</span>
              <span style={{ color: ATTACHMENT_STATE_PALETTE.description.hex }}>■ description {dist.description}</span>
              <span style={{ color: ATTACHMENT_STATE_PALETTE.title.hex }}>■ title {dist.title}</span>
            </div>
          )}
        </div>

        <div className="px-4 pt-3 shrink-0 p-1 bg-recess-1 shadow-well rounded-xl flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`mirror-tab-${tab.id}`}
              className={`flex items-center gap-1 min-h-[28px] px-2.5 rounded-lg text-[10px] font-mono transition-colors cursor-pointer ${
                activeTab === tab.id ? 'bg-veil-2 shadow-lift text-ink' : 'text-[#5d7394] hover:text-ink-dim'
              }`}
            >
              {tab.label}
              <span className="text-[9px] text-[#556985]">{tabCount(tab.id)}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs font-mono">
          {activeTab === 'artifacts' && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#6b82a3]">Attached artifacts</span>
                <button
                  onClick={onOpenArtifacts}
                  title="Open the library to attach artifacts"
                  data-testid="mirror-attach"
                  className="flex items-center gap-1 min-h-[24px] px-2 rounded-md text-[10px] text-ink-dim hover:text-ink hover:bg-surface-3 transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Attach
                </button>
              </div>
              {attachmentRows.length === 0 && (
                <p className="text-[#4f5f78]">Nothing attached — this chat sends its chapters only.</p>
              )}
              {stagedRows.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[9px] uppercase tracking-wider text-[#67e8f9]">
                    Next send — removable until you hit Send
                  </div>
                  {stagedRows.map(({ entry, artifact }) => (
                    <AttachmentRow
                      key={entry.artifactId}
                      artifactId={entry.artifactId}
                      state="staged"
                      title={artifact!.title}
                      subtitle={artifact!.current?.subtitle || artifact!.current?.description || ''}
                      tokens={entry.tokens}
                      granularity={entry.granularity}
                      badge="next send"
                      onSetGranularity={(g: Granularity) => onSetAttachmentGranularity(entry.artifactId, g)}
                      onUnstage={() => onUnstageAttachment(entry.artifactId)}
                      onOpenDetail={onOpenArtifact ? () => onOpenArtifact(entry.artifactId) : undefined}
                    />
                  ))}
                </div>
              )}
              {committedRows.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[9px] uppercase tracking-wider text-[#6b82a3]">
                    In the chat — no detach, granularity only
                  </div>
                  {committedRows.map(({ entry, artifact }) => (
                    <AttachmentRow
                      key={entry.artifactId}
                      artifactId={entry.artifactId}
                      state={entry.granularity}
                      title={artifact!.title}
                      subtitle={artifact!.current?.subtitle || artifact!.current?.description || ''}
                      tokens={entry.tokens}
                      badge={formatAttachmentProvenance(entry.turnIndex)?.badge}
                      granularity={entry.granularity}
                      onSetGranularity={(g: Granularity) => onSetAttachmentGranularity(entry.artifactId, g)}
                      onOpenDetail={onOpenArtifact ? () => onOpenArtifact(entry.artifactId) : undefined}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'chapters' && (
            <section className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-[#6b82a3]">Chapters, in send order</div>
              {chapterRows.length === 0 && <p className="text-[#4f5f78]">This chat has no chapters yet.</p>}
              {chapterRows.map((c, i) => (
                <div key={c.chapter.id} className="py-1.5 space-y-1">
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
          )}

          {activeTab === 'system' && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#6b82a3]">
                  System message ({tb.systemTokens} tok)
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSystemRaw(!systemRaw)}
                    className="min-h-[24px] px-2 rounded text-[10px] text-ink-dim hover:text-ink hover:bg-surface-3 cursor-pointer"
                  >
                    {systemRaw ? 'Rendered' : 'Raw'}
                  </button>
                  <button
                    onClick={() => copy('system', compiled.systemInstruction)}
                    className="min-h-[24px] px-2 rounded text-[10px] text-ink-dim hover:text-ink hover:bg-surface-3 inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copied === 'system' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied === 'system' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              {systemRaw ? (
                <pre className="bg-surface-0 p-3 rounded-lg text-[12px] text-[#86a2c9] overflow-x-auto whitespace-pre-wrap break-words">
{compiled.systemInstruction}
                </pre>
              ) : (
                <div
                  className="md-body bg-surface-0 p-3 rounded-lg"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(compiled.systemInstruction) }}
                />
              )}
            </section>
          )}

          {activeTab === 'payload' && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#6b82a3]">
                  Raw payload (compiled prompt · {(tb.substrateTokens + tb.historyTokens).toLocaleString()} tok)
                </span>
                <button
                  onClick={() => copy('payload', compiled.compiledPrompt)}
                  className="min-h-[24px] px-2 rounded text-[10px] text-ink-dim hover:text-ink hover:bg-surface-3 inline-flex items-center gap-1 cursor-pointer"
                >
                  {copied === 'payload' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied === 'payload' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="bg-surface-0 p-3 rounded-lg text-[12px] text-[#86a2c9] overflow-x-auto whitespace-pre-wrap break-words">
{compiled.compiledPrompt}
              </pre>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
