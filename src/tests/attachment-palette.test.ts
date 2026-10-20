/**
 * The colour law + the rail math (design-docs/12_PLAN_OF_RECORD.md §1, §3).
 *
 * Locks what David corrected on 2026-10-20 after the attachment timeline:
 *
 *  · dark plate, bright ink — ALWAYS (no bright row fills, ever again);
 *  · one punchy circle when the artifact is in the chat, dead dark grey when
 *    it is not;
 *  · the four hues step evenly — the shipped palette had a 92° HSL chasm on
 *    the yellow-green side, which is exactly what he saw;
 *  · the 5px rail grows on a cube root of 1M tokens, not to 100% by default;
 *  · one provenance counter (`msg N`), and legacy attachments say 'in chat'.
 */
import { describe, it, expect } from 'vitest';
import {
  ATTACHMENT_STATE_PALETTE,
  GRANULARITY_ORDER,
  getGranularityChipClass,
} from '../domains/granularity';
import { computeRailHeightPct, RAIL_TOKEN_YARDSTICK } from '../ui/context/ambientTelemetry';
import { formatAttachmentProvenance } from '../ui/context/AttachmentControls';
import { resolveRetryAnchorIndex } from '../application/sendQueue';

// ── tiny colour helpers (no deps: these assertions are the point) ──────────

