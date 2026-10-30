import { Turn, TimelineEvent } from './types';

/**
 * Per-thread turn storage (Phase 4): the active-thread methods operate on the
 * ACTIVE thread's bucket; the *For(threadId) variants address any thread
 * directly so callers never branch on active-vs-inactive.
 */
export interface IDialogueTimelineDomain {
  getTurns(): Turn[];
  getTurn(id: string): Turn | null;
  getTurnSlice(startIndex: number, endIndex?: number): Turn[];
  count(): number;

  appendTurn(role: 'user' | 'assistant' | 'system', content: string, extractedArtifacts?: any[], meta?: any, id?: string): Turn;
  updateTurn(id: string, partial: Partial<Turn>): void;
  loadTurns(turns: Turn[]): void;
  clear(): void;

  /** Names the thread the active-thread API reads and writes (thread switch = this, not an array swap). */
  setActiveThread(threadId: string): void;
  /** Appends to the NAMED thread, stamping threadId. */
  appendTurnFor(threadId: string, role: 'user' | 'assistant' | 'system', content: string, extractedArtifacts?: any[], meta?: any, id?: string): Turn;
  /** Edits a turn on the NAMED thread. */
  updateTurnFor(threadId: string, turnId: string, partial: Partial<Turn>): void;
  /** Replaces the NAMED thread's turns. */
  loadTurnsFor(threadId: string, turns: Turn[]): void;
  /** Full (re)hydration: replaces ALL buckets from a snapshot's tagged turns. */
  loadAllTurns(turns: Turn[]): void;
  turnsFor(threadId: string): Turn[];
  countFor(threadId: string): number;
  /** Every thread's turns, flattened. */
  allTurns(): Turn[];
  clearAll(): void;
  /** The thread left the project (deleted): its content goes with it. */
  forgetThread(threadId: string): void;

  subscribe(callback: (event: TimelineEvent) => void): () => void;
}
