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
  Pencil,
  Code,
  Copy,
} from 'lucide-react';
import { logger } from '../../utils/logger';
import { copyText } from '../../utils/clipboard';
import { isChapterInProgress } from '../../domains/02-chapter-segmentation';
import { getTtsSnapshot, ttsTransport } from '../context/ttsTransport';
import { MessageBody } from './MessageBody';
import { renderMarkdown } from '../../utils/markdown';
import { flipMessageView, messageIsRaw } from './chatRenderMode';
import type { ChatRenderMode } from './chatRenderMode';
import { composerKeyAction, enterSendHint } from './sendOnEnter';
import type { EnterSendMode } from './sendOnEnter';
import { ThreadRuntime, ChatAttachment, isAttachmentStaged } from '../../domains/06-chat-threads';
import type { Granularity, AttachmentVisualState } from '../../domains/granularity';
import { GRANULARITY_LABEL, cutIncludes, getAttachmentStatePalette } from '../../domains/granularity';
import {
  AttachmentDot,
  GranularityChips,
  AttachmentRow,
  StagedTray,
  dotVerbLabel,
  formatAttachmentProvenance,
  formatTokens,
} from '../context/AttachmentControls';
import { tts, authUnlock } from '../../gateway/api';
import { unlockLocalVault } from '../../data/localKeyVault';
import { getWorkspaceMode } from '../../services/workspaceSession';
import type { DraftProgress } from '../../application/draftQueue';
import { getModelForSlot } from '../../data/modelConfig';

/** Ticking elapsed clock for a draft phase (design 23 §2.2) — cleans up. */
function useElapsed(since: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [since]);
  return since === undefined ? 0 : Math.max(0, Math.floor((now - (since ?? now)) / 1000));
}

const PHASE_LABEL: Record<string, string> = {
  queued: 'QUEUED',
  connecting: 'CONNECTING',
  'awaiting-first-token': 'AWAITING FIRST TOKEN',
  writing: 'WRITING',
};

/** The one phase chip: honest state + clock (+ chars once writing). */
const DraftPhaseChip: React.FC<{
  progress?: DraftProgress;
  kind?: 'send' | 'regenerate';
  fallback: string;
}> = ({ progress, kind, fallback }) => {
  const secs = useElapsed(progress ? (progress.phase === 'writing' ? progress.firstTokenAt ?? progress.since : progress.since) : undefined);
  const prefix = kind === 'regenerate' ? 'REGENERATE · ' : '';
  if (!progress) return <>{prefix}{fallback}</>;
  const label = PHASE_LABEL[progress.phase] ?? String(progress.phase).toUpperCase();
  if (progress.phase === 'queued') return <>{prefix}{label}</>;
  if (progress.phase === 'writing') {
    const chars = progress.chars ?? 0;
    return (
      <>
        {prefix}
        {label} · {secs}s · {chars.toLocaleString()} chars
      </>
    );
  }
  if (progress.phase === 'awaiting-first-token') {
    return (
      <>
        {prefix}
        {label} · {secs}s — the model is thinking; no text yet
      </>
    );
  }
  return (
    <>
      {prefix}
      {label} · {secs}s
    </>
  );
};

/** How many lines the composer grows to fit before it starts scrolling. */
const COMPOSER_MAX_LINES = 5;

interface ChatViewProps {
  project: ProjectMetadata;
  chapters: ChapterTurns[];
  onSendMessage: (text: string) => Promise<void>;
  isLoading: boolean;
  streamingStatus?: string | null;
  streamPhase?: 'waiting' | 'streaming' | null;
  onStopGeneration?: () => void;
  onOpenServerLogs?: () => void;
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
}

