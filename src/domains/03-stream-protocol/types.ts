import { RelationKind } from '../02-topological-graph';

export interface ExtractedTopicShift {
  title: string;
  subtitle?: string;
  description?: string;
  summary?: string;
}

export interface ExtractedArtifactUpsert {
  id: string;
  title: string;
  type: 'document' | 'chapter';
  content: {
    subtitle: string;
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
  /** Set when the requested model was NOT used — honest downgrade trail (design-docs/16 §2). */
  downgradedFrom?: string;
  chunks?: number;
  bytesReceived?: number;
  elapsedMs?: number;
  timeToFirstChunkMs?: number;
}

/** Provider-neutral wire telemetry sent on SSE `complete` (and synthesized on abort). */
export interface BackendTelemetry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  timeToFirstChunkMs?: number;
  /** True when the numbers are estimates (no real usage telemetry came back). */
  isFallback?: boolean;
  /** The model the user asked for and did not get (watchdog/allowlist downgrade). */
  downgradedFrom?: string;
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
