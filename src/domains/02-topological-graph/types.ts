/**
 * The edge vocabulary is OPEN: these kinds are a starting set, not a closed
 * union. Graph traversal and dedupe match known kind strings; an unknown kind
 * round-trips untouched, and nothing may coerce it to 'relates_to'.
 */
export const KNOWN_RELATION_KINDS = [
  'parent_of',
  'child_of',
  'relates_to',
  'refines',
  'born_from',
] as const;

export type KnownRelationKind = (typeof KNOWN_RELATION_KINDS)[number];

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
