// ============================================================================
// SYSTEM ARCHITECTURE: THE UNIVERSAL ARTIFACT & OPTICAL CONTEXT ENGINE
// Spec: SYSTEM_ARCHITECTURE.md & 00_core_philosophy_soul.md
// ============================================================================

export type ArtifactType = 'document' | 'chapter' | (string & {});

export type ResolutionTier = 0 | 1 | 2 | 3;

/**
 * Universal Multi-Resolution representation pre-computed for every artifact.
 * Governs optical depth-of-field down-sampling.
 */
export interface MultiResolutionContent {
  /** Tier 0: 1-5 words. Label / tag identifier */
  t0_label: string;

  /** Tier 1: 1-2 sentences. Pure conceptual essence / silhouette */
  t1_abstract: string;

  /** Tier 2: 3-6 bullet points. Key parameters, structural decisions, constraints */
  t2_summary: string;

  /** Tier 3: Full fidelity. Verbatim text / markdown / dialogue turns */
  t3_body: string;
}

export interface ArtifactRevision {
  revision_id: string;
  timestamp: number;
  content: MultiResolutionContent;
  /** Conversation turn or prompt context that authored this change */
  author_note?: string;
}

export type RelationKind =
  | 'parent_of'   // Hierarchical abstraction (Parent is more abstract)
  | 'child_of'    // Hierarchical concretization (Child is more detailed)
  | 'relates_to'  // Lateral associative link
  | 'refines'     // Direct evolutionary update
  | 'born_from';  // Derived from a specific Chapter

export interface ArtifactRelation {
  target_artifact_id: string;
  kind: RelationKind;
  weight?: number; // Optional semantic tightness (default: 1.0)
}

export interface ProvenanceRecord {
  /** Chapter ID during which this artifact was first drafted */
  origin_chapter_id: string;
  /** Turn index range within that chapter (e.g., [4, 7]) */
  turn_range?: [number, number];
  /** History of subsequent chapters that modified this artifact */
  mutation_chapter_ids: string[];
}

/**
 * Universal Artifact Primitive:
 * Both documents and dialogue chapters share this unified schema.
 */
export interface Artifact {
  id: string;
  workspace_id: string;
  type: ArtifactType;
  created_at: number;
  updated_at: number;

  /** Multi-resolution representation of the latest active revision */
  current: MultiResolutionContent;

  /** Complete historical revision audit trail (revisions never deleted) */
  revisions: ArtifactRevision[];

  /** Graph connections to other artifacts */
  relations: ArtifactRelation[];

  /** Audit trail tying this artifact back to raw discussion turns */
  provenance: ProvenanceRecord;

  // Metadata & display attributes
  tags?: string[];
  category?: string;
  code?: string;
  isHighConcept?: boolean;
  color?: string;
  pinned_tier?: ResolutionTier;
  graph?: {
    x?: number;
    y?: number;
    parent?: string;
    children?: string[];
    relationships?: Array<{ target: string; type: string; note?: string }>;
    is_high_concept?: boolean;
    [key: string]: any;
  };

  // Helper getters/aliases for transition compatibility
  title?: string;
  description?: string;
  summary?: string;
  content?: string;
  history?: any[];
  projectId?: string;
  resolution?: any;
  yamlDocument?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  relationships?: any;
  abstract?: string;
  depth?: any;
  tokens?: number;
}

export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  timestamp: number;
  content: string; // The raw conversational text (excluding internal XML commands)
  raw_payload?: string; // Complete unstripped model stream for debugging
}

export interface ChapterArtifact extends Artifact {
  type: 'chapter';
  turns: Turn[];
  status: 'active' | 'closed';
  /** Optional side-channel recalibration dialogue associated solely with this chapter */
  recalibration_thread?: Turn[];
}

export type OpticalMode = 'autofocus' | 'manual' | 'myopia';

export interface WorkspaceState {
  workspace_id: string;
  name: string;
  description: string;
  color?: string;
  created_at: number;
  updated_at: number;

  /** Currently active conversation chapter ID */
  active_chapter_id: string;

  /** Pinned focal artifacts for manual or autofocus mode */
  focal_artifact_ids: string[];

  /** Optical mode governing depth of field */
  optical_mode: OpticalMode;

  /** All artifacts in the workspace (documents and chapters) mapped by ID */
  artifacts: Record<string, Artifact | ChapterArtifact>;

  /** Pinned or manual tier overrides per artifact */
  tier_overrides: Record<string, ResolutionTier>;
}

