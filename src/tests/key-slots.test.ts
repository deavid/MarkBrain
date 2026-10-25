/**
 * keySlots — BYOK credential storage (design-docs/16 D8/D9, §4.2 Tier 1).
 * Pins: keys optional, empty slots store nothing, lane binding never crosses
 * providers (a gemini model never signs with the OpenRouter key), and keys
 * never leak into anything export-shaped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setByokEnabledForTests } from '../data/byokFlag';
import {
  KEY_SLOTS,
  anyKeyConfigured,
  getKeySlot,
  listFilledKeySlots,
  loadLaneKeys,
  providerOfModel,
  resolveLaneKey,
  setKeySlot,
  setLaneKey,
} from '../data/keySlots';

function stubWindow(seed: Record<string, string> = {}) {
  const storage = new Map(Object.entries(seed));
  vi.stubGlobal('window', {
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

beforeEach(() => {
  setByokEnabledForTests(true); // the behavioral suite runs with BYOK on
});

afterEach(() => {
  setByokEnabledForTests(false);
  vi.unstubAllGlobals();
});

describe('key slots are optional (D9)', () => {
  it('boots with no keys at all', () => {
    stubWindow();
    expect(anyKeyConfigured()).toBe(false);
    expect(listFilledKeySlots()).toEqual([]);
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')).toBeNull();
    expect(resolveLaneKey('tts', 'gemini-3.8-flash-lite-tts')).toBeNull();
    expect(resolveLaneKey('chat', 'openai/gpt-5')).toBeNull();
  });

  it('empty or whitespace-only writes clear the slot and store nothing', () => {
    const storage = stubWindow({ 'markbrain:keys:gemini-free': 'AIza-old' });
    setKeySlot('gemini-free', '   ');
    expect(getKeySlot('gemini-free')).toBeNull();
    expect(storage.has('markbrain:keys:gemini-free')).toBe(false);

    setKeySlot('gemini-paid', '');
    expect(storage.has('markbrain:keys:gemini-paid')).toBe(false);
  });

  it('trims pasted keys but stores them verbatim otherwise', () => {
    stubWindow();
    setKeySlot('openrouter', '  sk-or-abc123  ');
    expect(getKeySlot('openrouter')).toBe('sk-or-abc123');
  });
});

describe('lane binding never crosses providers', () => {
  it('routes gemini models to gemini keys only', () => {
    stubWindow({ 'markbrain:keys:openrouter': 'sk-or-abc' });
    expect(providerOfModel('gemini-3.8-flash')).toBe('gemini');
    expect(resolveLaneKey('chat', 'gemini-3.8-flash')).toBeNull(); // OR key cannot sign it
  });

  it('routes slash-shaped ids to openrouter', () => {
    stubWindow({ 'markbrain:keys:gemini-free': 'AIza-x' });
    expect(providerOfModel('openai/gpt-5')).toBe('openrouter');
    expect(resolveLaneKey('chat', 'openai/gpt-5')).toBeNull(); // gemini key cannot sign it
  });

  it('auto prefers the free slot before paid', () => {
    stubWindow({
      'markbrain:keys:gemini-free': 'AIza-free',
      'markbrain:keys:gemini-paid': 'AIza-paid',
    });
    const resolved = resolveLaneKey('chat', 'gemini-3.5-flash-lite');
    expect(resolved?.keySlot).toBe('gemini-free');
  });

  it('an explicit lane binding beats auto, and falls through when empty', () => {
    const storage = stubWindow({
      'markbrain:keys:gemini-free': 'AIza-free',
      'markbrain:keys:gemini-paid': 'AIza-paid',
    });
    setLaneKey('chat', 'gemini-paid');
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')?.keySlot).toBe('gemini-paid');

    // Paid key cleared → auto/in-order picks the free one rather than nothing.
    setKeySlot('gemini-paid', null);
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')?.keySlot).toBe('gemini-free');

    // A binding for the wrong provider is ignored entirely.
    setLaneKey('extract', 'openrouter');
    expect(resolveLaneKey('extract', 'gemini-3.5-flash-lite')?.keySlot).toBe('gemini-free');
    expect(storage.has('markbrain:laneKeys')).toBe(true);
  });

  it('auto never leaks a key from the other provider', () => {
    stubWindow({ 'markbrain:keys:openrouter': 'sk-or-abc' });
    expect(resolveLaneKey('embed', 'gemini-embedding-001')).toBeNull();
  });
});

describe('lane binding persistence', () => {
  it('drops junk and round-trips valid choices', () => {
    stubWindow({ 'markbrain:laneKeys': JSON.stringify({ chat: 'gemini-paid', bogus: 'x', title: 42 }) });
    expect(loadLaneKeys()).toEqual({ chat: 'gemini-paid' });
  });

  it('reset-to-auto removes the key entirely', () => {
    const storage = stubWindow();
    setLaneKey('summarize', 'gemini-paid');
    expect(storage.has('markbrain:laneKeys')).toBe(true);
    setLaneKey('summarize', 'auto');
    expect(storage.has('markbrain:laneKeys')).toBe(false);
  });
});

describe('key slot inventory', () => {
  it('declares exactly the three slots of D8', () => {
    expect([...KEY_SLOTS]).toEqual(['gemini-free', 'gemini-paid', 'openrouter']);
  });
});

describe('flag off = BYOK does not exist (David 2026-10-25)', () => {
  afterEach(() => {
    setByokEnabledForTests(false);
    vi.unstubAllGlobals();
  });

  it('stored leftovers act as EMPTY — a hidden key must not keep signing requests', () => {
    setByokEnabledForTests(false);
    stubWindow({
      'markbrain:keys:gemini-free': 'AIzaLEFTOVER-JUNK',
      'markbrain:keys:openrouter': 'sk-or-LEFTOVER',
      'markbrain:laneKeys': JSON.stringify({ chat: 'gemini-free' }),
    });
    expect(getKeySlot('gemini-free')).toBeNull();
    expect(getKeySlot('openrouter')).toBeNull();
    expect(listFilledKeySlots()).toEqual([]);
    expect(anyKeyConfigured()).toBe(false);
    // ...and nothing resolves to a signing key: everything goes through the
    // server, exactly as the UI says ("the server owner's key").
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')).toBeNull();
    expect(resolveLaneKey('chat', 'openrouter/auto')).toBeNull();
    expect(loadLaneKeys()).toEqual({});
  });

  it('writes are ignored while the flag is off — no silent storage', () => {
    setByokEnabledForTests(false);
    const store = stubWindow();
    setKeySlot('gemini-free', 'AIzaNEW');
    setLaneKey('chat', 'gemini-paid');
    expect(store.get('markbrain:keys:gemini-free')).toBeUndefined();
    expect(store.get('markbrain:laneKeys')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('the leftovers are still there when the flag comes back on (inert, not destroyed)', () => {
    stubWindow({ 'markbrain:keys:gemini-free': 'AIzaLEFTOVER-JUNK' });
    setByokEnabledForTests(false);
    expect(getKeySlot('gemini-free')).toBeNull();
    setByokEnabledForTests(true);
    expect(getKeySlot('gemini-free')).toBe('AIzaLEFTOVER-JUNK');
  });
});
