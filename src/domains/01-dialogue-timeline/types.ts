export interface Turn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  extractedArtifacts?: any[];
}

export type TimelineEvent =
  | { type: 'turnAppended'; turn: Turn }
  | { type: 'timelineCleared'; workspaceId: string };