function srgbToLinear(u: number): number {
  return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => srgbToLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** OKLCH hue in degrees (enough precision to measure a step). */
function oklchHue(hex: string): number {
  const [r0, g0, b0] = hexToRgb(hex).map((v) => srgbToLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r0 + 0.5363325363 * g0 + 0.0514459929 * b0);
  const m = Math.cbrt(0.2119034982 * r0 + 0.6806995451 * g0 + 0.1073969566 * b0);
  const s = Math.cbrt(0.0883024619 * r0 + 0.2817188376 * g0 + 0.6299787005 * b0);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  void L;
  return ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
}

/** Every hex used as a BACKGROUND (Tailwind `bg-[#rrggbb]`), not as ink. */
function bgHexes(classes: string): string[] {
  return [...classes.matchAll(/bg-\[#([0-9a-f]{6})\]/gi)].map((m) => `#${m[1]}`);
}

/** Every hex literal inside a Tailwind arbitrary-value class string. */
function hexesIn(classes: string): string[] {
  return [...classes.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => `#${m[1]}`);
}

const STATES = [
  'unstaged',
  'staged',
  'title',
  'description',
  'summary',
  'full',
] as const;

describe('colour law (12 §1) — dark plate, bright ink, one lit circle', () => {
  it('has exactly six states, each with a canonical hex and a glow channel', () => {
    for (const state of STATES) {
      const p = ATTACHMENT_STATE_PALETTE[state];
      expect(p, `missing palette for ${state}`).toBeDefined();
      expect(p.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof p.glow).toBe('string');
      expect(p.rowClass.length).toBeGreaterThan(0);
      expect(p.dotClass.length).toBeGreaterThan(0);
    }
    // Six distinguishable dots — grey, cyan, then the four hues.
    const hexes = new Set(STATES.map((s) => ATTACHMENT_STATE_PALETTE[s].hex));
    expect(hexes.size).toBe(6);
  });

  it('every row plate is DARK — a bright background can never come back', () => {
    for (const state of STATES) {
      const fills = bgHexes(ATTACHMENT_STATE_PALETTE[state].rowClass);
      expect(fills.length, `${state} row needs a background hex`).toBeGreaterThan(0);
      for (const hex of fills) {
        // Dark plate: relative luminance under 0.10 (the brightest allowed is
        // the unstaged slate #131c2e ≈ 0.011 — plenty of headroom).
        expect(
          luminance(hex),
          `${state} row fill ${hex} is too bright (luminance ${luminance(hex).toFixed(3)})`
        ).toBeLessThan(0.1);
      }
      // And the ink is bright against it, never dark-on-bright.
      const inks = hexesIn(ATTACHMENT_STATE_PALETTE[state].titleTextClass);
      expect(inks.length, `${state} needs a title text colour`).toBeGreaterThan(0);
      expect(luminance(inks[0]), `${state} title ink is too dim`).toBeGreaterThan(0.4);
    }
  });

  it('unstaged sits a touch BRIGHTER than in-chat rows, with a dead grey circle', () => {
    const unstagedRow = hexesIn(ATTACHMENT_STATE_PALETTE.unstaged.rowClass)[0];
    const inChatRow = hexesIn(ATTACHMENT_STATE_PALETTE.title.rowClass)[0];
    expect(luminance(unstagedRow)).toBeGreaterThan(luminance(inChatRow));

    // The circle: near-black when it is NOT in the chat…
    const deadDot = hexesIn(ATTACHMENT_STATE_PALETTE.unstaged.dotClass)[0];
    expect(luminance(deadDot), 'unstaged dot must read as off').toBeLessThan(0.03);
    // …punchy when it IS: every in-chat circle sits far above its dark plate.
    for (const state of ['staged', 'title', 'description', 'summary', 'full'] as const) {
      const dot = hexesIn(ATTACHMENT_STATE_PALETTE[state].dotClass)[0];
      const plate = hexesIn(ATTACHMENT_STATE_PALETTE[state].rowClass)[0];
      expect(
        luminance(dot),
        `${state} dot (${dot}) does not glow against its plate (${plate})`
      ).toBeGreaterThan(luminance(plate) * 5 + 0.15);
      expect(luminance(dot), `${state} dot is not punchy enough`).toBeGreaterThan(0.22);
    }
  });

  it('the four hues step evenly in OKLCH (the old palette chasmed by 92° in HSL)', () => {
    // cheap → expensive: green → yellow → orange → red
    const hues = [...GRANULARITY_ORDER].map((g) => oklchHue(ATTACHMENT_STATE_PALETTE[g].hex));
    const steps = hues.slice(1).map((h, i) => Math.abs(h - hues[i]));
    for (const step of steps) {
      expect(step, `hue step ${step.toFixed(1)}° is uneven (steps were ${steps.map((s) => s.toFixed(1))})`).toBeGreaterThan(30);
      expect(step).toBeLessThan(45);
    }
    // Direction: Title is green (cheap/better), Full is red (heavy/worse).
    expect(ATTACHMENT_STATE_PALETTE.title.hex).toBe('#79ca4b');
    expect(ATTACHMENT_STATE_PALETTE.description.hex).toBe('#e2c328');
    expect(ATTACHMENT_STATE_PALETTE.summary.hex).toBe('#f99014');
    expect(ATTACHMENT_STATE_PALETTE.full.hex).toBe('#f45a56');
  });

  it('an inactive chip is brighter than the active well it contrasts with', () => {
    const inactive = hexesIn(
      getGranularityChipClass('full', false)
    )[0];
    const activeWell = hexesIn(getGranularityChipClass('full', true))[0];
    expect(luminance(inactive)).toBeGreaterThan(luminance(activeWell));
    // Active chip carries a crisp hue border so selection is never colour-only.
    expect(getGranularityChipClass('full', true)).toContain('#f45a56');
    expect(getGranularityChipClass('title', true)).toContain('#79ca4b');
  });
});

describe('rail height (12 §3) — cbrt of 1M tokens, capped at 100%', () => {
  it('is zero for an empty payload', () => {
    expect(computeRailHeightPct(0)).toBe(0);
    expect(computeRailHeightPct(-5)).toBe(0);
    expect(computeRailHeightPct(NaN)).toBe(0);
  });

  it('lands David’s example: 100k → cbrt(0.1) ≈ 46.4%', () => {
    expect(computeRailHeightPct(100_000)).toBeCloseTo(Math.cbrt(0.1) * 100, 4);
    expect(computeRailHeightPct(100_000)).toBeCloseTo(46.4159, 3);
  });

  it('is 20% at 8k and 100% at the 1M yardstick — and stays there', () => {
    expect(computeRailHeightPct(8_000)).toBeCloseTo(20, 3);
    expect(computeRailHeightPct(RAIL_TOKEN_YARDSTICK)).toBeCloseTo(100, 6);
    expect(computeRailHeightPct(5_000_000)).toBe(100);
  });

  it('is strictly increasing below the yardstick (the rail actually responds)', () => {
    const samples = [1_000, 5_000, 50_000, 250_000, 900_000].map(computeRailHeightPct);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });
});

describe('provenance (12 §2.2) — one counter, honest about legacy', () => {
  it('counts messages 1-based, like the chapter headers', () => {
    expect(formatAttachmentProvenance(0)?.badge).toBe('msg 1');
    expect(formatAttachmentProvenance(3)?.badge).toBe('msg 4');
  });
  it('says nothing for staged (null) — the tray already says "next send"', () => {
    expect(formatAttachmentProvenance(null)).toBeUndefined();
  });
  it('legacy (-1) claims "in chat", never a turn it does not have', () => {
    expect(formatAttachmentProvenance(-1)?.badge).toBe('in chat');
  });
});

describe('retry anchor (12 §5.1) — staged attachments weld to the user turn', () => {
  const thread = [
    { id: 'u1', role: 'user' },
    { id: 'a1', role: 'assistant' },
    { id: 'u2', role: 'user' },
    { id: 'a2', role: 'assistant' },
  ];
  it('anchors on the user turn the retry answers', () => {
    expect(resolveRetryAnchorIndex(thread, 'a1')).toBe(0);
    expect(resolveRetryAnchorIndex(thread, 'a2')).toBe(2);
  });
  it('falls back sensibly when the turn is unknown', () => {
    expect(resolveRetryAnchorIndex(thread, 'missing')).toBe(3);
    expect(resolveRetryAnchorIndex([], 'missing')).toBe(0);
  });
  it('never anchors AFTER the assistant turn being retried', () => {
    for (const id of ['a1', 'a2']) {
      const idx = resolveRetryAnchorIndex(thread, id);
      const retryIdx = thread.findIndex((t) => t.id === id);
      expect(idx).toBeLessThan(retryIdx);
    }
  });
});
