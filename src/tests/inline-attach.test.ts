/**
 * FEATURE_INLINE_ATTACHMENTS §1: the user speaks the same inline XML
 * language the model does — `<attach file="slug.md" level="full" />` rides
 * IN the user's message, renders as an in-place chip, shows verbatim in Raw,
 * and stages the named artifact into the chat when the message is sent.
 */
import { describe, it, expect } from 'vitest';
import { parseMessageSegments } from '../ui/chat/messageSegments';
import { matchArtifactByFile } from '../utils/artifactTaxonomy';
import { readFileSync } from 'node:fs';

describe('parseMessageSegments — <attach>', () => {
  it('parses an inline attach tag in position with its level', () => {
    const segs = parseMessageSegments(
      'Look at <attach file="the-spec.md" level="summary" /> and tell me what breaks.'
    );
    expect(segs.map((s) => s.kind)).toEqual(['prose', 'attach', 'prose']);
    const att = segs[1] as any;
    expect(att.file).toBe('the-spec.md');
    expect(att.level).toBe('summary');
  });

  it('defaults the level to full', () => {
    const segs = parseMessageSegments('a <attach file="x.md" /> b');
    expect((segs[1] as any).level).toBe('full');
  });

  it('marks an unclosed attach tag at the tail as streaming', () => {
    const segs = parseMessageSegments('text\n<attach file="x.md" leve');
    const tail = segs[1] as any;
    expect(tail.kind).toBe('attach');
    expect(tail.streaming).toBe(true);
    expect(tail.file).toBe('x.md');
  });
});

describe('matchArtifactByFile', () => {
  const artifacts = [
    {
      id: 'art-1',
      code: 'night-vision-design',
      title: 'Night Vision Design',
      previousCodes: ['night-vision-old'],
    },
  ];

  it('resolves code.md, plain code, exact title, slug-of-title and previousCodes', () => {
    for (const f of [
      'night-vision-design.md',
      'night-vision-design',
      'Night Vision Design',
      'Night Vision Design'.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    ]) {
      expect(matchArtifactByFile(f, artifacts as any)?.id).toBe('art-1');
    }
    expect(matchArtifactByFile('night-vision-old.md', artifacts as any)?.id).toBe('art-1');
    expect(matchArtifactByFile('nope.md', artifacts as any)).toBeNull();
  });
});

describe('send seam — inline attach stages the artifact (source pin)', () => {
  it('handleSendMessage extracts attach tags and stages them before enqueue', () => {
    const src = readFileSync('src/application/sendQueue.ts', 'utf8');
    expect(src).toMatch(/extractInlineAttach/);
    expect(src).toMatch(/stageArtifact/);
  });
});
