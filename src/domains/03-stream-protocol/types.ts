import { RelationKind } from '../02-topological-graph';

export interface ExtractedTopicShift {
  title: string;
  abstract?: string;
  summary?: string;
}

export interface ExtractedArtifactUpsert {
  id: string;
  title: string;
  type: 'document' | 'chapter';
  content: {
    t0_label: string;
    t1_abstract: string;
    t2_summary: string;
    t3_body: string;
  };
}

export interface ExtractedLink {
  source: string;
  target: string;
  kind: RelationKind;
}

export interface StreamStatusPayload {
  state: 'connecting' | 'thinking' | 'writing' | 'indexing' | 'completed' | 'error';
  message: string;
  timestamp: number;
  model?: string;
  chunks?: number;
  bytesReceived?: number;
  elapsedMs?: number;
  timeToFirstChunkMs?: number;
}

export interface BackendTelemetry {
  model: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  durationMs: number;
  timeToFirstChunkMs?: number;
  rawMetadata?: any;
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
