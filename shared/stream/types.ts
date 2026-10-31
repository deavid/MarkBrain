import { RelationKind } from '../types/graph';

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

/** An <unlink> ask: break the link(s) between the pair. `kind` narrows the
 * removal to one edge kind; null/absent removes every link between the pair. */
export interface ExtractedUnlink {
  source: string;
  target: string;
  kind: RelationKind | null;
}

export interface StreamStatusPayload {
  state: 'connecting' | 'connected' | 'thinking' | 'writing' | 'completed' | 'error';
  message: string;
  timestamp: number;
  model?: string;
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
}

export interface StreamTurnResult {
  cleanReply: string;
  rawReply: string;
  artifacts: ExtractedArtifactUpsert[];
  topicShift?: ExtractedTopicShift;
  telemetry?: BackendTelemetry;
  /** Flight-recorder row id (inspector linkage, David 2026-10-30). */
  callId?: string;
  /**
   * Graph asks the demuxer parsed out of the reply (Phase 3: local-mode links
   * now reach the commit planner — previously only the server path applied
   * them and the client dropped every <link>/<unlink> on the floor).
   */
  links?: ExtractedLink[];
  unlinks?: ExtractedUnlink[];
}

export interface StreamProtocolEvents {
  onStatusChanged?: (status: StreamStatusPayload) => void;
  onProseChunk?: (text: string) => void;
  onTopicShiftDetected?: (payload: ExtractedTopicShift) => void;
  onArtifactUpsertDetected?: (payload: ExtractedArtifactUpsert) => void;
  onLinkDetected?: (payload: ExtractedLink) => void;
  onTelemetryReceived?: (telemetry: BackendTelemetry) => void;
}
