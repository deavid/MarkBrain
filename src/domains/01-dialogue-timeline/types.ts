export interface Turn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Chat-thread ownership — tagged at snapshot boundaries (see 06-chat-threads). */
  threadId?: string;
  extractedArtifacts?: any[];
  meta?: {
    model?: string;
    promptTokens?: number;
    candidatesTokens?: number;
    totalTokens?: number;
    durationMs?: number;
    timeToFirstChunkMs?: number;
    isStreaming?: boolean;
    rawMetadata?: any;
    streamState?: string;
    interrupted?: boolean;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
    [key: string]: any;
  };
}

export type TimelineEvent =
  | { type: 'turnAppended'; turn: Turn }
  | { type: 'turnUpdated'; turn: Turn }
  | { type: 'timelineLoaded'; workspaceId: string }
  | { type: 'timelineCleared'; workspaceId: string };
