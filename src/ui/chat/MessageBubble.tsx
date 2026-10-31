/**
 * One message: the hover control row (voice, split, receipts, raw, copy),
 * the body itself, the receipts chips and the attachments welded to the turn.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  Code,
  Copy,
  Link2,
  Loader2,
  ScrollText,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { logger } from '../../utils/logger';
import { copyText } from '../../utils/clipboard';
import type { ChapterTurns, Turn } from '../../types';
import { MessageBody } from './MessageBody';
import { flipMessageView, messageIsRaw } from './chatRenderMode';
import type { ChatRenderMode } from './chatRenderMode';
import type { Granularity } from '../../domains/granularity';
import type { ChatAttachment } from '../../domains/06-chat-threads';
import {
  AttachmentRow,
  formatAttachmentProvenance,
} from '../context/AttachmentControls';
import { TurnReceiptsRow } from './TurnReceiptsRow';

export interface MessageBubbleProps {
  message: Turn;
  /** Index of the turn within the whole thread — attachment provenance. */
  globalTurnIndex: number;
  /** Default view for the feed; the per-message override lives here. */
  chatRender: ChatRenderMode;
  online: boolean;
  offlineReplica: boolean;
  chosenVoice: string;
  playingMessageId: string | null;
  ttsLoadingId: string | null;
  cachedIds: Set<string>;
  ttsFailedIds: Set<string>;
  handlePlayTTS: (message: Turn) => void;
  declaringMessageId: string | null;
  setDeclaringMessageId: (messageId: string | null) => void;
  newChapterTitle: string;
  setNewChapterTitle: (title: string) => void;
  handleDeclareSubmit: (messageId: string) => void;
  /** The thread's chapters — receipts look up the chapter this reply opened. */
  chapters: ChapterTurns[];
  artifactTitles: Record<string, string>;
  onOpenArtifact?: (artifactId: string) => void;
  /** Inspector linkage: opens the inspector on the EXACT recorded call. */
  onInspectCall?: (callId: string) => void;
  attachmentsOfTurn: (message: Turn, globalIndex: number) => ChatAttachment[];
  titleFor: (artifactId: string) => string;
  subtitleFor: (artifactId: string) => string;
  tokensFor: (artifactId: string) => number;
  onToggleAttachment?: (artifactId: string) => void;
  onSetAttachmentGranularity?: (artifactId: string, granularity: Granularity) => void;
  onRegenerateLast?: () => void;
  lastAssistantMessageId: string | null;
  isLoading: boolean;
  /** How many drafts the queue holds — Regenerate refuses to run while any exist. */
  draftCount: number;
}

/** Everything a bubble needs except the message itself (shared by every bubble in a feed). */
export type MessageBubbleSharedProps = Omit<MessageBubbleProps, 'message' | 'globalTurnIndex'>;

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  globalTurnIndex,
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
  onInspectCall,
  attachmentsOfTurn,
  titleFor,
  subtitleFor,
  tokensFor,
  onToggleAttachment,
  onSetAttachmentGranularity,
  onRegenerateLast,
  lastAssistantMessageId,
  isLoading,
  draftCount,
}) => {

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
  const isUser = message.role === 'user';
  const isPlaying = playingMessageId === message.id;
  const isTtsLoading = ttsLoadingId === message.id;
  const isRaw = isMessageRaw(message.id);
  const isCopied = copiedMessageId === message.id;
  return (
    <div
      className={`flex flex-col group ${isUser ? 'items-end' : 'items-start'}`}
    >
      <div className="flex items-center gap-2 mb-1 text-11 font-mono text-[#627794]">
        <span className={isUser ? 'text-[#8ab1e0]' : 'text-[#e05a66] font-semibold'}>
          {isUser ? 'You' : 'MarkBrain'}
        </span>
        <span>•</span>
        <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>

        {!offlineReplica && (
        <button
          onClick={() => handlePlayTTS(message)}
          disabled={isTtsLoading || (!online && !cachedIds.has(message.id) && !isPlaying)}
          className={`p-1 rounded hover:bg-surface-2 transition-colors cursor-pointer disabled:cursor-default ${
            isPlaying
              ? 'text-[#38bdf8]'
              : ttsFailedIds.has(message.id)
                ? 'text-[#f28894] hover:text-[#ff8fa0]'
                : cachedIds.has(message.id)
                  ? 'text-[#5ad49b] hover:text-[#7ee2b8]'
                  : 'text-[#50637f] hover:text-[#9bb0d1]'
          }`}
          title={
            isPlaying
              ? 'Stop playback'
              : ttsFailedIds.has(message.id)
                ? 'Audio download failed — click to retry'
                : cachedIds.has(message.id)
                  ? `Play from this device (cached) — voice: ${chosenVoice}`
                  : 'First click downloads & caches — second click plays. Zero network on play.'
          }
        >
          {isTtsLoading ? (
            <Loader2 className="w-3 h-3 animate-spin text-[#38bdf8]" />
          ) : isPlaying ? (
            <VolumeX className="w-3 h-3" />
          ) : (
            <Volume2 className="w-3 h-3" />
          )}
        </button>
        )}

        {!offlineReplica && (
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
        )}

        {!offlineReplica && onInspectCall && message.meta?.callId && (
        <button
          data-testid="inspect-call"
          onClick={() => onInspectCall(message.meta!.callId!)}
          className="p-1 rounded hover:bg-surface-2 text-[#50637f] hover:text-[#38bdf8] transition-colors opacity-40 group-hover:opacity-100 cursor-pointer"
          title="Exactly what was sent and what was received (raw provider payloads)"
        >
          <ScrollText className="w-3 h-3" />
        </button>
        )}

        {/* View + copy sit on BOTH roles and are always visible:
            hover does not exist on a phone, and these two are
            the whole point of the toggle. Nothing to read yet
            (a reply still thinking) → no controls. */}
        {message.content && (
          <>
            <button
              onClick={() => toggleMessageRaw(message)}
              aria-pressed={isRaw}
              className={`ml-1 flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-10 font-mono transition-colors cursor-pointer ${
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
          <div className="text-10 font-mono text-[#38bdf8] uppercase tracking-wider font-semibold">
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

        <TurnReceiptsRow
    message={message}
    chapters={chapters}
    isUser={isUser}
    artifactTitles={artifactTitles}
    onOpenArtifact={onOpenArtifact}
  />

  {message.meta && !isUser && (
          <div className="mt-2.5 pt-2 flex flex-wrap items-center justify-between gap-2 text-10 font-mono text-[#637894]">
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
                  disabled={isLoading || draftCount > 0}
                  title={
                    draftCount > 0
                      ? 'Available when the queue is empty'
                      : isLoading
                        ? 'Wait for the current reply'
                        : 'Ask for a new reply — replaces this one only if the new reply completes'
                  }
                  className="min-h-[22px] px-2 rounded-lg text-10 font-mono text-[#8ca3c7] hover:bg-surface-3 hover:text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default shrink-0"
                >
                  Regenerate
                </button>
              )}
            </div>
          </div>
        )}

        {message.meta?.isStreaming && (
          <div className="mt-2 flex items-center gap-2 text-11 font-mono text-[#38bdf8] animate-pulse">
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
          <div className="w-full shrink-0 text-9 font-mono uppercase tracking-wider text-[#556985] px-0.5">
            {isUser ? 'Attached on this turn' : 'Attached by the AI'}
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
  );};
