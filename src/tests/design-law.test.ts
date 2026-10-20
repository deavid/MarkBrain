/**
 * THE DESIGN LAW — surfaces separate, borders do not.
 *
 * Before 2026-10-20 the UI carried 107 distinct `border-[#…]` colours across
 * 325 uses and 180 distinct background hexes, 167 of which sat within 1.5%
 * relative luminance of their neighbour (≈1.00:1 — the same colour with a
 * different name). Elevation was unreadable, so a 1px line became the only
 * instrument that worked. The result read as a wireframe: "I don't know how
 * to make colour separate things, so I use borders."
 *
 * These assertions make the replacement enforceable instead of a note in a
 * doc. If someone reaches for another hairline, this fails with a number.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // the test itself quotes the forbidden patterns
      if (entry.name === 'tests') continue;
      walk(p, out);
    } else if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const FILES = walk(SRC).map((p) => ({ path: p.replace(process.cwd(), ''), text: readFileSync(p, 'utf8') }));

/** Every `border-[#rrggbb]` (or any arbitrary hex) in the app. */
function borderHexes(text: string): string[] {
  return [...text.matchAll(/border-\[#[0-9a-fA-F]{3,8}\]/g)].map((m) => m[0]);
}

/** Allowed colour roles for a border. Anything else is decoration. */
const ALLOWED_COLOUR_ROLES = new Set([
  'border-line', // control edge: inputs, the composer, selects
  'border-line-soft', // divider between the two structural panes
  'border-transparent', // tab/rail indicators at rest
  'border-brand', // destructive-alert accent on a control
  'border-accent', // focus + active tab indicator
  'border-none',
]);

/**
 * Width-only utilities are legal — they always come with a colour role from
 * the list above or with `border-transparent`: tab underlines (border-b-2)
 * and the folder indent rail (border-l).
 */
const WIDTH_ONLY = /^border-(?:b|t|l|r|x|y)(?:-\d)?$|^border(?:-\d)?$/;

function illegalBorderTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const m of text.matchAll(/\bborder(?:-[a-z]+)*(?:-\[[^\]]+\])?(?:\/\d+)?\b/g)) {
    const t = m[0];
    if (ALLOWED_COLOUR_ROLES.has(t)) continue;
    if (WIDTH_ONLY.test(t)) continue;
    if (/^border-dashed$|^border-dotted$/.test(t)) continue;
    tokens.push(t);
  }
  return tokens;
}

describe('design law — no hand-rolled border colours', () => {
  it('has ZERO `border-[#…]` anywhere in src (was 107 distinct colours, 325 uses)', () => {
    const offenders = FILES.flatMap((f) => borderHexes(f.text).map((h) => `${f.path}: ${h}`));
    expect(offenders, `hand-rolled border colours came back:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('uses only the six legitimate border roles', () => {
    const offenders = FILES.flatMap((f) =>
      illegalBorderTokens(f.text).map((t) => `${f.path}: ${t}`)
    );
    expect(offenders, `undeclared border utilities:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps the surface ladder perceptible (each step ≥ 1.03:1 over the one below)', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const steps = [...css.matchAll(/--color-surface-(\d):\s*(#[0-9a-f]{6})/gi)].map((m) => m[2]);
    expect(steps.length, 'expected six surface steps').toBe(6);

    const lum = (hex: string) => {
      const h = hex.replace('#', '');
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
      const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    for (let i = 1; i < steps.length; i++) {
      const ratio = contrast(steps[i], steps[i - 1]);
      expect(
        ratio,
        `surface-${i} (${steps[i]}) vs surface-${i - 1} (${steps[i - 1]}) = ${ratio.toFixed(3)}:1 — too close to read as a different plane`
      ).toBeGreaterThan(1.03);
    }
  });

  it('does not drift back into an unbounded background palette', () => {
    const hexes = new Set<string>();
    for (const f of FILES) {
      for (const m of f.text.matchAll(/bg-\[#[0-9a-fA-F]{3,8}\]/g)) hexes.add(m[0].toLowerCase());
    }
    // 180 before the sweep. The remaining ones are deliberate semantic tints
    // (drag targets, alert washes, the attachment hues) — not a second ladder.
    expect(
      hexes.size,
      `distinct bg-[#…] values: ${hexes.size}. Use the surface ladder (bg-surface-0…5) instead.`
    ).toBeLessThanOrEqual(110);
  });
});
