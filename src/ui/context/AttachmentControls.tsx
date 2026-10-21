import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Granularity } from '../../domains/granularity';
import {
  GRANULARITY_LABEL,
  GRANULARITY_ORDER,
  AttachmentVisualState,
  ATTACHMENT_STATE_PALETTE,
  getAttachmentStatePalette,
  getGranularityChipClass,
} from '../../domains/granularity';

/**
 * The one attachment widget. Same visual object, same two verbs, on every
 * surface that shows an artifact: the folder rows, the staged tray, the turn
 * cards, the chapter strip and the mirror.
 *
 *   · the ROW BODY (or its dot) runs the verb — unstaged stages, staged
 *     unstages, committed cycles the cut;
 *   · the ARROW-OUT on the right opens the detail popup, on every surface;
 *   · one token readout per row, never two.
 *
 * Colours come from domains/granularity.ts; nothing here hardcodes a hue.
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
}

interface GranularityChipsProps {
  value: Granularity;
  onChange: (g: Granularity) => void;
  /** Aria prefix, e.g. "Granularity for Unhaunter notes". */
  label: string;
  /** When the container carries a state, inactive chips adapt to it. */
  state?: AttachmentVisualState;
  compact?: boolean;
}

export const GranularityChips: React.FC<GranularityChipsProps> = ({
  value,
  onChange,
  label,
  state,
  compact = false,
}) => (
  <div className="flex items-center gap-0.5 flex-wrap min-w-0" onClick={(e) => e.stopPropagation()}>
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
          className={`flex items-center gap-1 min-h-[24px] ${compact ? 'px-1.5' : 'px-2'} py-0.5 rounded-md text-[10px] font-mono cursor-pointer transition-colors ${cls}`}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              backgroundColor: ATTACHMENT_STATE_PALETTE[g].hex,
              opacity: active ? 1 : 0.45,
            }}
            aria-hidden="true"
          />
          {GRANULARITY_LABEL[g]}
        </button>
      );
    })}
  </div>
);

/** One sentence, so the aria label and the tooltip never disagree with the behaviour. */
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

/**
 * One provenance counter for the whole app: the same 1-based `msg N` the
 * chapter headers use. `turnIndex` is -1 for attachments from before turn
 * tracking — they say "in chat" rather than claiming a message, and `null`
 * (staged, not sent yet) has no provenance at all.
 */
export function formatAttachmentProvenance(
  turnIndex: number | null | undefined
): { badge: string; title: string } | undefined {
  if (turnIndex === null || turnIndex === undefined) return undefined;
  if (turnIndex < 0) return { badge: 'in chat', title: 'joined before turn tracking' };
  return { badge: `msg ${turnIndex + 1}`, title: `Attached on message ${turnIndex + 1}` };
}

interface AttachmentRowProps {
  artifactId?: string;
  state: AttachmentVisualState;
  title: string;
  tokens: number;
  granularity: Granularity;
  /** The row verb. Chips, ✕ and the arrow stop propagation themselves. */
  onToggle?: () => void;
  onSetGranularity?: (g: Granularity) => void;
  /** Only staged rows get an unstage button; a committed row never does. */
  onUnstage?: () => void;
  /** Arrow-out → detail popup. */
  onOpenDetail?: () => void;
  description?: string;
  tags?: string[];
  /** Provenance / state badge ('next send', 'msg 4', 'review'…). */
  badge?: string;
  flagged?: boolean;
  /** Parked for cleanup: dimmed here, and the only state the cleanup tool will delete. */
  archived?: boolean;
}

/**
 * One artifact, rendered as its state, so all five surfaces read as the same
 * object with the same verbs.
 */
