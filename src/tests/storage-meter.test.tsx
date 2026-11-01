/**
 * Sidebar storage meter (design-docs/31 §4.2, David 2026-11-01):
 * a small, quiet readout at the bottom of the sidebar showing how much device
 * storage the workspace uses against a SAFE budget — the smaller of 100 MiB of
 * workspace data or half the browser's reported quota. It stays muted below
 * 50%, turns amber at 50%, and gets loud at 80% — the early-warning trigger
 * for the (future, parked) working-set archiver. No storage API → renders
 * nothing (private mode / SSR must not crash or show fake numbers).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import {
  SAFE_WORKING_SET_BYTES,
  computeStorageMeter,
  formatBytes,
} from '../ui/workspace/storageMeter';
import { StorageMeterRow } from '../ui/workspace/StorageMeterRow';

const MIB = 1024 * 1024;

describe('computeStorageMeter — the safe budget', () => {
  it('100 MiB of workspace data is the default budget when no quota is known', () => {
    const m = computeStorageMeter(14 * MIB, null)!;
    expect(SAFE_WORKING_SET_BYTES).toBe(100 * MIB);
    expect(m.budgetBytes).toBe(100 * MIB);
  });

  it('never claims more than HALF the browser quota', () => {
    // Browser quota can read ~60% of a 1TB disk — useless as a ceiling on its
    // own. Half of a small quota (100 MiB → 50 MiB) must win over 100 MiB.
    const m = computeStorageMeter(40 * MIB, 100 * MIB)!;
    expect(m.budgetBytes).toBe(50 * MIB);
  });

  it('half the quota wins when the browser is stricter than our 100 MiB', () => {
    const m = computeStorageMeter(20 * MIB, 120 * MIB)!;
    expect(m.budgetBytes).toBe(60 * MIB);
  });
});

describe('computeStorageMeter — percent + loudness levels', () => {
  it('stays quiet below 50%', () => {
    expect(computeStorageMeter(14 * MIB, null)!.level).toBe('quiet');
    expect(computeStorageMeter(49 * MIB, null)!.level).toBe('quiet');
  });

  it('turns amber at 50% and below 80%', () => {
    expect(computeStorageMeter(50 * MIB, null)!.level).toBe('amber');
    expect(computeStorageMeter(79 * MIB, null)!.level).toBe('amber');
  });

  it('gets loud at 80% and never over 100', () => {
    expect(computeStorageMeter(80 * MIB, null)!.level).toBe('loud');
    expect(computeStorageMeter(120 * MIB, null)!.pct).toBe(100);
    expect(computeStorageMeter(120 * MIB, null)!.level).toBe('loud');
  });

  it('usage past the budget reads against the budget, not the quota', () => {
    // 40 MiB used of a 50 MiB budget (quota 100 MiB) → 80% → loud.
    const m = computeStorageMeter(40 * MIB, 100 * MIB)!;
    expect(m.pct).toBe(80);
    expect(m.level).toBe('loud');
  });

  it('no usable estimate → null (renders nothing, invents no numbers)', () => {
    expect(computeStorageMeter(null, null)).toBeNull();
    expect(computeStorageMeter(undefined, 500 * MIB)).toBeNull();
    expect(computeStorageMeter(-5, null)).toBeNull();
    expect(computeStorageMeter(Number.NaN, null)).toBeNull();
  });
});

describe('formatBytes — small honest readout', () => {
  it('formats KB / MB / GB with one decimal', () => {
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(14 * MIB + 0.2 * MIB)).toBe('14.2 MB');
    expect(formatBytes(1.5 * 1024 * MIB)).toBe('1.5 GB');
  });

  it('round MB readouts lose the decimal', () => {
    expect(formatBytes(14 * MIB)).toBe('14 MB');
  });
});

describe('StorageMeterRow — what the sidebar shows', () => {
  it('quiet: muted readout with the percent visible', () => {
    const html = renderToStaticMarkup(
      React.createElement(StorageMeterRow, {
        meter: computeStorageMeter(14 * MIB, null)!,
      })
    );
    expect(html).toContain('data-testid="storage-meter"');
    expect(html).toContain('14%');
    expect(html).toContain('data-level="quiet"');
  });

  it('amber: the readout turns louder at 50%', () => {
    const html = renderToStaticMarkup(
      React.createElement(StorageMeterRow, {
        meter: computeStorageMeter(55 * MIB, null)!,
      })
    );
    expect(html).toContain('data-level="amber"');
  });

  it('loud: unmistakable at 80%', () => {
    const html = renderToStaticMarkup(
      React.createElement(StorageMeterRow, {
        meter: computeStorageMeter(85 * MIB, null)!,
      })
    );
    expect(html).toContain('data-level="loud"');
  });

  it('no data → renders nothing at all', () => {
    const html = renderToStaticMarkup(
      React.createElement(StorageMeterRow, { meter: null })
    );
    expect(html).toBe('');
  });
});

describe('Sidebar wiring', () => {
  it('the sidebar mounts the storage meter row', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const src = readFileSync('src/ui/workspace/Sidebar.tsx', 'utf8');
    expect(src).toContain('StorageMeterRow');
  });
});
