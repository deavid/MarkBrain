/**
 * Phase 3 line diff tests — colored triage diff correctness.
 */
import { describe, it, expect } from 'vitest';
import { diffLines, diffStats } from '../utils/lineDiff';

describe('diffLines', () => {
  it('identical bodies → all same, zero stats', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc');
    expect(lines.every((l) => l.type === 'same')).toBe(true);
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0 });
  });

  it('changed middle line → one del + one add, prefix/suffix stay same', () => {
    const lines = diffLines('keep\nold line\nend', 'keep\nnew line\nend');
    expect(lines.map((l) => l.type)).toEqual(['same', 'del', 'add', 'same']);
    expect(diffStats(lines)).toEqual({ added: 1, removed: 1 });
  });

  it('pure insertion and pure deletion', () => {
    expect(diffStats(diffLines('a', 'a\nb'))).toEqual({ added: 1, removed: 0 });
    expect(diffStats(diffLines('a\nb', 'a'))).toEqual({ added: 0, removed: 1 });
  });

  it('empty inputs do not crash', () => {
    expect(diffStats(diffLines('', 'x'))).toEqual({ added: 1, removed: 0 });
    expect(diffStats(diffLines('x', ''))).toEqual({ added: 0, removed: 1 });
    const both = diffLines('', '');
    expect(both).toEqual([{ type: 'same', text: '' }]);
  });

  it('200+ line body with one edit stays correct (prefix trim carries it)', () => {
    const oldBody = Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n');
    const newBody = oldBody.replace('line 100', 'line ONE HUNDRED');
    const lines = diffLines(oldBody, newBody);
    expect(diffStats(lines)).toEqual({ added: 1, removed: 1 });
    expect(lines.filter((l) => l.type === 'same')).toHaveLength(249);
  });
});