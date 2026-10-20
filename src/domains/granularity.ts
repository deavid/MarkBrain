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
 * THE COLOUR LAW (design-docs/12_PLAN_OF_RECORD.md §1) — read before touching
 * anything coloured in this app:
 *
 *   L0  Colour is a stroke and a light, never a field.
 *   L1  One filled thing per row: the dot.
 *   L2  Dark plate, bright ink — always, for every state.
 *   L3  Unselected sits on a slightly brighter key; selected presses into the
 *       dark well and ignites its indicator.
 *   L4  Hue belongs to state. Four hues only (green→yellow→orange→red, even
 *       OKLCH steps), plus one animated cyan for 'staged' and grey for none.
 *
 * The six visual states for an artifact in a chat
 * (design-docs/10_ATTACHMENT_TIMELINE.md §1, corrected by 12 §0.1–§0.2):
 * - 'unstaged': not in this chat — brighter dark-slate row, DARK GREY circle
 * - 'staged': armed for the next turn — deep dark row, punchy glowing cyan
 * - 'title': committed at Title — cheapest — deep dark row, leaf-green circle
 * - 'description': committed at Description — deep dark row, signal-yellow circle
 * - 'summary': committed at Summary — deep dark row, amber-orange circle
 * - 'full': committed at Full — heaviest — deep dark row, crimson-coral circle
 *
 * Palette maths (12 §0.1): the four hues sit at OKLCH 25°/61°/97°/136° — steps
 * of +36°/+36°/+39°, OKLab step distances 0.137/0.124/0.130 (ratio 1.10). The
 * shipped palette had a 92° HSL chasm on the yellow-green side because the old
 * green was a blue-shifted mint; this one is warm leaf green, so it also stops
 * colliding with the staged cyan.
 */
export type AttachmentVisualState = 'unstaged' | 'staged' | Granularity;

export interface AttachmentStatePalette {
  state: AttachmentVisualState;
  /** Canonical hex for the dot, the rail segment and the mirror legend. */
  hex: string;
  /** Box-shadow glow colour for the punchy lit circle (transparent when off). */
  glow: string;
  /** Solid circle dot classes */
  dotClass: string;
  /** Row / card container classes — ALWAYS a dark plate with bright ink. */
  rowClass: string;
  /** Primary title text class inside the row/card */
  titleTextClass: string;
  /** Secondary description/meta text class inside the row/card */
  subTextClass: string;
  /** Tag / muted badge class inside the row/card */
  tagClass: string;
  /** Active chip classes when this granularity is selected (pressed dark well) */
  activeChipClass: string;
  /** Inactive chip classes — shared, slightly brighter than the active well. */
  inactiveChipClass: string;
}

/** L3: the unselected key. One class, every state, so 'not selected' reads the same. */
const INACTIVE_CHIP_CLASS =
  'bg-[#152033] hover:bg-[#1b2940] text-[#9fb2ce] hover:text-[#e3edf7] border-[#24344f]';

/** The in-chat deep well: selected rows press DOWN into this. */
const ROW_WELL = 'bg-[#090f1a] hover:bg-[#0d1524] text-[#eef4fc]';

