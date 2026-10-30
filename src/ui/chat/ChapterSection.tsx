/**
 * One chapter: the header strip (identity, inventory, cut, actions menu), the
 * collapsible body layers, the compacted attachment strip, and its turns.
 */
import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  MoreVertical,
} from 'lucide-react';
import { isChapterInProgress } from '../../domains/02-chapter-segmentation';
import { getMellowPastelColor } from '../../utils/pastelColor';
import { renderMarkdown } from '../../utils/markdown';
import type { ChapterTurns, Turn } from '../../types';
import type { Granularity } from '../../domains/granularity';
import type { ChatAttachment } from '../../domains/06-chat-threads';
import { cutIncludes } from '../../domains/granularity';
import {
  AttachmentRow,
  GranularityChips,
  formatAttachmentProvenance,
  formatTokens,
} from '../context/AttachmentControls';
import { MessageBubble } from './MessageBubble';
import type { MessageBubbleSharedProps } from './MessageBubble';

/** The chapter header colours, one per chapter index. */
const CHAPTER_PASTEL_COLORS = [
  { bgHeader: 'bg-surface-2', dot: '#7093be', text: 'text-[#8ab1e0]' }, // slate steel blue
  { bgHeader: 'bg-surface-2', dot: '#5da88b', text: 'text-[#7ec2a6]' }, // mellow sage green
  { bgHeader: 'bg-surface-1', dot: '#9d80ba', text: 'text-[#b9a1d4]' }, // dark muted mauve
  { bgHeader: 'bg-surface-1', dot: '#b59765', text: 'text-[#d6be94]' }, // mellow dark amber
  { bgHeader: 'bg-surface-2', dot: '#64a3ba', text: 'text-[#8ac5db]' }, // dark muted teal
];

export interface ChapterSectionProps {
  /** The whole chapter list — the seam-down control looks at the next chapter. */
  chapters: ChapterTurns[];
  chapterIndex: number;
  chapter: ChapterTurns['chapter'];
  isOngoing: boolean;
  granularity: Granularity;
  turns: Turn[];
  chapterList: ChapterTurns['chapter'][];
  chapterTokens: Record<string, number>;
  isCollapsed: boolean;
  /** Chapter body layers (description / summary) live in the feed's state. */
  isLayerCollapsed: (layer: 'description' | 'summary') => boolean;
  onToggleLayer: (layer: 'description' | 'summary') => void;
  onToggleCollapse: () => void;
  chapterMenuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  steerActive: boolean;
  steerText: string;
  onSteerTextChange: (text: string) => void;
  onSteerStart: () => void;
  onSteerSubmit: () => void;
  onSteerCancel: () => void;
  summarizing: boolean;
  summarizeError: string;
  onSummarize: () => void;
  onSetCut: ((next: Granularity) => void) | undefined;
  onMergeChapter?: (chapterId: string) => void;
  onShiftBoundary?: (chapterId: string, newStartIndex: number) => void;
  onRecalibrateChapter?: (chapterId: string, steeringPrompt?: string) => Promise<void>;
  offlineReplica: boolean;
  attachmentsOfChapter: (chapter: ChapterTurns['chapter']) => ChatAttachment[];
  titleFor: (artifactId: string) => string;
  subtitleFor: (artifactId: string) => string;
  tokensFor: (artifactId: string) => number;
  onToggleAttachment?: (artifactId: string) => void;
  onSetAttachmentGranularity?: (artifactId: string, granularity: Granularity) => void;
  onOpenArtifact?: (artifactId: string) => void;
  /** Everything the bubbles in this chapter need, minus the message itself. */
  messageProps: MessageBubbleSharedProps;
}

