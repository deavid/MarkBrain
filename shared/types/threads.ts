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
 */
export interface ChatAttachment {
  artifactId: string;
  granularity: Granularity;
  addedAt: number;
  /** `null` = staged (removable); `>= 0` = committed to that 0-based turn index; `-1` = committed (legacy, turn unknown). */
  turnIndex?: number | null;
  turnId?: string | null;
}

export function isAttachmentStaged(att: ChatAttachment): boolean {
  return att.turnIndex === null;
}

/** Chats holding this artifact as an attachment — the referential check that gates deletion. */
export function threadsReferencingArtifact(threads: ChatThread[], artifactId: string): ChatThread[] {
  return threads.filter((t) => (t.attachments || []).some((a) => a.artifactId === artifactId));
}

export interface ChatThread {
  id: string;
  folderId: string | null;
  title: string;
  titleState: ThreadTitleState;
  /** 0 = placeholder (no LLM yet), 1 = first auto-gen, 2 = re-gen after ~3 turns. */
  titleVersion: number;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  lifecycle: ThreadLifecycle;
  lastOutcome: 'ok' | 'error' | 'interrupted';
  preview: string;
  /**
   * Artifacts used in THIS chat, in attach order. Empty = nothing but the
   * conversation is sent. Legacy snapshots hydrate to [] (see ThreadRegistry).
   */
  attachments: ChatAttachment[];
  /** Per-thread capability overrides (Package 2 §2.2). Absent fields fall through to the project default. */
  capabilities?: Partial<ChatCapabilities>;
}

/**
 * Which functional blocks the chatbot is ALLOWED to use (Package 2 §2.2).
 * A capability that is OFF never reaches the system instruction: the XML
 * schema for it is not taught, and any rogue block the model emits anyway is
 * stripped by the demuxer and IGNORED by the apply paths.
 */
export interface ChatCapabilities {
  /** Allow/instruct LLM to emit <topic_shift> to cut chapters. DEFAULT: false. */
  autoChapter: boolean;
  /** Allow/instruct LLM to emit <artifact_upsert>. DEFAULT: true. */
  writeArtifacts: boolean;
  /** Allow/instruct LLM to emit <link>. DEFAULT: false. */
  graphLinks: boolean;
}

export const DEFAULT_CHAT_CAPABILITIES: ChatCapabilities = {
  autoChapter: false,
  writeArtifacts: true,
  graphLinks: false,
};

/**
 * Merge order (Package 2 §2.2): DEFAULT ← project default ← thread override.
 * `null`/undefined at any level falls through to the previous one.
 */
export function resolveCapabilities(
  thread: Pick<ChatThread, 'capabilities'> | null | undefined,
  projectDefault?: Partial<ChatCapabilities> | null
): ChatCapabilities {
  return {
    ...DEFAULT_CHAT_CAPABILITIES,
    ...(projectDefault || {}),
    ...(thread?.capabilities || {}),
  };
}

export interface ThreadFolder {
  id: string;
  name: string;
  order: number;
}

export type ThreadRuntime = 'idle' | 'queued' | 'working' | 'error' | 'interrupted';

const rand = () => Math.random().toString(36).slice(2, 6);

export function makeThreadId(): string {
  return `thread-${Date.now().toString(36)}-${rand()}`;
}

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

export function makeDefaultThread(): ChatThread {
  return makeNewThread({
    title: 'Main',
    titleState: 'auto',
    titleVersion: 2,
  });
}

export function placeholderTitle(text: string): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'New thread';
  if (clean.length <= 40) return clean;
  const cut = clean.slice(0, 40);
  const spaceIdx = cut.lastIndexOf(' ');
  return (spaceIdx > 12 ? cut.slice(0, spaceIdx) : cut).trim() + '…';
}

export function titlePipelineStep(
  thread: ChatThread,
  assistantCount: number
): 'stage1' | 'stage2' | null {
  if (thread.titleState === 'manual') return null;
  if (thread.titleVersion === 0 && assistantCount >= 1) return 'stage1';
  if (thread.titleVersion === 1 && assistantCount >= 3) return 'stage2';
  return null;
}

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

export function queuePositionOf(threadId: string, queue: Array<{ threadId: string }>): number {
  const idx = queue.findIndex((j) => j.threadId === threadId);
  return idx >= 0 ? idx + 1 : 0;
}