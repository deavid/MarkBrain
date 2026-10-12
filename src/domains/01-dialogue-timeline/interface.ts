import { Turn, TimelineEvent } from './types';

export interface IDialogueTimelineDomain {
  // Queries
  getTurns(): Turn[];
  getTurn(id: string): Turn | null;
  getTurnSlice(startIndex: number, endIndex?: number): Turn[];
  count(): number;

  // Commands
  appendTurn(role: 'user' | 'assistant' | 'system', content: string, extractedArtifacts?: any[]): Turn;
  loadTurns(turns: Turn[]): void;
  clear(): void;

  // Subscriptions
  subscribe(callback: (event: TimelineEvent) => void): () => void;
}
