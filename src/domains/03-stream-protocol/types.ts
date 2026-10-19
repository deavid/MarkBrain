import { RelationKind } from '../02-topological-graph';

export interface ExtractedTopicShift {
  title: string;
  /** 1–2 sentences: what the new chapter is about (level 2 of the cut). */
  description?: string;
  summary?: string;
}

export interface ExtractedArtifactUpsert {
  id: string;
  title: string;
  type: 'document' | 'chapter';
  content: {
    description: string;
    summary: string;
    body: string;
  };
}

export interface ExtractedLink {
  source: string;
  target: string;
  kind: RelationKind;
}

export interface StreamStatusPayload {
  state: 'connecting' | 'thinking' | 'writing' | 'completed' | 'error';
  message: string;
  timestamp: number;
  model?: string;
  chunks?: number;
  bytesReceived?: number;
  elapsedMs?: number;
  timeToFirstChunkMs?: number;
}

/**
 * Provider-neutral telemetry vocabulary (see 08_UNIFIED_DATA_MODEL.md D3) —
 * the wire payload the server sends on `complete` and the abort-path
 * synthesis mirrors. input/output/latency names are provider-neutral so a
 * multi-provider future doesn't leak Gemini-vs-OpenAI names into OUR types.
 */
export interface BackendTelemetry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  timeToFirstChunkMs?: number;
  /** True when the numbers are estimates (no real usage telemetry came back). */
  isFallback?: boolean;
}

export interface StreamTurnResult {
  cleanReply: string;
  rawReply: string;
  artifacts: ExtractedArtifactUpsert[];
  topicShift?: ExtractedTopicShift;
  telemetry?: BackendTelemetry;
}

export interface StreamProtocolEvents {
  onStatusChanged?: (status: StreamStatusPayload) => void;
  onProseChunk?: (text: string) => void;
  onTopicShiftDetected?: (payload: ExtractedTopicShift) => void;
  onArtifactUpsertDetected?: (payload: ExtractedArtifactUpsert) => void;
  onLinkDetected?: (payload: ExtractedLink) => void;
  onTelemetryReceived?: (telemetry: BackendTelemetry) => void;
}
