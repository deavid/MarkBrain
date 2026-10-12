import { IDialogueTimelineDomain } from './interface';
import { Turn, TimelineEvent } from './types';

export class DialogueTimelineDomain implements IDialogueTimelineDomain {
  private turns: Turn[] = [];
  private listeners: Set<(event: TimelineEvent) => void> = new Set();
  private workspaceId: string;

  constructor(workspaceId: string, initialTurns: Turn[] = []) {
    this.workspaceId = workspaceId;
    this.turns = [...initialTurns];
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
    extractedArtifacts?: any[]
  ): Turn {
    const turn: Turn = {
      id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role,
      content,
      timestamp: Date.now(),
      extractedArtifacts,
    };
    this.turns.push(turn);
    this.emit({ type: 'turnAppended', turn });
    return turn;
  }

  loadTurns(turns: Turn[]): void {
    this.turns = [...turns];
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
