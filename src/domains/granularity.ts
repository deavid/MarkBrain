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

/**
 * Cycle through the 4 granularities on dot click:
 * title (green) → description (yellow) → summary (orange) → full (red) → title.
 */
export function cycleGranularity(current: Granularity): Granularity {
  const idx = GRANULARITY_ORDER.indexOf(current);
  if (idx === -1) return 'title';
  return GRANULARITY_ORDER[(idx + 1) % GRANULARITY_ORDER.length];
}

/**
 * The 6 visual states for an artifact in a chat (design-docs/10_ATTACHMENT_TIMELINE.md):
 * - 'unstaged': not in this chat yet (dim slate, light text)
 * - 'staged': armed for the next turn, not sent yet (very bright cyan, dark text)
 * - 'title': committed in chat at Title — cheapest (emerald green, dark text)
 * - 'description': committed at Description — light (yellow, dark text)
 * - 'summary': committed at Summary — medium (orange, dark text)
 * - 'full': committed at Full — heaviest (red, dark text)
 */
export type AttachmentVisualState = 'unstaged' | 'staged' | Granularity;

export interface AttachmentStatePalette {
  state: AttachmentVisualState;
  /** Solid circle dot color + ring classes */
  dotClass: string;
  /** Row / card container classes (bright fill → dark text, dim fill → light text) */
  rowClass: string;
  /** Primary title text class inside the row/card */
  titleTextClass: string;
  /** Secondary description/meta text class inside the row/card */
  subTextClass: string;
  /** Tag / muted badge class inside the row/card */
  tagClass: string;
  /** Active chip classes when this granularity is selected */
  activeChipClass: string;
  /** Inactive chip classes when inside a bright or dark row */
  inactiveChipClass: string;
}

export const ATTACHMENT_STATE_PALETTE: Record<AttachmentVisualState, AttachmentStatePalette> = {
  unstaged: {
    state: 'unstaged',
    dotClass: 'bg-[#4f6482] border border-[#6e86a8] hover:bg-[#67e8f9] hover:border-[#cffafe]',
    rowClass: 'bg-[#0c1322] hover:bg-[#101a2e] text-[#e3edf7]',
    titleTextClass: 'text-[#e3edf7]',
    subTextClass: 'text-[#758ca8]',
    tagClass: 'text-[#556985] bg-[#080d18] border-[#152136]',
    activeChipClass: 'bg-[#1e293b] text-[#e2e8f0] border-[#475569]',
    inactiveChipClass: 'bg-[#080d16] text-[#6b82a3] border-[#141f33] hover:text-[#a4bddf]',
  },
  staged: {
    state: 'staged',
    dotClass: 'bg-[#061826] border-2 border-[#083344] ring-2 ring-[#ecfeff] shadow-sm',
    rowClass: 'bg-[#67e8f9] hover:bg-[#a5f3fc] text-[#051521] font-medium',
    titleTextClass: 'text-[#04101a] font-bold',
    subTextClass: 'text-[#082f49]',
    tagClass: 'text-[#083344] bg-[#cffafe]/80 border-[#0e7490]/40',
    activeChipClass: 'bg-[#083344] text-[#ecfeff] border-[#04101a] font-bold shadow-xs',
    inactiveChipClass: 'bg-[#cffafe]/75 text-[#083344] border-[#0e7490]/40 hover:bg-[#ecfeff]',
  },
  title: {
    state: 'title',
    dotClass: 'bg-[#052e16] border-2 border-[#022c22] ring-2 ring-[#d1fae5]',
    rowClass: 'bg-[#4ade80] hover:bg-[#6ee7b7] text-[#052e16] font-medium',
    titleTextClass: 'text-[#031c0d] font-bold',
    subTextClass: 'text-[#064e3b]',
    tagClass: 'text-[#052e16] bg-[#bbf7d0]/80 border-[#15803d]/40',
    activeChipClass: 'bg-[#4ade80] text-[#031c0d] border-[#15803d] font-bold shadow-xs',
    inactiveChipClass: 'bg-[#dcfce7]/75 text-[#064e3b] border-[#15803d]/40 hover:bg-[#ecfdf5]',
  },
  description: {
    state: 'description',
    dotClass: 'bg-[#291d04] border-2 border-[#422006] ring-2 ring-[#fef9c3]',
    rowClass: 'bg-[#fde047] hover:bg-[#fef08a] text-[#1c1404] font-medium',
    titleTextClass: 'text-[#140e02] font-bold',
    subTextClass: 'text-[#422006]',
    tagClass: 'text-[#3b1d06] bg-[#fef9c3]/80 border-[#a16207]/40',
    activeChipClass: 'bg-[#fde047] text-[#140e02] border-[#a16207] font-bold shadow-xs',
    inactiveChipClass: 'bg-[#fef9c3]/75 text-[#422006] border-[#a16207]/40 hover:bg-[#fefce8]',
  },
  summary: {
    state: 'summary',
    dotClass: 'bg-[#2b1004] border-2 border-[#431407] ring-2 ring-[#ffedd5]',
    rowClass: 'bg-[#fb923c] hover:bg-[#fdba74] text-[#1f0b02] font-medium',
    titleTextClass: 'text-[#170701] font-bold',
    subTextClass: 'text-[#431407]',
    tagClass: 'text-[#431407] bg-[#ffedd5]/80 border-[#c2410c]/40',
    activeChipClass: 'bg-[#fb923c] text-[#170701] border-[#c2410c] font-bold shadow-xs',
    inactiveChipClass: 'bg-[#ffedd5]/75 text-[#431407] border-[#c2410c]/40 hover:bg-[#fff7ed]',
  },
  full: {
    state: 'full',
    dotClass: 'bg-[#2b0608] border-2 border-[#450a0a] ring-2 ring-[#ffe4e6]',
    rowClass: 'bg-[#f87171] hover:bg-[#fca5a5] text-[#1f0505] font-medium',
    titleTextClass: 'text-[#170303] font-bold',
    subTextClass: 'text-[#450a0a]',
    tagClass: 'text-[#450a0a] bg-[#fee2e2]/80 border-[#b91c1c]/40',
    activeChipClass: 'bg-[#f87171] text-[#170303] border-[#b91c1c] font-bold shadow-xs',
    inactiveChipClass: 'bg-[#fee2e2]/75 text-[#450a0a] border-[#b91c1c]/40 hover:bg-[#fef2f2]',
  },
};

export function getAttachmentStatePalette(state: AttachmentVisualState): AttachmentStatePalette {
  return ATTACHMENT_STATE_PALETTE[state];
}

/**
 * Active chip class for any granularity button on a dark surface (Chapter header,
 * Mirror panel, Detail modal): uses the 4 rainbow heat colors with dark text.
 */
export function getGranularityChipClass(target: Granularity, active: boolean): string {
  if (!active) {
    return 'border-[#162234] bg-[#090e18] text-[#758ca8] hover:text-[#c7daf2] hover:border-[#243754]';
  }
  return ATTACHMENT_STATE_PALETTE[target].activeChipClass;
}
