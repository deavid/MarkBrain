import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DomainContextValue } from '../../domains/DomainRegistry';
import {
  deriveThreadRuntime,
  queuePositionOf,
  ThreadRuntime,
} from '../../domains/06-chat-threads';
import type { SendQueue } from '../../application/sendQueue';

export interface ThreadUiParams {
  sendQueue: SendQueue;
  threadRegistry: DomainContextValue['threadRegistry'];
  tick: number;
}

// Presentation-side thread state: queue wrappers ChatView/Sidebar bind,
// per-thread runtimes, and unread tracking. Moved verbatim from App.tsx.
export function useThreadUi(params: ThreadUiParams) {
  const { sendQueue, threadRegistry, tick } = params;

  const handleStopGeneration = useCallback(() => {
    sendQueue.stopGeneration();
  }, [sendQueue, threadRegistry]);

  // ── Thread-aware turn routing / serial queue handlers ──────────────────────
  // Routing helpers (getTurnsOf & co.), noteSendIntent/maybeRetitle, executeTurn
  // and the queue pump all moved to application/sendQueue.ts. These thin
  // wrappers keep the exact names/signatures ChatView/Sidebar already bind.
  const handleSendMessage = async (text: string) => {
    sendQueue.handleSendMessage(text);
  };

  // Cancel this thread's PENDING jobs (never touches an in-flight stream).
  const handleCancelQueued = (threadId: string) => {
    sendQueue.handleCancelQueued(threadId);
  };

  // Regenerate the last assistant turn of the active thread (error/interrupted).
  const handleRetryThread = () => {
    sendQueue.handleRetryThread();
  };

  // Per-thread runtime for sidebar rows + chat header chip (derived, never persisted).
  const threadRuntimes = useMemo(() => {
    const map: Record<string, { state: ThreadRuntime; position: number }> = {};
    const queue = sendQueue.getQueue();
    const activeJobThreadId = sendQueue.getActiveJob()?.threadId ?? null;
    for (const t of threadRegistry.getThreads()) {
      map[t.id] = {
        state: deriveThreadRuntime(t, activeJobThreadId, queue),
        position: queuePositionOf(t.id, queue),
      };
    }
    return map;
  }, [tick, threadRegistry]);

  // "New since you left": thread finished generating while you were elsewhere.
  // Transient (tab-local) — cleared the moment the thread is opened.
  const [unreadThreadIds, setUnreadThreadIds] = useState<string[]>([]);
  const markThreadUnread = (threadId: string) => {
    if (threadId === threadRegistry.getActiveThreadId()) return;
    setUnreadThreadIds((prev) => (prev.includes(threadId) ? prev : [...prev, threadId]));
  };
  const clearThreadUnread = (threadId: string) => {
    setUnreadThreadIds((prev) =>
      prev.includes(threadId) ? prev.filter((id) => id !== threadId) : prev
    );
  };

  return {
    handleStopGeneration,
    handleSendMessage,
    handleCancelQueued,
    handleRetryThread,
    threadRuntimes,
    unreadThreadIds,
    markThreadUnread,
    clearThreadUnread,
  };
}
