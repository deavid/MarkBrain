import React from 'react';
import type { Granularity } from '../../domains/granularity';
import {
  GRANULARITY_LABEL,
  GRANULARITY_ORDER,
  AttachmentVisualState,
  getAttachmentStatePalette,
  getGranularityChipClass,
} from '../../domains/granularity';

/**
 * The attachment controls, shared by every surface that steers context:
 * the Artifacts folder rows, the chat staged tray + turn cards, the chapter
 * attachment strips, the mirror panel and the artifact detail modal.
 *
 * One palette (domains/granularity.ts), one dot verb, one four-word chip row —
 * so the folder and the chat can never disagree about what a color means
 * (design-docs/10_ATTACHMENT_TIMELINE.md §1).
 */

interface AttachmentDotProps {
  state: AttachmentVisualState;
  onClick?: () => void;
  /** Sentence, not a word — what tapping the dot will do. */
  label: string;
  size?: 'sm' | 'md';
}

export const AttachmentDot: React.FC<AttachmentDotProps> = ({ state, onClick, label, size = 'md' }) => {
  const palette = getAttachmentStatePalette(state);
  const box = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  const dot = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';
  if (!onClick) {
    return (
      <span className={`${box} flex items-center justify-center shrink-0`} aria-hidden="true">
        <span className={`${dot} rounded-full ${palette.dotClass}`} />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      data-state={state}
      className={`${box} flex items-center justify-center shrink-0 rounded-full cursor-pointer transition-transform active:scale-95`}
    >
      <span className={`${dot} rounded-full transition-colors ${palette.dotClass}`} />
    </button>
  );
};

interface GranularityChipsProps {
  value: Granularity;
  onChange: (g: Granularity) => void;
  /** Aria prefix, e.g. "Granularity for Unhaunter notes". */
  label: string;
  /** When the container is a bright state fill, inactive chips adapt to it. */
  state?: AttachmentVisualState;
  compact?: boolean;
}

/** The four words. Active chip wears its rainbow heat color with dark text. */
export const GranularityChips: React.FC<GranularityChipsProps> = ({
  value,
  onChange,
  label,
  state,
  compact = false,
}) => (
  <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
    {GRANULARITY_ORDER.map((g) => {
      const active = g === value;
      const cls = active
        ? getGranularityChipClass(g, true)
        : state
          ? getAttachmentStatePalette(state).inactiveChipClass
          : getGranularityChipClass(g, false);
      return (
        <button
          key={g}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onChange(g);
          }}
          aria-label={`${label}: ${GRANULARITY_LABEL[g]}`}
          aria-pressed={active}
          data-granularity={g}
          className={`min-h-[24px] ${compact ? 'px-1.5' : 'px-2'} py-0.5 rounded border text-[10px] font-mono cursor-pointer transition-colors ${cls}`}
        >
          {GRANULARITY_LABEL[g]}
        </button>
      );
    })}
  </div>
);

/**
 * What tapping the dot does right now — one sentence, so the aria label and
 * the tooltip never disagree with the behaviour.
 */
export function dotVerbLabel(state: AttachmentVisualState, title: string): string {
  switch (state) {
    case 'unstaged':
      return `Stage "${title}" for the next message`;
    case 'staged':
      return `Unstage "${title}" (not sent yet)`;
    default:
      return `"${title}" is in this chat at ${GRANULARITY_LABEL[state]} — cycle granularity`;
  }
}

export function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
}

interface AttachmentRowProps {
  state: AttachmentVisualState;
  title: string;
  tokens: number;
  granularity: Granularity;
  onToggle?: () => void;
  onSetGranularity?: (g: Granularity) => void;
  /** Only staged rows get an unstage button; committed rows never do. */
  onUnstage?: () => void;
  subtitle?: string;
}

/**
 * One attachment, rendered as its state: bright fill ⇒ dark text, dim fill ⇒
 * light text. Used by the chat staged tray, the turn cards and the chapter
 * attachment strip so all three read as the same object.
 */
export const AttachmentRow: React.FC<AttachmentRowProps> = ({
  state,
  title,
  tokens,
  granularity,
  onToggle,
  onSetGranularity,
  onUnstage,
  subtitle,
}) => {
  const palette = getAttachmentStatePalette(state);
  return (
    <div
      data-state={state}
      data-artifact-title={title}
      className={`rounded-xl px-2 py-1.5 space-y-1 ${palette.rowClass}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <AttachmentDot
          state={state}
          onClick={onToggle}
          label={dotVerbLabel(state, title)}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] font-mono truncate ${palette.titleTextClass}`} title={title}>
            {title}
          </div>
          {subtitle && (
            <div className={`text-[9px] font-mono truncate ${palette.subTextClass}`}>{subtitle}</div>
          )}
        </div>
        <span className={`text-[9px] font-mono shrink-0 tabular-nums ${palette.subTextClass}`}>
          {formatTokens(tokens)} tok
        </span>
        {onUnstage && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onUnstage();
            }}
            aria-label={`Unstage "${title}"`}
            data-testid="unstage-attachment"
            className={`min-h-[24px] px-1.5 rounded border text-[10px] font-mono cursor-pointer shrink-0 ${palette.inactiveChipClass}`}
          >
            ✕
          </button>
        )}
      </div>
      {onSetGranularity && (
        <div className="pl-7">
          <GranularityChips
            value={granularity}
            label={`Granularity for ${title}`}
            state={state}
            compact
            onChange={onSetGranularity}
          />
        </div>
      )}
    </div>
  );
};

interface StagedTrayProps {
  items: Array<{ artifactId: string; title: string; tokens: number; granularity: Granularity }>;
  onSetGranularity: (artifactId: string, g: Granularity) => void;
  onUnstage: (artifactId: string) => void;
}

/**
 * The staged tray — what will ride the NEXT message. It sits in the composer's
 * flow, so it reserves real space and can be cleared before Send. After Send
 * the items move into the chat history on their turn (10 §7).
 */
export const StagedTray: React.FC<StagedTrayProps> = ({ items, onSetGranularity, onUnstage }) => {
  if (items.length === 0) return null;
  return (
    <div
      data-testid="staged-tray"
      className="rounded-2xl border border-[#0e7490]/40 bg-[#061826]/70 p-2 space-y-1.5"
    >
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[9px] font-mono uppercase tracking-wider text-[#67e8f9]">
          Staged for this message ({items.length})
        </span>
        <span className="text-[9px] font-mono text-[#67e8f9]/70">
          rides the next send · removable until then
        </span>
      </div>
      {items.map((item) => (
        <AttachmentRow
          key={item.artifactId}
          state="staged"
          title={item.title}
          tokens={item.tokens}
          granularity={item.granularity}
          onSetGranularity={(g) => onSetGranularity(item.artifactId, g)}
          onUnstage={() => onUnstage(item.artifactId)}
        />
      ))}
    </div>
  );
};
