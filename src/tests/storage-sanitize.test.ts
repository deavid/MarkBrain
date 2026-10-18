import { describe, it, expect } from 'vitest';
import { sanitizeForStorage } from '../utils/storageSanitize';

describe('sanitizeForStorage', () => {
  it('drops object keys whose value is undefined (the Firestore poison pill)', () => {
    const poisoned = {
      id: 'art-1',
      graph: { x: undefined, y: undefined, is_high_concept: false },
      resolution: undefined,
      yamlDocument: undefined,
    };
    const clean = sanitizeForStorage(poisoned) as Record<string, unknown>;

    expect(clean.id).toBe('art-1');
    expect(clean).not.toHaveProperty('resolution');
    expect(clean).not.toHaveProperty('yamlDocument');
    expect(clean.graph).toEqual({ is_high_concept: false });
    expect('x' in (clean.graph as object)).toBe(false);
    expect('y' in (clean.graph as object)).toBe(false);
  });

  it('converts undefined array elements to null (JSON semantics)', () => {
    const clean = sanitizeForStorage([1, undefined, 3]);
    expect(clean).toEqual([1, null, 3]);
  });

  it('leaves already-clean snapshots untouched', () => {
    const snap = { turns: [{ id: 't1' }], artifacts: [], edges: [], updatedAt: 42 };
    expect(sanitizeForStorage(snap)).toEqual(snap);
  });
});