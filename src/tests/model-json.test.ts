/**
 * Extraction JSON robustness: a bare JSON.parse fails intermittently on literal
 * control characters and bad escapes in model output. Each test below is one of
 * those observed shapes.
 */
import { describe, it, expect } from 'vitest';
import { parseModelJson } from '../../server/lib/modelJson';

describe('parseModelJson', () => {
  it('parses clean JSON unchanged', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips illegal control characters inside strings (the observed failure)', () => {
    // 0x0B (vertical tab) at a string position — exactly the "Bad control
    // character in string literal" class of error.
    const raw = '{"title": "My\u000BNote", "tags": ["a","b"]}';
    expect(parseModelJson(raw)).toEqual({ title: 'MyNote', tags: ['a', 'b'] });
  });

  it('keeps legal whitespace escapes (\\n, \\t stay)', () => {
    expect(parseModelJson('{"s": "line1\\nline2\\tend"}')).toEqual({
      s: 'line1\nline2\tend',
    });
  });

  it('extracts the outer object from prose/fenced model chatter', () => {
    const raw = 'Here you go:\n```json\n{"title": "X", "code": "x"}\n```\nDone!';
    expect(parseModelJson(raw)).toEqual({ title: 'X', code: 'x' });
  });

  it('neutralizes invalid escapes (\\x) while keeping valid ones', () => {
    const raw = '{"path": "C:\\xUsers\\\\data", "q": "say \\"hi\\""}';
    const out = parseModelJson(raw) as { path: string; q: string };
    expect(out.path).toBe('C:xUsers\\data');
    expect(out.q).toBe('say "hi"');
  });

  it('throws a descriptive error when there is no JSON object at all', () => {
    expect(() => parseModelJson('sorry, I cannot do that')).toThrow(/no JSON object/);
  });
});