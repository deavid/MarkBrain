/**
 * Local-mode flight recorder (design-docs/28 §4.5) — pure-logic coverage.
 *
 * Node test env has no `indexedDB`, so the store's IO is exercised through
 * the pure pieces it factors out (scrubRequestDeep, pruneCallLogIds,
 * callDurations), plus a no-op guard test proving the recorder never throws
 * when IndexedDB is absent.
 */
import { describe, it, expect } from 'vitest';
import {
  scrubRequestDeep,
  pruneCallLogIds,
  callDurations,
  CALL_LOG_TTL_MS,
  CALL_LOG_MAX_PER_USER,
  type ApiCallLog,
} from '../domains/callLogTypes';
import { recordCallStart, recordCallEnd } from '../services/callLogStore';

function makeLog(over: Partial<ApiCallLog>): ApiCallLog {
  return {
    id: 'call-x',
    userId: null,
    kind: 'chat',
    provider: 'gemini',
    model: 'gemini-3.5-pro',
    tSend: 0,
    tAck: null,
    tFirstReasoning: null,
    tFirstToken: null,
    tEnd: null,
    status: 'pending' as const,
    reasoningText: null,
    textChunks: null,
    reasoningChunks: null,
    httpStatus: null,
    request: { endpoint: 'direct:generateContent', model: 'gemini-3.5-pro' },
    responseText: null,
    usage: null,
    error: null,
    jobId: null,
    turnId: null,
    ...over,
  };
}

describe('scrubRequestDeep', () => {
  it('strips apiKey/Authorization-style keys at any depth', () => {
    const scrubbed = scrubRequestDeep({
      endpoint: '/api/chat/stream',
      model: 'm',
      params: {
        temperature: 0.7,
        apiKey: 'SK-VALUE-1',
        headers: { Authorization: 'Bearer SK-VALUE-2', 'x-goog-api-key': 'SK-VALUE-3', 'Content-Type': 'application/json' },
        nested: { apiKey: 'SK-VALUE-4', user_secrets: { vault: 'SK-VALUE-5' }, keep: 'kept-value' },
      },
    });
    const s = JSON.stringify(scrubbed);
    expect(s).not.toContain('SK-VALUE-1');
    expect(s).not.toContain('SK-VALUE-2');
    expect(s).not.toContain('SK-VALUE-3');
    expect(s).not.toContain('SK-VALUE-4');
    expect(s).not.toContain('SK-VALUE-5');
    // Non-secret payload survives intact.
    expect(s).toContain('kept-value');
    expect(s).toContain('0.7');
    expect(s).toContain('application/json');
  });

  it('handles nulls, arrays and primitives without dying', () => {
    expect(scrubRequestDeep(null)).toBeNull();
    expect(scrubRequestDeep('plain')).toBe('plain');
    expect(scrubRequestDeep([{ apiKey: 'SK-X', n: 1 }])).toEqual([{ n: 1 }]);
  });
});

describe('pruneCallLogIds (pure prune decision)', () => {
  it('drops records older than the 7-day TTL', () => {
    const now = 1_000_000_000_000;
    const logs = [
      makeLog({ id: 'fresh', tSend: now - 1000 }),
      makeLog({ id: 'edge', tSend: now - CALL_LOG_TTL_MS }), // exactly at the cutoff — kept
      makeLog({ id: 'stale', tSend: now - CALL_LOG_TTL_MS - 1 }),
    ];
    expect(pruneCallLogIds(logs, now)).toEqual(['stale']);
  });

  it('caps each user bucket at 500, keeping the newest', () => {
    const now = 1_000_000_000_000;
    const logs: ApiCallLog[] = [];
    for (let i = 0; i < CALL_LOG_MAX_PER_USER + 3; i++) {
      logs.push(makeLog({ id: `u1-${i}`, userId: 1, tSend: now - i * 1000 }));
    }
    logs.push(makeLog({ id: 'u2-0', userId: 2, tSend: now - 5000 }));
    logs.push(makeLog({ id: 'local-0', userId: null, tSend: now - 6000 }));
    const doomed = pruneCallLogIds(logs, now);
    expect(doomed).toContain('u1-500');
    expect(doomed).toContain('u1-502');
    expect(doomed).not.toContain('u1-0');
    expect(doomed).not.toContain('u1-499');
    expect(doomed).not.toContain('u2-0');
    expect(doomed).not.toContain('local-0');
    expect(doomed).toHaveLength(3);
  });

  it('prunes per user, not globally', () => {
    const now = 1_000_000_000_000;
    const logs = [
      makeLog({ id: 'a-1', userId: 1, tSend: now - 1000 }),
      makeLog({ id: 'a-2', userId: 1, tSend: now - 2000 }),
      makeLog({ id: 'b-1', userId: 2, tSend: now - 3000 }),
    ];
    expect(pruneCallLogIds(logs, now, CALL_LOG_TTL_MS, 1)).toEqual(['a-2']);
  });
});

describe('callDurations', () => {
  it('computes ack / ttft / total from the stopwatch timestamps', () => {
    const d = callDurations({ tSend: 1000, tAck: 1200, tFirstToken: 1500, tEnd: 3000 });
    expect(d).toEqual({ ackMs: 200, ttftMs: 500, totalMs: 2000 });
  });

  it('answers null while milestones are missing', () => {
    expect(callDurations({ tSend: 1000, tAck: null, tFirstToken: null, tEnd: null })).toEqual({
      ackMs: null,
      ttftMs: null,
      totalMs: null,
    });
  });
});

describe('local store without IndexedDB (Node test env)', () => {
  it('recordCallStart/recordCallEnd no-op gracefully instead of throwing', () => {
    // Guard for the premise: vitest's node env has no indexedDB.
    expect(typeof indexedDB).toBe('undefined');
    const id = recordCallStart({
      kind: 'chat',
      provider: 'gemini',
      model: 'gemini-3.5-pro',
      request: { endpoint: 'direct:generateContent', model: 'gemini-3.5-pro', compiledPrompt: 'p' },
    });
    expect(id).toMatch(/^call-/);
    expect(() => {
      recordCallEnd(id, { status: 'ok', responseText: 'raw text' });
      recordCallEnd(null, { status: 'error', error: 'x' });
    }).not.toThrow();
  });

  it('scrubs secrets before the (skipped) write', () => {
    // The scrub happens synchronously in recordCallStart — prove the same
    // scrub the store uses keeps secrets out of the payload it would store.
    const scrubbed = scrubRequestDeep({
      endpoint: 'direct:streamGenerateContent?alt=sse',
      model: 'm',
      systemInstruction: 'sys',
      compiledPrompt: 'p',
      params: { apiKey: 'SK-LOCAL-SECRET' },
    });
    expect(JSON.stringify(scrubbed)).not.toContain('SK-LOCAL-SECRET');
    expect(JSON.stringify(scrubbed)).toContain('sys');
  });
});
