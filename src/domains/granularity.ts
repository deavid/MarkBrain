/**
 * Granularity: the four-level cumulative cut (`title ⊂ description ⊂ summary ⊂ full`).
 * Dependency-free so every domain and UI surface shares one ordering and one palette.
 * Palette math and contrast invariants are locked in `src/tests/attachment-palette.test.ts`.
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
 * Chapter default when a chapter is sealed: full → summary; a manual choice
 * (title/description) is the user's and is never clobbered.
 */
export function sealedGranularity(current: Granularity | undefined): Granularity {
  return current === undefined || current === 'full' ? 'summary' : current;
}

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

export type AttachmentVisualState = 'unstaged' | 'staged' | Granularity;

export interface AttachmentStatePalette {
  state: AttachmentVisualState;
  /** Canonical hex used for the dot, rail segment, and mirror legend. */
  hex: string;
  glow: string;
  dotClass: string;
  /** Alpha tint of `hex` over the host plane — never an opaque fill. */
  rowClass: string;
  titleTextClass: string;
  subTextClass: string;
  tagClass: string;
  activeChipClass: string;
  inactiveChipClass: string;
}

// Rows and chips composite over variable host planes (chapter cards, staged tray),
// so plates use alpha tints of their state hue (11% row, 22% active chip) and idle
// chips use neutral recess-1. Opaque hex plates clash with host cards.
const INACTIVE_CHIP_CLASS =
  'bg-recess-1 hover:bg-recess-2 text-ink-mute hover:text-ink-dim';

export const ATTACHMENT_STATE_PALETTE: Record<AttachmentVisualState, AttachmentStatePalette> = {
  unstaged: {
    state: 'unstaged',
    hex: '#161b2e',
    glow: 'transparent',
    dotClass:
      'bg-[#161b2e] ring-1 ring-[#2f3a55] group-hover:ring-[#4d5c7d]',
    rowClass: 'bg-veil-2 hover:bg-veil-3 text-ink',
    titleTextClass: 'text-[#c9d3ea]',
    subTextClass: 'text-[#93a0c0]',
    tagClass: 'text-ink-dim bg-recess-1',
    activeChipClass: 'bg-veil-3 text-ink font-semibold shadow-[0_1px_8px_-2px_rgba(150,165,215,0.45)]',
    inactiveChipClass: INACTIVE_CHIP_CLASS,
  },
  staged: {
    state: 'staged',
    hex: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.55)',
    dotClass:
      'bg-[#38bdf8] ring-2 ring-[#38bdf8]/35 shadow-[0_0_10px_rgba(56,189,248,0.75)] animate-pulse',
    rowClass: 'bg-[#38bdf8]/11 hover:bg-[#38bdf8]/16 text-ink',
    titleTextClass: 'text-[#d7ddf0] font-semibold',
    subTextClass: 'text-[#9dc6e8]',
    tagClass: 'text-[#7dd3fc] bg-[#38bdf8]/12',
    activeChipClass: 'bg-[#38bdf8]/22 text-[#7dd3fc] font-semibold shadow-[0_1px_8px_-2px_rgba(56,189,248,0.55)]',
    inactiveChipClass: INACTIVE_CHIP_CLASS,
  },
  title: {
    state: 'title',
    hex: '#79ca4b',
    glow: 'rgba(121, 202, 75, 0.5)',
    dotClass:
      'bg-[#79ca4b] ring-2 ring-[#79ca4b]/30 shadow-[0_0_8px_rgba(121,202,75,0.65)]',
    rowClass: 'bg-[#79ca4b]/11 hover:bg-[#79ca4b]/16 text-ink',
    titleTextClass: 'text-[#d7ddf0] font-semibold',
    subTextClass: 'text-[#9aa7c6]',
    tagClass: 'text-ink-dim bg-recess-1',
    activeChipClass: 'bg-[#79ca4b]/22 text-[#a9e07a] font-semibold shadow-[0_1px_8px_-2px_rgba(121,202,75,0.5)]',
    inactiveChipClass: INACTIVE_CHIP_CLASS,
  },
  description: {
    state: 'description',
    hex: '#e2c328',
    glow: 'rgba(226, 195, 40, 0.5)',
    dotClass:
      'bg-[#e2c328] ring-2 ring-[#e2c328]/30 shadow-[0_0_8px_rgba(226,195,40,0.65)]',
    rowClass: 'bg-[#e2c328]/11 hover:bg-[#e2c328]/16 text-ink',
    titleTextClass: 'text-[#d7ddf0] font-semibold',
    subTextClass: 'text-[#9aa7c6]',
    tagClass: 'text-ink-dim bg-recess-1',
    activeChipClass: 'bg-[#e2c328]/22 text-[#f0dd7a] font-semibold shadow-[0_1px_8px_-2px_rgba(226,195,40,0.5)]',
    inactiveChipClass: INACTIVE_CHIP_CLASS,
  },
  summary: {
    state: 'summary',
    hex: '#f99014',
    glow: 'rgba(249, 144, 20, 0.5)',
    dotClass:
      'bg-[#f99014] ring-2 ring-[#f99014]/30 shadow-[0_0_8px_rgba(249,144,20,0.65)]',
    rowClass: 'bg-[#f99014]/11 hover:bg-[#f99014]/16 text-ink',
    titleTextClass: 'text-[#d7ddf0] font-semibold',
    subTextClass: 'text-[#9aa7c6]',
    tagClass: 'text-ink-dim bg-recess-1',
    activeChipClass: 'bg-[#f99014]/22 text-[#ffab5c] font-semibold shadow-[0_1px_8px_-2px_rgba(249,144,20,0.5)]',
    inactiveChipClass: INACTIVE_CHIP_CLASS,
  },
  full: {
    state: 'full',
    hex: '#f45a56',
    glow: 'rgba(244, 90, 86, 0.5)',
    dotClass:
      'bg-[#f45a56] ring-2 ring-[#f45a56]/30 shadow-[0_0_8px_rgba(244,90,86,0.65)]',
    rowClass: 'bg-[#f45a56]/11 hover:bg-[#f45a56]/16 text-ink',
    titleTextClass: 'text-[#d7ddf0] font-semibold',
    subTextClass: 'text-[#9aa7c6]',
    tagClass: 'text-ink-dim bg-recess-1',
    activeChipClass: 'bg-[#f45a56]/22 text-[#ff9a96] font-semibold shadow-[0_1px_8px_-2px_rgba(244,90,86,0.5)]',
    inactiveChipClass: INACTIVE_CHIP_CLASS,
  },
};

export function getAttachmentStatePalette(state: AttachmentVisualState): AttachmentStatePalette {
  return ATTACHMENT_STATE_PALETTE[state];
}

export function getGranularityChipClass(target: Granularity, active: boolean): string {
  return active
    ? ATTACHMENT_STATE_PALETTE[target].activeChipClass
    : ATTACHMENT_STATE_PALETTE.unstaged.inactiveChipClass;
}
