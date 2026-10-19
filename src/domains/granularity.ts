/**
 * Granularity — the ONE axis, the FOUR words (TERMINOLOGY.md §0).
 *
 * `tier`, `level`, `resolution`, `abstract`, `label`, `excluded` are dead
 * words. An artifact or a chapter is included at exactly one granularity, and
 * granularity is a CUT, not a substitution: each level contains everything the
 * shorter levels contain, plus one more layer.
 *
 *   title        → title
 *   description  → title + description
 *   summary      → title + description + summary
 *   full         → title + description + summary + body / verbatim turns
 *
 * The ordering lives here so the compiler, the previews, the token estimator
 * and the UI menu cannot drift apart. Deliberately dependency-free: every
 * domain may import it (type-only at the call sites).
 */

export type Granularity = 'title' | 'description' | 'summary' | 'full';

/** Ascending cut order — menu order, comparison order, nothing else. */
export const GRANULARITY_ORDER: readonly Granularity[] = [
  'title',
  'description',
  'summary',
  'full',
] as const;

/** UI copy for the four words (one casing, one place). */
export const GRANULARITY_LABEL: Record<Granularity, string> = {
  title: 'Title',
  description: 'Description',
  summary: 'Summary',
  full: 'Full',
};

/**
 * Internal enum numbers from TERMINOLOGY.md §0 (10/20/30/100). They are never
 * displayed, never persisted in preferences, never compared by the UI — they
 * exist only so ordering can be expressed as arithmetic where that reads
 * better than an array index.
 */
export const GRANULARITY_WEIGHT: Record<Granularity, 10 | 20 | 30 | 100> = {
  title: 10,
  description: 20,
  summary: 30,
  full: 100,
};

export type ArtifactLayer = 'title' | 'description' | 'summary' | 'body';

/**
 * THE cut rule: does the chosen granularity include this layer?
 * Title rides along at every level (it is the row's name as much as content).
 */
export function cutIncludes(granularity: Granularity, layer: ArtifactLayer): boolean {
  switch (layer) {
    case 'title':
      return true;
    case 'description':
      return granularity !== 'title';
    case 'summary':
      return granularity === 'summary' || granularity === 'full';
    case 'body':
      return granularity === 'full';
    default:
      return false;
  }
}

/**
 * Chapter default when a chapter is sealed: full → summary; a manual choice
 * (title/description) is the user's and is never clobbered.
 */
export function sealedGranularity(current: Granularity | undefined): Granularity {
  return current === undefined || current === 'full' ? 'summary' : current;
}

/** Strict-ish coercion from anything that might arrive from storage/legacy. */
export function normalizeGranularity(value: unknown, fallback: Granularity = 'full'): Granularity {
  return value === 'title' || value === 'description' || value === 'summary' || value === 'full'
    ? value
    : fallback;
}
