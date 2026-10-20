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
  /** Active chip classes — steps UP into its own hue, hue carried by the ink. */
  activeChipClass: string;
  /** Inactive chip classes — shared, neutral, steps DOWN into its host. */
  inactiveChipClass: string;
}

/**
 * THE TWO ALPHA INSTRUMENTS (index.css §veil/recess) — the de-border sweep's
 * second pass, after David's correction of 2026-10-20:
 *
 * "I want to see the difference, I want to see the border, but I don't want an
 *  actual border — either going just up _/= or down =\_, driven with actual
 *  background colour cleverness, or usage of alpha."
 *
 * A row lives INSIDE a host plane (a chapter card, the staged tray). Its plate
 * is therefore an ALPHA tint of its own hue rather than an opaque hex: it
 * composites onto whatever it sits on, so it can never clash with its host.
 * That was the failure in the first sweep — opaque purple chips punched holes
 * in a green card and out-shouted the selection they were supposed to recede
 * from.
 *
 *   the row          hue at 11%  (hover 16%)   a tint, never a bright plate
 *   the active chip  hue at 22% + hue ink + a soft glow   → steps UP
 *   an idle chip     recess-1, totally neutral            → steps DOWN
 *
 * Idle chips are neutral on purpose: six hues at rest would be six colours to
 * read. One hue per row (the one it is actually at) and one lit indicator (the
 * dot). Selection is carried by ink and by light, never by a stroke.
 */
const INACTIVE_CHIP_CLASS =
  'bg-recess-1 hover:bg-recess-2 text-ink-mute hover:text-ink-dim';

/**
 * Six plates. Each in-chat state is a tint of its own hue laid over the host
 * plane, so the same row is correct on the chapter card, in the compacted
 * strip and inside the staged tray. All of them are quieter than the unstaged
 * key, so "not in the chat" still reads as the plainer, lighter surface.
 */
export const ATTACHMENT_STATE_PALETTE: Record<AttachmentVisualState, AttachmentStatePalette> = {
  unstaged: {
    state: 'unstaged',
    hex: '#161b2e',
    glow: 'transparent',
    // L4: no hue to give — a key with its LED off. A dim ring keeps the circle
    // legible without it becoming a filled dot.
    dotClass:
      'bg-[#161b2e] ring-1 ring-[#2f3a55] group-hover:ring-[#4d5c7d]',
    // Not in the chat = the plainest lift off the host plane. No hue at all.
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

/**
 * Chip class for any granularity button on any surface.
 *
 * The colour has to be carried by the INK, not by a hairline: active = the hue
 * as a soft light (22% tint + a glow that is a shadow, not a stroke) with the
 * hue in the label; inactive = the shared NEUTRAL recess, muted label, no
 * outline at all. Idle chips are deliberately colourless so six of them at
 * rest never become six colours to read — and so they can never clash with the
 * hue of the row they are sitting in.
 */
export function getGranularityChipClass(target: Granularity, active: boolean): string {
  return active
    ? ATTACHMENT_STATE_PALETTE[target].activeChipClass
    : ATTACHMENT_STATE_PALETTE.unstaged.inactiveChipClass;
}
