/**
 * Artifact document — a stored thought unit in the library.
 *
 * Its content is stored as LAYERS of one document (not as alternative texts):
 * `title` lives on the artifact, and `description → summary → body` are written
 * to be read together. Granularity picks where the document is cut
 * (see `../granularity`). The artifact itself carries NO granularity: that
 * belongs to the attachment in a chat.
 */

/** The three layered text fields (level 1 — the title — is `title` below). */
export interface ArtifactLayers {
  /** ~200 words. Second layer: what this is, continuing from the title. */
  description: string;
  /** ~2000 words. Third layer: the substance, continuing from the description. */
  summary: string;
  /** The source text (markdown / verbatim document). */
  body: string;
}

export interface UniversalArtifactDocument {
  id: string;
  workspaceId: string;
  code: string;
  title: string;
  type: 'document' | 'chapter';
  category: string;
  isHighConcept: boolean;
  color?: string;
  current: ArtifactLayers;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  graph?: {
    x?: number;
    y?: number;
    is_high_concept?: boolean;
    parent?: string;
    children?: string[];
    relationships?: Array<{ target: string; type: string; note?: string }>;
    [key: string]: any;
  };
  yamlDocument?: string;
}

export type ArtifactDocumentEvent =
  | { type: 'artifactCreated'; artifact: UniversalArtifactDocument }
  | { type: 'artifactUpdated'; artifact: UniversalArtifactDocument }
  | { type: 'artifactsLoaded'; artifacts: UniversalArtifactDocument[] }
  | { type: 'artifactDeleted'; artifactId: string };