export const ATTACHMENT_STATE_PALETTE: Record<AttachmentVisualState, AttachmentStatePalette> = {
  unstaged: {
    state: 'unstaged',
    hex: '#18202c',
    glow: 'transparent',
    // L4: no hue to give — an unpressed key with its LED off.
    dotClass:
      'bg-[#18202c] border border-[#33435c] group-hover:border-[#556985]',
    rowClass: 'bg-[#131c2e] hover:bg-[#18243a] border border-[#1f2d46] text-[#d6e3f5]',
    titleTextClass: 'text-[#d6e3f5]',
    subTextClass: 'text-[#8499b8]',
    tagClass: 'text-[#8499b8] bg-[#0c1322] border-[#1f2d46]',
    activeChipClass: 'bg-[#0d1422] text-[#e3edf7] border-[#33435c]',
    inactiveChipClass: INACTIVE_CHIP_CLASS,
  },
  staged: {
    state: 'staged',
    hex: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.55)',
    dotClass:
      'bg-[#38bdf8] ring-2 ring-[#38bdf8]/35 shadow-[0_0_10px_rgba(56,189,248,0.75)] animate-pulse',
    rowClass: 'bg-[#081320] hover:bg-[#0c1a2b] border border-[#38bdf8]/45 text-[#eef6ff]',
    titleTextClass: 'text-[#f0f9ff] font-semibold',
    subTextClass: 'text-[#93c5fd]',
    tagClass: 'text-[#7dd3fc] bg-[#0c2236] border-[#38bdf8]/40',
    activeChipClass:
      'bg-[#092232] text-[#ecfeff] border-[#38bdf8] font-semibold shadow-[0_0_8px_rgba(56,189,248,0.25)]',
    inactiveChipClass: INACTIVE_CHIP_CLASS,
  },
  title: {
    state: 'title',
    hex: '#79ca4b',
    glow: 'rgba(121, 202, 75, 0.5)',
    dotClass:
      'bg-[#79ca4b] ring-2 ring-[#79ca4b]/30 shadow-[0_0_8px_rgba(121,202,75,0.65)]',
    rowClass: `${ROW_WELL} border border-[#79ca4b]/35`,
    titleTextClass: 'text-[#eef4fc] font-semibold',
    subTextClass: 'text-[#94a8c6]',
    tagClass: 'text-[#b8cae4] bg-[#101929] border-[#22324d]',
    activeChipClass:
      'bg-[#0c1f17] text-[#eefcf3] border-[#79ca4b] font-semibold shadow-[0_0_8px_rgba(121,202,75,0.25)]',
    inactiveChipClass: INACTIVE_CHIP_CLASS,
  },
  description: {
    state: 'description',
    hex: '#e2c328',
    glow: 'rgba(226, 195, 40, 0.5)',
    dotClass:
      'bg-[#e2c328] ring-2 ring-[#e2c328]/30 shadow-[0_0_8px_rgba(226,195,40,0.65)]',
    rowClass: `${ROW_WELL} border border-[#e2c328]/35`,
    titleTextClass: 'text-[#eef4fc] font-semibold',
    subTextClass: 'text-[#94a8c6]',
    tagClass: 'text-[#b8cae4] bg-[#101929] border-[#22324d]',
    activeChipClass:
      'bg-[#1f1c0b] text-[#fefce8] border-[#e2c328] font-semibold shadow-[0_0_8px_rgba(226,195,40,0.25)]',
    inactiveChipClass: INACTIVE_CHIP_CLASS,
  },
  summary: {
    state: 'summary',
    hex: '#f99014',
    glow: 'rgba(249, 144, 20, 0.5)',
    dotClass:
      'bg-[#f99014] ring-2 ring-[#f99014]/30 shadow-[0_0_8px_rgba(249,144,20,0.65)]',
    rowClass: `${ROW_WELL} border border-[#f99014]/35`,
    titleTextClass: 'text-[#eef4fc] font-semibold',
    subTextClass: 'text-[#94a8c6]',
    tagClass: 'text-[#b8cae4] bg-[#101929] border-[#22324d]',
    activeChipClass:
      'bg-[#221408] text-[#fff7ed] border-[#f99014] font-semibold shadow-[0_0_8px_rgba(249,144,20,0.25)]',
    inactiveChipClass: INACTIVE_CHIP_CLASS,
  },
  full: {
    state: 'full',
    hex: '#f45a56',
    glow: 'rgba(244, 90, 86, 0.5)',
    dotClass:
      'bg-[#f45a56] ring-2 ring-[#f45a56]/30 shadow-[0_0_8px_rgba(244,90,86,0.65)]',
    rowClass: `${ROW_WELL} border border-[#f45a56]/35`,
    titleTextClass: 'text-[#eef4fc] font-semibold',
    subTextClass: 'text-[#94a8c6]',
    tagClass: 'text-[#b8cae4] bg-[#101929] border-[#22324d]',
    activeChipClass:
      'bg-[#240e10] text-[#fef2f2] border-[#f45a56] font-semibold shadow-[0_0_8px_rgba(244,90,86,0.25)]',
    inactiveChipClass: INACTIVE_CHIP_CLASS,
  },
};

export function getAttachmentStatePalette(state: AttachmentVisualState): AttachmentStatePalette {
  return ATTACHMENT_STATE_PALETTE[state];
}

/**
 * Chip class for any granularity button on any surface: active = pressed dark
 * well in the hue's own tint with a crisp border; inactive = the shared
 * brighter slate key. Never a bright fill, never dark text on light.
 */
export function getGranularityChipClass(target: Granularity, active: boolean): string {
  return active
    ? ATTACHMENT_STATE_PALETTE[target].activeChipClass
    : ATTACHMENT_STATE_PALETTE.unstaged.inactiveChipClass;
}
