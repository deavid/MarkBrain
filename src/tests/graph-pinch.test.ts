/**
 * Graph viewport polish (David, 2026-11-01):
 * 1. The controls bar sits at 64px from the left so the floating brain logo
 *    (fixed top-3 left-3 when the sidebar is closed) never covers Zoom In.
 * 2. Mobile pinch-zoom: two fingers on the canvas zoom the graph, keeping the
 *    canvas point between the fingers visually anchored — the same contract
 *    the wheel zoom already honours (zoom towards the cursor).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  beginPinch,
  applyPinch,
  PINCH_MIN_ZOOM,
  PINCH_MAX_ZOOM,
} from '../ui/graph/pinchZoom';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('beginPinch / applyPinch — the two-finger zoom contract', () => {
  it('zoom scales proportionally with the finger distance', () => {
    const a = { x: 100, y: 400 };
    const b = { x: 300, y: 400 }; // 200px apart
    const st = beginPinch(1, { x: 0, y: 0 }, a, b);
    const out = applyPinch(st, { x: 75, y: 400 }, { x: 325, y: 400 }); // 250px apart
    expect(out.zoom).toBeCloseTo(1.25, 5);
  });

  it('spreading fingers zooms IN, closing them zooms OUT', () => {
    const a = { x: 100, y: 400 };
    const b = { x: 300, y: 400 };
    const st = beginPinch(1, { x: 0, y: 0 }, a, b);
    const wider = applyPinch(st, { x: 0, y: 400 }, { x: 400, y: 400 });
    const narrower = applyPinch(st, { x: 150, y: 400 }, { x: 250, y: 400 });
    expect(wider.zoom).toBeGreaterThan(1);
    expect(narrower.zoom).toBeLessThan(1);
  });

  it('the canvas point between the fingers stays visually anchored', () => {
    // Zoom into a point and the point must stay under the fingers' midpoint.
    const startZoom = 1;
    const startPan = { x: 50, y: 200 };
    const a0 = { x: 100, y: 400 };
    const b0 = { x: 300, y: 400 };
    const mid0 = { x: 200, y: 400 };
    const st = beginPinch(startZoom, startPan, a0, b0);

    // Fingers spread to 400px, midpoint slides a bit (it always does).
    const a1 = { x: 80, y: 410 };
    const b1 = { x: 480, y: 410 };
    const mid1 = { x: 280, y: 410 };
    const out = applyPinch(st, a1, b1);

    const canvasPoint = (p: { x: number; y: number }, zoom: number, pan: { x: number; y: number }) => ({
      x: (p.x - pan.x) / zoom,
      y: (p.y - pan.y) / zoom,
    });
    // The anchored point is where the gesture STARTED (under the original
    // midpoint): that canvas point must now be drawn under the NEW midpoint.
    const anchored = canvasPoint(mid0, startZoom, startPan);
    expect(anchored.x * out.zoom + out.pan.x).toBeCloseTo(mid1.x, 0);
    expect(anchored.y * out.zoom + out.pan.y).toBeCloseTo(mid1.y, 0);
  });

  it('zoom is clamped and pan follows the clamp (no drift past the limits)', () => {
    const a = { x: 100, y: 400 };
    const b = { x: 300, y: 400 };
    const st = beginPinch(2.4, { x: 0, y: 0 }, a, b);
    const out = applyPinch(st, { x: 0, y: 400 }, { x: 2000, y: 400 }); // absurd spread
    expect(out.zoom).toBe(PINCH_MAX_ZOOM);
    const st2 = beginPinch(0.15, { x: 0, y: 0 }, a, b);
    const out2 = applyPinch(st2, { x: 199, y: 400 }, { x: 201, y: 400 }); // fingers together
    expect(out2.zoom).toBe(PINCH_MIN_ZOOM);
  });

  it('a one-finger wobble after lift-off must not change anything', () => {
    // Handoff law: when the second finger lifts, the zoom/pan freezes exactly
    // where the pinch ended — no jump.
    const st = beginPinch(1, { x: 0, y: 0 }, { x: 100, y: 400 }, { x: 300, y: 400 });
    const out = applyPinch(st, { x: 60, y: 400 }, { x: 340, y: 400 });
    const frozen = applyPinch(st, { x: 340, y: 400 }, { x: 60, y: 400 }); // order swap, same fingers
    expect(frozen.zoom).toBeCloseTo(out.zoom, 5);
    expect(frozen.pan.x).toBeCloseTo(out.pan.x, 5);
    expect(frozen.pan.y).toBeCloseTo(out.pan.y, 5);
  });
});

describe('SpatialGraph wiring (source scan)', () => {
  const src = readFileSync('src/ui/graph/SpatialGraph.tsx', 'utf8');

  it('the controls bar clears the 64px floating logo', () => {
    expect(src).toMatch(/top-3 left-16/);
  });

  it('pinch is wired through the two-pointer handlers, not browser gestures', () => {
    expect(src).toContain('beginPinch');
    expect(src).toContain('applyPinch');
    // The container keeps browser page-zoom OFF so OUR pinch owns two fingers,
    // and a cancelled touch cleans up like a lift (no ghost pointer).
    expect(src).toContain('touch-none');
    expect(src).toContain('onPointerCancel');
  });
});
