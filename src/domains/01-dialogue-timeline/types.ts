/**
 * Provider-neutral turn telemetry — ONE vocabulary (see
 * design-docs/08_UNIFIED_DATA_MODEL.md D3). Kept small on purpose: every
 * field here must have a writer AND a reader or it is a zombie.
 */
export interface TurnMeta {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  /** Latency to the first streamed chunk (orb stats seed / mirror honesty). */
  timeToFirstChunkMs?: number;
  isStreaming?: boolean;
  streamState?: string;
  /** True when the numbers are estimates (no real usage telemetry came back). */
  isFallback?: boolean;
}

/**
 * Chat-extracted note chip attached to a turn — the sendQueue writer feeds
 * these, ChatView renders them (and can inspect/save them because `id`
 * matches the artifact the extraction pipeline created).
 */
export interface ExtractedArtifact {
  id: string;
  title: string;
  type: string;
  code?: string;
  category?: string;
  description?: string;
  summary?: string;
  content?: string;
  isHighConcept?: boolean;
}

export interface Turn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Epoch ms — formatting happens at the one display site. */
  timestamp: number;
  /** Chat-thread ownership — tagged at snapshot boundaries (see 06-chat-threads). */
  threadId?: string;
  extractedArtifacts?: ExtractedArtifact[];
  meta?: TurnMeta;
}

export type TimelineEvent =
  | { type: 'turnAppended'; turn: Turn }
  | { type: 'turnUpdated'; turn: Turn }
  | { type: 'timelineLoaded'; workspaceId: string }
  | { type: 'timelineCleared'; workspaceId: string };
