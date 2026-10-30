/**
 * Granularity: the four-level cumulative cut (`title ⊂ description ⊂ summary ⊂ full`).
 * `title` carries the title AND the subtitle hook together: a 4-word name alone
 * says nothing, and the hook costs about 40 tokens.
 * Dependency-free so every domain, the server, and UI surfaces share one ordering.
 * (The UI palette stays in `src/domains/granularity.ts` — deliberate UI, anchored
 * by design-doc 12 and `src/tests/attachment-palette.test.ts`.)
 */

export type Granularity = 'title' | 'description' | 'summary' | 'full';

export const GRANULARITY_ORDER: readonly Granularity[] = [
  'title',
  'description',
  'summary',
  'full',
] as const;

export const GRANULARITY_LABEL: Record<Granularity, string> = {
  title: 'Title',
  description: 'Description',
  summary: 'Summary',
  full: 'Full',
};

export type ArtifactLayer = 'title' | 'description' | 'summary' | 'body';

/** Cumulative cut: each level includes the shorter levels plus its own layer. */
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
 * The chapter-cut law, as a value a snapshot can carry: a build that writes
 * this marker never moves a chapter's cut on its own. Its ABSENCE in a stored
 * snapshot marks chapters whose `summary` came from the old auto-seal (the
 * build downgraded every chapter the moment it closed, `full → summary`), not
 * from a user gesture — see the one-time migration in `services/stores/hydrate.ts`.
 */
export const GRANULARITY_LAW = 'user-only';

export function normalizeGranularity(value: unknown, fallback: Granularity = 'full'): Granularity {
  return value === 'title' || value === 'description' || value === 'summary' || value === 'full'
    ? value
    : fallback;
}

export function cycleGranularity(current: Granularity): Granularity {
  const idx = GRANULARITY_ORDER.indexOf(current);
  if (idx === -1) return 'title';
  return GRANULARITY_ORDER[(idx + 1) % GRANULARITY_ORDER.length];
}
