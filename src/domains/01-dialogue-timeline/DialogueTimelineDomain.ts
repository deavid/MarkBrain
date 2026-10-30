import { IDialogueTimelineDomain } from './interface';
import { Turn, TimelineEvent } from './types';
import { logger } from '../../utils/logger';

/**
 * Per-thread turn storage (Phase 4). Every thread's turns live in ONE map
 * keyed by threadId — there is no separate "inactive" cache anywhere else.
 * The active-thread API (getTurns/appendTurn/updateTurn/loadTurns/clear)
 * operates on the ACTIVE thread's bucket and behaves exactly as it always
 * did; the *For(threadId) variants address any thread directly, so callers
 * never branch on "is this the active thread?" again.
 */
export class DialogueTimelineDomain implements IDialogueTimelineDomain {
  private byThread = new Map<string, Turn[]>();
  private listeners: Set<(event: TimelineEvent) => void> = new Set();
  private workspaceId: string;
  private activeThreadId = '';

  constructor(workspaceId: string, initialTurns: Turn[] = []) {
    this.workspaceId = workspaceId;
    // Pre-hydration bucket (constructor seeds): keyed by the empty active id
    // until setActiveThread names the real thread.
    this.byThread.set(this.activeThreadId, [...initialTurns]);
    logger.info('Timeline', `Initialized timeline for workspace ${workspaceId} with ${initialTurns.length} turns`);
  }

  /** The thread's bucket, created empty on first touch. */
  private bucket(threadId: string = this.activeThreadId): Turn[] {
    let b = this.byThread.get(threadId);
    if (!b) {
      b = [];
      this.byThread.set(threadId, b);
    }
    return b;
  }

  /**
   * Names the thread the active-thread API reads and writes. Called on thread
   * switch instead of swapping arrays in and out — content never moves.
   */
  setActiveThread(threadId: string): void {
    if (this.activeThreadId === threadId) return;
    this.activeThreadId = threadId;
    this.bucket(threadId);
    this.emit({ type: 'timelineLoaded', workspaceId: this.workspaceId });
  }

  getTurns(): Turn[] {
    return [...this.bucket()];
  }

  getTurn(id: string): Turn | null {
    return this.bucket().find((t) => t.id === id) || null;
  }

  getTurnSlice(startIndex: number, endIndex?: number): Turn[] {
    return this.bucket().slice(startIndex, endIndex);
  }

  count(): number {
    return this.bucket().length;
  }

  appendTurn(
    role: 'user' | 'assistant' | 'system',
    content: string,
    extractedArtifacts?: any[],
    meta?: any,
    /**
     * Optional explicit id (Phase 3): the commit planner decides the pair's
     * turn ids up front so client and server agree on them. Absent → the
     * historical generated id (every pre-existing caller is unchanged).
     */
    id?: string
  ): Turn {
    return this.appendTurnFor(this.activeThreadId, role, content, extractedArtifacts, meta, id);
  }

  /** Appends to the NAMED thread — the one uniform write path (no active fork). */
  appendTurnFor(
    threadId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    extractedArtifacts?: any[],
    meta?: any,
    id?: string
  ): Turn {
    const turn: Turn = {
      id: id ?? `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role,
      content,
      timestamp: Date.now(),
      extractedArtifacts,
      meta,
      threadId,
    };
    this.bucket(threadId).push(turn);
    logger.info('Timeline', `Appended turn [${role}] #${this.bucket(threadId).length} to ${threadId || '(active)'}`, { id: turn.id, role, length: content.length, meta });
    this.emit({ type: 'turnAppended', turn });
    return turn;
  }

  updateTurn(id: string, partial: Partial<Turn>): void {
    this.updateTurnFor(this.activeThreadId, id, partial);
  }

  updateTurnFor(threadId: string, turnId: string, partial: Partial<Turn>): void {
    const turns = this.bucket(threadId);
    const idx = turns.findIndex((t) => t.id === turnId);
    if (idx !== -1) {
      // Hot path: called once per SSE chunk during streaming — no logging here
      // (instrumentation law: never log hot loops; see logger.ts header).
      turns[idx] = { ...turns[idx], ...partial };
      this.emit({ type: 'turnUpdated', turn: turns[idx] });
    } else {
      logger.warn('Timeline', `Attempted to update non-existent turn: ${turnId}`);
    }
  }

  loadTurns(turns: Turn[]): void {
    this.loadTurnsFor(this.activeThreadId, turns);
  }

  /** Replaces the NAMED thread's turns. */
  loadTurnsFor(threadId: string, turns: Turn[]): void {
    this.byThread.set(threadId, [...turns]);
    logger.info('Timeline', `Loaded ${turns.length} turns into thread ${threadId || '(active)'} of ${this.workspaceId}`);
    this.emit({ type: 'timelineLoaded', workspaceId: this.workspaceId });
  }

  /** Full (re)hydration: replaces ALL buckets from a snapshot's tagged turns. */
  loadAllTurns(turns: Turn[]): void {
    const grouped = new Map<string, Turn[]>();
    for (const turn of turns) {
      const tid = turn.threadId ?? this.activeThreadId;
      const list = grouped.get(tid) ?? [];
      list.push(turn);
      grouped.set(tid, list);
    }
    this.byThread = grouped;
    logger.info('Timeline', `Loaded ${turns.length} turns across ${grouped.size} thread(s) into ${this.workspaceId}`);
    this.emit({ type: 'timelineLoaded', workspaceId: this.workspaceId });
  }

  turnsFor(threadId: string): Turn[] {
    return [...this.bucket(threadId)];
  }

  countFor(threadId: string): number {
    return this.bucket(threadId).length;
  }

  /** Every thread's turns, flattened (snapshot save + registry compose read this). */
  allTurns(): Turn[] {
    const out: Turn[] = [];
    for (const turns of this.byThread.values()) out.push(...turns);
    return out;
  }

  /** Clears the ACTIVE thread's turns. */
  clear(): void {
    this.bucket(this.activeThreadId);
    this.byThread.set(this.activeThreadId, []);
    this.emit({ type: 'timelineCleared', workspaceId: this.workspaceId });
  }

  /** Drops everything (full re-hydration starts from an empty slate). */
  clearAll(): void {
    this.byThread = new Map();
    this.emit({ type: 'timelineCleared', workspaceId: this.workspaceId });
  }

  /** The thread left the project (deleted): its content goes with it. */
  forgetThread(threadId: string): void {
    this.byThread.delete(threadId);
  }

  subscribe(callback: (event: TimelineEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(event: TimelineEvent) {
    this.listeners.forEach((l) => l(event));
  }
}