const CHAPTER_PASTEL_COLORS = [
  { bgHeader: 'bg-surface-2', dot: '#7093be', text: 'text-[#8ab1e0]' }, // slate steel blue
  { bgHeader: 'bg-surface-2', dot: '#5da88b', text: 'text-[#7ec2a6]' }, // mellow sage green
  { bgHeader: 'bg-surface-1', dot: '#9d80ba', text: 'text-[#b9a1d4]' }, // dark muted mauve
  { bgHeader: 'bg-surface-1', dot: '#b59765', text: 'text-[#d6be94]' }, // mellow dark amber
  { bgHeader: 'bg-surface-2', dot: '#64a3ba', text: 'text-[#8ac5db]' }, // dark muted teal
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
}) => {
  // Controlled when App lifts the draft; local fallback for uncontrolled mounts.
  const [localDraft, setLocalDraft] = useState('');
  const draftIsControlled = draftText !== undefined;
  const inputText = draftIsControlled ? draftText : localDraft;
  const setInputText = (value: string) => {
    if (draftIsControlled) onDraftTextChange?.(value);
    else setLocalDraft(value);
  };
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleFlash, setTitleFlash] = useState<'ok' | 'fail' | null>(null);
  const [feedScrolled, setFeedScrolled] = useState(false);

  // Per-message view overrides. Absent key = follow the sidebar's default, so
  // changing the global switch still speaks for every bubble that was never
  // individually flipped.
  const [rawOverrides, setRawOverrides] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const chatRenderRef = useRef<ChatRenderMode>(chatRender);

  useEffect(() => {
    if (chatRenderRef.current === chatRender) return;
    chatRenderRef.current = chatRender;
    setRawOverrides({});
  }, [chatRender]);

  const isMessageRaw = (messageId: string) => messageIsRaw(rawOverrides, messageId, chatRender);

  const toggleMessageRaw = (message: Turn) => {
    const next = !isMessageRaw(message.id);
    logger.action('ChatView', `Message view: ${next ? 'raw source' : 'rendered markdown'}`, {
      messageId: message.id,
      role: message.role,
    });
    setRawOverrides((prev) => flipMessageView(prev, message.id, chatRender));
  };

  const handleCopyMessage = async (message: Turn) => {
    const ok = await copyText(message.content);
    if (!ok) {
      logger.warn('ChatView', 'Clipboard write failed for message markdown', {
        messageId: message.id,
        role: message.role,
      });
      return;
    }
    logger.action('ChatView', 'Copied message markdown to clipboard', {
      messageId: message.id,
      role: message.role,
      chars: message.content.length,
    });
    setCopiedMessageId(message.id);
    window.setTimeout(() => {
      setCopiedMessageId((current) => (current === message.id ? null : current));
    }, 1600);
  };

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

  const [showPrompts, setShowPrompts] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const heroInputRef = useRef<HTMLTextAreaElement>(null);
  const threadInputRef = useRef<HTMLTextAreaElement | null>(null);
  const prevMessagesCountRef = useRef<number>(0);

  const totalMessagesCount = (chapters || []).reduce(
    (acc, grp) => acc + (grp.turns ? grp.turns.length : 0),
    0
  );

  useEffect(() => {
    if (totalMessagesCount === 0 && heroInputRef.current) {
      heroInputRef.current.focus();
    }
  }, [totalMessagesCount]);

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

  // ChatView only plays back with the voice chosen in the sidebar.
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [collapsedChapterIds, setCollapsedChapterIds] = useState<Record<string, boolean>>({});
  const [summarizingIds, setSummarizingIds] = useState<Record<string, boolean>>({});
  const [summarizeErrorIds, setSummarizeErrorIds] = useState<Record<string, string>>({});

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
  // VAULT_LOCKED unlock row state (design 23 §2.3) — per draft card.
  const [unlockPw, setUnlockPw] = useState<Record<string, string>>({});
  const [unlockErr, setUnlockErr] = useState<Record<string, string>>({});
  const [unlockBusy, setUnlockBusy] = useState<Record<string, boolean>>({});
  const handleUnlockDraft = async (d: { id: string }) => {
    const pw = unlockPw[d.id] ?? '';
    if (!pw) {
      setUnlockErr((e) => ({ ...e, [d.id]: 'Enter your password.' }));
      return;
    }
    setUnlockBusy((b) => ({ ...b, [d.id]: true }));
    setUnlockErr((e) => ({ ...e, [d.id]: '' }));
    try {
      const ok =
        getWorkspaceMode() === 'vps' ? (await authUnlock(pw)).ok : await unlockLocalVault(pw);
      if (ok) {
        onRetryDraft?.(d.id);
        setUnlockPw((p) => ({ ...p, [d.id]: '' }));
      } else {
        setUnlockErr((e) => ({ ...e, [d.id]: 'Wrong password — try again.' }));
      }
    } catch {
      setUnlockErr((e) => ({ ...e, [d.id]: 'Unlock failed — try again.' }));
    } finally {
      setUnlockBusy((b) => ({ ...b, [d.id]: false }));
    }
  };
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

  // A thread/view switch unmounts the feed while audio may still be playing:
  // pause it and idle the transport, or the sidebar card shows a track that
  // no longer exists.
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      ttsTransport.end();
    };
  }, []);

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

  /**
   * One keyboard contract for both composers. Shift+Enter and Ctrl/Cmd+Enter
   * are fixed; only the bare Enter key answers to the `enterSend` preference.
   * A 'newline' verdict deliberately does NOT preventDefault — the textarea
   * inserts the break itself, which is the whole point.
   */
  /**
   * Grow the composer to fit its text, up to COMPOSER_MAX_LINES.
   *
   * A textarea with rows={1} shows ONE row and scrolls the rest away, so a
   * multi-line message was invisible while you typed it. This is deliberately
   * capped: the composer belongs to typing, not to reading, so it opens small
   * and never eats the thread.
   */
  const autoGrow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    const cs = window.getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 22;
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const max = lineHeight * COMPOSER_MAX_LINES + padY;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  };

  // Re-measure on every text change: paste, and the clear-after-send both land
  // without an onChange we control.
  useEffect(() => {
    autoGrow(heroInputRef.current);
    autoGrow(threadInputRef.current);
  }, [inputText]);

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const action = composerKeyAction(
      { key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing },
      enterSend
    );
    if (action !== 'send') return;
    e.preventDefault();
    if (inputText.trim() && !isLoading) {
      handleSubmit(e);
    }
  };

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
      ttsTransport.end();
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
    ttsTransport.end();

    setTtsLoadingId(message.id);
    ttsTransport.begin(message.id);

    try {
      const res = await tts({
        text: message.content,
        voice: chosenVoice,
        model: getModelForSlot('tts'),
      });

      // 21F: VPS serves compact audio/ogg straight from the disk cache
      // (X-Tts-Cache: HIT|MISS). Local/direct still answers JSON PCM.
      const contentType = res.headers.get('content-type') || '';
      if (contentType.startsWith('audio/ogg')) {
        const blob = await res.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        ttsTransport.setAudio(audio);
        audio.onended = () => {
          setPlayingMessageId(null);
          audioRef.current = null;
          URL.revokeObjectURL(audioUrl);
          ttsTransport.end();
        };
        audio.onerror = () => {
          logger.warn('ChatView', 'TTS ogg playback failed, falling back to browser speech');
          audioRef.current = null;
          URL.revokeObjectURL(audioUrl);
          ttsTransport.end();
          fallbackSpeech(message.content, message.id);
        };
        try {
          await audio.play();
          ttsTransport.playing({
            duration: Number.isFinite(audio.duration) ? audio.duration : 0,
            seekable: true,
          });
          setPlayingMessageId(message.id);
        } catch (playErr) {
          logger.warn('ChatView', 'TTS ogg play() refused, falling back to web speech', playErr);
          audioRef.current = null;
          URL.revokeObjectURL(audioUrl);
          ttsTransport.end();
          fallbackSpeech(message.content, message.id);
        }
        return;
      }

      const data = await res.json();

      if (data.audioData) {
        const audioUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioData}`;
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        // The transport owns the timeline (volume application + seek), ChatView
        // owns which message and what happens next.
        ttsTransport.setAudio(audio);
        audio.onended = () => {
          setPlayingMessageId(null);
          audioRef.current = null;
          ttsTransport.end();
        };
        audio.onerror = () => {
          logger.warn('ChatView', 'TTS audio playback failed, falling back to browser speech synthesis');
          audioRef.current = null;
          ttsTransport.end();
          fallbackSpeech(data.cleanSpokenText || message.content, message.id);
        };
        try {
          await audio.play();
          ttsTransport.playing({
            duration: Number.isFinite(audio.duration) ? audio.duration : 0,
            seekable: true,
          });
          setPlayingMessageId(message.id);
        } catch (playErr) {
          // Autoplay refusal must not leave a claimed element behind.
          logger.warn('ChatView', 'TTS audio play() refused, falling back to web speech', playErr);
          audioRef.current = null;
          ttsTransport.end();
          fallbackSpeech(data.cleanSpokenText || message.content, message.id);
        }
      } else {
        fallbackSpeech(data.cleanSpokenText || message.content, message.id);
      }
    } catch (err) {
      logger.warn('ChatView', 'TTS API request failed, falling back to web speech', err);
      ttsTransport.end();
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
      // Volume from the shared control; a live utterance cannot be re-gained,
      // so a drag mid-sentence applies to the next one.
      utterance.volume = getTtsSnapshot().volume;
      const stop = () => {
        setPlayingMessageId(null);
        ttsTransport.end();
      };
      utterance.onend = stop;
      utterance.onerror = stop;
      ttsTransport.setAudio(null);
      window.speechSynthesis.speak(utterance);
      setPlayingMessageId(msgId);
      ttsTransport.playing({ seekable: false, duration: 0 });
    } else {
      setPlayingMessageId(null);
      ttsTransport.end();
    }
  };

  const handleDeclareSubmit = (msgId: string) => {
    if (!newChapterTitle.trim()) return;
    logger.action('ChatView', 'Declare new chapter boundary split', { messageId: msgId, newChapterTitle: newChapterTitle.trim() });
    onDeclareChapter(msgId, newChapterTitle.trim());
    setDeclaringMessageId(null);
    setNewChapterTitle('');
  };

  const lastGroup = chapters[chapters.length - 1];
  const lastAssistantMessageId = (() => {
    for (let i = chapters.length - 1; i >= 0; i--) {
      const turns = chapters[i].turns;
      for (let j = turns.length - 1; j >= 0; j--) {
        if (turns[j].role === 'assistant') return turns[j].id as string;
      }
    }
    return null;
  })();

  return (
    <div className="relative flex-1 flex flex-col min-h-0 min-w-0 w-full h-full bg-surface-0 text-ink select-text overflow-hidden pt-0 mt-0">
      {/* Archived thread: readable, one click to continue */}
      {threadArchived && (
        <div className="flex items-center justify-between gap-3 px-3 sm:px-6 py-1.5 bg-surface-2 text-[10px] font-mono text-ink-mute shrink-0 animate-in fade-in duration-150">
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

            <form
              onSubmit={handleSubmit}
              className="bg-veil-1 focus-within:bg-veil-2 rounded-2xl p-4 shadow-pop transition-colors space-y-3"
            >
              <textarea
                ref={(el) => { heroInputRef.current = el; autoGrow(el); }}
                value={inputText}
                onChange={(e) => { setInputText(e.target.value); autoGrow(e.target); }}
                onKeyDown={handleComposerKeyDown}
                placeholder="Pour it out before it evaporates — we'll organize later."
                rows={3}
                disabled={isLoading}
                autoFocus
                className="w-full bg-transparent text-xs sm:text-sm text-ink placeholder-[#50637f] focus:outline-none resize-none leading-relaxed font-sans"
              />

              <div className="flex items-center justify-between pt-3 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      logger.action('ChatView', 'Open artifacts folder to attach (hero)', {
                        matches: missingMatchCount,
                      });
                      if (missingMatchCount > 0 && onOpenArtifactsWithProximity) {
                        onOpenArtifactsWithProximity();
                      } else {
                        onOpenArtifacts?.();
                      }
                    }}
                    data-testid="open-artifacts"
                    className="relative min-h-[30px] px-2.5 rounded-lg bg-surface-3 hover:bg-surface-4 text-ink-dim hover:text-ink transition-colors flex items-center gap-1.5 cursor-pointer font-mono text-[11px] shrink-0"
                    title="Attach artifacts from the library"
                    aria-label="Attach artifacts"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span>Attach</span>
                    {missingMatchCount > 0 && (
                      <span
                        data-testid="attach-match-badge"
                        className="min-w-[16px] h-[16px] px-1 rounded-full bg-[#67e8f9] text-[#06131f] text-[9px] font-mono font-bold flex items-center justify-center"
                        title={`${missingMatchCount} unattached artifact${missingMatchCount === 1 ? '' : 's'} match this draft`}
                      >
                        {missingMatchCount}
                      </span>
                    )}
                  </button>
                  <span className="text-[11px] font-mono text-[#5b7394] hidden sm:inline">
                    {enterSend === 'send' ? 'Enter sends' : 'Ctrl+Enter sends'}
                  </span>
                </div>

                {/* Stop is ALWAYS reachable while a stream runs (design 23 §2.4):
                    a spinner that eats the only button is a trap — found live. */}
                {isLoading && onStopGeneration ? (
                  <button
                    type="button"
                    onClick={onStopGeneration}
                    className="px-4 py-2 rounded-xl bg-[#dc2626] hover:bg-[#b91c1c] text-ink font-mono text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-red-900/30 cursor-pointer shrink-0"
                    title="Stop generation"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!inputText.trim() || isLoading}
                    className="px-4 py-2 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] active:bg-[#1e40af] disabled:opacity-40 text-ink font-mono text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                  >
                    <span>Start Dialogue</span>
                    <Send className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      ) : (
        /* Unified Vertical Chat Feed with Episodic Chapters - ZERO TOP BAR */
        <div
          className="flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-4 space-y-4"
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
          {!threadArchived && (
            <div
              data-testid="thread-title-row"
              data-scrolled={feedScrolled ? 'true' : 'false'}
              className={`sticky top-0 z-20 flex items-center gap-2 min-w-0 pl-16 pr-24 -mx-3 sm:-mx-6 transition-colors ${
                feedScrolled ? 'py-1.5 bg-surface-0/95 backdrop-blur-md' : 'py-0'
              }`}
            >
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
                    feedScrolled ? 'text-sm' : 'text-xl sm:text-2xl'
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
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${project.color || '#3b82f6'}22` }}
                  >
                    <Brain className="w-4 h-4" style={{ color: project.color || '#3b82f6' }} />
                  </span>
                  <h1
                    className={`truncate font-semibold tracking-tight font-mono ${
                      feedScrolled ? 'text-sm' : 'text-xl sm:text-2xl'
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
                  className={`text-[10px] font-mono shrink-0 animate-in fade-in duration-150 ${
                    titleFlash === 'ok' ? 'text-brand-green' : 'text-[#f28894]'
                  }`}
                >
                  {titleFlash === 'ok' ? 'Titled' : 'Needs a reply first'}
                </span>
              )}
            </div>
          )}

          {/* Clearance for the floating token orb — scrolls away with the
              content, never sticky, never fixed (phones need every pixel back
              the moment you scroll). */}
          <div
            data-testid="scroll-top-clearance"
            aria-hidden="true"
            className="h-2 shrink-0 -mt-2"
          />
          {chapters.map(({ chapter, ongoing: isOngoing, granularity, turns }, chapterIndex) => {
          const isCollapsed = collapsedChapterIds[chapter.id] ?? false;

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
                      className="text-[10px] font-mono uppercase tracking-wider shrink-0 font-semibold"
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
                    <span className="text-[10px] font-mono text-[#758ca8] tabular-nums">
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
                          triggerChapterSummarize(chapter.id);
                        }}
                        disabled={summarizingIds[chapter.id]}
                        title="Re-run the chapter summary — replaces the description and summary with fresh ones"
                        className="min-h-[24px] px-2 rounded-lg text-[10px] font-mono text-[#8ca3c7] hover:bg-surface-3 hover:text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default shrink-0"
                      >
                        {summarizingIds[chapter.id] ? 'Writing…' : 'Regenerate'}
                      </button>
                    )}

                    {granularity !== 'title' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          toggleCollapseChapter(chapter.id);
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
                  </div>
                </div>

                {onSetChapterGranularity &&
                  (isChapterInProgress(chapterList, chapterIndex) ? (
                    // The last chapters are still live: they always send Full,
                    // so a cut would only promise layers nobody wrote.
                    <div
                      data-testid="chapter-in-progress"
                      data-chapter-id={chapter.id}
                      className="inline-flex items-center min-h-[24px] px-2 rounded-lg bg-recess-1 shadow-well text-[10px] font-mono text-ink-mute select-none"
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
                        onChange={(g) =>
                          handleSetChapterCut(
                            { chapter, index: chapterIndex, ongoing: isOngoing, granularity, turns },
                            g
                          )
                        }
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
                      <div className="font-semibold text-[10px] text-[#e2c328] mb-1 font-mono uppercase tracking-wider">
                        Description
                      </div>
                      <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(chapter.description) }} />
                    </div>
                  )}
                  {cutIncludes(granularity, 'summary') && chapter.summary && (
                    <div
                      data-testid="chapter-layer-summary"
                      className="text-xs text-ink-dim leading-relaxed bg-recess-1 shadow-well p-3 rounded-lg"
                    >
                      <div className="font-semibold text-[10px] text-[#f99014] mb-1 font-mono uppercase tracking-wider">
                        Summary
                      </div>
                      <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(chapter.summary) }} />
                    </div>
                  )}
                  {/* Missing layer under a chosen cut = chrome, not content: a
                      real gap, honestly named, with the call that fills it.
                      At Full there is nothing to promise, so no chrome. */}
                  {granularity !== 'full' &&
                    ((cutIncludes(granularity, 'description') && !chapter.description) ||
                      (cutIncludes(granularity, 'summary') && !chapter.summary)) && (
                      <div className="flex items-center justify-between gap-3 text-[11px] text-ink-mute p-2.5 bg-recess-1 rounded-lg">
                        <span className="font-mono">
                          {summarizingIds[chapter.id]
                            ? 'Writing summary…'
                            : summarizeErrorIds[chapter.id]
                              ? 'Summary request timed out or failed.'
                              : cutIncludes(granularity, 'summary') && !chapter.summary
                                ? 'No summary yet — this chapter is sending only what exists.'
                                : 'No description yet for this chapter.'}
                        </span>
                        {!summarizingIds[chapter.id] && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              // Fill the layer; never change the cut.
                              triggerChapterSummarize(chapter.id);
                            }}
                            className="text-[10px] font-mono px-2.5 py-1 rounded-lg bg-surface-3 text-ink-dim hover:bg-surface-4 hover:text-ink font-medium transition-colors cursor-pointer shrink-0"
                          >
                            {summarizeErrorIds[chapter.id] ? 'Retry' : 'Write it'}
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
                    <div className="w-full shrink-0 text-[9px] font-mono uppercase tracking-wider text-[#556985]">
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
                    const isUser = message.role === 'user';
                    const isPlaying = playingMessageId === message.id;
                    const isTtsLoading = ttsLoadingId === message.id;
                    const isRaw = isMessageRaw(message.id);
                    const isCopied = copiedMessageId === message.id;
                    return (
                      <div
                        key={message.id}
                        className={`flex flex-col group ${isUser ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-center gap-2 mb-1 text-[11px] font-mono text-[#627794]">
                          <span className={isUser ? 'text-[#8ab1e0]' : 'text-[#e05a66] font-semibold'}>
                            {isUser ? 'You' : 'MarkBrain'}
                          </span>
                          <span>•</span>
                          <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>

                          <button
                            onClick={() => handlePlayTTS(message)}
                            disabled={isTtsLoading}
                            className={`p-1 rounded hover:bg-surface-2 transition-colors cursor-pointer ${
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

                          <button
                            onClick={() => {
                              setDeclaringMessageId(
                                declaringMessageId === message.id ? null : message.id
                              );
                              setNewChapterTitle('');
                            }}
                            className="p-1 rounded hover:bg-surface-2 text-[#50637f] hover:text-[#8ab1e0] transition-colors opacity-40 group-hover:opacity-100 cursor-pointer"
                            title="Split into new chapter starting at this message"
                          >
                            <BookmarkPlus className="w-3 h-3" />
                          </button>

                          {/* View + copy sit on BOTH roles and are always visible:
                              hover does not exist on a phone, and these two are
                              the whole point of the toggle. Nothing to read yet
                              (a reply still thinking) → no controls. */}
                          {message.content && (
                            <>
                              <button
                                onClick={() => toggleMessageRaw(message)}
                                aria-pressed={isRaw}
                                className={`ml-1 flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[10px] font-mono transition-colors cursor-pointer ${
                                  isRaw
                                    ? 'bg-veil-2 text-ink shadow-lift font-semibold'
                                    : 'text-[#50637f] hover:bg-surface-2 hover:text-[#9bb0d1]'
                                }`}
                                title={isRaw ? 'Show rendered markdown' : 'Show the raw markdown source'}
                              >
                                <Code className="w-3 h-3" />
                                <span>Raw</span>
                              </button>

                              <button
                                onClick={() => handleCopyMessage(message)}
                                className={`p-1 rounded hover:bg-surface-2 transition-colors cursor-pointer ${
                                  isCopied ? 'text-[#5ad49b]' : 'text-[#50637f] hover:text-[#9bb0d1]'
                                }`}
                                title={isCopied ? 'Copied markdown' : 'Copy markdown'}
                                aria-label={`Copy ${isUser ? 'your message' : 'this reply'} as markdown`}
                              >
                                {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </>
                          )}
                        </div>

                        {declaringMessageId === message.id && (
                          <div className="w-full max-w-lg my-2 p-3 bg-surface-4 rounded-xl shadow-pop space-y-2 animate-in fade-in duration-150">
                            <div className="text-[10px] font-mono text-[#38bdf8] uppercase tracking-wider font-semibold">
                              Declare Chapter Split at this Message
                            </div>
                            <input
                              type="text"
                              value={newChapterTitle}
                              onChange={(e) => setNewChapterTitle(e.target.value)}
                              placeholder="New Chapter Title (e.g. On pricing)"
                              className="w-full bg-recess-2 shadow-well rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
                            />
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                onClick={() => setDeclaringMessageId(null)}
                                className="px-2.5 py-1 text-xs font-mono text-[#7185a3] hover:text-ink cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleDeclareSubmit(message.id)}
                                disabled={!newChapterTitle.trim()}
                                className="px-3 py-1 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 text-ink rounded-lg text-xs font-mono font-medium shadow-md transition-colors cursor-pointer"
                              >
                                Split Chapter
                              </button>
                            </div>
                          </div>
                        )}

                        <div
                          className={`max-w-[92%] sm:max-w-[85%] rounded-2xl p-3 sm:p-4 text-xs sm:text-sm leading-relaxed ${
                            isUser
                              ? 'bg-veil-2 shadow-lift text-ink'
                              : 'bg-recess-1 shadow-well text-ink'
                          }`}
                        >
                          {message.content ? (
                            <MessageBody content={message.content} raw={isRaw} tone={isUser ? 'raised' : 'sunken'} />
                          ) : (
                            <div className="flex items-center gap-2 text-xs font-mono text-[#38bdf8] py-1 animate-pulse">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#38bdf8]" />
                              <span>Thinking...</span>
                            </div>
                          )}

                          {message.extractedArtifacts && message.extractedArtifacts.length > 0 && (
                            <div className="mt-3 pt-2.5 space-y-2">
                              <div className="text-[10px] font-semibold text-[#8ab1e0] flex items-center justify-between font-mono">
                                <div className="flex items-center gap-1.5">
                                  <FileCode className="w-3.5 h-3.5 text-[#8ab1e0]" />
                                  <span>Extracted notes</span>
                                </div>
                                <span className="text-[9px] text-[#6fd3dd] bg-veil-3 px-1.5 py-0.2 rounded">
                                  Collected
                                </span>
                              </div>

                              {message.extractedArtifacts.map((art: ExtractedArtifact, idx) => (
                                <div
                                  key={art.id || idx}
                                  className="bg-veil-2 shadow-lift p-2.5 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <div className="font-semibold text-xs text-ink flex items-center gap-1.5 truncate">
                                      <span>{art.title}</span>
                                      <span className="text-[9px] font-mono text-[#8ab1e0] bg-veil-3 px-1.5 py-0.2 rounded">
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
                                        className="px-2 py-1 rounded-lg bg-veil-3 hover:bg-veil-4 text-[11px] font-mono text-[#7eb4ed] transition-colors cursor-pointer"
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
                                      className="px-2.5 py-1 rounded-lg bg-veil-3 hover:bg-veil-4 text-xs font-mono text-ink-dim transition-colors cursor-pointer"
                                    >
                                      Save as Artifact
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {message.meta && !isUser && (
                            <div className="mt-2.5 pt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-[#637894]">
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
                                {onRegenerateLast && message.id === lastAssistantMessageId && (
                                  <button
                                    type="button"
                                    data-testid="regenerate-last"
                                    onClick={() => onRegenerateLast()}
                                    disabled={isLoading || drafts.length > 0}
                                    title={
                                      drafts.length > 0
                                        ? 'Available when the queue is empty'
                                        : isLoading
                                          ? 'Wait for the current reply'
                                          : 'Ask for a new reply — replaces this one only if the new reply completes'
                                    }
                                    className="min-h-[22px] px-2 rounded-lg text-[10px] font-mono text-[#8ca3c7] hover:bg-surface-3 hover:text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default shrink-0"
                                  >
                                    Regenerate
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          {message.meta?.isStreaming && (
                            <div className="mt-2 flex items-center gap-2 text-[11px] font-mono text-[#38bdf8] animate-pulse">
                              <Loader2 className="w-3 h-3 animate-spin text-[#38bdf8]" />
                              <span className="capitalize">{message.meta.streamState || 'writing'}...</span>
                            </div>
                          )}



                        </div>

                        {/* Attachments welded to THIS turn — where the artifact
                            entered the conversation. No ×: the turn already
                            happened; only the cut stays steerable. */}
                        {attachmentsOfTurn(message, globalTurnIndex).length > 0 && (
                          <div className="max-w-[92%] sm:max-w-[85%] w-full mt-1.5 flex flex-wrap gap-1.5">
                            <div className="w-full shrink-0 text-[9px] font-mono uppercase tracking-wider text-[#556985] px-0.5">
                              Attached on this turn
                            </div>
                            {attachmentsOfTurn(message, globalTurnIndex).map((att) => (
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
                                  onToggleAttachment
                                    ? () => onToggleAttachment(att.artifactId)
                                    : undefined
                                }
                                onSetGranularity={
                                  onSetAttachmentGranularity
                                    ? (g) => onSetAttachmentGranularity(att.artifactId, g)
                                    : undefined
                                }
                                onOpenDetail={
                                  onOpenArtifact ? () => onOpenArtifact(att.artifactId) : undefined
                                }
                                hideGranularityChips
                                size="compact"
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
          <div className="flex items-center justify-between gap-3 text-xs font-mono text-ink-dim bg-surface-2 p-3 rounded-lg max-w-xl animate-in fade-in">
            <div className="flex items-center gap-2.5 min-w-0">
              <Loader2 className="w-4 h-4 animate-spin text-[#38bdf8] shrink-0" />
              {/* Design 23 §2.2: the bar leads with the phase chip + clock. */}
              <span
                data-testid="stream-phase-chip"
                className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[#38bdf8]"
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
                  className="px-2 py-1 rounded-lg bg-surface-3 hover:bg-surface-4 text-[10px] text-ink-dim hover:text-ink transition-colors cursor-pointer"
                  title="View live server logs"
                >
                  Logs
                </button>
              )}
              {onStopGeneration && (
                <button
                  type="button"
                  onClick={onStopGeneration}
                  className="px-2.5 py-1 rounded-lg bg-wash-danger hover:bg-[#3a1a20] text-[#f87171] text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
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

      {/* Draft queue (design-docs/18): unpaired asks live here — never in the
          feed. A sending draft shows its streaming partial (the reply has not
          earned a place in the conversation yet); a failed/stopped one offers
          the three exits: Retry / Store as-is / Discard. */}
      {drafts.length > 0 && (
        <div className="mx-3 sm:mx-6 mb-2 space-y-1.5 shrink-0" data-testid="draft-queue">
          {drafts.map((d) => {
            const isBusy = d.state === 'sending';
            const isBlocked = d.state === 'failed' || d.state === 'stopped';
            return (
              <div
                key={d.id}
                data-testid={`draft-${d.state}`}
                className={`rounded-lg border px-3 py-2 text-[11px] font-mono ${
                  isBlocked ? 'border-brand bg-red-500/[0.07]' : 'border-line bg-surface-2'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isBlocked && <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                    <span
                      data-testid="draft-phase-chip"
                      className={`shrink-0 font-semibold uppercase tracking-wider text-[10px] ${
                        isBlocked
                          ? 'text-red-300'
                          : isBusy
                            ? 'text-[#38bdf8]'
                            : 'text-ink-mute'
                      }`}
                    >
                      {isBlocked ? (
                        d.state === 'stopped'
                          ? d.kind === 'regenerate'
                            ? 'Regenerate stopped'
                            : 'Stopped'
                          : d.kind === 'regenerate'
                            ? 'Regenerate failed'
                            : 'Failed'
                      ) : (
                        <DraftPhaseChip
                          progress={d.progress}
                          kind={d.kind}
                          fallback={
                            isBusy
                              ? d.kind === 'regenerate'
                                ? 'Regenerating the reply'
                                : 'Writing reply'
                              : drafts.some(
                                    (x) =>
                                      x.id !== d.id &&
                                      x.threadId === d.threadId &&
                                      (x.state === 'failed' || x.state === 'stopped') &&
                                      x.createdAt <= d.createdAt
                                  )
                                ? 'Queued — blocked by the failed draft above (choose Retry / Store as-is / Discard there)'
                                : d.kind === 'regenerate'
                                  ? 'Regenerate queued'
                                  : 'Queued'
                          }
                        />
                      )}
                    </span>
                    {isBlocked && d.reason && (
                      <span className="truncate text-red-200/90">{d.reason}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isBlocked && (
                      <>
                        <button
                          type="button"
                          onClick={() => onRetryDraft?.(d.id)}
                          data-testid="draft-retry"
                          className="px-2 py-1 rounded-lg bg-surface-3 hover:bg-surface-4 text-ink font-semibold transition-colors cursor-pointer"
                        >
                          Retry
                        </button>
                        {d.partial && (
                          <button
                            type="button"
                            onClick={() => onStoreAsIsDraft?.(d.id)}
                            data-testid="draft-store-as-is"
                            className="px-2 py-1 rounded-lg bg-surface-3 hover:bg-surface-4 text-[#38bdf8] transition-colors cursor-pointer"
                          >
                            Store as-is
                          </button>
                        )}
                      </>
                    )}
                    {(isBlocked || d.state === 'queued') && (
                      <button
                        type="button"
                        onClick={() => onDiscardDraft?.(d.id)}
                        data-testid="draft-discard"
                        className="px-2 py-1 rounded-lg bg-surface-3 hover:bg-surface-4 text-[#e0b96c] transition-colors cursor-pointer"
                      >
                        Discard
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-1 truncate text-ink-dim">{d.text}</div>
                {/* Design 23 §2.1.3: the frozen payload, read-only — what this
                    send actually carries. */}
                {d.attachments && d.attachments.length > 0 && (
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[10px] font-mono text-ink-dim">
                    <span data-testid="draft-payload">
                      {d.attachments.length} note{d.attachments.length === 1 ? '' : 's'} ·{' '}
                      {formatTokens(
                        d.attachments.reduce((sum, a) => sum + (tokensFor(a.artifactId) || 0), 0)
                      )}{' '}
                      tok riding this send
                    </span>
                    {d.attachments.map((a) => (
                      <span
                        key={a.artifactId}
                        className="flex items-center gap-1 rounded bg-recess-1 px-1.5 py-0.5 text-[9px] text-ink-faint"
                        title={titleFor(a.artifactId)}
                      >
                        <AttachmentDot
                          state={a.turnIndex === null ? 'staged' : a.granularity}
                          label={titleFor(a.artifactId)}
                          size="sm"
                        />
                        <span className="max-w-[120px] truncate">{titleFor(a.artifactId)}</span>
                        {GRANULARITY_LABEL[a.granularity]}
                      </span>
                    ))}
                  </div>
                )}
                {isBlocked && d.errorCode === 'VAULT_LOCKED' && (
                  <div
                    className="mt-1.5 flex items-center gap-1.5 flex-wrap"
                    data-testid="draft-vault-unlock-row"
                  >
                    <input
                      type="password"
                      data-testid="draft-vault-unlock-password"
                      value={unlockPw[d.id] ?? ''}
                      onChange={(e) => setUnlockPw((p) => ({ ...p, [d.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleUnlockDraft(d);
                      }}
                      placeholder="Password"
                      aria-label="Password to unlock your keys"
                      className="w-40 rounded-lg bg-recess-1 shadow-well px-2 py-1 text-[11px] text-ink placeholder:text-ink-faint focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleUnlockDraft(d)}
                      data-testid="draft-vault-unlock"
                      disabled={unlockBusy[d.id]}
                      className="px-2 py-1 rounded-lg bg-surface-3 hover:bg-surface-4 text-ink font-semibold transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {unlockBusy[d.id] ? 'Unlocking…' : 'Unlock & resend'}
                    </button>
                    {unlockErr[d.id] ? (
                      <span className="text-red-300">{unlockErr[d.id]}</span>
                    ) : null}
                  </div>
                )}
                {d.partial && (isBusy || isBlocked) && (
                  <div className="mt-1.5 max-h-24 overflow-y-auto rounded bg-recess-1 px-2 py-1.5 text-[11px] text-ink-dim whitespace-pre-wrap">
                    {d.partial}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalMessagesCount > 0 && (
        <div className="p-2.5 sm:p-3 bg-surface-0 shrink-0 space-y-2">
          <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-4xl mx-auto">
            {/* [+] → the Artifacts folder IS the picker. The voice
                selector moved to the sidebar, where settings belong. */}
            <button
              type="button"
              onClick={() => {
                logger.action('ChatView', 'Open artifacts folder to attach', {
                  matches: missingMatchCount,
                });
                if (missingMatchCount > 0 && onOpenArtifactsWithProximity) {
                  onOpenArtifactsWithProximity();
                } else {
                  onOpenArtifacts?.();
                }
              }}
              data-testid="open-artifacts"
              className="relative h-full px-2.5 py-2.5 rounded-lg bg-recess-1 shadow-well hover:bg-recess-2 text-ink-dim hover:text-ink transition-colors flex items-center gap-1.5 cursor-pointer font-mono text-[10px] sm:text-xs shrink-0"
              title="Attach artifacts from the library"
              aria-label="Attach artifacts"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              {missingMatchCount > 0 && (
                <span
                  data-testid="attach-match-badge"
                  className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[#67e8f9] text-[#06131f] text-[9px] font-mono font-bold flex items-center justify-center"
                  title={`${missingMatchCount} unattached artifact${missingMatchCount === 1 ? '' : 's'} match this draft`}
                >
                  {missingMatchCount}
                </span>
              )}
            </button>
            <textarea
              ref={(el) => { threadInputRef.current = el; autoGrow(el); }}
              value={inputText}
              onChange={(e) => { setInputText(e.target.value); autoGrow(e.target); }}
              onKeyDown={handleComposerKeyDown}
              placeholder="Keep typing…"
              title={enterSendHint(enterSend)}
              disabled={isLoading}
              rows={1}
              className="flex-1 bg-recess-1 shadow-well rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:bg-recess-2 transition-colors resize-none leading-relaxed overflow-y-auto max-h-[140px]"
            />

            {isLoading && onStopGeneration ? (
              <button
                type="button"
                onClick={onStopGeneration}
                className="px-4 py-2.5 rounded-xl bg-[#dc2626] hover:bg-[#b91c1c] text-ink transition-all shadow-md shadow-red-900/30 flex items-center gap-1.5 cursor-pointer font-mono text-xs font-semibold shrink-0"
                title="Stop generation"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="px-4 py-2.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 disabled:hover:bg-[#2563eb] text-ink transition-all shadow-md shadow-blue-900/25 flex items-center justify-center cursor-pointer shrink-0"
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
