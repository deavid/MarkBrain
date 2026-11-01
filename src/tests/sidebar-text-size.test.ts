/**
 * BUG-014: text size choices are Small / Medium / Large / Largest (never
 * "Default"/"Large"/"Larger" colliding), and the open sidebar width scales
 * +5% / +10% / +15% with the chosen size (350 → 368 → 385 → 403).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getSidebarWidthPx } from '../ui/uiFontScale';
import { UI_FONT_SCALE_CHOICES } from '../ui/workspace/SidebarPreferencesPanel';

describe('text size naming', () => {
  it('labels are Small / Medium / Large / Largest', () => {
    expect(UI_FONT_SCALE_CHOICES.map((c) => c.label)).toEqual([
      'Small',
      'Medium',
      'Large',
      'Largest',
    ]);
  });

  it('no stale "Default" label remains in the preferences panel', () => {
    const src = readFileSync('src/ui/workspace/SidebarPreferencesPanel.tsx', 'utf8');
    expect(src).not.toMatch(/'Default'/);
  });
});

describe('getSidebarWidthPx', () => {
  it('scales the open sidebar 350 → 368 → 385 → 403', () => {
    expect(getSidebarWidthPx(1)).toBe(350);
    expect(getSidebarWidthPx(1.15)).toBe(368);
    expect(getSidebarWidthPx(1.3)).toBe(385);
    expect(getSidebarWidthPx(1.5)).toBe(403);
  });
});

describe('Sidebar applies the scaled width when open', () => {
  it('uses getSidebarWidthPx for the open width', () => {
    const src = readFileSync('src/ui/workspace/Sidebar.tsx', 'utf8');
    expect(src).toContain('getSidebarWidthPx');
    expect(src).not.toContain('md:w-[350px]');
  });
});
