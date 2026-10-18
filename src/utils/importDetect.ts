import { Artifact } from '../types';
import { contentHash } from './contentHash';

// Multi-import plan — Phase 2: smart duplicate/version detection.
// Tiers (cheap → expensive… actually: strongest signal first at equal cost):
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

/** True when the artifact carries an unresolved import flag relationship. */
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

/**
 * Detect whether an incoming import looks like an already-imported artifact.
 * Checks every existing artifact tier-by-tier (hash across all, then code,
 * then title), so an identical body wins over a coincidental title clash.
 * `skipId` prevents self-matches (incoming id already present).
 */
export function detectImportFlag(
  incoming: { title: string; code?: string; body: string },
  existing: DetectTarget[],
  skipId?: string
): ImportFlag | null {
  const incomingHash = contentHash(incoming.body);

  // Tier 1: identical (normalized) content → duplicate-of
  for (const ex of existing) {
    if (skipId && ex.id === skipId) continue;
    if (contentHash(ex.body) === incomingHash) {
      return { type: 'duplicate-of', targetId: ex.id, targetTitle: ex.title, reason: 'identical content' };
    }
  }

  // Tier 2: same code → revision-of
  const codeN = (incoming.code || '').trim().toLowerCase();
  if (codeN) {
    for (const ex of existing) {
      if (skipId && ex.id === skipId) continue;
      if ((ex.code || '').trim().toLowerCase() === codeN) {
        return { type: 'revision-of', targetId: ex.id, targetTitle: ex.title, reason: 'same code' };
      }
    }
  }

  // Tier 3: same title (trimmed, case-folded) → revision-of
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