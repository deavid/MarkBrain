import { Artifact } from '../types';
import { contentHash } from './contentHash';

// Import duplicate/version detection. Tiers, strongest signal first:
//   1. identical normalized body  → duplicate-of
//   2. same frontmatter `code`    → revision-of
//   3. same title (case-folded)   → revision-of
// The flag IS the relationship (graph.relationships) — no extra persistence.

export type ImportFlagType = 'duplicate-of' | 'revision-of';

export interface ImportFlag {
  type: ImportFlagType;
  targetId: string;
  targetTitle: string;
  /** Human tier name: 'identical content' | 'same code' | 'same title' */
  reason: string;
}

export interface DetectTarget {
  id: string;
  title: string;
  code?: string;
  body: string;
}

const IMPORT_FLAG_TYPES: ReadonlySet<string> = new Set(['duplicate-of', 'revision-of']);

export function isFlaggedArtifact(art: Artifact): boolean {
  return Boolean(
    art.graph?.relationships?.some((r) => r && IMPORT_FLAG_TYPES.has(r.type))
  );
}

/** The relationship edge a flag adds — built in one place (App land + session row snapshot). */
export function flagRelationship(flag: ImportFlag): {
  target: string;
  type: string;
  note: string;
} {
  const date = new Date().toISOString().slice(0, 10);
  return {
    target: flag.targetId,
    type: flag.type,
    note: `Auto-flagged on import ${date} (${flag.reason})`,
  };
}

/** `skipId` prevents self-matches (incoming id already present). */
export function detectImportFlag(
  incoming: { title: string; code?: string; body: string },
  existing: DetectTarget[],
  skipId?: string
): ImportFlag | null {
  const incomingHash = contentHash(incoming.body);

  for (const ex of existing) {
    if (skipId && ex.id === skipId) continue;
    if (contentHash(ex.body) === incomingHash) {
      return { type: 'duplicate-of', targetId: ex.id, targetTitle: ex.title, reason: 'identical content' };
    }
  }

  const codeN = (incoming.code || '').trim().toLowerCase();
  if (codeN) {
    for (const ex of existing) {
      if (skipId && ex.id === skipId) continue;
      if ((ex.code || '').trim().toLowerCase() === codeN) {
        return { type: 'revision-of', targetId: ex.id, targetTitle: ex.title, reason: 'same code' };
      }
    }
  }

  const titleN = (incoming.title || '').trim().toLowerCase();
  if (titleN) {
    for (const ex of existing) {
      if (skipId && ex.id === skipId) continue;
      if ((ex.title || '').trim().toLowerCase() === titleN) {
        return { type: 'revision-of', targetId: ex.id, targetTitle: ex.title, reason: 'same title' };
      }
    }
  }

  return null;
}