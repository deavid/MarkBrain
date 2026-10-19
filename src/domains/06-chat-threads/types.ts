/**
 * Chat threads — data model + pure decision helpers.
 *
 * A thread is a conversation lane INSIDE a project: turns/chapters carry a
 * threadId, and the snapshot stores thread + folder metadata alongside them.
 *
 * Two orthogonal status axes (never conflate them):
 *   - lifecycle ('active' | 'archived') — user-set, persistent, reversible.
 *   - runtime   ('idle' | 'queued' | 'working' | 'error' | 'interrupted') —
 *     DERIVED from the generation queue + lastOutcome. Never persisted.
 *
 * Everything in this file is pure — unit-tested without any domain/storage.
 */

import type { Granularity } from '../granularity';

export type ThreadLifecycle = 'active' | 'archived';

/** How the thread title came to be. 'manual' is a permanent user lock. */
export type ThreadTitleState = 'placeholder' | 'auto' | 'manual';

/**
 * An artifact used in a chat. The ATTACHMENT carries the granularity — the
 * same artifact can be `title` in one chat and `full` in another.
 *
 * One-way on purpose: there is no detach and no excluded state (David,
 * 2026-10-19). The only knob is granularity, floor = title (a mention).
 */
export interface ChatAttachment {
  artifactId: string;
  granularity: Granularity;
  addedAt: number;
}

export interface ChatThread {
  id: string;
  folderId: string | null; // null = Inbox
  title: string;
  titleState: ThreadTitleState;
  /** 0 = placeholder (no LLM yet), 1 = first auto-gen, 2 = re-gen after ~3 turns. */
  titleVersion: number;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  lifecycle: ThreadLifecycle;
  /** Post-mortem of the last generation attempt (persists across reloads). */
  lastOutcome: 'ok' | 'error' | 'interrupted';
  /** First ~100 chars of the latest user message (row subtitle). */
  preview: string;
  /**
   * Artifacts used in THIS chat, in attach order. Empty = nothing but the
   * conversation is sent. Legacy snapshots hydrate to [] (see ThreadRegistry).
   */
  attachments: ChatAttachment[];
}

export interface ThreadFolder {
  id: string;
  name: string;
  order: number;
}

/** Derived UI state — see deriveThreadRuntime(). */
export type ThreadRuntime = 'idle' | 'queued' | 'working' | 'error' | 'interrupted';

const rand = () => Math.random().toString(36).slice(2, 6);

export function makeThreadId(): string {
  return `thread-${Date.now().toString(36)}-${rand()}`;
}

/**
 * Fresh thread. titleVersion 0 = the staged titling pipeline hasn't run yet.
 */
export function makeNewThread(partial: Partial<ChatThread> = {}): ChatThread {
  const now = Date.now();
  return {
    id: makeThreadId(),
    folderId: null,
    title: 'New thread',
    titleState: 'placeholder',
    titleVersion: 0,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    lifecycle: 'active',
    lastOutcome: 'ok',
    preview: '',
    attachments: [],
    ...partial,
  };
}

/**
 * Migration/default thread: synthetic title, pipeline exhausted (titleVersion 2)
 * so legacy conversations never get re-titled by the stage-1/stage-2 triggers.
 */
export function makeDefaultThread(): ChatThread {
  return makeNewThread({
    title: 'Main',
    titleState: 'auto',
    titleVersion: 2,
  });
}

/** Every thread owns at least one chapter (startIndex 0 covers its turns). */
export function makeGenesisChapter(projectId: string, threadId: string) {
  return {
    id: `chap-genesis-${threadId}`,
    workspaceId: projectId,
    threadId,
    title: 'Genesis Chapter',
    description: '',
    summary: '',
    granularity: 'full' as const,
    status: 'active' as const,
    startIndex: 0,
    createdAt: Date.now(),
  };
}

/** Truncated first-message title (Stage 0) — no LLM involved. */
export function placeholderTitle(text: string): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'New thread';
  if (clean.length <= 40) return clean;
  const cut = clean.slice(0, 40);
  const spaceIdx = cut.lastIndexOf(' ');
  return (spaceIdx > 12 ? cut.slice(0, spaceIdx) : cut).trim() + '…';
}

/**
 * Staged titling pipeline decision — called after a SUCCESSFUL assistant reply.
 *   stage1: first reply completes while title is still a placeholder.
 *   stage2: exactly once more after ~3 substantive replies.
 * Manual rename and migrated threads (titleVersion 2) opt out permanently.
 */
export function titlePipelineStep(
  thread: ChatThread,
  assistantCount: number
): 'stage1' | 'stage2' | null {
  if (thread.titleState === 'manual') return null;
  if (thread.titleVersion === 0 && assistantCount >= 1) return 'stage1';
  if (thread.titleVersion === 1 && assistantCount >= 3) return 'stage2';
  return null;
}

/** Compact transcript sample for the title meta-call: first 2 + last 4 turns. */
export function sampleTurnsForTitle(
  turns: Array<{ role: string; content: string }>
): Array<{ role: string; content: string }> {
  const nonEmpty = turns.filter((t) => (t.content || '').trim().length > 0);
  const sample =
    nonEmpty.length > 8
      ? [...nonEmpty.slice(0, 2), ...nonEmpty.slice(-4)]
      : nonEmpty;
  return sample.map((t) => ({
    role: t.role,
    content: t.content.slice(0, 400),
  }));
}

/**
 * Runtime for a thread row — precedence: actively streaming > queued > flags.
 * Pure so the queue UI and its tests share one source of truth.
 */
export function deriveThreadRuntime(
  thread: ChatThread,
  activeJobThreadId: string | null,
  queue: Array<{ threadId: string }>
): ThreadRuntime {
  if (activeJobThreadId && thread.id === activeJobThreadId) return 'working';
  if (queue.some((j) => j.threadId === thread.id)) return 'queued';
  if (thread.lastOutcome === 'error') return 'error';
  if (thread.lastOutcome === 'interrupted') return 'interrupted';
  return 'idle';
}

/** 1-based position in the pending queue, 0 when not queued. */
export function queuePositionOf(threadId: string, queue: Array<{ threadId: string }>): number {
  const idx = queue.findIndex((j) => j.threadId === threadId);
  return idx >= 0 ? idx + 1 : 0;
}