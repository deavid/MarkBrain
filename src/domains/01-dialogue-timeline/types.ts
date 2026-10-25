/** Provider-neutral turn telemetry. Every field here must have both a writer and a reader. */
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
  /**
   * Attachments welded to this turn by the commit (server or client mirror):
   * artifactId + provenance. The registry's thread list is the staging state;
   * the TURN META is the committed truth (design 23 §2.1/§2.4.1).
   */
  attachments?: Array<{ artifactId: string; granularity?: string; addedAt?: number; turnIndex?: number | null; turnId?: string | null }>;
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
  subtitle?: string;
  description?: string;
  summary?: string;
  content?: string;
  isHighConcept?: boolean;
  /** Thread-scoped index of the turn the AI attached it to (server-stamped). */
  turnIndex?: number;
}

export interface Turn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  threadId?: string;
  extractedArtifacts?: ExtractedArtifact[];
  meta?: TurnMeta;
}

export type TimelineEvent =
  | { type: 'turnAppended'; turn: Turn }
  | { type: 'turnUpdated'; turn: Turn }
  | { type: 'timelineLoaded'; workspaceId: string }
  | { type: 'timelineCleared'; workspaceId: string };
