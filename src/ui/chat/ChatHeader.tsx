/**
 * The thread header: the in-flow title with inline rename + auto-title, and
 * the archived-thread banner.
 */
import React, { useState } from 'react';
import { Brain, Loader2, Pencil, Sparkles } from 'lucide-react';
import { logger } from '../../utils/logger';
import type { ProjectMetadata } from '../../domains/00-workspace/types';

export interface ArchiveBannerProps {
  threadArchived: boolean;
  threadTitle: string;
  onUnarchive?: () => void;
}

/** Archived thread: readable, one click to continue. */
export const ArchiveBanner: React.FC<ArchiveBannerProps> = ({ threadArchived, threadTitle, onUnarchive }) => (
  <>
  {threadArchived && (
    <div className="flex items-center justify-between gap-3 px-3 sm:px-6 py-1.5 bg-surface-2 text-10 font-mono text-ink-mute shrink-0 animate-in fade-in duration-150">
      <span className="truncate">
        Archived — you can read it. Typing asks to unarchive first.
      </span>
      <button
        type="button"
        onClick={() => {
          onUnarchive?.();
          logger.action('ChatView', 'Unarchived thread from banner', { title: threadTitle });
        }}
        className="px-2.5 py-1 rounded-lg bg-surface-3 hover:bg-surface-4 text-ink-dim hover:text-ink transition-colors cursor-pointer shrink-0"
      >
        Unarchive
      </button>
    </div>
  )}
  </>
);

export interface ChatHeaderProps {
  project: ProjectMetadata;
  threadTitle: string;
  threadTitleState: 'placeholder' | 'auto' | 'manual';
  threadArchived: boolean;
  onSuggestTitle?: () => void | Promise<boolean>;
  onRenameTitle?: (title: string) => void;
  /** Whether the feed is scrolled past the top — the title pins as a slim bar. */
  feedScrolled: boolean;
  offlineReplica: boolean;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  project,
  threadTitle,
  threadTitleState,
  threadArchived,
  onSuggestTitle,
  onRenameTitle,
  feedScrolled,
  offlineReplica,
}) => {
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleFlash, setTitleFlash] = useState<'ok' | 'fail' | null>(null);

  const startTitleRename = () => {
    setTitleDraft(threadTitleState === 'placeholder' ? '' : threadTitle);
    setRenamingTitle(true);
    setTitleFlash(null);
  };
  const commitTitleRename = () => {
    const next = titleDraft.trim();
    setRenamingTitle(false);
    if (!next || next === threadTitle) return;
    logger.action('ChatView', 'Renamed thread from the chat title', { title: next });
    onRenameTitle?.(next);
  };
  const cancelTitleRename = () => {
    setRenamingTitle(false);
    setTitleDraft('');
  };
  const handleAutoTitle = async () => {
    if (titleBusy || !onSuggestTitle) return;
    setTitleBusy(true);
    setTitleFlash(null);
    try {
      const applied = await onSuggestTitle();
      setTitleFlash(applied === false ? 'fail' : 'ok');
    } catch {
      setTitleFlash('fail');
    } finally {
      setTitleBusy(false);
      window.setTimeout(() => setTitleFlash(null), 2600);
    }
  };

  return (
    <>
  {!threadArchived && (
    <div
      data-testid="thread-title-row"
      data-scrolled={feedScrolled ? 'true' : 'false'}
      className={`sticky top-0 z-20 flex justify-center gap-2 min-w-0 pl-16 pr-24 -mx-3 sm:-mx-6 transition-colors [@media(max-height:520px)]:hidden ${
        // The scroller has NO top padding on purpose: a sticky box is
        // clamped to its containing block, which starts below that
        // padding — that WAS the gap. The in-flow (unscrolled) hero
        // carries its own top padding instead, so the pinned pill's
        // square shoulders sit truly flush at the window top.
        feedScrolled ? '' : 'pt-3 sm:pt-4'
      }`}
    >
      <div
        className={`flex items-center gap-2 min-w-0 ${
          feedScrolled
            ? // Flush + SHORT: square shoulders hug the window top
              // (no gap possible — the top edge is a straight line),
              // the pill is as tall as its text plus a whisper.
              'max-w-[60%] rounded-t-none rounded-b-xl bg-surface-0/95 backdrop-blur-md px-2.5 pt-1 pb-1.5 shadow-sm'
            : 'flex-1 justify-center'
        }`}
      >
      {!offlineReplica && (
      <button
        type="button"
        onClick={handleAutoTitle}
        disabled={titleBusy}
        aria-busy={titleBusy}
        aria-label="Generate a title from this conversation"
        title="Generate a title from this conversation"
        className="p-1.5 rounded-lg text-ink-faint hover:text-brand-gold hover:bg-surface-2 transition-colors cursor-pointer shrink-0 disabled:opacity-60"
      >
        {titleBusy ? (
          <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />
        ) : (
          <Sparkles className="w-4 h-4" />
        )}
      </button>
      )}

      {renamingTitle ? (
        <input
          autoFocus
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitleRename}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitTitleRename();
            if (e.key === 'Escape') cancelTitleRename();
          }}
          placeholder="Name this conversation…"
          aria-label="Conversation title"
          className={`flex-1 min-w-0 bg-transparent font-semibold tracking-tight text-ink font-mono placeholder:text-ink-faint focus:outline-none border-b border-line pb-0.5 text-center ${
            feedScrolled ? 'text-xs' : 'text-xl sm:text-2xl'
          }`}
        />
      ) : (
        <button
          type="button"
          onClick={startTitleRename}
          className="group flex items-center justify-center gap-2 min-w-0 flex-1 text-left cursor-text"
          title="Click to rename"
        >
          {/* The hero's identity mark, compacted: the active header
              carries the project the way the empty state does, so the
              conversation is never anonymous and the identity sits in
              the middle of the row, far from both floating corners. */}
          <span
            aria-hidden="true"
            className={`rounded-lg flex items-center justify-center shrink-0 ${
              feedScrolled ? 'w-5 h-5' : 'w-7 h-7'
            }`}
            style={{ backgroundColor: `${project.color || '#3b82f6'}22` }}
          >
            <Brain
              className={feedScrolled ? 'w-3.5 h-3.5' : 'w-4 h-4'}
              style={{ color: project.color || '#3b82f6' }}
            />
          </span>
          <h1
            className={`truncate font-semibold tracking-tight font-mono ${
              feedScrolled ? 'text-xs' : 'text-xl sm:text-2xl'
            } ${
              threadTitleState === 'placeholder' || threadTitle === 'New thread'
                ? 'italic text-ink-mute'
                : 'text-ink'
            }`}
          >
            {threadTitle}
          </h1>
          <Pencil className="w-3 h-3 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </button>
      )}

      {titleFlash && (
        <span
          data-testid="title-flash"
          className={`text-10 font-mono shrink-0 animate-in fade-in duration-150 ${
            titleFlash === 'ok' ? 'text-brand-green' : 'text-[#f28894]'
          }`}
        >
          {titleFlash === 'ok' ? 'Titled' : 'Needs a reply first'}
        </span>
      )}
      </div>
    </div>
  )}
    </>
  );
};
