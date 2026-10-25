/**
 * Errors are final — there is no smart downgrade (David, 2026-10-25).
 *
 * The bug this pins: he asked for gemini-3.8-flash-lite and the server's 9s
 * first-chunk watchdog silently re-streamed the reply from 3.5, with an amber
 * "DOWNGRADED FROM…" chip. That hid the real situation (and he SHOULD have had
 * 3.8 quota — the swap made it unobservable). Law now: the requested model
 * answers or the request fails with the real error, which the draft shows.
 *
 * "I don't want the smart downgrade - I want the actual error … remove the
 * downgrade and make errors final."
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  requireModelId,
  DEFAULT_MODEL_ID,
  defaultModelFor,
  listValidModelIds,
  tryRequireModelId,
} from '../../server/lib/models';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('requireModelId — no substitution exists', () => {
  it('an empty/absent request gets the lane default (no preference is not an error)', () => {
    expect(requireModelId(undefined, 'chat')).toBe(defaultModelFor('chat'));
    expect(requireModelId('', 'chat')).toBe(defaultModelFor('chat'));
    expect(requireModelId(null, 'title')).toBe(defaultModelFor('title'));
  });

  it('a valid id passes through exactly', () => {
    expect(requireModelId(DEFAULT_MODEL_ID, 'chat')).toBe(DEFAULT_MODEL_ID);
  });

  it('an unknown id is a HARD error with the real reason — never a swap', () => {
    expect(() => requireModelId('gemini-3.8-flash-lite-typo', 'chat')).toThrow(
      /gemini-3\.8-flash-lite-typo.*not available/
    );
    // Wrong capability is an error too — no "close enough" model.
    expect(() => requireModelId('gemini-embedding-001', 'chat')).toThrow(/not available/);
  });
});

describe('the downgrade family stays dead', () => {
  it('the chat stream route has no watchdog swap and no downgradedFrom trail', () => {
    const chat = read('server/routes/chat.ts');
    expect(chat).toContain('requireModelId(');
    expect(chat).not.toContain('resolveModelId');
    expect(chat).not.toContain('downgradedFrom');
    expect(chat).not.toContain('WATCHDOG');
    expect(chat).not.toContain('FIRST_CHUNK_TIMEOUT');
    expect(chat).not.toContain('Downgrading to');
    // The requested model streams, full stop — via the caller's per-request
    // vault client (design-docs/21B §7.3), never a process-global key.
    expect(chat).toContain('streamFromModel(ai, targetModel');
  });

  it('no route substitutes a model silently', () => {
    for (const rel of [
      'server/routes/chat.ts',
      'server/routes/extract.ts',
      'server/routes/summarize.ts',
      'server/routes/title.ts',
      'server/routes/tts.ts',
      'server/routes/searchIndex.ts',
    ]) {
      const src = read(rel);
      expect(src, rel).not.toContain('resolveModelId');
      expect(src, rel).not.toContain('fellBackFrom');
    }
  });

  it('the UI carries no downgrade banner and no downgradedFrom meta', () => {
    const chatView = read('src/ui/chat/ChatView.tsx');
    expect(chatView).not.toContain('downgradedFrom');
    expect(chatView).not.toContain('Downgraded from');
    expect(chatView).not.toContain('model-downgrade-banner');
    const sendQueue = read('src/application/sendQueue.ts');
    expect(sendQueue).not.toContain('downgradedFrom');
  });
});

describe('the catalog is the three REAL Gemini text models + three OpenRouter lanes (design 24 §3)', () => {
  it('text lanes offer 3 Gemini models and 3 OpenRouter models', () => {
    expect(listValidModelIds('chat')).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-4-argon',
      'nvidia/nemotron-3.5-lightning:free',
      'z-ai/glm-5.3-flash',
      'xiaomi/mimo-v2.6-flash',
    ]);
  });

  it('the invented gemini-3.8-flash-lite is gone — it was never a model', () => {
    expect(listValidModelIds('chat')).not.toContain('gemini-3.8-flash-lite');
    // ...and asking for it is a hard error with the real reason.
    expect(() => requireModelId('gemini-3.8-flash-lite', 'chat')).toThrow(/not available/);
  });

  it('infra lanes keep their own models', () => {
    expect(listValidModelIds('embed')).toEqual(['gemini-embedding-001']);
    expect(listValidModelIds('tts')).toEqual(['gemini-3.8-flash-lite-tts']);
  });
});

describe('a bad model can never kill the server', () => {
  it('tryRequireModelId returns an error payload, it does not throw', () => {
    const bad = tryRequireModelId('gemini-3.8-flash-lite', 'qaGen');
    expect('error' in bad).toBe(true);
    if ('error' in bad) expect(bad.error).toMatch(/not available/);
    const good = tryRequireModelId('gemini-3.8-flash', 'qaGen');
    expect(good).toEqual({ id: 'gemini-3.8-flash' });
  });

  it('searchIndex resolves models through the safe variant (it crashed the process once)', () => {
    const src = read('server/routes/searchIndex.ts');
    expect(src).toContain('tryRequireModelId(');
    expect(src).not.toMatch(/const (qaModel|embedModel) = requireModelId/);
    expect(src).toContain("res.status(400).json({ error:");
  });
});
