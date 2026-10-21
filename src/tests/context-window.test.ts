/**
 * One window, one curve. The mirror used to report 73,420 / 32,000 (bar pinned
 * red) while the rail measured against 1M — two answers to "how full am I" and
 * both wrong. The ceiling must have one source, and any fill that reports a
 * budget must be cube-rooted or it reads empty until the very end.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_CONTEXT_TOKENS, saturationFillFraction, saturationFillPct } from '../utils/contextWindow';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

describe('the model window has one source', () => {
  it('is the full 1M, not 32k', () => {
    expect(MAX_CONTEXT_TOKENS).toBe(1_000_000);
  });

  it('no source file hardcodes 32000 as a ceiling any more', () => {
    const offenders = walk(join(process.cwd(), 'src'))
      .map((p) => ({ p, text: readFileSync(p, 'utf8') }))
      .filter(({ p, text }) => !p.endsWith('tokenCalculator.ts') && /32000/.test(text));
    expect(offenders.map((o) => o.p)).toEqual([]);
  });
});

describe('the fill curve is cube-rooted, so small payloads still show up', () => {
  it('cbrt of the budget fraction', () => {
    expect(saturationFillPct(1_000)).toBeCloseTo(10, 0);
    expect(saturationFillPct(8_000)).toBeCloseTo(20, 0);
    expect(saturationFillPct(125_000)).toBeCloseTo(50, 0);
    expect(saturationFillPct(1_000_000)).toBe(100);
    // The old linear bar showed this as 7.3%: an invisible sliver.
    expect(saturationFillPct(73_420)).toBeCloseTo(42, 0);
    expect(saturationFillFraction(73_420)).toBeLessThan(1);
  });

  it('clamps nonsense to a sane 0..1', () => {
    expect(saturationFillFraction(-5)).toBe(0);
    expect(saturationFillFraction(5_000_000)).toBe(1);
    expect(saturationFillFraction(Number.NaN)).toBe(0);
  });
});
