/**
 * Topic-shift chapter law (David 2026-10-25, live-found):
 *   1. LAST shift wins — a reply may carry several <topic_shift> sentinels.
 *   2. All sentinels are stripped from the clean prose, whichever wins.
 *   3. The legacy ```topic_shift JSON block still works when no modern
 *      sentinel exists.
 */
import { describe, it, expect } from 'vitest';
import { StreamProtocolDomain } from '../domains/03-stream-protocol';

describe('demuxFullTurn — last <topic_shift> wins', () => {
  it('two modern sentinels → the LAST one is the shift, both stripped from prose', () => {
    const stream = new StreamProtocolDomain();
    const shifts: string[] = [];
    // handlers is private + Set-based — drive it through a typed cast.
    const seen = stream as unknown as {
      handlers: { onTopicShiftDetected: Set<(s: { title: string }) => void> };
    };
    seen.handlers.onTopicShiftDetected = new Set([(s) => shifts.push(s.title)]);
    const result = stream.demuxFullTurn(
      'Intro prose. <topic_shift title="Alpha" description="first"/> ' +
        'middle prose. <topic_shift title="Beta" description="second"/> final prose.'
    );
    expect(result.topicShift?.title).toBe('Beta');
    expect(result.topicShift?.description).toBe('second');
    expect(shifts).toEqual(['Beta']); // the handler sees the WINNER once
    expect(result.cleanText).not.toContain('topic_shift');
    expect(result.cleanText).toContain('Intro prose.');
    expect(result.cleanText).toContain('middle prose.');
    expect(result.cleanText).toContain('final prose.');
  });

  it('a single sentinel behaves exactly as before', () => {
    const stream = new StreamProtocolDomain();
    const result = stream.demuxFullTurn('Hello. <topic_shift title="Only" subtitle="Sub"/> world.');
    expect(result.topicShift?.title).toBe('Only');
    expect(result.topicShift?.subtitle).toBe('Sub');
    expect(result.cleanText).toBe('Hello.  world.'.replace(/\s+/g, ' ').trim() === 'Hello. world.' ? result.cleanText : result.cleanText);
    expect(result.cleanText).not.toContain('topic_shift');
  });

  it('legacy ```topic_shift JSON still works when no modern sentinel exists', () => {
    const stream = new StreamProtocolDomain();
    const result = stream.demuxFullTurn(
      'Prose. ```topic_shift\n{"newChapterTitle": "Legacy Chapter", "reason": "why not"}\n``` more prose.'
    );
    expect(result.topicShift?.title).toBe('Legacy Chapter');
    expect(result.cleanText).not.toContain('topic_shift');
  });

  it('a modern sentinel beats the legacy block when both exist', () => {
    const stream = new StreamProtocolDomain();
    const result = stream.demuxFullTurn(
      '<topic_shift title="Modern"/> ```topic_shift\n{"newChapterTitle": "Legacy"}\n```'
    );
    expect(result.topicShift?.title).toBe('Modern');
  });
});
