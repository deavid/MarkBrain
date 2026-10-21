import type { AttachmentVisualState } from '../../domains/granularity';
import { ATTACHMENT_STATE_PALETTE } from '../../domains/granularity';

/**
 * Numbers behind the orb and the 5px rail. The rail is the payload itself, in
 * `compiledPrompt` order; every segment's hue comes from the palette in
 * domains/granularity.ts. If a token is not in the payload, it is not in the rail.
 */

export const RAIL_TOKEN_YARDSTICK = 1_000_000;

/** Slate, deliberately outside the four-hue state language. */
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
  /** `min(100, cbrt(totalTokens / 1M) * 100)`, as a percentage of the viewport edge. */

  railHeightPct: number;
  /** Ordered payload segments: system → attachments → chapters. */
  segments: EdgeRailSegment[];
}

export function computeRailHeightPct(totalTokens: number): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
  const factor = Math.min(1, totalTokens / RAIL_TOKEN_YARDSTICK);
  return Math.min(100, Math.cbrt(factor) * 100);
}

/** Rail colour for a state. */

export function railHexFor(state: AttachmentVisualState | 'system'): string {
  return state === 'system' ? SYSTEM_RAIL_HEX : ATTACHMENT_STATE_PALETTE[state].hex;
}

/**
 * Green → yellow → red, measured against the container CEILING (not the rail's
 * 1M yardstick): the orb answers "how full is my budget", the rail answers "how
 * big is this payload against the model's window".
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
