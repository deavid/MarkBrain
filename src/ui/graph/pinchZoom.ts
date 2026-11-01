/**
 * It turns two-finger pinch gestures into zoom + pan for the graph viewport —
 * and nothing else. The contract is the same one the wheel zoom honours: the
 * canvas point between the fingers stays visually anchored while the zoom
 * follows the finger distance. Pure math, no DOM, so tests can pin it.
 */

export const PINCH_MIN_ZOOM = 0.12;
export const PINCH_MAX_ZOOM = 2.5;

export interface Point {
  x: number;
  y: number;
}

export interface PinchState {
  startDist: number;
  startZoom: number;
  /** Midpoint of the two fingers at gesture start (container coords). */
  startMid: Point;
  /** Pan at gesture start. */
  startPan: Point;
}

/**
 * Anchors a pinch gesture. `zoom` and `pan` are the viewport's state the
 * moment the second finger lands; `a` and `b` are the two pointer positions
 * in container coordinates.
 */
export function beginPinch(zoom: number, pan: Point, a: Point, b: Point): PinchState {
  return {
    startDist: Math.max(dist(a, b), 1),
    startZoom: zoom,
    startMid: mid(a, b),
    startPan: pan,
  };
}

/**
 * Produces the viewport's new zoom + pan for the fingers' current positions.
 * Safe to call with the finger order swapped or after partial movement: the
 * result depends only on the current geometry, never on the path taken.
 */
export function applyPinch(state: PinchState, a: Point, b: Point): { zoom: number; pan: Point } {
  const nowDist = Math.max(dist(a, b), 1);
  const nowMid = mid(a, b);

  const rawZoom = (state.startZoom * nowDist) / state.startDist;
  const zoom = Math.min(Math.max(rawZoom, PINCH_MIN_ZOOM), PINCH_MAX_ZOOM);

  // Keep the canvas point that was under the START midpoint under the NOW
  // midpoint: canvasPoint = (screen - pan) / zoom  →  pan = screen - canvas*zoom
  const canvas = {
    x: (state.startMid.x - state.startPan.x) / state.startZoom,
    y: (state.startMid.y - state.startPan.y) / state.startZoom,
  };
  const pan = {
    x: Math.round(nowMid.x - canvas.x * zoom),
    y: Math.round(nowMid.y - canvas.y * zoom),
  };

  return { zoom, pan };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
