/**
 * Semantic edge vocabulary — OPEN (requirement 01 §4.8): the known kinds are
 * a starting set, not a closed union. Graph traversal logic (getAncestors,
 * dedupe) matches known kind strings; unknown kinds round-trip untouched.
 */
export const KNOWN_RELATION_KINDS = [
  'parent_of',
  'child_of',
  'relates_to',
  'refines',
  'born_from',
] as const;

export type KnownRelationKind = (typeof KNOWN_RELATION_KINDS)[number];

/** Open vocabulary — arbitrary kinds are legal and survive storage. */
export type RelationKind = string;

export interface SemanticEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: RelationKind;
  weight?: number;
}

export type GraphEvent =
  | { type: 'edgeAdded'; edge: SemanticEdge }
  | { type: 'edgeRemoved'; edgeId: string }
  | { type: 'edgesLoaded'; edges: SemanticEdge[] };
