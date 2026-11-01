/**
 * BUG-003: Auto-Space layout solver driven by David's `visible_factor` model.
 *
 * Pure + deterministic: same input always yields the same solved positions,
 * so it is unit-testable without a browser (TDD Law).
 *
 * The model (card width 220 -> half_width W = 110):
 *   visible          = distance - 2 * W          (raw line span between cards)
 *   visible_w_label  = visible - W               (room for the mid-line label)
 *   visible_factor   = visible_w_label / W
 *   distance(f)      = (f + 3) * W
 *
 * Reference scale:
 *   300px -> -0.27  too short (label doesn't fit)
 *   500px -> +1.55  short (minimum acceptable linked distance)
 *   800px -> +4.27  normal / medium (target sweet spot)
 *  1000px -> +6.09  long (upper comfortable band)
 *  1500px ->+10.64  too long (pull back)
 */

export const HALF_WIDTH = 110;

/** Hard floor for any linked pair (~500px). */
export const MIN_LINKED_FACTOR = 1.55;
/** Ideal normal/medium distance for linked nodes (~800px). */
export const TARGET_LINKED_FACTOR = 4.27;
/** Comfortable upper band for linked nodes (~1000px). */
export const LONG_LINKED_FACTOR = 6.09;

/** Any two non-linked nodes within this distance strongly repel (~600px, vf ~2.45). */
export const MIN_UNLINKED_DISTANCE = 600;
/** If a third node sits within this of a linked edge's segment, push it out. */
export const NODE_TO_EDGE_CLEARANCE = 220;

/** Simulation shape. */
const ITERATIONS = 250;
const MAX_STEP = 120; // px at temp 1.0

export function computeVisibleFactor(distance: number, halfWidth: number = HALF_WIDTH): number {
  return (distance - 3 * halfWidth) / halfWidth;
}

export function distanceFromVisibleFactor(factor: number, halfWidth: number = HALF_WIDTH): number {
  return (factor + 3) * halfWidth;
}

interface Pt {
  x: number;
  y: number;
}

interface WorkNode extends Pt {
  id: string;
  degree: number;
}

function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Deterministic jitter angle per index so coincident starts get a direction. */
function jitterOffset(index: number): Pt {
  const angle = (index * 2.399963229728653) % (Math.PI * 2); // golden-angle spread
  return { x: Math.cos(angle) * 55, y: Math.sin(angle) * 55 };
}

/** Perpendicular distance from point p to segment ab (t clamped). */
function perpDistance(p: Pt, a: Pt, b: Pt): { dist: number; t: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-6) return { dist: hypot(p.x - a.x, p.y - a.y), t: 0 };
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0.1, Math.min(0.9, t));
  const px = a.x + t * abx;
  const py = a.y + t * aby;
  return { dist: hypot(p.x - px, p.y - py), t };
}

/**
 * Solve the whole layout in one click: ~250 float64 iterations with an
 * annealing temperature schedule. NO per-step rounding — velocity freezes
 * were the death of the old physics (BUG-003 §1).
 */
