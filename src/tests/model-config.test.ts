/**
 * modelConfig — capability-slot model selection (design-docs/16 §3.1).
 * Same contract as searchConfig: junk falls back per-slot, default state is
 * the ABSENCE of the localStorage key, and the slot read is per-call so a
 * settings change lands on the very next request.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getScopedStorageKey } from '../services/workspaceSession';
import {
  DEFAULT_MODEL_SLOTS,
  MODEL_CONFIG_KEY,
  MODEL_SLOTS,
  getModelForSlot,
  loadModelConfig,
  normalizeModelConfig,
  saveModelConfig,
} from '../data/modelConfig';

function stubWindow(seed: Record<string, string> = {}) {
  const storage = new Map(Object.entries(seed));
  vi.stubGlobal('window', {
    location: { search: '' },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
    },
  });
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('modelConfig defaults', () => {
  it('pins infrastructure lanes to the free-quota models, chat to flash-lite', () => {
    expect(DEFAULT_MODEL_SLOTS.chat).toBe('gemini-3.5-flash-lite');
    expect(DEFAULT_MODEL_SLOTS.embed).toBe('gemini-embedding-001');
    expect(DEFAULT_MODEL_SLOTS.tts).toBe('gemini-3.8-flash-lite-tts');
    // workhorse lanes share the chat default in Phase 0
    expect(DEFAULT_MODEL_SLOTS.extract).toBe('gemini-3.5-flash-lite');
    expect(DEFAULT_MODEL_SLOTS.summarize).toBe('gemini-3.5-flash-lite');
    expect(DEFAULT_MODEL_SLOTS.qaGen).toBe('gemini-3.5-flash-lite');
    expect(DEFAULT_MODEL_SLOTS.title).toBe('gemini-3.5-flash-lite');
  });

  it('declares exactly the seven lanes of design-docs/16 §3.1', () => {
    expect([...MODEL_SLOTS]).toEqual([
      'chat',
      'extract',
      'summarize',
      'qaGen',
      'title',
      'embed',
      'tts',
    ]);
  });
});

describe('normalizeModelConfig', () => {
  it('keeps valid ids and drops junk per-slot, never wholesale', () => {
    const out = normalizeModelConfig({
      chat: 'gemini-3.8-flash',
      embed: 'not a model id!!!',
      tts: '',
    });
    expect(out.chat).toBe('gemini-3.8-flash');
    expect(out.embed).toBe(DEFAULT_MODEL_SLOTS.embed); // junk → default
    expect(out.tts).toBe(DEFAULT_MODEL_SLOTS.tts); // empty → default
  });

  it('falls back to defaults for non-objects and for every non-string slot', () => {
    expect(normalizeModelConfig(null)).toEqual(DEFAULT_MODEL_SLOTS);
    expect(normalizeModelConfig('gemini-3.8-flash')).toEqual(DEFAULT_MODEL_SLOTS);
    expect(
      normalizeModelConfig({ chat: 42, extract: { id: 'x' }, summarize: true })
    ).toEqual(DEFAULT_MODEL_SLOTS);
  });

  it('rejects model ids with spaces or leading punctuation (XSS/path hygiene)', () => {
    const out = normalizeModelConfig({
      chat: ' gemini-3.8-flash',
      extract: '<script>alert(1)</script>',
      summarize: '/etc/passwd',
    });
    expect(out.chat).toBe(DEFAULT_MODEL_SLOTS.chat);
    expect(out.extract).toBe(DEFAULT_MODEL_SLOTS.extract);
    expect(out.summarize).toBe(DEFAULT_MODEL_SLOTS.summarize);
  });

  it('accepts OpenRouter-style ids with slashes and colons', () => {
    const out = normalizeModelConfig({
      chat: 'openai/gpt-5',
      extract: 'anthropic/claude-sonnet-4.5',
    });
    expect(out.chat).toBe('openai/gpt-5');
    expect(out.extract).toBe('anthropic/claude-sonnet-4.5');
  });
});

describe('loadModelConfig', () => {
  it('returns defaults when the key is absent — default state is key absence', () => {
    stubWindow();
    expect(loadModelConfig()).toEqual(DEFAULT_MODEL_SLOTS);
  });

  it('round-trips a saved config through localStorage', () => {
    stubWindow();
    const cfg = { ...DEFAULT_MODEL_SLOTS, chat: 'gemini-3.8-flash', embed: 'some-embed-model' };
    saveModelConfig(cfg);
    expect(loadModelConfig()).toEqual(cfg);
  });

  it('removes the key when the config returns to defaults', () => {
    const storage = stubWindow({
      [getScopedStorageKey(MODEL_CONFIG_KEY)]: JSON.stringify({ ...DEFAULT_MODEL_SLOTS, chat: 'gemini-3.8-flash' }),
    });
    saveModelConfig(DEFAULT_MODEL_SLOTS);
    expect(storage.has(getScopedStorageKey(MODEL_CONFIG_KEY))).toBe(false);
    expect(loadModelConfig()).toEqual(DEFAULT_MODEL_SLOTS);
  });

  it('survives malformed JSON without throwing', () => {
    stubWindow({ [getScopedStorageKey(MODEL_CONFIG_KEY)]: '{not json' });
    expect(loadModelConfig()).toEqual(DEFAULT_MODEL_SLOTS);
  });
});

describe('getModelForSlot', () => {
  it('reads the live slot per call — a save lands immediately', () => {
    stubWindow();
    expect(getModelForSlot('chat')).toBe(DEFAULT_MODEL_SLOTS.chat);
    saveModelConfig({ ...DEFAULT_MODEL_SLOTS, chat: 'gemini-3.8-flash' });
    expect(getModelForSlot('chat')).toBe('gemini-3.8-flash');
  });

  it('degrades to defaults with no window at all', () => {
    vi.unstubAllGlobals();
    expect(getModelForSlot('tts')).toBe(DEFAULT_MODEL_SLOTS.tts);
    expect(loadModelConfig()).toEqual(DEFAULT_MODEL_SLOTS);
  });
});
