/**
 * BUG-007/012 seam: parseMessageSegments walks a message (complete or
 * mid-stream) and returns prose and operation tags IN PLACE, in order.
 * Half-written tags at the tail become `streaming` segments — never raw XML
 * leaked into the prose.
 */
import { describe, it, expect } from 'vitest';
import { parseMessageSegments } from '../ui/chat/messageSegments';

describe('parseMessageSegments — complete tags', () => {
  it('keeps link, unlink, topic_shift and artifact_upsert in their exact positions', () => {
    const content = [
      'Here are the links:',
      '',
      '<link source="a.md" target="b.md" kind="relates_to" />',
      '',
      'And a chapter starts here.',
      '<topic_shift title="New Chapter" subtitle="About X" />',
      'Then prose.',
      '<artifact_upsert file="the-hook.md" title="The Hook"><subtitle>s</subtitle><content>Body text.</content></artifact_upsert>',
      'Final words.',
    ].join('\n');
    const segs = parseMessageSegments(content);
    expect(segs.map((s) => s.kind)).toEqual([
      'prose',
      'link',
      'prose',
      'topic_shift',
      'prose',
      'artifact_upsert',
      'prose',
    ]);
    const link = segs[1] as any;
    expect(link.source).toBe('a.md');
    expect(link.target).toBe('b.md');
    expect(link.relKind).toBe('relates_to');
    expect(link.action).toBe('link');
    const shift = segs[3] as any;
    expect(shift.title).toBe('New Chapter');
    const art = segs[5] as any;
    expect(art.file).toBe('the-hook.md');
    expect(art.title).toBe('The Hook');
    expect(art.wordCount).toBeGreaterThan(0);
    expect((segs[6] as any).text).toContain('Final words.');
  });

  it('parses <unlink> with action unlink', () => {
    const segs = parseMessageSegments(
      'before <unlink source="a.md" target="b.md" kind="relates_to" /> after'
    );
    expect(segs[1]).toMatchObject({ kind: 'link', action: 'unlink' });
  });

  it('collapses the blank-line holes a stripped tag used to leave', () => {
    const segs = parseMessageSegments('para one\n\n\n<link source="a" target="b" kind="relates_to" />\n\n\npara two');
    const prose1 = segs[0] as any;
    expect(prose1.text.trimEnd()).toBe('para one');
    const prose2 = segs[2] as any;
    expect(prose2.text.trimStart()).toBe('para two');
  });
});

describe('parseMessageSegments — streaming tails (BUG-012)', () => {
  it('marks an unclosed artifact_upsert at the tail as streaming', () => {
    const content =
      'Writing now.\n<artifact_upsert file="the-hook.md" title="The Hook">\n<subtitle>partial su';
    const segs = parseMessageSegments(content);
    expect(segs[0].kind).toBe('prose');
    const tail = segs[1] as any;
    expect(tail.kind).toBe('artifact_upsert');
    expect(tail.streaming).toBe(true);
    expect(tail.file).toBe('the-hook.md');
    expect(tail.title).toBe('The Hook');
  });

  it('marks an unclosed link at the tail as streaming', () => {
    const segs = parseMessageSegments('text\n<link source="a.md" targ');
    const tail = segs[1] as any;
    expect(tail.kind).toBe('link');
    expect(tail.streaming).toBe(true);
    expect(tail.source).toBe('a.md');
  });

  it('marks an unclosed topic_shift at the tail as streaming', () => {
    const segs = parseMessageSegments('text\n<topic_shift title="Mid');
    const tail = segs[1] as any;
    expect(tail.kind).toBe('topic_shift');
    expect(tail.streaming).toBe(true);
    expect(tail.title).toBe('Mid');
  });

  it('an unclosed tag that is CLOSED later is no longer streaming', () => {
    const before = parseMessageSegments('text\n<link source="a.md"');
    expect((before[1] as any).streaming).toBe(true);
    const after = parseMessageSegments('text\n<link source="a.md" target="b.md" kind="relates_to" />');
    expect((after[1] as any).streaming).toBeUndefined();
    expect(after.length).toBe(2);
  });
});