export interface ContextTelemetry {
  focal_artifact_ids: string[];
  optical_mode: OpticalMode;
  token_breakdown: {
    system_tokens: number;
    substrate_tokens: number;
    history_tokens: number;
    total_tokens: number;
    budget_ceiling: number;
  };
  node_distribution: {
    tier_3_count: number;
    tier_2_count: number;
    tier_1_count: number;
    tier_0_count: number;
    culled_count: number;
  };
}

export interface ModelOption {
  id: string;
  name: string;
  badge: string;
  powerRating: number;
  latency: string;
  contextWindow: string;
  description: string;
  costMultiplier?: number;
}

// Compatibility types for legacy components during transition
export type AbstractionLevel = 'full' | 'summary' | 'description' | 'title' | 'excluded';
export type ContextDepth = AbstractionLevel | 'off' | 'name' | 'children-summaries';
export type ArtifactCategory = string;
export interface ArtifactRelationship {
  parent?: string;
  children?: string[];
  related?: string[];
}
export interface ArtifactGraphData {
  parent?: string;
  children?: string[];
  relationships?: Array<{ target: string; type: string; note?: string }>;
  is_high_concept?: boolean;
  x?: number;
  y?: number;
}
export interface ArtifactVersion {
  version: number;
  timestamp: string;
  author?: 'user' | 'assistant';
  changeSummary: string;
  previousContent?: string;
  content: string;
}
export interface GraphNode {
  id: string;
  artifactId: string;
  projectId: string;
  title: string;
  type: string;
  isHighConcept?: boolean;
  status?: string;
  x: number;
  y: number;
  tags?: string[];
}
export interface GraphEdge {
  id: string;
  source?: string;
  target?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  sourceProjectId?: string;
  targetProjectId?: string;
  label?: string;
  isCrossRepo?: boolean;
  isCrossProject?: boolean;
  type?: string;
  strength?: number;
}
export interface MessageMeta {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costEstimate?: string;
  latencyMs?: number;
  isStreaming?: boolean;
  streamState?: string;
  interrupted?: boolean;
  rawMetadata?: any;
}
export interface ChatMessage {
  id: string;
  chapterId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  extractedArtifacts?: any[];
  createdArtifacts?: any[];
  updatedArtifacts?: any[];
  meta?: MessageMeta;
}
export interface Chapter {
  id: string;
  projectId: string;
  title: string;
  code?: string;
  summary?: string;
  shortSummary?: string;
  deepSummary?: string;
  keyPoints?: string[];
  isSummarized?: boolean;
  compressionMode?: 'full' | 'summary' | 'drop' | 'dropped';
  depth?: 'off' | 'name' | 'summary' | 'full';
  messages: ChatMessage[];
  status: 'active' | 'completed';
  topicShiftReason?: string;
  createdAt: string;
  color?: string;
  isPinnedAsArtifact?: boolean;
  graph?: ArtifactGraphData;
}
export interface Project {
  id: string;
  name: string;
  codeName?: string;
  description: string;
  color: string;
  icon?: string;
  boundaryRules?: string;
  lastActivity?: string;
  currentChapterId: string;
  chapters: Chapter[];
  artifacts: Artifact[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  draftMessage?: string;
}
export interface TokenGroupBreakdown {
  artifactsTokens: number;
  activeChapterTokens: number;
  olderChaptersTokens: number;
  systemPromptTokens: number;
  totalTokens: number;
  artifactsCount: number;
  activeChaptersCount: number;
  olderChaptersCount: number;
  estimatedCost: string;
}

export const MELLOW_DARK_PASTELS = [
  '#4a3f6b', // Mellow dark lavender/purple
  '#2d5a6c', // Mellow dark slate teal
  '#3d6350', // Mellow dark sage/forest
  '#6e4c38', // Mellow dark warm cedar
  '#594263', // Mellow dark plum/mauve
  '#2f5266', // Mellow dark oceanic steel
  '#634b52', // Mellow dark dusky rose
  '#425e70', // Mellow dark indigo slate
  '#545938', // Mellow dark olive brass
  '#3a5959', // Mellow dark eucalyptus
  '#5f4359', // Mellow dark amethyst
  '#4d5366', // Mellow dark dusk navy
];

export function getMellowPastelColor(seed: string | number): string {
  if (typeof seed === 'number') {
    return MELLOW_DARK_PASTELS[Math.abs(seed) % MELLOW_DARK_PASTELS.length];
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return MELLOW_DARK_PASTELS[Math.abs(hash) % MELLOW_DARK_PASTELS.length];
}
