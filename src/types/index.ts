// ============================================================================
// UNIVERSAL ARTIFACT DATA MODEL (legacy shared types)
// ============================================================================
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';

export type ArtifactType = 'document' | 'chapter' | (string & {});

export type ResolutionTier = 0 | 1 | 2 | 3;

/**
 * Why an artifact received its compiled tier — mirrors the optical compiler
 * domain (same boundary convention as ResolutionTier) so components can label
 * manual pin / forced override / ancestor backbone / automatic depth-of-field
 * without importing across the domain layer.
 */
export type TierReason = 'pin' | 'fallback' | 'override' | 'ancestor' | 'radius' | 'culled';

/**
 * Universal Artifact Primitive — the artifact DOCUMENT model lives in the
 * domain layer (single source of truth, Phase 3b of the cleanse).
 */
export type Artifact = UniversalArtifactDocument;

export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  timestamp: number;
  content: string; // The raw conversational text (excluding internal XML commands)
  raw_payload?: string; // Complete unstripped model stream for debugging
}

export type OpticalMode = 'autofocus' | 'manual' | 'myopia';

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

export type AbstractionLevel = 'full' | 'summary' | 'description' | 'title' | 'excluded';
export type ContextDepth = AbstractionLevel | 'off' | 'name' | 'children-summaries';
export type ArtifactCategory = string;
export interface ArtifactGraphData {
  parent?: string;
  children?: string[];
  relationships?: Array<{ target: string; type: string; note?: string }>;
  is_high_concept?: boolean;
  x?: number;
  y?: number;
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
