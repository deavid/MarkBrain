import React, { useState, useRef, useEffect } from 'react';
import {
  Artifact,
  ChapterTurns,
  ExtractedArtifact,
  Turn,
  getMellowPastelColor,
} from '../../types';
import type { ProjectMetadata } from '../../domains/00-workspace/types';
import {
  Sparkles,
  Send,
  Loader2,
  FileCode,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronUp,
  BookmarkPlus,
  Check,
  Compass,
  Square,
  Terminal,
  AlertCircle,
  Cloud,
  Brain,
  Plus,
} from 'lucide-react';
import { logger } from '../../utils/logger';
import { ThreadRuntime, ChatAttachment, isAttachmentStaged } from '../../domains/06-chat-threads';
import type { Granularity, AttachmentVisualState } from '../../domains/granularity';
import { GRANULARITY_LABEL, cutIncludes, getAttachmentStatePalette } from '../../domains/granularity';
import {
  AttachmentDot,
  GranularityChips,
  AttachmentRow,
  StagedTray,
  dotVerbLabel,
  formatTokens,
} from '../context/AttachmentControls';
import { tts } from '../../gateway/api';

interface ChatViewProps {
  project: ProjectMetadata;
  /** Chapters with their turns — the shared selector (02-chapter-segmentation/selectors). */
  chapters: ChapterTurns[];
  onSendMessage: (text: string) => Promise<void>;
  isLoading: boolean;
  streamingStatus?: string | null;
  /** Which serial-queue phase the active thread's job is in (working only). */
  streamPhase?: 'waiting' | 'streaming' | null;
  onStopGeneration?: () => void;
  onOpenServerLogs?: () => void;
  onAddArtifactToProject: (artifact: Artifact) => void;
  onSummarizeChapter: (chapterId: string) => Promise<void>;
  onDeclareChapter: (messageId: string, title: string) => void;
  /** Chapter granularity — the one knob; the compiler honors all four. */
  onSetChapterGranularity?: (chapterId: string, granularity: Granularity) => void;
  onSelectArtifact?: (artifact: Artifact | ExtractedArtifact) => void;
  // ── Attachments (10_ATTACHMENT_TIMELINE.md) ──────────────────────────────
  /** This chat's attachments — staged + committed, in attach order. */
  attachments?: ChatAttachment[];
  /** Compiler's per-artifact token cost at the current cut. */
  tokensByArtifact?: Record<string, number>;
  /** Compiler's per-chapter token cost at the current cut. */
  chapterTokens?: Record<string, number>;
  /** Artifact titles for the attachment cards (id → title). */
  artifactTitles?: Record<string, string>;
  /** The dot verb on a turn card: committed items only cycle granularity. */
  onToggleAttachment?: (artifactId: string) => void;
  /** Unstage a staged item from the tray. */
  onUnstageAttachment?: (artifactId: string) => void;
  onSetAttachmentGranularity?: (artifactId: string, granularity: Granularity) => void;
  /** Jump to the Artifacts folder (the picker). */
  onOpenArtifacts?: () => void;
  /** Read-aloud voice (the selector itself lives in the sidebar now). */
  chosenVoice?: string;
  // Thread chrome (06-chat-threads)
  threadTitle?: string;
  threadTitleState?: 'placeholder' | 'auto' | 'manual';
  threadArchived?: boolean;
  threadRuntime?: ThreadRuntime;
  queuePosition?: number;
  onSuggestTitle?: () => void;
  onUnarchive?: () => void;
  onRetry?: () => void;
  onCancelQueued?: () => void;
}

// Prebuilt TTS voices supported by the Gemini TTS endpoint (/api/tts)
const TTS_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'] as const;

// Consistent mellow dark pastel palette for chapters
const CHAPTER_PASTEL_COLORS = [
  { border: 'border-[#2d3a4f]', bgHeader: 'bg-[#121a28]', dot: '#7093be', text: 'text-[#8ab1e0]' }, // slate steel blue
  { border: 'border-[#2b3a36]', bgHeader: 'bg-[#111c18]', dot: '#5da88b', text: 'text-[#7ec2a6]' }, // mellow sage green
  { border: 'border-[#3a3345]', bgHeader: 'bg-[#1a1523]', dot: '#9d80ba', text: 'text-[#b9a1d4]' }, // dark muted mauve
  { border: 'border-[#3d3428]', bgHeader: 'bg-[#1c1710]', dot: '#b59765', text: 'text-[#d6be94]' }, // mellow dark amber
  { border: 'border-[#243745]', bgHeader: 'bg-[#101b24]', dot: '#64a3ba', text: 'text-[#8ac5db]' }, // dark muted teal
];

