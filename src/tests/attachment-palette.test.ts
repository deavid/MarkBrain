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
import { readFileSync } from 'node:fs';
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

/** The surface plane a row/plate is composited onto (index.css surface-1). */
const HOST = '#121526';

/** Alpha-tint composite `color at α over host`, in sRGB — what the eye gets. */
function over(hex: string, alpha: number, host: string = HOST): string {
  const f = hexToRgb(hex);
  const b = hexToRgb(host);
  return (
    '#' +
    f
      .map((c, i) => Math.round(alpha * c + (1 - alpha) * b[i]).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** `bg-[#rrggbb]/NN` → { hex, alpha }. The veil/recess instrument of index.css. */
function tint(classes: string): { hex: string; alpha: number } | undefined {
  const m = classes.match(/bg-\[#([0-9a-f]{6})\]\/(\d+)/i);
  return m ? { hex: `#${m[1]}`, alpha: Number(m[2]) / 100 } : undefined;
}

/** `bg-veil-N` → the alpha declared in index.css (0 when absent). */
function veilAlpha(classes: string): number {
  const m = classes.match(/bg-veil-(\d)/);
  if (!m) return 0;
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  const decl = css.match(new RegExp(`--color-veil-${m[1]}:\\s*rgb\\([^)]*\\/\\s*([\\d.]+)\\s*\\)`));
  return decl ? Number(decl[1]) : 0;
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

  it('every row plate is a TINT of its own hue, laid over the host plane', () => {
    // The de-border sweep's second pass (index.css §veil/recess): a row lives
    // INSIDE a host plane, so its plate is alpha, never an opaque hex. That is
    // what stops the purple-chip-in-a-green-card clash the first pass shipped.
    for (const state of ['staged', 'title', 'description', 'summary', 'full'] as const) {
      const row = ATTACHMENT_STATE_PALETTE[state].rowClass;
      const t = tint(row);
      expect(t, `${state} row must tint its hue with alpha, not fill it`).toBeDefined();
      expect(t!.hex.toLowerCase()).toBe(ATTACHMENT_STATE_PALETTE[state].hex.toLowerCase());
      expect(t!.alpha, `${state} tint ${t!.alpha} is too strong to be a tint`).toBeLessThanOrEqual(0.2);
      expect(t!.alpha, `${state} tint ${t!.alpha} is too weak to read`).toBeGreaterThanOrEqual(0.08);
      // …and the composite it produces is still a DARK plate: a bright row
      // background can never come back, on any host from surface-0 up.
      for (const host of ['#0a0e1b', HOST, '#181c31']) {
        const composited = over(t!.hex, t!.alpha, host);
        expect(
          luminance(composited),
          `${state} row over ${host} → ${composited} is too bright (${luminance(composited).toFixed(3)})`
        ).toBeLessThan(0.1);
      }
      // And the ink is bright against it, never dark-on-bright.
      const inks = hexesIn(ATTACHMENT_STATE_PALETTE[state].titleTextClass);
      expect(inks.length, `${state} needs a title text colour`).toBeGreaterThan(0);
      expect(luminance(inks[0]), `${state} title ink is too dim`).toBeGreaterThan(0.4);
    }

    // 'Not in the chat' gives nothing away: no hue at all, just the plainer lift.
    expect(
      /#[0-9a-f]{6}/i.test(ATTACHMENT_STATE_PALETTE.unstaged.rowClass),
      'the unstaged row must stay neutral'
    ).toBe(false);
    expect(ATTACHMENT_STATE_PALETTE.unstaged.rowClass).toContain('bg-veil-');
  });

  it('unstaged sits a touch BRIGHTER than in-chat rows, with a dead grey circle', () => {
    // L3: the unselected key is the brighter key. In the alpha system that is
    // a numeric claim — the neutral veil must out-alpha every hue tint.
    const unstaged = veilAlpha(ATTACHMENT_STATE_PALETTE.unstaged.rowClass);
    expect(unstaged, 'bg-veil-2 must declare an alpha').toBeGreaterThan(0);
    for (const state of ['staged', 'title', 'description', 'summary', 'full'] as const) {
      expect(
        unstaged,
        `${state} hue tint is not quieter than the unstaged key`
      ).toBeGreaterThan(tint(ATTACHMENT_STATE_PALETTE[state].rowClass)!.alpha);
    }

    // The circle: near-black when it is NOT in the chat…
    const deadDot = hexesIn(ATTACHMENT_STATE_PALETTE.unstaged.dotClass)[0];
    expect(luminance(deadDot), 'unstaged dot must read as off').toBeLessThan(0.03);
    // …punchy when it IS: every in-chat circle sits far above the plate it
    // actually sits on (hue tint composited over the host).
    for (const state of ['staged', 'title', 'description', 'summary', 'full'] as const) {
      const dot = hexesIn(ATTACHMENT_STATE_PALETTE[state].dotClass)[0];
      const t = tint(ATTACHMENT_STATE_PALETTE[state].rowClass)!;
      const plate = over(t.hex, t.alpha);
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

  it('an idle chip is NEUTRAL; the active chip carries its hue as light', () => {
    // David, 2026-10-20: opaque idle chips clashed with the hue of the row they
    // sat in, AND out-shouted the selection. So: idle is colourless and sinks;
    // active is the only coloured chip on the row, and it glows.
    const idle = getGranularityChipClass('full', false);
    expect(hexesIn(idle), 'an idle chip must not carry a colour').toEqual([]);
    expect(idle, 'an idle chip steps DOWN into its host').toContain('bg-recess-1');
    expect(idle, 'never a stroke — a shadow at most').not.toContain('ring-');

    for (const g of GRANULARITY_ORDER) {
      const active = getGranularityChipClass(g, true);
      const hue = ATTACHMENT_STATE_PALETTE[g].hex;
      expect(active, `${g} active chip lost its hue`).toContain(hue);
      const t = tint(active);
      expect(t, `${g} active chip must be a tint of the hue`).toBeDefined();
      expect(t!.alpha, `${g} active chip does not light up against its row`).toBeGreaterThan(0.2);
      // The label is the hue itself, bright enough to be read on the tint.
      const inks = hexesIn(active).filter((h) => h.toLowerCase() !== hue.toLowerCase());
      expect(inks.length, `${g} active chip needs a hue-coloured label`).toBeGreaterThan(0);
      expect(luminance(inks[0]), `${g} active label is too dim`).toBeGreaterThan(0.4);
      // …and the glow is a shadow, never a 1px stroke.
      expect(active).toContain('shadow-[0_');
      expect(active, `${g} active chip must not draw a border`).not.toContain('border');
    }
  });

  it('a veil / a recess always produces a real step, on ANY host in the ladder', () => {
    // The whole point of the alpha instrument: a chip, a bubble or a well is
    // correct on every host, so it can never clash with the plane it lands in.
    // "Correct" is a measured claim — the step must be at least as big as a
    // ladder step (ΔL* ≥ 3) wherever it is applied.
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    const ladder = [...css.matchAll(/--color-surface-(\d):\s*(#[0-9a-f]{6})/gi)].map((m) => m[2]);
    const hosts = ladder.slice(0, 4); // s0…s3 — nothing is ever nested deeper

    const lstar = (hex: string) => {
      const y = luminance(hex);
      return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
    };
    const channel = (name: string) => {
      const d = css.match(new RegExp(`--color-${name}:\\s*rgb\\(([^)]*)\\)`))![1];
      const [r, g, b, a] = d.split(/[\s/]+/).filter(Boolean).map(Number);
      return { hex: `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`, a };
    };

    for (const host of hosts) {
      const up = channel('veil-2');
      const lift = lstar(over(up.hex, up.a, host)) - lstar(host);
      expect(lift, `veil-2 lifts ${host} by only ΔL* ${lift.toFixed(1)}`).toBeGreaterThan(3);
      expect(lift, `veil-2 lifts ${host} by ΔL* ${lift.toFixed(1)} — too much to be a step`).toBeLessThan(10);
      // veil-1 is the same step as one ladder rung.
      const up1 = channel('veil-1');
      const lift1 = lstar(over(up1.hex, up1.a, host)) - lstar(host);
      expect(lift1, `veil-1 lifts ${host} by only ΔL* ${lift1.toFixed(1)}`).toBeGreaterThan(3);
      expect(lift1, `veil-1 lifts ${host} by ΔL* ${lift1.toFixed(1)} — that is not one step`).toBeLessThan(6);
    }

    // A recess inside a card (s1 / s2) must sink by at least a full step.
    const down = channel('recess-1');
    for (const host of [ladder[1], ladder[2]]) {
      const drop = lstar(host) - lstar(over(down.hex, down.a, host));
      expect(drop, `recess-1 sinks ${host} by only ΔL* ${drop.toFixed(1)}`).toBeGreaterThan(3);
    }
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
