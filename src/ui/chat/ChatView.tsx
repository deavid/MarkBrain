/**
 * ChatView — the chat feed shell: chapter sections, drafts, staged tray, and
 * the composer. (Phase 6: the dead elapsed-seconds timer and unused lastGroup
 * binding left over from Phase 5 are gone.)
 */
import React, { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { isOnline, subscribeOnline } from '../../application/connectivity';
import {
  Artifact,
  ChapterTurns,
  ExtractedArtifact,
  Turn,
} from '../../types';
import type { ProjectMetadata } from '../../domains/00-workspace/types';
import { Loader2, Square, Brain } from 'lucide-react';
import { logger } from '../../utils/logger';
import { ChatAttachment, isAttachmentStaged } from '../../domains/06-chat-threads';
import type { ChatCapabilities } from '../../domains/06-chat-threads/types';
import { resolveCapabilities } from '../../domains/06-chat-threads/types';
import type { ChatRenderMode } from './chatRenderMode';
import type { EnterSendMode } from './sendOnEnter';
import type { Granularity } from '../../domains/granularity';
import { StagedTray } from '../context/AttachmentControls';
import { isOfflineReplica } from '../../services/workspaceSession';
import type { DraftProgress } from '../../application/draftQueue';
import { ArchiveBanner, ChatHeader } from './ChatHeader';
import { ChapterSection } from './ChapterSection';
import type { MessageBubbleSharedProps } from './MessageBubble';
import { useMessageTts } from './useMessageTts';
import { DraftPhaseChip, DraftQueueTray } from './DraftQueueTray';
import { ComposerUnlockModal, HeroComposer, ThreadComposer, useComposer } from './ChatComposer';


export interface ChatViewProps {
  project: ProjectMetadata;
  chapters: ChapterTurns[];
  onSendMessage: (text: string) => Promise<void>;
  /** design 25 §1.1: a send with no configured key routes here (Model Settings → Keys). */
  onOpenKeySettings?: () => void;
  isLoading: boolean;
  streamingStatus?: string | null;
  streamPhase?: 'waiting' | 'streaming' | null;
  onStopGeneration?: () => void;
  onOpenServerLogs?: () => void;
  /** Per-message receipts (VPS): open the flight recorder filtered to THIS
   * reply's job — the raw request and the raw provider answer, verbatim. */
  onOpenReceipts?: (jobId: string) => void;
  onAddArtifactToProject: (artifact: Artifact) => void;
  onSummarizeChapter: (chapterId: string) => Promise<void>;
  onDeclareChapter: (messageId: string, title: string) => void;
  onSetChapterGranularity?: (chapterId: string, granularity: Granularity) => void;
  onSelectArtifact?: (artifact: Artifact | ExtractedArtifact) => void;
  attachments?: ChatAttachment[];
  tokensByArtifact?: Record<string, number>;
  chapterTokens?: Record<string, number>;
  artifactTitles?: Record<string, string>;
  artifactSubtitles?: Record<string, string>;
  onToggleAttachment?: (artifactId: string) => void;
  onUnstageAttachment?: (artifactId: string) => void;
  onSetAttachmentGranularity?: (artifactId: string, granularity: Granularity) => void;
  onOpenArtifacts?: () => void;
  chosenVoice?: string;
  /** Default bubble view for the whole feed; each message can still flip. */
  chatRender?: ChatRenderMode;
  /** What a bare Enter does: send, or insert a new line. Shift/Ctrl are fixed. */
  enterSend?: EnterSendMode;
  onOpenArtifact?: (artifactId: string) => void;
  threadTitle?: string;
  threadTitleState?: 'placeholder' | 'auto' | 'manual';
  threadArchived?: boolean;
  onSuggestTitle?: () => void | Promise<boolean>;
  onRenameTitle?: (title: string) => void;
  onUnarchive?: () => void;
  /** Unpaired asks (design-docs/18) — drafts live outside the conversation. */
  drafts?: Array<{
    id: string;
    threadId: string;
    createdAt: number;
    state: 'queued' | 'sending' | 'failed' | 'stopped';
    text: string;
    reason?: string;
    partial?: string;
    kind?: 'send' | 'regenerate';
    /** Design 23: the draft OWNS its payload snapshot (session-only). */
    attachments?: ChatAttachment[];
    /** Design 23 §2.2: honest phase + clock. */
    progress?: DraftProgress;
    /** Design 23 §2.3: machine-readable exit (VAULT_LOCKED → unlock row). */
    errorCode?: string;
  }>;
  onRetryDraft?: (id: string) => void;
  onStoreAsIsDraft?: (id: string) => void;
  onDiscardDraft?: (id: string) => void;
  /**
   * Regenerate the last pair's reply (design-docs/18): replaces it only if
   * the new reply completes. Refused while the queue has anything in it.
   */
  onRegenerateLast?: () => void;
  /**
   * Lifted chat draft (LAW 4): this component unmounts when [+ Attach] opens
   * the library, so the unsent text must live in App, keyed by thread.
   * Absent → local state, so bare unit-test mounts keep working.
   */
  draftText?: string;
  onDraftTextChange?: (text: string) => void;
  /** Unattached artifacts scoring above threshold against the current draft. */
  missingMatchCount?: number;
  /** Open the library straight into the Proximity lens (badge-aware attach). */
  onOpenArtifactsWithProximity?: () => void;
  /** Chat capability toggles (Package 2 §2.5): per-thread override vs project default. */
  projectCapabilities?: Partial<ChatCapabilities>;
  onSetProjectCapabilities?: (caps: Partial<ChatCapabilities>) => void;
  /** Chapter controls (Package 2 §2.6): merge into the previous, move the seam, re-summarize with a steering note. */
  onMergeChapter?: (chapterId: string) => void;
  onShiftBoundary?: (chapterId: string, newStartIndex: number) => void;
  onRecalibrateChapter?: (chapterId: string, steeringPrompt?: string) => Promise<void>;
}


export const ChatView: React.FC<ChatViewProps> = ({
  project,
  chapters,
  onSendMessage,
  onOpenKeySettings,
  isLoading,
  streamingStatus,
  streamPhase,
  onStopGeneration,
  onOpenServerLogs,
  onOpenReceipts,
  onAddArtifactToProject,
  onSummarizeChapter,
  onDeclareChapter,
  onSetChapterGranularity,
  onSelectArtifact,
  attachments = [],
  tokensByArtifact = {},
  chapterTokens = {},
  artifactTitles = {},
  artifactSubtitles = {},
  onToggleAttachment,
  onUnstageAttachment,
  onSetAttachmentGranularity,
  onOpenArtifacts,
  chosenVoice = 'Kore',
  chatRender = 'markdown',
  enterSend = 'send',
  onOpenArtifact,
  threadTitle = 'New thread',
  threadTitleState = 'placeholder',
  threadArchived = false,
  onSuggestTitle,
  onRenameTitle,
  onUnarchive,
  drafts = [],
  onRetryDraft,
  onStoreAsIsDraft,
  onDiscardDraft,
  onRegenerateLast,
  draftText,
  onDraftTextChange,
  missingMatchCount = 0,
  onOpenArtifactsWithProximity,
  projectCapabilities,
  onSetProjectCapabilities,
  onMergeChapter,
  onShiftBoundary,
  onRecalibrateChapter,
}) => {
  const [feedScrolled, setFeedScrolled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessagesCountRef = useRef<number>(0);
  const totalMessagesCount = (chapters || []).reduce(
    (acc, grp) => acc + (grp.turns ? grp.turns.length : 0),
    0
  );
  const online = useSyncExternalStore(subscribeOnline, isOnline);
  // Per-message voice playback (device cache scan, download-and-cache, transport).
  const { playingMessageId, ttsLoadingId, cachedIds, ttsFailedIds, handlePlayTTS } = useMessageTts(
    chapters,
    chosenVoice,
    online
  );

  const [collapsedChapterIds, setCollapsedChapterIds] = useState<Record<string, boolean>>({});
  // Chapter body layers (description / summary) — COLLAPSED by default
  // (2026-10-25: a Full cut dumped both layers' full prose into the chat).
  const [collapsedChapterLayers, setCollapsedChapterLayers] = useState<Record<string, boolean>>({});
  const isLayerCollapsed = (chapterId: string, layer: 'description' | 'summary'): boolean =>
    collapsedChapterLayers[`${chapterId}:${layer}`] ?? true;
  const toggleChapterLayer = (chapterId: string, layer: 'description' | 'summary'): void =>
    setCollapsedChapterLayers((prev) => ({ ...prev, [`${chapterId}:${layer}`]: !(prev[`${chapterId}:${layer}`] ?? true) }));
  const [summarizingIds, setSummarizingIds] = useState<Record<string, boolean>>({});
  const [summarizeErrorIds, setSummarizeErrorIds] = useState<Record<string, string>>({});
  // Chat capability toggles: what the checkboxes show is the RESOLVED state —
  // defaults ← project. One scope (2026-10-29): no per-chat overrides.
  const resolvedCapabilities = resolveCapabilities(null, projectCapabilities);
  // Chapter header menu (Package 2 §2.6): which chapter's ⋯ menu is open, and
  // the steering-note input for "Regenerate summary".
  const [chapterMenuId, setChapterMenuId] = useState<string | null>(null);
  const [steerChapterId, setSteerChapterId] = useState<string | null>(null);
  const [steerText, setSteerText] = useState('');
  // Inline "Split Chapter" form state
  const [declaringMessageId, setDeclaringMessageId] = useState<string | null>(null);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const toggleCollapseChapter = (id: string) => {
    setCollapsedChapterIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  // Design 23 §2.1.2: while the head draft is queued and nothing is sending,
  // the tray is THAT draft's editor — rows come from its snapshot. Otherwise
  // it shows the live staged set (arms the next send).
  const headDraft = drafts[0];
  const editingDraft =
    headDraft && headDraft.state === 'queued' && !drafts.some((d) => d.state === 'sending')
      ? headDraft
      : null;
  const stagedAttachments = (editingDraft?.attachments ?? attachments).filter(isAttachmentStaged);
  const trayCaption = editingDraft
    ? 'riding this send · removable until it goes out'
    : 'arms the next send · removable until then';
  const activeDraftForPhase =
    drafts.find((d) => d.state === 'sending') ?? drafts.find((d) => d.state === 'queued');
  const committedAttachments = attachments.filter((a) => !isAttachmentStaged(a));

  const attachmentsOfTurn = (message: Turn, globalIndex: number): ChatAttachment[] =>
    committedAttachments.filter((a) =>
      a.turnId ? a.turnId === message.id : a.turnIndex === globalIndex
    );

  /**
   * Attachments committed inside a chapter's window — the compacted strip.
   * `turnIndex === -1` means unknown provenance (pre-tracking data), so it rides
   * the first chapter instead of claiming a turn it doesn't have.
   */
  const attachmentsOfChapter = (chapter: ChapterTurns['chapter']): ChatAttachment[] => {
    const end = typeof chapter.endIndex === 'number' ? chapter.endIndex : Number.MAX_SAFE_INTEGER;
    return committedAttachments.filter((a) =>
      a.turnIndex === -1
        ? chapter.startIndex === 0
        : typeof a.turnIndex === 'number' && a.turnIndex >= chapter.startIndex && a.turnIndex < end
    );
  };

  const tokensFor = (artifactId: string) => tokensByArtifact[artifactId] ?? 0;
  const titleFor = (artifactId: string) => artifactTitles[artifactId] || artifactId;
  const chapterList = chapters.map((entry) => entry.chapter);
  const subtitleFor = (artifactId: string) => artifactSubtitles[artifactId] || '';
  /**
   * Fill a missing layer WITHOUT touching the chosen cut. "Write it" is a
   * request for text, never a stealth change of what gets sent.
   */
  const triggerChapterSummarize = (chapterId: string) => {
    setSummarizeErrorIds((prev) => {
      if (!(chapterId in prev)) return prev;
      const next = { ...prev };
      delete next[chapterId];
      return next;
    });
    setSummarizingIds((prev) => ({ ...prev, [chapterId]: true }));
    Promise.resolve(onSummarizeChapter(chapterId))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setSummarizeErrorIds((prev) => ({ ...prev, [chapterId]: msg }));
      })
      .finally(() => setSummarizingIds((prev) => ({ ...prev, [chapterId]: false })));
  };
  /**
   * The chapter cut control: tapping a granularity unfolds the chapter AND, if
   * that layer does not exist yet, fires the summarize call — so the body is
   * never a mystery blank box.
   */
  const handleSetChapterCut = (chapter: ChapterTurns, next: Granularity) => {
    onSetChapterGranularity?.(chapter.chapter.id, next);
    setCollapsedChapterIds((prev) => ({ ...prev, [chapter.chapter.id]: false }));
    const missingLayer =
      (next === 'description' && !chapter.chapter.description) ||
      (next === 'summary' && !chapter.chapter.summary);
    if (!missingLayer || chapter.turns.length === 0) return;
    triggerChapterSummarize(chapter.chapter.id);
  };
  // The tray moved into the feed, so a stage/unstage has to bring it into view.
  const stagedCount = stagedAttachments.length;
  useEffect(() => {
    if (stagedCount === 0) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedCount]);
  // Auto-scroll ONLY when a new message is appended (NOT on summary toggles or loading state)
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      prevMessagesCountRef.current = totalMessagesCount;
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      return;
    }
    if (totalMessagesCount > prevMessagesCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessagesCountRef.current = totalMessagesCount;
  }, [totalMessagesCount]);
  // Offline replica is a read-only mirror (decision 2026-10-29): the user can
  // look, never touch — no sends, no unlocks, no server calls.
  const offlineReplica = isOfflineReplica();

  // The composers (hero + footer) share one draft and one padlock state.
  const composer = useComposer({
    draftText,
    onDraftTextChange,
    isLoading,
    onSendMessage,
    onOpenKeySettings,
    enterSend,
  });

  const handleDeclareSubmit = (msgId: string) => {
    if (!newChapterTitle.trim()) return;
    logger.action('ChatView', 'Declare new chapter boundary split', { messageId: msgId, newChapterTitle: newChapterTitle.trim() });
    onDeclareChapter(msgId, newChapterTitle.trim());
    setDeclaringMessageId(null);
    setNewChapterTitle('');
  };
  const lastAssistantMessageId = (() => {
    for (let i = chapters.length - 1; i >= 0; i--) {
      const turns = chapters[i].turns;
      for (let j = turns.length - 1; j >= 0; j--) {
        if (turns[j].role === 'assistant') return turns[j].id as string;
      }
    }
    return null;
  })();

  // Everything a message bubble needs, threaded through the chapter sections.
  const messageProps: MessageBubbleSharedProps = {
    chatRender,
    online,
    offlineReplica,
    chosenVoice,
    playingMessageId,
    ttsLoadingId,
    cachedIds,
    ttsFailedIds,
    handlePlayTTS,
    declaringMessageId,
    setDeclaringMessageId,
    newChapterTitle,
    setNewChapterTitle,
    handleDeclareSubmit,
    chapters,
    artifactTitles,
    onOpenArtifact,
    onOpenReceipts,
    attachmentsOfTurn,
    titleFor,
    subtitleFor,
    tokensFor,
    onToggleAttachment,
    onSetAttachmentGranularity,
    onRegenerateLast,
    lastAssistantMessageId,
    isLoading,
    draftCount: drafts.length,
  };


  return (

    <div className="relative flex-1 flex flex-col min-h-0 min-w-0 w-full h-full bg-surface-0 text-ink select-text overflow-hidden pt-0 mt-0">

      <ArchiveBanner threadArchived={threadArchived} threadTitle={threadTitle} onUnarchive={onUnarchive} />

      {/* No floating title pill any more: an 11px chip hovering over the text
          was not a title, and rename was a trip to the sidebar. The title is
          now the first thing in the feed (in flow, scrolls away, editable). */}

      {totalMessagesCount === 0 ? (
        <div className="flex-1 min-h-[400px] flex flex-col items-center p-4 sm:p-8 overflow-y-auto">
          <div className="w-full max-w-2xl space-y-6 my-auto transition-opacity duration-300">
            <div className="text-center space-y-3">
              <div
                style={{ backgroundColor: `${project.color || '#3b82f6'}22` }}
                className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center"
              >
                <Brain className="w-8 h-8" style={{ color: project.color || '#3b82f6' }} />
              </div>

              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-ink tracking-tight font-mono">
                  {project.name || 'Untitled Project'}
                </h1>
                <div className="flex items-center justify-center gap-2 text-xs text-[#6e85a6] font-mono mt-1">
                  <span>{project.codeName || 'CORE'}</span>
                  <span aria-hidden="true">·</span>
                  <span>Thinking space</span>
                  <span aria-hidden="true">·</span>
                  <span>Local-first</span>
                </div>
              </div>

              {project.description && (
                <p className="text-xs sm:text-sm text-[#8299ba] max-w-lg mx-auto leading-relaxed">
                  {project.description}
                </p>
              )}
            </div>

            {/* Staged tray works before the first message too — you can arm
                notes, watch the cost, then start the conversation. */}
            <StagedTray
              items={stagedAttachments.map((a) => ({
                artifactId: a.artifactId,
                title: titleFor(a.artifactId),
                subtitle: subtitleFor(a.artifactId),
                tokens: tokensFor(a.artifactId),
                granularity: a.granularity,
              }))}
              onSetGranularity={(id, g) => onSetAttachmentGranularity?.(id, g)}
              onUnstage={(id) => onUnstageAttachment?.(id)}
              onOpenDetail={onOpenArtifact}
              caption={trayCaption}
            />

            {offlineReplica ? (
              <div
                data-testid="offline-readonly-strip"
                className="rounded-2xl bg-recess-1 px-4 py-3 text-center text-11 font-mono text-ink-mute shadow-well"
              >
                Offline replica — read-only. Sign in to make changes.
              </div>
            ) : (

            <HeroComposer
              composer={composer}
              enterSend={enterSend}
              resolvedCapabilities={resolvedCapabilities}
              onSetProjectCapabilities={onSetProjectCapabilities}
              missingMatchCount={missingMatchCount}
              onOpenArtifacts={onOpenArtifacts}
              onOpenArtifactsWithProximity={onOpenArtifactsWithProximity}
              isLoading={isLoading}
              onStopGeneration={onStopGeneration}
            />

            )}
          </div>
        </div>
      ) : (
        /* Unified Vertical Chat Feed with Episodic Chapters - ZERO TOP BAR */
        <div
          className="flex-1 overflow-y-auto px-3 pb-3 sm:px-6 sm:pb-4 space-y-4"
          onScroll={(e) => {
            const next = e.currentTarget.scrollTop > 24;
            if (next !== feedScrolled) setFeedScrolled(next);
          }}
        >
          {/* THE TITLE — a real title, in flow at the top of the feed and edited
              right here. It pins as a slim bar once you scroll past it. The
              identity sits CENTERED with a fixed 16/24px gutter on both sides:
              the sidebar's brain toggle is position:fixed at (12, 12) z-50 at
              any viewport width when the dock is closed (it used to swallow the
              auto-title sparkle once the sm:pl-6 kicked in), and the token orb
              floats at the top-right. Centering keeps the identity out of both
              corners; the gutters keep the two buttons clear of the text. */}
          {/* design 26 (live note): the pinned band is NOT full width — it
              shrinks to a centered pill (~60% max) so it stops reading as a
              toolbar, and it is smaller overall. On short viewports (phone
              landscape) the whole row hides: every vertical pixel matters
              there, and a pinned title band is pure overhead. */}

          <ChatHeader
            project={project}
            threadTitle={threadTitle}
            threadTitleState={threadTitleState}
            threadArchived={threadArchived}
            onSuggestTitle={onSuggestTitle}
            onRenameTitle={onRenameTitle}
            feedScrolled={feedScrolled}
            offlineReplica={offlineReplica}
          />


          {/* Clearance for the floating token orb — scrolls away with the
              content, never sticky, never fixed (phones need every pixel back
              the moment you scroll). */}
          <div
            data-testid="scroll-top-clearance"
            aria-hidden="true"
            className="h-2 shrink-0 -mt-2"
          />
          {chapters.map((entry, chapterIndex) => {
            const { chapter, ongoing: isOngoing, granularity, turns } = entry;

            return (
              <ChapterSection
                key={chapter.id}
                chapters={chapters}
                chapterIndex={chapterIndex}
                chapter={chapter}
                isOngoing={isOngoing}
                granularity={granularity}
                turns={turns}
                chapterList={chapterList}
                chapterTokens={chapterTokens}
                isCollapsed={collapsedChapterIds[chapter.id] ?? false}
                isLayerCollapsed={(layer) => isLayerCollapsed(chapter.id, layer)}
                onToggleLayer={(layer) => toggleChapterLayer(chapter.id, layer)}
                onToggleCollapse={() => toggleCollapseChapter(chapter.id)}
                chapterMenuOpen={chapterMenuId === chapter.id}
                onToggleMenu={() => {
                  setSteerChapterId(null);
                  setChapterMenuId(chapterMenuId === chapter.id ? null : chapter.id);
                }}
                onCloseMenu={() => setChapterMenuId(null)}
                steerActive={steerChapterId === chapter.id}
                steerText={steerText}
                onSteerTextChange={setSteerText}
                onSteerStart={() => {
                  setSteerText('');
                  setSteerChapterId(chapter.id);
                }}
                onSteerSubmit={() => {
                  void onRecalibrateChapter?.(chapter.id, steerText.trim() || undefined);
                  setSteerChapterId(null);
                  setChapterMenuId(null);
                }}
                onSteerCancel={() => setSteerChapterId(null)}
                summarizing={summarizingIds[chapter.id]}
                summarizeError={summarizeErrorIds[chapter.id]}
                onSummarize={() => triggerChapterSummarize(chapter.id)}
                onSetCut={
                  onSetChapterGranularity ? (g) => handleSetChapterCut(entry, g) : undefined
                }
                onMergeChapter={onMergeChapter}
                onShiftBoundary={onShiftBoundary}
                onRecalibrateChapter={onRecalibrateChapter}
                offlineReplica={offlineReplica}
                attachmentsOfChapter={attachmentsOfChapter}
                titleFor={titleFor}
                subtitleFor={subtitleFor}
                tokensFor={tokensFor}
                onToggleAttachment={onToggleAttachment}
                onSetAttachmentGranularity={onSetAttachmentGranularity}
                onOpenArtifact={onOpenArtifact}
                messageProps={messageProps}
              />
            );
          })}


        {isLoading && (
          <div className="flex items-center justify-between gap-3 text-xs font-mono text-ink-dim bg-surface-2 p-3 rounded-lg max-w-xl animate-in fade-in">
            <div className="flex items-center gap-2.5 min-w-0">
              <Loader2 className="w-4 h-4 animate-spin text-[#38bdf8] shrink-0" />
              {/* Design 23 §2.2: the bar leads with the phase chip + clock. */}
              <span
                data-testid="stream-phase-chip"
                className="shrink-0 font-mono text-10 uppercase tracking-wider text-[#38bdf8]"
              >
                <DraftPhaseChip
                  progress={activeDraftForPhase?.progress}
                  kind={activeDraftForPhase?.kind}
                  fallback="Working"
                />
              </span>
              <span className="truncate text-ink-dim">{streamingStatus}</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onOpenServerLogs && (
                <button
                  type="button"
                  onClick={onOpenServerLogs}
                  disabled={!online}
                  className="px-2 py-1 rounded-lg bg-surface-3 hover:bg-surface-4 text-10 text-ink-dim hover:text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
                  title={!online ? 'Offline — logs need a connection' : 'View live server logs'}
                >
                  Logs
                </button>
              )}
              {onStopGeneration && (
                <button
                  type="button"
                  onClick={onStopGeneration}
                  className="px-2.5 py-1 rounded-lg bg-wash-danger hover:bg-[#3a1a20] text-[#f87171] text-11 font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                  title="Stop generating"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* The staged files are the NEXT turn's addendum, so they live in the
            flow — never in the fixed footer, where a long list crushes the
            chat to 0px and nothing scrolls. */}
        {stagedAttachments.length > 0 && (
          <div className="px-3 sm:px-6 pb-2">
            <StagedTray
              items={stagedAttachments.map((a) => ({
                artifactId: a.artifactId,
                title: titleFor(a.artifactId),
                subtitle: subtitleFor(a.artifactId),
                tokens: tokensFor(a.artifactId),
                granularity: a.granularity,
              }))}
              onSetGranularity={(id, g) => onSetAttachmentGranularity?.(id, g)}
              onUnstage={(id) => onUnstageAttachment?.(id)}
              onOpenDetail={onOpenArtifact}
              caption={trayCaption}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
      )}

      <DraftQueueTray
        drafts={drafts}
        offlineReplica={offlineReplica}
        tokensFor={tokensFor}
        titleFor={titleFor}
        onRetryDraft={onRetryDraft}
        onStoreAsIsDraft={onStoreAsIsDraft}
        onDiscardDraft={onDiscardDraft}
      />


      {totalMessagesCount > 0 && (
        <div className="p-2.5 sm:p-3 bg-surface-0 shrink-0 space-y-2">
          {offlineReplica ? (
            <div
              data-testid="offline-readonly-strip-bottom"
              className="rounded-2xl bg-recess-1 px-4 py-3 text-center text-11 font-mono text-ink-mute shadow-well max-w-4xl mx-auto"
            >
              Offline replica — read-only. Sign in to make changes.
            </div>
          ) : (


          <ThreadComposer
            composer={composer}
            enterSend={enterSend}
            resolvedCapabilities={resolvedCapabilities}
            onSetProjectCapabilities={onSetProjectCapabilities}
            missingMatchCount={missingMatchCount}
            onOpenArtifacts={onOpenArtifacts}
            onOpenArtifactsWithProximity={onOpenArtifactsWithProximity}
            isLoading={isLoading}
            onStopGeneration={onStopGeneration}
          />
          )}

         </div>
      )}


      <ComposerUnlockModal composer={composer} />

    </div>
  );
};
