/**
 * Spec JSON export version marker.
 *
 * 2.0.0 shipped on main with the Project aggregate in the shape; the type
 * collapse killed that aggregate (boundaryRules & friends went with it) but
 * the export kept declaring 2.0.0 — external parsers could not detect the
 * break. The shape change is breaking → 3.0.0.
 */
import { describe, it, expect } from 'vitest';
import { exportToJSON } from '../utils/tokenCalculator';

describe('spec JSON export version', () => {
  it('declares 3.0.0 after the breaking shape change', () => {
    const out = JSON.parse(
      exportToJSON([], {
        meta: { id: 'p1', name: 'Proj', codeName: 'proj', description: '' },
        artifacts: [],
        chapters: [],
        edges: [],
      })
    );
    expect(out.version).toBe('3.0.0');
    expect(out.appName).toBe('MarkBrain');
  });
});
