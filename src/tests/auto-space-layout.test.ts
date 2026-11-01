import { describe, it, expect } from 'vitest';
import {
  computeVisibleFactor,
  distanceFromVisibleFactor,
  computeAutoSpacePositions,
} from '../ui/graph/autoSpaceLayout';

interface N {
  id: string;
  x: number;
  y: number;
}

describe('computeVisibleFactor / distanceFromVisibleFactor (BUG-003)', () => {
  it('300px is too short: negative factor (~-0.27)', () => {
    const vf = computeVisibleFactor(300);
    expect(vf).toBeLessThan(0);
    expect(vf).toBeCloseTo(-0.27, 1);
  });

  it('500px is the short floor: ~1.55', () => {
    expect(computeVisibleFactor(500)).toBeCloseTo(1.55, 1);
  });

  it('800px is the sweet spot: ~4.27', () => {
    expect(computeVisibleFactor(800)).toBeCloseTo(4.27, 1);
  });

  it('1000px is long: ~6.09', () => {
    expect(computeVisibleFactor(1000)).toBeCloseTo(6.09, 1);
  });

  it('1500px is too long: ~10.64', () => {
    expect(computeVisibleFactor(1500)).toBeCloseTo(10.64, 1);
  });

  it('round-trips: distanceFromVisibleFactor(computeVisibleFactor(d)) ~= d', () => {
    for (const d of [300, 500, 800, 1000, 1500]) {
      expect(distanceFromVisibleFactor(computeVisibleFactor(d))).toBeCloseTo(d, 0);
    }
  });

  it('distanceFromVisibleFactor(0) = 330px (label just fits with zero visible span)', () => {
    expect(distanceFromVisibleFactor(0)).toBeCloseTo(330, 0);
  });
});

describe('computeAutoSpacePositions (BUG-003)', () => {
  const dist = (a: N, b: N) => Math.hypot(b.x - a.x, b.y - a.y);

  it('one click spreads a cramped clump of 10 connected nodes', () => {
    // 10 nodes crammed inside a 200x200 box, chained + a hub.
    const nodes: N[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push({ id: `n${i}`, x: 100 + (i % 5) * 40, y: 100 + Math.floor(i / 5) * 60 });
    }
    const edges = [
      { sourceId: 'n0', targetId: 'n1' },
      { sourceId: 'n1', targetId: 'n2' },
      { sourceId: 'n2', targetId: 'n3' },
      { sourceId: 'n3', targetId: 'n4' },
      { sourceId: 'n0', targetId: 'n5' },
      { sourceId: 'n5', targetId: 'n6' },
      { sourceId: 'n6', targetId: 'n7' },
      { sourceId: 'n7', targetId: 'n8' },
      { sourceId: 'n8', targetId: 'n9' },
      { sourceId: 'n0', targetId: 'n9' },
    ];

    const solved = computeAutoSpacePositions(nodes, edges);
    const byId = new Map(solved.map((p) => [p.id, p]));

    const linkedDists: number[] = [];
    for (const e of edges) {
      const a = byId.get(e.sourceId)!;
      const b = byId.get(e.targetId)!;
      const d = dist(a, b);
      linkedDists.push(d);
      // visible_factor floor/ceiling: >= 1.5 (~500px) and < 9.5 (~1375px)
      expect(computeVisibleFactor(d)).toBeGreaterThanOrEqual(1.5);
      expect(computeVisibleFactor(d)).toBeLessThan(9.5);
    }
    linkedDists.sort((a, b) => a - b);
    const median = linkedDists[Math.floor(linkedDists.length / 2)];
    // median linked distance in the 650-1000px range (vf 3.0-6.1)
    expect(median).toBeGreaterThanOrEqual(650);
    expect(median).toBeLessThanOrEqual(1000);

    // No two nodes (linked or not) closer than 480px
    for (let i = 0; i < solved.length; i++) {
      for (let j = i + 1; j < solved.length; j++) {
        expect(dist(solved[i], solved[j])).toBeGreaterThanOrEqual(480);
      }
    }
  });

  it('pulls back overly long edges into the 700-1000px range', () => {
    const nodes: N[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 2500, y: 0 },
    ];
    const solved = computeAutoSpacePositions(nodes, [{ sourceId: 'a', targetId: 'b' }]);
    const d = dist(solved[0], solved[1]);
    expect(d).toBeGreaterThanOrEqual(700);
    expect(d).toBeLessThanOrEqual(1000);
  });

  it('pushes a node sitting on a linked edge off the line by >=180px', () => {
    const nodes: N[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 800, y: 0 },
      { id: 'c', x: 400, y: 10 }, // right on the line AB
    ];
    const solved = computeAutoSpacePositions(nodes, [{ sourceId: 'a', targetId: 'b' }]);
    const byId = new Map(solved.map((p) => [p.id, p]));
    const a = byId.get('a')!;
    const b = byId.get('b')!;
    const c = byId.get('c')!;

    // perpendicular distance from C to line AB
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len = Math.hypot(abx, aby);
    const t = Math.max(0, Math.min(1, ((c.x - a.x) * abx + (c.y - a.y) * aby) / (len * len)));
    const px = a.x + t * abx;
    const py = a.y + t * aby;
    const perpDist = Math.hypot(c.x - px, c.y - py);
    expect(perpDist).toBeGreaterThanOrEqual(180);
  });

  it('is deterministic: same input, same output', () => {
    const nodes: N[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 120, y: 30 },
      { id: 'c', x: 60, y: 80 },
    ];
    const edges = [{ sourceId: 'a', targetId: 'b' }];
    const r1 = computeAutoSpacePositions(nodes, edges);
    const r2 = computeAutoSpacePositions(nodes, edges);
    expect(r1).toEqual(r2);
  });

  it('unlinked islands sit clear of the connected web', () => {
    const nodes: N[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 900, y: 0 },
      { id: 'x', x: 450, y: 450 }, // unlinked
      { id: 'y', x: 500, y: 500 }, // unlinked, near x
    ];
    const solved = computeAutoSpacePositions(nodes, [{ sourceId: 'a', targetId: 'b' }]);
    const byId = new Map(solved.map((p) => [p.id, p]));
    // islands not on top of each other
    expect(dist(byId.get('x')!, byId.get('y')!)).toBeGreaterThanOrEqual(480);
    // islands not crowding the web
    expect(dist(byId.get('x')!, byId.get('a')!)).toBeGreaterThanOrEqual(480);
    expect(dist(byId.get('x')!, byId.get('b')!)).toBeGreaterThanOrEqual(480);
    expect(dist(byId.get('y')!, byId.get('a')!)).toBeGreaterThanOrEqual(480);
    expect(dist(byId.get('y')!, byId.get('b')!)).toBeGreaterThanOrEqual(480);
  });
});
