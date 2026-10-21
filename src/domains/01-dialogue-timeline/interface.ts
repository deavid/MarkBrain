import { Turn, TimelineEvent } from './types';

export interface IDialogueTimelineDomain {
  getTurns(): Turn[];
  getTurn(id: string): Turn | null;
  getTurnSlice(startIndex: number, endIndex?: number): Turn[];
  count(): number;

  appendTurn(role: 'user' | 'assistant' | 'system', content: string, extractedArtifacts?: any[], meta?: any): Turn;
  updateTurn(id: string, partial: Partial<Turn>): void;
  loadTurns(turns: Turn[]): void;
  clear(): void;

  subscribe(callback: (event: TimelineEvent) => void): () => void;
}