export function computeAutoSpacePositions(
  nodes: ReadonlyArray<{ id: string; x: number; y: number }>,
  edges: ReadonlyArray<{ sourceId: string; targetId: string }>,
): Array<{ id: string; x: number; y: number }> {
  if (nodes.length === 0) return [];

  // Degree map + adjacency
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  const edgeList = edges
    .filter((e) => degree.has(e.sourceId) && degree.has(e.targetId) && e.sourceId !== e.targetId)
    .map((e) => {
      degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
      degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
      return e;
    });

  // Working copies in float64; jitter near-coincident starts deterministically.
  const work: WorkNode[] = nodes.map((n, i) => ({
    id: n.id,
    degree: degree.get(n.id) ?? 0,
    x: n.x,
    y: n.y,
  }));
  for (let i = 0; i < work.length; i++) {
    for (let j = i + 1; j < work.length; j++) {
      if (hypot(work[i].x - work[j].x, work[i].y - work[j].y) < 100) {
        const jit = jitterOffset(i);
        work[i].x += jit.x;
        work[i].y += jit.y;
        const jit2 = jitterOffset(j);
        work[j].x += jit2.x;
        work[j].y += jit2.y;
      }
    }
  }
  const byId = new Map(work.map((n) => [n.id, n]));

  const connected = work.filter((n) => n.degree > 0);
  const islands = work.filter((n) => n.degree === 0);

  // Velocity state — accumulated + damped + clamped (the old physics reset
  // velocities every frame and rounded positions, so it froze; see BUG-003 §1).
  const vx = new Map<string, number>();
  const vy = new Map<string, number>();
  for (const n of work) {
    vx.set(n.id, 0);
    vy.set(n.id, 0);
  }

  // --- Simulate the connected web ---
  for (let step = 0; step < ITERATIONS; step++) {
    const temp = Math.max(0.08, 1 - step / ITERATIONS);
    const maxMove = MAX_STEP * temp;

    // A. Linked edge forces via visible_factor
    for (const e of edgeList) {
      const u = byId.get(e.sourceId)!;
      const v = byId.get(e.targetId)!;
      const dx = v.x - u.x;
      const dy = v.y - u.y;
      const dist = Math.max(hypot(dx, dy), 1);
      const vf = computeVisibleFactor(dist);
      const targetVf =
        TARGET_LINKED_FACTOR + Math.min(1.8, Math.max(u.degree, v.degree) * 0.2);

      let k: number;
      if (vf >= targetVf - 0.6 && vf <= targetVf + 0.8) {
        k = 0.02; // deadband comfort zone
      } else if (vf < MIN_LINKED_FACTOR) {
        k = 0.35; // strong push outward
      } else if (vf > LONG_LINKED_FACTOR) {
        k = 0.25; // stronger pull inward
      } else {
        k = 0.12;
      }
      // Spring toward the target distance: when too far, pull together;
      // when too close, push apart. (u moves along +dx when stretched.)
      const f = dist - distanceFromVisibleFactor(targetVf);
      const fx = (dx / dist) * f * k;
      const fy = (dy / dist) * f * k;
      vx.set(u.id, vx.get(u.id)! + fx);
      vy.set(u.id, vy.get(u.id)! + fy);
      vx.set(v.id, vx.get(v.id)! - fx);
      vy.set(v.id, vy.get(v.id)! - fy);
    }

    // B. All-pairs repulsion (wide scattering)
    for (let i = 0; i < connected.length; i++) {
      for (let j = i + 1; j < connected.length; j++) {
        const n1 = connected[i];
        const n2 = connected[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.max(hypot(dx, dy), 1);
        if (dist >= 900) continue;
        const overlap = 900 - dist;
        // inverse-square term is strong inside MIN_UNLINKED_DISTANCE
        const invSq = dist < MIN_UNLINKED_DISTANCE
          ? (MIN_UNLINKED_DISTANCE - dist) * 0.9
          : 0;
        const force = overlap * 0.05 + invSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        vx.set(n1.id, vx.get(n1.id)! - fx);
        vy.set(n1.id, vy.get(n1.id)! - fy);
        vx.set(n2.id, vx.get(n2.id)! + fx);
        vy.set(n2.id, vy.get(n2.id)! + fy);
      }
    }

    // C. Node-to-edge line clearance
    for (const e of edgeList) {
      const a = byId.get(e.sourceId)!;
      const b = byId.get(e.targetId)!;
      for (const c of connected) {
        if (c === a || c === b) continue;
        const { dist, t } = perpDistance(c, a, b);
        if (dist >= NODE_TO_EDGE_CLEARANCE) continue;
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const len = Math.max(hypot(abx, aby), 1);
        // perpendicular direction (rotate AB by +90deg)
        const px = -aby / len;
        const py = abx / len;
        // which side is C on?
        const cross = (c.x - a.x) * py - (c.y - a.y) * px;
        const side = cross >= 0 ? 1 : -1;
        const push = NODE_TO_EDGE_CLEARANCE - dist + 10;
        const fx = px * side * push;
        const fy = py * side * push;
        vx.set(c.id, vx.get(c.id)! + fx);
        vy.set(c.id, vy.get(c.id)! + fy);
        vx.set(a.id, vx.get(a.id)! - fx * 0.15);
        vy.set(a.id, vy.get(a.id)! - fy * 0.15);
        vx.set(b.id, vx.get(b.id)! - fx * 0.15);
        vy.set(b.id, vy.get(b.id)! - fy * 0.15);
      }
    }

    // Apply damped, temperature-clamped velocity (float64 — no rounding).
    const damping = 0.6;
    for (const n of connected) {
      let velX = vx.get(n.id)! * damping;
      let velY = vy.get(n.id)! * damping;
      const mag = hypot(velX, velY);
      if (mag > maxMove) {
        velX = (velX / mag) * maxMove;
        velY = (velY / mag) * maxMove;
      }
      n.x += velX;
      n.y += velY;
      vx.set(n.id, 0);
      vy.set(n.id, 0);
    }
  }

  // --- Place unlinked islands on a shelf above the web bounding box ---
  if (islands.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const n of connected) {
      if (n.x < minX) minX = n.x;
      if (n.x + 220 > maxX) maxX = n.x + 220;
      if (n.y < minY) minY = n.y;
    }
    if (!isFinite(minX)) {
      minX = 0;
      maxX = 220;
      minY = 0;
    }
    const spacing = 750;
    const shelfY = minY - 700;
    const totalWidth = (islands.length - 1) * spacing;
    const startX = (minX + maxX) / 2 - totalWidth / 2;
    islands.forEach((n, i) => {
      n.x = startX + i * spacing;
      n.y = shelfY;
    });
  }

  return work.map((n) => ({ id: n.id, x: Math.round(n.x), y: Math.round(n.y) }));
}
