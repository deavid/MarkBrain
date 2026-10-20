import type { AttachmentVisualState } from '../../domains/granularity';
import { ATTACHMENT_STATE_PALETTE } from '../../domains/granularity';

/**
 * Ambient telemetry for the two peripheral readouts (SaturationOrb + the 5px
 * Edge Rail). design-docs/12_PLAN_OF_RECORD.md §3.
 *
 * The rail is the payload, read top to bottom — same order as
 * `compiledPrompt` and the Mirror: system → attachments (substrate order) →
 * chapters (chronological). Each segment wears the hue of what it is, from the
 * one palette in domains/granularity.ts. No invented categories, no 70/30
 * splits of `historyTokens`.
 */

export const RAIL_TOKEN_YARDSTICK = 1_000_000;

/** Neutral slate for the system block — deliberately outside the 4-hue language. */
export const SYSTEM_RAIL_HEX = '#475872';

export interface EdgeRailSegment {
  id: string;
  kind: 'system' | 'attachment' | 'chapter';
  label: string;
  tokens: number;
  /** 'system' is neutral; every other segment carries its attachment/chapter state. */
  state: AttachmentVisualState | 'system';
  hex: string;
}

export interface AmbientTelemetryData {
  totalTokens: number;
  ceiling: number;
  saturationRatio: number;
  /**
   * Filled height of the 5px rail, as a percentage of the viewport edge:
   * `min(100, cbrt(totalTokens / 1_000_000) * 100)`.
   * 100k tokens → 46.4% ; 8k → 20% ; 1M → 100% (and stays there).
   */
  railHeightPct: number;
  /** Ordered payload segments: system → attachments → chapters. */
  segments: EdgeRailSegment[];
}

/**
 * David's cube-root law (R1.5): the rail must not sit at 100% all the time.
 * `cbrt(factor over 1M)` turns a linear yardstick into one you can actually
 * read at a glance — 100k is a little under half, 8k is a fifth.
 */
export function computeRailHeightPct(totalTokens: number): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
  const factor = Math.min(1, totalTokens / RAIL_TOKEN_YARDSTICK);
  return Math.min(100, Math.cbrt(factor) * 100);
}

/** Rail colour for a state — one palette, one truth (12 §3.2). */
export function railHexFor(state: AttachmentVisualState | 'system'): string {
  return state === 'system' ? SYSTEM_RAIL_HEX : ATTACHMENT_STATE_PALETTE[state].hex;
}

/**
 * Saturation ring colour. Kept as three steps of the SAME language as the rail:
 * green (comfortable) → yellow (warm) → red (hot). Thresholds are against the
 * container ceiling, which is a different yardstick from the rail's 1M — that
 * is on purpose: the orb answers "how full is MY budget", the rail answers
 * "how big is this payload against the model's window".
 */
export function computeAmbientColor(ratio: number): { hex: string; glow: string; textClass: string } {
  if (ratio > 0.85) {
    const hex = ATTACHMENT_STATE_PALETTE.full.hex;
    return { hex, glow: 'rgba(244, 90, 86, 0.4)', textClass: 'text-[#f45a56]' };
  }
  if (ratio > 0.5) {
    const hex = ATTACHMENT_STATE_PALETTE.description.hex;
    return { hex, glow: 'rgba(226, 195, 40, 0.4)', textClass: 'text-[#e2c328]' };
  }
  const hex = ATTACHMENT_STATE_PALETTE.title.hex;
  return { hex, glow: 'rgba(121, 202, 75, 0.4)', textClass: 'text-[#79ca4b]' };
}
