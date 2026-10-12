export type RelationKind =
  | 'parent_of'
  | 'child_of'
  | 'relates_to'
  | 'refines'
  | 'born_from';

export interface SemanticEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: RelationKind;
  weight?: number;
}

export type GraphEvent =
  | { type: 'edgeAdded'; edge: SemanticEdge }
  | { type: 'edgeRemoved'; edgeId: string };
