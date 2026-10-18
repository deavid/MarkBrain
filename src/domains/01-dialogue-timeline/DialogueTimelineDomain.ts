import { IDialogueTimelineDomain } from './interface';
import { Turn, TimelineEvent } from './types';
import { logger } from '../../utils/logger';

export class DialogueTimelineDomain implements IDialogueTimelineDomain {
  private turns: Turn[] = [];
  private listeners: Set<(event: TimelineEvent) => void> = new Set();
  private workspaceId: string;

  constructor(workspaceId: string, initialTurns: Turn[] = []) {
    this.workspaceId = workspaceId;
    this.turns = [...initialTurns];
    logger.info('Timeline', `Initialized timeline for workspace ${workspaceId} with ${this.turns.length} turns`);
  }

  getTurns(): Turn[] {
    return [...this.turns];
  }

  getTurn(id: string): Turn | null {
    return this.turns.find((t) => t.id === id) || null;
  }

  getTurnSlice(startIndex: number, endIndex?: number): Turn[] {
    return this.turns.slice(startIndex, endIndex);
  }

  count(): number {
    return this.turns.length;
  }

  appendTurn(
    role: 'user' | 'assistant' | 'system',
    content: string,
    extractedArtifacts?: any[],
    meta?: any
  ): Turn {
    const turn: Turn = {
      id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role,
      content,
      timestamp: Date.now(),
      extractedArtifacts,
      meta,
    };
    this.turns.push(turn);
    logger.info('Timeline', `Appended turn [${role}] #${this.turns.length}`, { id: turn.id, role, length: content.length, meta });
    this.emit({ type: 'turnAppended', turn });
    return turn;
  }

  updateTurn(id: string, partial: Partial<Turn>): void {
    const idx = this.turns.findIndex((t) => t.id === id);
    if (idx !== -1) {
      // Hot path: called once per SSE chunk during streaming — no logging here
      // (instrumentation law: never log hot loops; see logger.ts header).
      this.turns[idx] = { ...this.turns[idx], ...partial };
      this.emit({ type: 'turnUpdated', turn: this.turns[idx] });
    } else {
      logger.warn('Timeline', `Attempted to update non-existent turn: ${id}`);
    }
  }

  loadTurns(turns: Turn[]): void {
    this.turns = [...turns];
    logger.info('Timeline', `Loaded ${this.turns.length} turns into workspace ${this.workspaceId}`);
    this.emit({ type: 'timelineLoaded', workspaceId: this.workspaceId });
  }

  clear(): void {
    this.turns = [];
    this.emit({ type: 'timelineCleared', workspaceId: this.workspaceId });
  }

  subscribe(callback: (event: TimelineEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(event: TimelineEvent) {
    this.listeners.forEach((l) => l(event));
  }
}
