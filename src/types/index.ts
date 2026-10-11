export type ArtifactType = 
  | 'architecture' 
  | 'token-spec' 
  | 'component-contract' 
  | 'schema' 
  | 'migration-guide'
  | 'design-artifact'
  | 'system-spec'
  | 'concept-doc'
  | 'decision-record'
  | 'research-note'
  | 'game-mechanic'
  | 'imported-source';

export type ArtifactCategory = 
  | 'design-artifact'
  | 'system-spec'
  | 'concept-doc'
  | 'decision-record'
  | 'research-note'
  | 'game-mechanic'
  | 'chat-chapter'
  | 'imported-source';

export type AbstractionLevel = 'full' | 'summary' | 'description' | 'title' | 'excluded';

export type ContextDepth = AbstractionLevel | 'off' | 'name' | 'children-summaries';

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

export interface Artifact {
  id: string;
  projectId?: string;
  code: string; // nickname/code/handle e.g. "rage-mechanic" or "token-boundary"
  title: string; // few words
  type: ArtifactType;
  category: ArtifactCategory | string;
  description: string; // few phrases
  summary: string; // few paragraphs
  content: string; // Markdown pages
  graph?: ArtifactGraphData;
  isHighConcept?: boolean;
  resolution: AbstractionLevel;
  history?: ArtifactVersion[];
  tags?: string[];
  createdAt?: string;
  updatedAt: string;
  yamlDocument?: string;
  // legacy / compatibility props
  abstract?: string;
  depth?: ContextDepth;
  tokens?: number;
  relationships?: ArtifactRelationship;
}

export interface GraphNode {
  id: string;
  artifactId: string;
  projectId: string;
  title: string;
  type: ArtifactType;
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
}

export interface ChatMessage {
  id: string;
  chapterId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  extractedArtifacts?: Array<Partial<Artifact> & { abstract?: string; isHighConcept?: boolean }>;
  createdArtifacts?: Artifact[];
  updatedArtifacts?: {
    artifactId: string;
    artifactTitle: string;
    changeSummary: string;
    previousContent: string;
    newContent?: string;
    version?: number;
  }[];
  meta?: MessageMeta;
}

export interface Chapter {
  id: string;
  projectId: string;
  parentId?: string; // Parent chapter ID for tree-form
  level?: 1 | 2 | 3; // 1 = Chapter, 2 = Subchapter, 3 = Section
  title: string;
  code?: string;
  summary?: string;
  shortSummary?: string;
  deepSummary?: string;
  subchapters?: string[];
  keyPoints?: string[];
  isSummarized?: boolean;
  compressionMode?: 'full' | 'summary' | 'drop' | 'dropped';
  depth?: 'off' | 'name' | 'summary' | 'full';
  messages: ChatMessage[];
  status: 'active' | 'completed';
  topicShiftReason?: string;
  createdAt: string;
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
