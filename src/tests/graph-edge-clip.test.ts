/**
 * BUG-004: edges are drawn card-border to card-border (not center-to-center)
 * so lines and labels never disappear behind a node card.
 */
import { describe, it, expect } from 'vitest';
import { clipEdgeToNodeRects, MIN_LINKED_CENTER_DISTANCE } from '../ui/graph/SpatialGraph';

const rect = (x: number, y: number, width = 220, height = 68) => ({ x, y, width, height });

describe('clipEdgeToNodeRects', () => {
  it('clips both ends to the card borders on a horizontal axis', () => {
    const r = clipEdgeToNodeRects(rect(0, 0), rect(400, 0));
    // Source card right edge (220 + 4 margin) — not the center (110).
    expect(r.sx).toBeCloseTo(224);
    expect(r.sy).toBeCloseTo(34);
    // Target card left edge (400 - 4 margin).
    expect(r.tx).toBeCloseTo(396);
    expect(r.ty).toBeCloseTo(34);
  });

  it('midpoint sits in the open gap between the two cards', () => {
    const r = clipEdgeToNodeRects(rect(0, 0), rect(400, 0));
    expect(r.midX).toBeCloseTo((224 + 396) / 2);
    expect(r.midY).toBeCloseTo(34);
    // The gap between borders is where the label lives — inside neither card.
    expect(r.midX).toBeGreaterThan(224);
    expect(r.midX).toBeLessThan(396);
  });

  it('clips on a diagonal direction, exiting through the correct faces', () => {
    const r = clipEdgeToNodeRects(rect(0, 0), rect(300, 300));
    const inside = (p: { x: number; y: number }, rect: { x: number; y: number }) =>
      p.x > rect.x && p.x < rect.x + 220 && p.y > rect.y && p.y < rect.y + 68;
    // Exit point sits on (or just outside) the source border, never inside it.
    expect(inside({ x: r.sx, y: r.sy }, { x: 0, y: 0 })).toBe(false);
    // Entry point sits on (or just outside) the target border, never inside it.
    expect(inside({ x: r.tx, y: r.ty }, { x: 300, y: 300 })).toBe(false);
  });

  it('handles fully-overlapping centers without NaN', () => {
    const r = clipEdgeToNodeRects(rect(0, 0), rect(0, 0));
    expect(Number.isFinite(r.sx)).toBe(true);
    expect(Number.isFinite(r.tx)).toBe(true);
  });

  it('MIN_LINKED_CENTER_DISTANCE leaves room for an 80px label gap', () => {
    expect(MIN_LINKED_CENTER_DISTANCE).toBeGreaterThanOrEqual(320);
  });
});
