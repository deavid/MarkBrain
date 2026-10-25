/**
 * The chat slot is the single source of truth (design-docs/16) — the bug this
 * pins (David, 2026-10-25): the Model Settings popup showed Gemini 3.8 while
 * the sidebar and every send used 3.5. Two stores existed: the popup wrote
 * `markbrain:modelConfig` and sends read a stale React `selectedModel`.
 *
 * Law: every read of the chat lane resolves through resolveChatModelOption,
 * which reads the slot per call. And a model is NEVER silently swapped for a
 * different one — an unknown id goes out as-is.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_MODEL_SLOTS,
  resolveChatModelOption,
  saveModelConfig,
} from '../data/modelConfig';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function stubWindow(seed: Record<string, string> = {}) {
  const storage = new Map(Object.entries(seed));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  });
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const CATALOG = [
  { id: 'gemini-3.5-flash-lite', name: 'Google: Gemini 3.5 Flash Lite' },
  { id: 'gemini-3.8-flash-lite', name: 'Google: Gemini 3.8 Flash Lite' },
];
const FALLBACK = { id: 'gemini-3.5-flash-lite', name: 'Google: Gemini 3.5 Flash Lite' };

describe('the chat slot wins — settings and sends can never disagree', () => {
  it('picking 3.8 in the popup means the next request uses 3.8', () => {
    stubWindow();
    saveModelConfig({ ...DEFAULT_MODEL_SLOTS, chat: 'gemini-3.8-flash-lite' });
    const resolved = resolveChatModelOption(CATALOG, FALLBACK);
    expect(resolved.id).toBe('gemini-3.8-flash-lite');
  });

  it('reads the slot per call — a change applies without any reload/state sync', () => {
    stubWindow();
    saveModelConfig({ ...DEFAULT_MODEL_SLOTS, chat: 'gemini-3.5-flash-lite' });
    expect(resolveChatModelOption(CATALOG, FALLBACK).id).toBe('gemini-3.5-flash-lite');
    saveModelConfig({ ...DEFAULT_MODEL_SLOTS, chat: 'gemini-3.8-flash-lite' });
    expect(resolveChatModelOption(CATALOG, FALLBACK).id).toBe('gemini-3.8-flash-lite');
  });

  it('never silently swaps: an unknown slot id is sent as-is, not replaced by the fallback', () => {
    stubWindow();
    saveModelConfig({ ...DEFAULT_MODEL_SLOTS, chat: 'gemini-9.9-mystery' });
    const resolved = resolveChatModelOption(CATALOG, FALLBACK);
    expect(resolved.id).toBe('gemini-9.9-mystery');
    expect(resolved.id).not.toBe(FALLBACK.id);
  });

  it('an unset slot falls back honestly', () => {
    stubWindow();
    expect(resolveChatModelOption(CATALOG, FALLBACK).id).toBe(FALLBACK.id);
  });
});

describe('wiring: the app resolves the chat lane through the slot', () => {
  it('getContext and the sidebar display both call resolveChatModelOption', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    const getContextBlock = app.slice(app.indexOf('getContext:'), app.indexOf('getContext:') + 400);
    expect(getContextBlock).toContain('resolveChatModelOption');
    expect(app).toContain('selectedModel={resolveChatModelOption(');
    // The stale snapshot must not come back as the request model.
    expect(getContextBlock).not.toContain('model: selectedModel');
  });

  it('the title lane honors its slot too', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain("titleThread({ messages, version, model: getModelForSlot('title') })");
  });
});