export const ChapterSection: React.FC<ChapterSectionProps> = ({
  chapters,
  chapterIndex,
  chapter,
  isOngoing,
  granularity,
  turns,
  chapterList,
  chapterTokens,
  isCollapsed,
  isLayerCollapsed,
  onToggleLayer,
  onToggleCollapse,
  chapterMenuOpen,
  onToggleMenu,
  onCloseMenu,
  steerActive,
  steerText,
  onSteerTextChange,
  onSteerStart,
  onSteerSubmit,
  onSteerCancel,
  summarizing,
  summarizeError,
  onSummarize,
  onSetCut,
  onMergeChapter,
  onShiftBoundary,
  onRecalibrateChapter,
  offlineReplica,
  attachmentsOfChapter,
  titleFor,
  subtitleFor,
  tokensFor,
  onToggleAttachment,
  onSetAttachmentGranularity,
  onOpenArtifact,
  messageProps,
}) => {
  const chapColor = getMellowPastelColor(chapter.id || chapterIndex);
  const pastel = CHAPTER_PASTEL_COLORS[chapterIndex % CHAPTER_PASTEL_COLORS.length];

  return (
  <section
    key={chapter.id}
    data-ongoing={isOngoing ? 'true' : undefined}
    className={`transition-colors duration-200 relative rounded-2xl overflow-hidden bg-surface-1 shadow-step mb-5 ${
      isOngoing ? 'mt-2' : ''
    }`}
  >
    <div
      style={{ backgroundColor: `${chapColor}16` }}
      className="p-3 sm:p-3.5 space-y-1.5 transition-colors"
    >
      {/* Two rows on purpose: identity + inventory, then the cut. One
          row pushes the four words off a 350px screen. */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
            style={{ backgroundColor: chapColor }}
            title={isOngoing ? 'Active Chapter' : 'Completed Chapter'}
          />

          <span
            style={{ color: chapColor }}
            className="text-10 font-mono uppercase tracking-wider shrink-0 font-semibold"
          >
            Chapter {chapterIndex + 1}
          </span>

          <h3 className="font-semibold text-xs sm:text-sm text-ink font-mono line-clamp-2 leading-snug">
            {chapter.title}
            {chapter.subtitle && (
              <span className="font-normal italic text-ink-dim ml-1.5">
                — {chapter.subtitle}
              </span>
            )}
          </h3>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-10 font-mono text-[#758ca8] tabular-nums">
            {turns.length} msg{turns.length !== 1 ? 's' : ''}
            {chapterTokens[chapter.id] !== undefined && (
              <>
                {' · '}
                <span className="text-[#b8cae4]">
                  {formatTokens(chapterTokens[chapter.id])} tok
                </span>
              </>
            )}
          </span>

          {/* Regenerate. "Write it" only shows when a layer is MISSING;
              a stale summary had no affordance at all. Same call — the
              model's text overwrites what is there — so this is the
              button that was absent, not a second code path. Hidden for
              in-progress chapters: they send Full, so anything written
              now is stale before the next turn lands. */}
          {!isChapterInProgress(chapterList, chapterIndex) && (
            <button
              type="button"
              data-testid="chapter-regenerate"
              onClick={(e) => {
                e.preventDefault();
                onSummarize();
              }}
              disabled={summarizing}
              title="Re-run the chapter summary — replaces the description and summary with fresh ones"
              className="min-h-[24px] px-2 rounded-lg text-10 font-mono text-[#8ca3c7] hover:bg-surface-3 hover:text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default shrink-0"
            >
              {summarizing ? 'Writing…' : 'Regenerate'}
            </button>
          )}

          {granularity !== 'title' && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onToggleCollapse();
              }}
              className="min-w-[24px] min-h-[24px] p-1 rounded-lg hover:bg-surface-3 text-[#8ca3c7] transition-colors cursor-pointer"
              title={isCollapsed ? 'Expand the cut' : 'Fold this chapter'}
            >
              {isCollapsed ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Chapter actions (Package 2 §2.6): undo a cut, nudge the
              seam, or re-run the summary with a steering note. The
              existing per-message split control stays where it is. */}
          {(onMergeChapter || onShiftBoundary || onRecalibrateChapter) && !offlineReplica && (
            <div className="relative shrink-0">
              <button
                type="button"
                data-testid={`chapter-menu-${chapter.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  onToggleMenu();
                }}
                className="min-w-[24px] min-h-[24px] p-1 rounded-lg hover:bg-surface-3 text-[#8ca3c7] transition-colors cursor-pointer"
                title="Chapter actions"
                aria-label="Chapter actions"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {chapterMenuOpen && (
                <div
                  data-testid={`chapter-menu-panel-${chapter.id}`}
                  className="absolute z-50 right-0 top-full mt-1 w-60 rounded-xl bg-surface-2 shadow-pop border border-line p-1.5 space-y-0.5"
                >
                  {onMergeChapter && chapterIndex > 0 && (
                    <button
                      type="button"
                      data-testid={`chapter-merge-${chapter.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onMergeChapter(chapter.id);
                        onCloseMenu();
                      }}
                      className="block w-full text-left px-2 py-1.5 rounded-lg text-11 text-ink hover:bg-surface-3 transition-colors cursor-pointer"
                    >
                      Merge with previous chapter
                    </button>
                  )}
                  {onShiftBoundary && chapterIndex > 0 && chapter.startIndex > 0 && (
                    <button
                      type="button"
                      data-testid={`chapter-seam-up-${chapter.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onShiftBoundary(chapter.id, chapter.startIndex - 1);
                        onCloseMenu();
                      }}
                      className="block w-full text-left px-2 py-1.5 rounded-lg text-11 text-ink hover:bg-surface-3 transition-colors cursor-pointer"
                    >
                      Move seam up one message
                    </button>
                  )}
                  {onShiftBoundary && (
                    <button
                      type="button"
                      data-testid={`chapter-seam-down-${chapter.id}`}
                      disabled={
                        chapters[chapterIndex + 1] !== undefined &&
                        chapters[chapterIndex + 1].chapter.startIndex <= chapter.startIndex + 1
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        onShiftBoundary(chapter.id, chapter.startIndex + 1);
                        onCloseMenu();
                      }}
                      className="block w-full text-left px-2 py-1.5 rounded-lg text-11 text-ink hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
                    >
                      Move seam down one message
                    </button>
                  )}
                  {onRecalibrateChapter && !isChapterInProgress(chapterList, chapterIndex) && (
                    steerActive ? (
                      <div className="px-2 py-1.5 space-y-1.5" data-testid="chapter-steer-input">
                        <div className="text-10 text-ink-mute leading-snug">
                          What should the recap focus on? Optional.
                        </div>
                        <input
                          value={steerText}
                          onChange={(e) => onSteerTextChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              onSteerSubmit();
                            }
                          }}
                          placeholder="e.g. focus on the decisions made"
                          className="w-full bg-recess-1 rounded-lg px-2 py-1 text-11 text-ink placeholder:text-ink-faint focus:outline-none"
                        />
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            data-testid="chapter-steer-submit"
                            onClick={(e) => {
                              e.preventDefault();
                              onSteerSubmit();
                            }}
                            className="px-2 py-1 rounded-lg bg-surface-4 text-ink text-10 font-mono cursor-pointer"
                          >
                            Regenerate
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              onSteerCancel();
                            }}
                            className="px-2 py-1 rounded-lg text-ink-mute text-10 font-mono hover:bg-surface-3 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid={`chapter-recalibrate-${chapter.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          onSteerStart();
                        }}
                        className="block w-full text-left px-2 py-1.5 rounded-lg text-11 text-ink hover:bg-surface-3 transition-colors cursor-pointer"
                      >
                        Regenerate summary…
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {onSetCut &&
        (isChapterInProgress(chapterList, chapterIndex) ? (
          // The last chapters are still live: they always send Full,
          // so a cut would only promise layers nobody wrote.
          <div
            data-testid="chapter-in-progress"
            data-chapter-id={chapter.id}
            className="inline-flex items-center min-h-[24px] px-2 rounded-lg bg-recess-1 shadow-well text-10 font-mono text-ink-mute select-none"
            title="Still in progress — always sends Full, nothing to cut yet"
          >
            In progress · Full
          </div>
        ) : (
          <div data-testid="chapter-cut" data-chapter-id={chapter.id} className="max-w-full">
            <GranularityChips
              value={(chapter.granularity ?? granularity) as Granularity}
              label={`Send chapter ${chapterIndex + 1}`}
              compact
              onChange={(g) => onSetCut(g)}
            />
          </div>
        ))}
    </div>

    {/* What you see is what you send: the body renders exactly the
        layers the current cut includes, in order — description,
        summary, then the verbatim turns at Full. Title renders none of
        them; the header IS the payload. */}
    {!isCollapsed && granularity !== 'title' && (
      <div
        data-testid="chapter-body"
        className="p-3 sm:p-4 space-y-2"
      >
        {/* Each layer is gated on the SAME cutIncludes() the compiler
            uses. Dropping this guard lets the screen show prose the
            payload does not carry — the exact failure that made the
            chapter body untrustworthy. */}
        {cutIncludes(granularity, 'description') && chapter.description && (
          <div
            data-testid="chapter-layer-description"
            className="text-xs text-ink-dim leading-relaxed bg-recess-1 shadow-well p-3 rounded-lg"
          >
            <button
              type="button"
              onClick={() => onToggleLayer('description')}
              aria-expanded={!isLayerCollapsed('description')}
              className="w-full flex items-center justify-between gap-2 cursor-pointer"
            >
              <div className="font-semibold text-10 text-[#e2c328] mb-1 font-mono uppercase tracking-wider">
                Description
              </div>
              <span className="text-9 font-mono text-[#6b82a3] shrink-0">
                {isLayerCollapsed('description') ? '+ show' : '− hide'}
              </span>
            </button>
            {!isLayerCollapsed('description') && (
              <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(chapter.description) }} />
            )}
          </div>
        )}
        {cutIncludes(granularity, 'summary') && chapter.summary && (
          <div
            data-testid="chapter-layer-summary"
            className="text-xs text-ink-dim leading-relaxed bg-recess-1 shadow-well p-3 rounded-lg"
          >
            <button
              type="button"
              onClick={() => onToggleLayer('summary')}
              aria-expanded={!isLayerCollapsed('summary')}
              className="w-full flex items-center justify-between gap-2 cursor-pointer"
            >
              <div className="font-semibold text-10 text-[#f99014] mb-1 font-mono uppercase tracking-wider">
                Summary
              </div>
              <span className="text-9 font-mono text-[#6b82a3] shrink-0">
                {isLayerCollapsed('summary') ? '+ show' : '− hide'}
              </span>
            </button>
            {!isLayerCollapsed('summary') && (
              <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(chapter.summary) }} />
            )}
          </div>
        )}
        {/* Missing layer under a chosen cut = chrome, not content: a
            real gap, honestly named, with the call that fills it.
            At Full there is nothing to promise, so no chrome. */}
        {granularity !== 'full' &&
          ((cutIncludes(granularity, 'description') && !chapter.description) ||
            (cutIncludes(granularity, 'summary') && !chapter.summary)) && (
            <div className="flex items-center justify-between gap-3 text-11 text-ink-mute p-2.5 bg-recess-1 rounded-lg">
              <span className="font-mono">
                {summarizing
                  ? 'Writing summary…'
                  : summarizeError
                    ? 'Summary request timed out or failed.'
                    : cutIncludes(granularity, 'summary') && !chapter.summary
                      ? 'No summary yet — this chapter is sending only what exists.'
                      : 'No description yet for this chapter.'}
              </span>
              {!summarizing && !offlineReplica && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    // Fill the layer; never change the cut.
                    onSummarize();
                  }}
                  className="text-10 font-mono px-2.5 py-1 rounded-lg bg-surface-3 text-ink-dim hover:bg-surface-4 hover:text-ink font-medium transition-colors cursor-pointer shrink-0"
                >
                  {summarizeError ? 'Retry' : 'Write it'}
                </button>
              )}
            </div>
          )}
      </div>
    )}

    {/* Compacted attachment strip — whenever this chapter's turns are
        not on screen (folded, or sent below Full), its committed
        attachments stay visible and steerable here. An attachment's
        cut is independent of the chapter's. It is the chapter's FOOTER
        on purpose: description and summary lead, attachments close. */}
    {(() => {
      const chapterAtts = attachmentsOfChapter(chapter);
      const turnsHidden = isCollapsed || granularity !== 'full';
      if (!turnsHidden || chapterAtts.length === 0) return null;
      return (
        <div className="px-3 sm:px-4 py-2 bg-veil-1 flex flex-wrap gap-1.5">
          <div className="w-full shrink-0 text-9 font-mono uppercase tracking-wider text-[#556985]">
            Attached in this chapter (independent of the cut)
          </div>
          {chapterAtts.map((att) => (
            <AttachmentRow
              key={att.artifactId}
              artifactId={att.artifactId}
              state={att.granularity}
              title={titleFor(att.artifactId)}
              subtitle={subtitleFor(att.artifactId)}
              tokens={tokensFor(att.artifactId)}
              granularity={att.granularity}
              badge={formatAttachmentProvenance(att.turnIndex)?.badge}
              onToggle={
                onToggleAttachment ? () => onToggleAttachment(att.artifactId) : undefined
              }
              onSetGranularity={
                onSetAttachmentGranularity
                  ? (g) => onSetAttachmentGranularity(att.artifactId, g)
                  : undefined
              }
              onOpenDetail={onOpenArtifact ? () => onOpenArtifact(att.artifactId) : undefined}
              hideGranularityChips
              size="compact"
            />
          ))}
        </div>
      );
    })()}

    {/* Messages Container — only when the cut actually includes the
        turns. At Title/Description/Summary the body above IS the
        payload, so rendering raw messages here would show the model
        text it never receives. */}
    {!isCollapsed && granularity === 'full' && turns.length > 0 && (
      <div className="p-3 sm:p-5 space-y-4">
        {turns.map((message, turnIdx) => {
                    const globalTurnIndex = chapter.startIndex + turnIdx;

                    return (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        globalTurnIndex={globalTurnIndex}
                        {...messageProps}
                      />
                    );
                  })}
      </div>
    )}
  </section>
  );
};