export const AttachmentRow: React.FC<AttachmentRowProps> = ({
  artifactId,
  state,
  title,
  tokens,
  granularity,
  onToggle,
  onSetGranularity,
  onUnstage,
  onOpenDetail,
  description,
  tags,
  badge,
  flagged,
  archived = false,
}) => {
  const palette = getAttachmentStatePalette(state);
  return (
    <div
      data-state={state}
      data-artifact-id={artifactId}
      data-artifact-title={title}
      onClick={
        onToggle
          ? (e) => {
              e.preventDefault();
              onToggle();
            }
          : undefined
      }
      className={`group w-full text-left rounded-xl px-2 py-1.5 space-y-1 ${
        onToggle ? 'cursor-pointer select-none' : ''
      } ${palette.rowClass} ${archived ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <AttachmentDot
          state={state}
          onClick={onToggle}
          label={dotVerbLabel(state, title)}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[11px] font-mono truncate ${palette.titleTextClass}`} title={title}>
              {title}
            </span>
            {flagged && (
              <span className={`text-[9px] font-mono px-1 py-0.2 rounded ${palette.tagClass}`}>
                review
              </span>
            )}
            {archived && (
              <span
                className="text-[9px] font-mono px-1 py-0.2 rounded bg-recess-2 text-[#c8a05a]"
                title="Parked — nothing hides it, but only archived artifacts can be deleted for good"
              >
                archived
              </span>
            )}
            {badge && (
              <span
                className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${palette.tagClass}`}
                title={state === 'staged' ? 'Rides the next send' : undefined}
              >
                {badge}
              </span>
            )}
          </div>
          {description && (
            <div className={`text-[10px] font-mono line-clamp-2 mt-0.5 ${palette.subTextClass}`}>
              {description}
            </div>
          )}
          <div className={`text-[9px] font-mono tabular-nums ${palette.subTextClass}`}>
            {formatTokens(tokens)} tok
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
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
              className={`min-w-[28px] min-h-[28px] px-1.5 rounded-md text-[10px] font-mono cursor-pointer ${palette.inactiveChipClass}`}
            >
              ✕
            </button>
          )}
          {onOpenDetail && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenDetail();
              }}
              aria-label={`Open details for "${title}"`}
              data-testid="open-artifact-detail"
              title={`Open "${title}" details`}
              className="min-w-[30px] min-h-[30px] flex items-center justify-center rounded-lg text-ink-faint hover:text-ink hover:bg-surface-3 transition-colors cursor-pointer"
            >
              <ArrowUpRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {onSetGranularity && state !== 'unstaged' && (
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
      {tags && tags.length > 0 && (
        <div className="pl-7 flex items-center gap-1 flex-wrap">
          {tags.slice(0, 4).map((t) => (
            <span key={t} className={`text-[9px] font-mono ${palette.subTextClass}`}>
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

interface StagedTrayProps {
  items: Array<{ artifactId: string; title: string; tokens: number; granularity: Granularity }>;
  onSetGranularity: (artifactId: string, g: Granularity) => void;
  onUnstage: (artifactId: string) => void;
  onOpenDetail?: (artifactId: string) => void;
}

/**
 * What will ride the next message. It sits in the composer's flow so it reserves
 * real space, and it can be cleared before Send.
 */
export const StagedTray: React.FC<StagedTrayProps> = ({
  items,
  onSetGranularity,
  onUnstage,
  onOpenDetail,
}) => {
  if (items.length === 0) return null;
  return (
    <div
      data-testid="staged-tray"
      className="rounded-xl bg-surface-1 p-2 space-y-1.5"
    >
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[9px] font-mono uppercase tracking-wider text-[#38bdf8]">
          Staged for this message ({items.length})
        </span>
        <span className="text-[9px] font-mono text-[#7dd3fc]/70">
          rides the next send · removable until then
        </span>
      </div>
      {items.map((item) => (
        <AttachmentRow
          key={item.artifactId}
          artifactId={item.artifactId}
          state="staged"
          title={item.title}
          tokens={item.tokens}
          granularity={item.granularity}
          onSetGranularity={(g) => onSetGranularity(item.artifactId, g)}
          onUnstage={() => onUnstage(item.artifactId)}
          onOpenDetail={onOpenDetail ? () => onOpenDetail(item.artifactId) : undefined}
        />
      ))}
    </div>
  );
};
