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

export interface StreamProtocolEvents {
  onProseChunk?: (text: string) => void;
  onTopicShiftDetected?: (payload: ExtractedTopicShift) => void;
  onArtifactUpsertDetected?: (payload: ExtractedArtifactUpsert) => void;
  onLinkDetected?: (payload: ExtractedLink) => void;
}