export const ChatView: React.FC<ChatViewProps> = ({
  project,
  chapters,
  onSendMessage,
  isLoading,
  streamingStatus,
  streamPhase,
  onStopGeneration,
  onOpenServerLogs,
  onAddArtifactToProject,
  onSummarizeChapter,
  onDeclareChapter,
  onSetChapterGranularity,
  onSelectArtifact,
  attachments = [],
  tokensByArtifact = {},
  chapterTokens = {},
  artifactTitles = {},
  onToggleAttachment,
  onUnstageAttachment,
  onSetAttachmentGranularity,
  onOpenArtifacts,
  chosenVoice = 'Kore',
  threadTitle = 'New thread',
  threadTitleState = 'placeholder',
  threadArchived = false,
  threadRuntime = 'idle',
  queuePosition = 0,
  onSuggestTitle,
  onUnarchive,
  onRetry,
  onCancelQueued,
}) => {
  const [inputText, setInputText] = useState('');
  const [showPrompts, setShowPrompts] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const heroInputRef = useRef<HTMLTextAreaElement>(null);
  const prevMessagesCountRef = useRef<number>(0);

  // Total turn count across chapter windows (safe navigation against undefined)
  const totalMessagesCount = (chapters || []).reduce(
    (acc, grp) => acc + (grp.turns ? grp.turns.length : 0),
    0
  );

  // Auto-focus hero input on fresh workspace
  useEffect(() => {
    if (totalMessagesCount === 0 && heroInputRef.current) {
      heroInputRef.current.focus();
    }
  }, [totalMessagesCount]);

  // Live timer while request is running
  useEffect(() => {
    let timer: any = null;
    if (isLoading) {
      setElapsedSeconds(0);
      timer = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isLoading]);

  // Audio / TTS State (the voice SELECTOR lives in the sidebar now; ChatView
  // only plays back with the chosen voice)
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Accordion state for chapter folding
  const [collapsedChapterIds, setCollapsedChapterIds] = useState<Record<string, boolean>>({});
  /** Chapters whose description/summary we are generating right now. */
  const [summarizingIds, setSummarizingIds] = useState<Record<string, boolean>>({});

  // Inline "Split Chapter" form state
  const [declaringMessageId, setDeclaringMessageId] = useState<string | null>(null);
  const [newChapterTitle, setNewChapterTitle] = useState('');

  const toggleCollapseChapter = (id: string) => {
    setCollapsedChapterIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // ── Attachments: staged tray + turn anchors (10_ATTACHMENT_TIMELINE.md) ──
  const stagedAttachments = attachments.filter(isAttachmentStaged);
  const committedAttachments = attachments.filter((a) => !isAttachmentStaged(a));

  /** Attachments welded to a specific turn (turnId, or the turn's global index). */
  const attachmentsOfTurn = (message: Turn, globalIndex: number): ChatAttachment[] =>
    committedAttachments.filter((a) =>
      a.turnId ? a.turnId === message.id : a.turnIndex === globalIndex
    );

  /** Attachments committed inside a chapter's window — the compacted strip. */
  const attachmentsOfChapter = (chapter: ChapterTurns['chapter']): ChatAttachment[] => {
    const end = typeof chapter.endIndex === 'number' ? chapter.endIndex : Number.MAX_SAFE_INTEGER;
    return committedAttachments.filter(
      (a) =>
        typeof a.turnIndex === 'number' &&
        a.turnIndex >= chapter.startIndex &&
        a.turnIndex < end
    );
  };

  const tokensFor = (artifactId: string) => tokensByArtifact[artifactId] ?? 0;
  const titleFor = (artifactId: string) => artifactTitles[artifactId] || artifactId;

  /**
   * The chapter cut control. What you see is what you send (10 §5): tapping a
   * granularity unfolds the chapter AND, if that layer does not exist yet,
   * fires the summarize call so the body is never a mystery blank box.
   */
  const handleSetChapterCut = (chapter: ChapterTurns, next: Granularity) => {
    onSetChapterGranularity?.(chapter.chapter.id, next);
    setCollapsedChapterIds((prev) => ({ ...prev, [chapter.chapter.id]: false }));
    const missingLayer =
      (next === 'description' && !chapter.chapter.description) ||
      (next === 'summary' && !chapter.chapter.summary);
    if (!missingLayer || chapter.turns.length === 0) return;
    setSummarizingIds((prev) => ({ ...prev, [chapter.chapter.id]: true }));
    Promise.resolve(onSummarizeChapter(chapter.chapter.id))
      .catch((err) => logger.error('ChatView', 'Chapter summarize failed', err))
      .finally(() =>
        setSummarizingIds((prev) => ({ ...prev, [chapter.chapter.id]: false }))
      );
  };

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) {
      logger.warn('ChatView', 'Ignored empty submission attempt');
      return;
    }
    if (isLoading) {
      logger.warn('ChatView', 'Ignored submission while reasoning stream is active');
      return;
    }
    const msg = inputText;
    logger.action('ChatView', 'User sent message', { length: msg.length, snippet: msg.substring(0, 80) });
    setInputText('');
    setShowPrompts(false);
    onSendMessage(msg);
  };

  // TTS Handler with explicit waiting indicator
  const handlePlayTTS = async (message: Turn) => {
    logger.action('ChatView', 'Toggle TTS Audio playback', { messageId: message.id });
    if (playingMessageId === message.id) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setPlayingMessageId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    setTtsLoadingId(message.id);

    try {
      const res = await tts({
        text: message.content,
        voice: chosenVoice,
      });

      const data = await res.json();

      if (data.audioData) {
        const audioUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioData}`;
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.onended = () => {
          setPlayingMessageId(null);
          audioRef.current = null;
        };
        audio.onerror = () => {
          logger.warn('ChatView', 'TTS audio playback failed, falling back to browser speech synthesis');
          fallbackSpeech(data.cleanSpokenText || message.content, message.id);
        };
        await audio.play();
        setPlayingMessageId(message.id);
      } else {
        fallbackSpeech(data.cleanSpokenText || message.content, message.id);
      }
    } catch (err) {
      logger.warn('ChatView', 'TTS API request failed, falling back to web speech', err);
      fallbackSpeech(message.content, message.id);
    } finally {
      setTtsLoadingId(null);
    }
  };

  const fallbackSpeech = (text: string, msgId: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.onend = () => setPlayingMessageId(null);
      utterance.onerror = () => setPlayingMessageId(null);
      window.speechSynthesis.speak(utterance);
      setPlayingMessageId(msgId);
    } else {
      setPlayingMessageId(null);
    }
  };

  const handleDeclareSubmit = (msgId: string) => {
    if (!newChapterTitle.trim()) return;
    logger.action('ChatView', 'Declare new chapter boundary split', { messageId: msgId, newChapterTitle: newChapterTitle.trim() });
    onDeclareChapter(msgId, newChapterTitle.trim());
    setDeclaringMessageId(null);
    setNewChapterTitle('');
  };

  // Retry affordance: only for the LAST assistant message when the thread is
  // idle (not working/queued) and that reply died (error/interrupted).
  const lastGroup = chapters[chapters.length - 1];
  const lastMessage = lastGroup?.turns[lastGroup.turns.length - 1];
  const lastMessageFailed =
    lastMessage?.role === 'assistant' &&
    (lastMessage.meta?.streamState === 'error' ||
      lastMessage.meta?.streamState === 'interrupted');
  const showRetry =
    Boolean(onRetry) &&
    (threadRuntime === 'error' || threadRuntime === 'interrupted') &&
    !isLoading &&
    queuePosition === 0 &&
    lastMessageFailed;

  return (
    <div className="relative flex-1 flex flex-col min-h-0 min-w-0 w-full h-full bg-[#0d121c] text-[#e3edf7] select-text overflow-hidden pt-0 mt-0">
      {/* Archived thread: readable, one click to continue */}
      {threadArchived && (
        <div className="flex items-center justify-between gap-3 px-3 sm:px-6 py-1.5 bg-[#0a0f19] border-b border-[#1a293e] text-[10px] font-mono text-[#7d93b3] shrink-0 animate-in fade-in duration-150">
          <span className="truncate">
            Archived — you can read it. Typing asks to unarchive first.
          </span>
          <button
            type="button"
            onClick={() => {
              onUnarchive?.();
              logger.action('ChatView', 'Unarchived thread from banner', { title: threadTitle });
            }}
            className="px-2.5 py-1 rounded-lg bg-[#141d2d] hover:bg-[#1a273d] border border-[#1d2d47] text-[#8ab1e0] transition-colors cursor-pointer shrink-0"
          >
            Unarchive
          </button>
        </div>
      )}

      {/* Floating thread title — overlays content, reserves NO vertical space.
          Appears over the chat (nice on scroll-up); rename lives in the sidebar. */}
      {!threadArchived && (
        <div className="absolute top-1.5 left-14 right-3 z-20 flex items-center gap-1.5 pointer-events-none">
          <span
            className={`truncate text-[11px] font-mono font-semibold text-[#8ab1e0]/85 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] bg-[#0d121c]/70 backdrop-blur-sm rounded-md px-2 py-1 border border-[#162234]/60 ${
              threadTitleState === 'placeholder' ? 'italic' : ''
            }`}
            title="Rename in the sidebar (double-click the thread)"
          >
            {threadTitle}
          </span>
          <button
            type="button"
            onClick={() => onSuggestTitle?.()}
            className="pointer-events-auto p-1 rounded-md bg-[#0d121c]/70 backdrop-blur-sm border border-[#162234]/60 text-[#e0b96c] hover:text-[#f0d090] transition-colors cursor-pointer"
            title="Auto-generate a title for this thread"
          >
            <Sparkles className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* If project has zero messages, render the Centered Hero Input Composer */}
      {totalMessagesCount === 0 ? (
        <div className="flex-1 min-h-[400px] flex flex-col items-center justify-center p-4 sm:p-8 overflow-y-auto">
          <div className="w-full max-w-2xl space-y-6 my-auto transition-opacity duration-300">
            {/* Project Brand */}
            <div className="text-center space-y-3">
              <div
                style={{ borderColor: `${project.color || '#3b82f6'}55` }}
                className="w-16 h-16 rounded-2xl bg-[#111928] border mx-auto flex items-center justify-center shadow-xl"
              >
                <Brain className="w-8 h-8" style={{ color: project.color || '#3b82f6' }} />
              </div>

              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight font-mono">
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
                tokens: tokensFor(a.artifactId),
                granularity: a.granularity,
              }))}
              onSetGranularity={(id, g) => onSetAttachmentGranularity?.(id, g)}
              onUnstage={(id) => onUnstageAttachment?.(id)}
            />

            {/* Elevated Hero Input Card */}
            <form
              onSubmit={handleSubmit}
              className="bg-[#0b101a] border border-[#162234] focus-within:border-[#3b82f6]/70 rounded-2xl p-4 shadow-2xl transition-all space-y-3"
            >
              <textarea
                ref={heroInputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (inputText.trim() && !isLoading) {
                      handleSubmit(e);
                    }
                  }
                }}
                placeholder="Pour it out before it evaporates — we'll organize later."
                rows={3}
                disabled={isLoading}
                autoFocus
                className="w-full bg-transparent text-xs sm:text-sm text-[#eef4fc] placeholder-[#50637f] focus:outline-none resize-none leading-relaxed font-sans"
              />

              <div className="flex items-center justify-between pt-2 border-t border-[#131d2e] text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      logger.action('ChatView', 'Open artifacts folder to attach (hero)');
                      onOpenArtifacts?.();
                    }}
                    data-testid="open-artifacts"
                    className="relative min-h-[30px] px-2.5 rounded-xl bg-[#090d15] border border-[#162234] hover:border-[#67e8f9]/50 text-[#8ab1e0] hover:text-[#eef4fc] transition-colors flex items-center gap-1.5 cursor-pointer font-mono text-[11px] shrink-0"
                    title="Attach artifacts from the library"
                    aria-label="Attach artifacts"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span>Attach</span>
                    {stagedAttachments.length > 0 && (
                      <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-[#67e8f9] text-[#06131f] text-[9px] font-mono font-bold flex items-center justify-center">
                        {stagedAttachments.length}
                      </span>
                    )}
                  </button>
                  <span className="text-[11px] font-mono text-[#5b7394] hidden sm:inline">
                    Enter to send
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={!inputText.trim() || isLoading}
                  className="px-4 py-2 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] active:bg-[#1e40af] disabled:opacity-40 text-white font-mono text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Synthesizing...</span>
                    </>
                  ) : (
                    <>
                      <span>Start Dialogue</span>
                      <Send className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        /* Unified Vertical Chat Feed with Episodic Chapters - ZERO TOP BAR */
        <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-4 space-y-4">
          {/* In-flow clearance for the floating title pill + token orb. It
              scrolls away with the content — never sticky, never fixed
              (phones need every pixel back the moment you scroll). */}
          <div
            data-testid="scroll-top-clearance"
            aria-hidden="true"
            className="h-10 shrink-0 border-b border-[#162234]/80 -mt-1"
          />
          {chapters.map(({ chapter, ongoing: isOngoing, granularity, turns }, chapterIndex) => {
          const isCollapsed = collapsedChapterIds[chapter.id] ?? false;

          // Pick mellow dark pastel color for nuance
          const chapColor = getMellowPastelColor(chapter.id || chapterIndex);
          const pastel = CHAPTER_PASTEL_COLORS[chapterIndex % CHAPTER_PASTEL_COLORS.length];

          return (
            <section
              key={chapter.id}
              style={{
                borderColor: `${chapColor}55`,
                boxShadow: `0 4px 24px -4px ${chapColor}15`,
              }}
              className={`transition-all duration-200 relative border ${
                isOngoing
                  ? `rounded-t-2xl rounded-b-none bg-[#0c1322]/90 border-b-0 overflow-visible mt-2 mb-0`
                  : `rounded-2xl bg-[#0c121e]/85 overflow-hidden mb-5 shadow-sm`
              }`}
            >
              {/* Chapter Header Ribbon */}
              <div
                style={{
                  backgroundColor: `${chapColor}18`,
                  borderBottomColor: `${chapColor}40`,
                }}
                className="p-3 sm:p-3.5 border-b flex flex-wrap items-center justify-between gap-2.5 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Status Indicator Dot with pastel nuance */}
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
                    style={{ backgroundColor: chapColor }}
                    title={isOngoing ? 'Active Chapter' : 'Completed Chapter'}
                  />

                  <span
                    style={{ color: chapColor }}
                    className="text-[10px] font-mono uppercase tracking-wider shrink-0 font-semibold"
                  >
                    Chapter {chapterIndex + 1}
                  </span>

                  <h3 className="font-semibold text-xs sm:text-sm text-[#eef4fc] truncate font-mono">
                    {chapter.title}
                  </h3>

                </div>

                {/* Chapter Actions: the four words (what gets sent) + token cost + fold */}
                <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap justify-end">
                  <span className="text-[10px] font-mono text-[#556985] mr-1 tabular-nums">
                    {turns.length} msg{turns.length !== 1 ? 's' : ''}
                    {chapterTokens[chapter.id] !== undefined && (
                      <> · <span className="text-[#8ab1e0]">{formatTokens(chapterTokens[chapter.id])} tok</span></>
                    )}
                  </span>

                  {onSetChapterGranularity && (
                    <div data-testid="chapter-cut" data-chapter-id={chapter.id}>
                      <GranularityChips
                        value={(chapter.granularity ?? granularity) as Granularity}
                        label={`Send chapter ${chapterIndex + 1}`}
                        compact
                        onChange={(g) =>
                          handleSetChapterCut(
                            { chapter, index: chapterIndex, ongoing: isOngoing, granularity, turns },
                            g
                          )
                        }
                      />
                    </div>
                  )}

                  {granularity !== 'title' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        toggleCollapseChapter(chapter.id);
                      }}
                      className="p-1 rounded-lg hover:bg-[#162134] text-[#8ca3c7] transition-colors cursor-pointer"
                      title={isCollapsed ? 'Expand the cut' : 'Fold this chapter'}
                    >
                      {isCollapsed ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronUp className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Compacted attachment strip — whenever this chapter's turns are
                  not on screen (folded, or sent below Full), its committed
                  attachments stay visible and steerable here. Granularity is
                  independent of the chapter cut (10 §5.5). */}
              {(() => {
                const chapterAtts = attachmentsOfChapter(chapter);
                const turnsHidden = isCollapsed || granularity !== 'full';
                if (!turnsHidden || chapterAtts.length === 0) return null;
                return (
                  <div className="px-3 sm:px-4 py-2 bg-[#0a1120] border-b border-[#121c2d] space-y-1.5">
                    <div className="text-[9px] font-mono uppercase tracking-wider text-[#556985]">
                      Attached in this chapter (independent of the cut)
                    </div>
                    {chapterAtts.map((att) => (
                      <AttachmentRow
                        key={att.artifactId}
                        state={att.granularity}
                        title={titleFor(att.artifactId)}
                        tokens={tokensFor(att.artifactId)}
                        granularity={att.granularity}
                        onToggle={
                          onToggleAttachment ? () => onToggleAttachment(att.artifactId) : undefined
                        }
                        onSetGranularity={
                          onSetAttachmentGranularity
                            ? (g) => onSetAttachmentGranularity(att.artifactId, g)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                );
              })()}

              {/* What you see is what you send (10 §5): the body renders exactly
                  the layers the current cut includes, in order — description,
                  summary, then the verbatim turns at Full. Title renders none
                  of them (the header IS the payload). */}
              {!isCollapsed && granularity !== 'title' && (
                <div
                  data-testid="chapter-body"
                  className="p-3 sm:p-4 bg-[#0a0f19] border-b border-[#121c2d] space-y-2"
                >
                  {chapter.description && (
                    <div className="text-xs text-[#b8cce6] leading-relaxed bg-[#0d1424] p-3 rounded-xl border border-[#141f33]">
                      <div className="font-semibold text-[10px] text-[#8ab1e0] mb-1 font-mono uppercase tracking-wider">
                        Description
                      </div>
                      <p className="text-[#dbe7f6]">{chapter.description}</p>
                    </div>
                  )}
                  {chapter.summary && (
                    <div className="text-xs text-[#b8cce6] leading-relaxed bg-[#0d1424] p-3 rounded-xl border border-[#141f33]">
                      <div className="font-semibold text-[10px] text-[#e0b96c] mb-1 font-mono uppercase tracking-wider">
                        Summary
                      </div>
                      <p className="whitespace-pre-wrap">{chapter.summary}</p>
                    </div>
                  )}
                  {/* Missing layer under a chosen cut = chrome, not content: a
                      real gap, honestly named, with the call that fills it.
                      At Full there is nothing to promise, so no chrome. */}
                  {granularity !== 'full' &&
                    ((cutIncludes(granularity, 'description') && !chapter.description) ||
                      (cutIncludes(granularity, 'summary') && !chapter.summary)) && (
                      <div className="flex items-center justify-between gap-3 text-[11px] text-[#7d93b3] p-2.5 bg-[#0d1424] rounded-xl border border-[#141f33]">
                        <span className="font-mono">
                          {summarizingIds[chapter.id]
                            ? 'Writing summary…'
                            : cutIncludes(granularity, 'summary') && !chapter.summary
                              ? 'No summary yet — this chapter is sending only what exists.'
                              : 'No description yet for this chapter.'}
                        </span>
                        {!summarizingIds[chapter.id] && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              handleSetChapterCut(
                                { chapter, index: chapterIndex, ongoing: isOngoing, granularity, turns },
                                chapter.summary ? 'description' : 'summary'
                              );
                            }}
                            className="text-[10px] font-mono px-2.5 py-1 rounded-lg bg-[#18263e] text-[#8ab1e0] hover:bg-[#203252] border border-[#233758] font-medium transition-colors cursor-pointer shrink-0"
                          >
                            Write it
                          </button>
                        )}
                      </div>
                    )}
                </div>
              )}

              {/* Messages Container — only when the cut actually includes the
                  turns. At Title/Description/Summary the body above IS the
                  payload; showing raw messages here would be the lie the old
                  "honest strip" confessed to (10 §5). */}
              {!isCollapsed && granularity === 'full' && turns.length > 0 && (
                <div className="p-3 sm:p-5 space-y-4">
                  {turns.map((message, turnIdx) => {
                    const globalTurnIndex = chapter.startIndex + turnIdx;
                    const isUser = message.role === 'user';
                    const isPlaying = playingMessageId === message.id;
                    const isTtsLoading = ttsLoadingId === message.id;

                    return (
                      <div
                        key={message.id}
                        className={`flex flex-col group ${isUser ? 'items-end' : 'items-start'}`}
                      >
                        {/* Speaker & Timestamp Header */}
                        <div className="flex items-center gap-2 mb-1 text-[11px] font-mono text-[#627794]">
                          <span className={isUser ? 'text-[#8ab1e0]' : 'text-[#e05a66] font-semibold'}>
                            {isUser ? 'You' : 'MarkBrain'}
                          </span>
                          <span>•</span>
                          <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>

                          {/* TTS Audio Button */}
                          <button
                            onClick={() => handlePlayTTS(message)}
                            disabled={isTtsLoading}
                            className={`p-1 rounded hover:bg-[#141b29] transition-colors cursor-pointer ${
                              isPlaying ? 'text-[#38bdf8]' : 'text-[#50637f] hover:text-[#9bb0d1]'
                            }`}
                            title={isPlaying ? 'Stop playback' : `Play audio (TTS) — voice: ${chosenVoice}`}
                          >
                            {isTtsLoading ? (
                              <Loader2 className="w-3 h-3 animate-spin text-[#38bdf8]" />
                            ) : isPlaying ? (
                              <VolumeX className="w-3 h-3" />
                            ) : (
                              <Volume2 className="w-3 h-3" />
                            )}
                          </button>

                          {/* Timeline Split Button (Declare Chapter Boundary) */}
                          <button
                            onClick={() => {
                              setDeclaringMessageId(
                                declaringMessageId === message.id ? null : message.id
                              );
                              setNewChapterTitle('');
                            }}
                            className="p-1 rounded hover:bg-[#141b29] text-[#50637f] hover:text-[#8ab1e0] transition-colors opacity-40 group-hover:opacity-100 cursor-pointer"
                            title="Split into new chapter starting at this message"
                          >
                            <BookmarkPlus className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Inline Timeline Split Form */}
                        {declaringMessageId === message.id && (
                          <div className="w-full max-w-lg my-2 p-3 bg-[#0a0f19] border border-[#1a293e] rounded-xl shadow-xl space-y-2 animate-in fade-in duration-150">
                            <div className="text-[10px] font-mono text-[#38bdf8] uppercase tracking-wider font-semibold">
                              Declare Chapter Split at this Message
                            </div>
                            <input
                              type="text"
                              value={newChapterTitle}
                              onChange={(e) => setNewChapterTitle(e.target.value)}
                              placeholder="New Chapter Title (e.g. On pricing)"
                              className="w-full bg-[#080d16] border border-[#162438] rounded-lg px-2.5 py-1.5 text-xs text-[#eef4fc] placeholder-[#556985] focus:outline-none focus:border-[#38bdf8]"
                            />
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                onClick={() => setDeclaringMessageId(null)}
                                className="px-2.5 py-1 text-xs font-mono text-[#7185a3] hover:text-white cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleDeclareSubmit(message.id)}
                                disabled={!newChapterTitle.trim()}
                                className="px-3 py-1 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 text-white rounded-lg text-xs font-mono font-medium shadow-md transition-colors cursor-pointer"
                              >
                                Split Chapter
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Bubble Content */}
                        <div
                          className={`max-w-[92%] sm:max-w-[85%] rounded-2xl p-3 sm:p-4 text-xs sm:text-sm leading-relaxed shadow-sm ${
                            isUser
                              ? 'bg-[#182338] text-[#eef4fc] border border-[#243552]'
                              : 'bg-[#0f1624] text-[#d6e3f5] border border-[#172235]'
                          }`}
                        >
                          <div className="whitespace-pre-wrap font-sans space-y-2">
                            {message.content ? (
                              message.content
                            ) : (
                              <div className="flex items-center gap-2 text-xs font-mono text-[#38bdf8] py-1 animate-pulse">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#38bdf8]" />
                                <span>Thinking...</span>
                              </div>
                            )}
                          </div>

                          {/* Extracted notes */}
                          {message.extractedArtifacts && message.extractedArtifacts.length > 0 && (
                            <div className="mt-3 pt-2.5 border-t border-[#090e18] space-y-2">
                              <div className="text-[10px] font-semibold text-[#8ab1e0] flex items-center justify-between font-mono">
                                <div className="flex items-center gap-1.5">
                                  <FileCode className="w-3.5 h-3.5 text-[#8ab1e0]" />
                                  <span>Extracted notes</span>
                                </div>
                                <span className="text-[9px] text-[#4f99a3] bg-[#0c1a20] px-1.5 py-0.2 rounded border border-[#081216]">
                                  Collected
                                </span>
                              </div>

                              {message.extractedArtifacts.map((art: ExtractedArtifact, idx) => (
                                <div
                                  key={art.id || idx}
                                  className="bg-[#0a0e16] p-2.5 rounded-xl border border-[#060a10] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <div className="font-semibold text-xs text-[#eef4fc] flex items-center gap-1.5 truncate">
                                      <span>{art.title}</span>
                                      <span className="text-[9px] font-mono text-[#8ab1e0] bg-[#121a28] px-1.5 py-0.2 rounded">
                                        {art.code}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-[#869ab8] line-clamp-1 mt-0.5">
                                      {art.description || art.summary}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {onSelectArtifact && (
                                      <button
                                        onClick={() => onSelectArtifact(art)}
                                        className="px-2 py-1 rounded-lg bg-[#0e1726] hover:bg-[#162338] text-[11px] font-mono text-[#7eb4ed] border border-[#1b2b42] transition-colors cursor-pointer"
                                        title="Inspect fields and details full-screen"
                                      >
                                        Inspect
                                      </button>
                                    )}
                                    <button
                                      onClick={() => {
                                        const now = Date.now();
                                        const title = art.title || 'Extracted note';
                                        const desc = art.description || '';
                                        const summ = art.summary || '';
                                        const body = art.content || `# ${title}\n\nExtracted note.`;
                                        const fullArtifact: Artifact = {
                                          id: `art-${now}-${idx}`,
                                          workspaceId: project.id,
                                          type: 'document',
                                          color: '#5d87b8',
                                          current: {
                                            description: desc,
                                            summary: summ,
                                            body: body,
                                          },
                                          code:
                                            art.code ||
                                            title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                                          title,
                                          category: art.category || 'note',
                                          isHighConcept: Boolean(art.isHighConcept),
                                          tags: ['chat-extracted'],
                                          createdAt: now,
                                          updatedAt: now,
                                        };
                                        onAddArtifactToProject(fullArtifact);
                                      }}
                                      className="px-2.5 py-1 rounded-lg bg-[#1a2538] hover:bg-[#23334d] text-xs font-mono text-[#8ab1e0] border border-[#233550] transition-colors cursor-pointer"
                                    >
                                      Save as Artifact
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Real 1:1 API Usage & Telemetry (provider-neutral vocab) */}
                          {message.meta && !isUser && (
                            <div className="mt-2.5 pt-2 border-t border-[#141f30] flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-[#637894]">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[#38bdf8] font-semibold">{message.meta.model || '—'}</span>
                                <span>•</span>
                                <span className="tabular-nums">{message.meta.isFallback ? 'est.' : ''} {message.meta.inputTokens ?? 0} in</span>
                                <span>•</span>
                                <span className="tabular-nums">{message.meta.isFallback ? 'est.' : ''} {message.meta.outputTokens ?? 0} out</span>
                                <span>•</span>
                                <span className="text-[#a4bddf] font-semibold tabular-nums">{message.meta.isFallback ? 'est.' : ''} {message.meta.totalTokens ?? 0} total tok</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {message.meta.timeToFirstChunkMs != null && (
                                  <span className="text-[#556985] tabular-nums">
                                    first chunk {(message.meta.timeToFirstChunkMs / 1000).toFixed(2)}s
                                  </span>
                                )}
                                {message.meta.latencyMs != null && (
                                  <span className="text-[#556985] tabular-nums">
                                    {(message.meta.latencyMs / 1000).toFixed(2)}s
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Live Streaming State Feedback */}
                          {message.meta?.isStreaming && (
                            <div className="mt-2 flex items-center gap-2 text-[11px] font-mono text-[#38bdf8] animate-pulse">
                              <Loader2 className="w-3 h-3 animate-spin text-[#38bdf8]" />
                              <span className="capitalize">{message.meta.streamState || 'writing'}...</span>
                            </div>
                          )}

                          {/* Interrupted Response Badge */}
                          {message.meta?.streamState === 'interrupted' && (
                            <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/35 text-[10px] font-mono shadow-xs">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span className="font-semibold tracking-wider uppercase text-[10px]">Response Interrupted</span>
                            </div>
                          )}
                        </div>

                        {/* Attachments welded to THIS turn — where the artifact
                            entered the conversation. No × : history has no
                            delete key; only the cut stays steerable (10 §8). */}
                        {attachmentsOfTurn(message, globalTurnIndex).length > 0 && (
                          <div className="max-w-[92%] sm:max-w-[85%] w-full mt-1.5 space-y-1">
                            <div className="text-[9px] font-mono uppercase tracking-wider text-[#556985] px-0.5">
                              Attached on this turn
                            </div>
                            {attachmentsOfTurn(message, globalTurnIndex).map((att) => (
                              <AttachmentRow
                                key={att.artifactId}
                                state={att.granularity}
                                title={titleFor(att.artifactId)}
                                tokens={tokensFor(att.artifactId)}
                                granularity={att.granularity}
                                onToggle={
                                  onToggleAttachment
                                    ? () => onToggleAttachment(att.artifactId)
                                    : undefined
                                }
                                onSetGranularity={
                                  onSetAttachmentGranularity
                                    ? (g) => onSetAttachmentGranularity(att.artifactId, g)
                                    : undefined
                                }
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        {isLoading && (
          <div className="flex items-center justify-between gap-3 text-xs font-mono text-[#8ab1e0] bg-[#101623] p-3 rounded-xl border border-[#1a293e] max-w-xl shadow-lg animate-in fade-in">
            <div className="flex items-center gap-2.5 min-w-0">
              <Loader2 className="w-4 h-4 animate-spin text-[#38bdf8] shrink-0" />
              <span className="truncate">{streamingStatus || 'MarkBrain is thinking...'}</span>
              <span className="text-[10px] text-[#567295] font-mono px-1.5 py-0.5 rounded bg-[#090d16] border border-[#141e2e] shrink-0">
                {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')}s
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onOpenServerLogs && (
                <button
                  type="button"
                  onClick={onOpenServerLogs}
                  className="px-2 py-1 rounded-lg bg-[#0e1726] hover:bg-[#162338] text-[10px] text-[#8ab1e0] border border-[#1c2d47] transition-colors cursor-pointer"
                  title="View live server logs"
                >
                  Logs
                </button>
              )}
              {onStopGeneration && (
                <button
                  type="button"
                  onClick={onStopGeneration}
                  className="px-2.5 py-1 rounded-lg bg-[#3b1219] hover:bg-[#521720] text-[#f87171] border border-[#6b212b] text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                  title="Stop generating"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop</span>
                </button>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
      )}

      {/* Retry banner for a failed/interrupted last reply */}
      {showRetry && (
        <div className="mx-3 sm:mx-6 mb-2 flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[#1a1510]/80 border border-[#423214] text-[11px] font-mono text-[#e0b96c] animate-in fade-in duration-150 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 text-[#e0b96c] shrink-0" />
            <span className="truncate">
              {threadRuntime === 'error' ? 'Generation failed' : 'Response interrupted'} — the last reply didn't finish.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onRetry?.()}
            className="px-3 py-1 rounded-lg bg-[#2a2010] hover:bg-[#3a2c14] border border-[#5a4418] text-[#f0d090] font-semibold transition-colors cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Bottom Pinned Chat Input Bar - Active once messages exist */}
      {totalMessagesCount > 0 && (
        <div className="p-2.5 sm:p-3 bg-[#0d121c] border-t border-[#121c2c] shrink-0 space-y-2">
          <div className="max-w-4xl mx-auto">
            <StagedTray
              items={stagedAttachments.map((a) => ({
                artifactId: a.artifactId,
                title: titleFor(a.artifactId),
                tokens: tokensFor(a.artifactId),
                granularity: a.granularity,
              }))}
              onSetGranularity={(id, g) => onSetAttachmentGranularity?.(id, g)}
              onUnstage={(id) => onUnstageAttachment?.(id)}
            />
          </div>
          <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-4xl mx-auto">
            {/* [+] → the Artifacts folder IS the picker (10 §3). The voice
                selector moved to the sidebar, where settings belong. */}
            <button
              type="button"
              onClick={() => {
                logger.action('ChatView', 'Open artifacts folder to attach');
                onOpenArtifacts?.();
              }}
              data-testid="open-artifacts"
              className="relative h-full px-2.5 py-2.5 rounded-xl bg-[#090d15] border border-[#162234] hover:border-[#67e8f9]/50 text-[#8ab1e0] hover:text-[#eef4fc] transition-colors flex items-center gap-1.5 cursor-pointer font-mono text-[10px] sm:text-xs shrink-0"
              title="Attach artifacts from the library"
              aria-label="Attach artifacts"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              {stagedAttachments.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[#67e8f9] text-[#06131f] text-[9px] font-mono font-bold flex items-center justify-center">
                  {stagedAttachments.length}
                </span>
              )}
            </button>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (inputText.trim() && !isLoading) {
                    handleSubmit(e);
                  }
                }
              }}
              placeholder="Keep typing — Enter to send, Shift+Enter for a new line"
              disabled={isLoading}
              rows={1}
              className="flex-1 bg-[#090d15] border border-[#162234] rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-[#eef4fc] placeholder-[#50637f] focus:outline-none focus:border-[#3b82f6]/50 transition-colors resize-none leading-relaxed max-h-32"
            />

            {/* Pending sends for THIS thread (serial queue) — cancel never touches the live stream */}
            {queuePosition > 0 && !isLoading && (
              <button
                type="button"
                onClick={() => onCancelQueued?.()}
                className="px-2.5 py-2 rounded-xl bg-[#241c0c] hover:bg-[#33270f] border border-[#423214] text-[#e0b96c] text-[10px] font-mono transition-colors cursor-pointer shrink-0"
                title="Cancel queued messages for this thread"
              >
                {queuePosition} queued ✕
              </button>
            )}

            {isLoading && onStopGeneration ? (
              <button
                type="button"
                onClick={onStopGeneration}
                className="px-4 py-2.5 rounded-xl bg-[#dc2626] hover:bg-[#b91c1c] text-white transition-all shadow-md shadow-red-900/30 flex items-center gap-1.5 cursor-pointer font-mono text-xs font-semibold shrink-0"
                title="Stop generation"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="px-4 py-2.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 disabled:hover:bg-[#2563eb] text-white transition-all shadow-md shadow-blue-900/25 flex items-center justify-center cursor-pointer shrink-0"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
};
