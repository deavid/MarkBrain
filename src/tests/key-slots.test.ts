/**
 * keySlots — credential dispatch behind the mode split (design-docs/16 D8/D9,
 * 21C §2.2).
 *
 * Pins:
 * - local mode reads/writes ONLY through the WebCrypto passphrase vault —
 *   plaintext `markbrain:keys:*` storage is dead (leftovers never sign).
 * - vps mode never holds raw keys on the client: resolveLaneKey is always
 *   null so every call routes through /api/*.
 * - keys optional (D9), empty slots store nothing, lane binding never
 *   crosses providers, keys never leak into anything export-shaped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import {
  createOrResetLocalVault,
  unlockLocalVault,
  destroyLocalVault,
  lockLocalVault,
  sealLocalVault,
  hasSavedLocalVault,
  setPbkdf2IterationsForTests,
  setVaultChatTier,
} from '../data/localKeyVault';
import { setWorkspaceMode, clearWorkspaceMode, saveVpsSession, clearVpsSession } from '../services/workspaceSession';

const PASS = 'test-pass-1234';

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
    location: { origin: 'http://localhost:3030' },
  });
  return storage;
}

async function freshVault(seed: Record<string, string> = {}) {
  const storage = stubWindow(seed);
  await createOrResetLocalVault(PASS);
  return storage;
}

beforeEach(() => {
  setPbkdf2IterationsForTests(1000);
});

afterEach(() => {
  destroyLocalVault();
  clearWorkspaceMode();
  clearVpsSession();
  vi.unstubAllGlobals();
});

describe('key slots are optional (D9)', () => {
  it('boots with no keys at all', async () => {
    stubWindow();
    expect(anyKeyConfigured()).toBe(false);
    expect(listFilledKeySlots()).toEqual([]);
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')).toBeNull();
    expect(resolveLaneKey('tts', 'gemini-3.8-flash-lite-tts')).toBeNull();
    expect(resolveLaneKey('chat', 'openai/gpt-5')).toBeNull();
  });

  it('empty or whitespace-only writes clear the slot and store nothing', async () => {
    const storage = await freshVault();
    setKeySlot('gemini-free', 'AIza-old');
    expect(getKeySlot('gemini-free')).toBe('AIza-old');
    setKeySlot('gemini-free', '   ');
    expect(getKeySlot('gemini-free')).toBeNull();
    // Plaintext slot names never appear — the vault envelope is the only record.
    expect(storage.has('markbrain:keys:gemini-free')).toBe(false);
    expect(hasSavedLocalVault()).toBe(true);

    setKeySlot('gemini-paid', '');
    expect(getKeySlot('gemini-paid')).toBeNull();
  });

  it('trims pasted keys but stores them verbatim otherwise', async () => {
    await freshVault();
    setKeySlot('openrouter-free', '  sk-or-abc123  ');
    expect(getKeySlot('openrouter-free')).toBe('sk-or-abc123');
  });
});

describe('lane binding never crosses providers', () => {
  it('routes gemini models to gemini keys only', async () => {
    await freshVault();
    setKeySlot('openrouter-free', 'sk-or-abc');
    expect(providerOfModel('gemini-3.8-flash')).toBe('gemini');
    expect(resolveLaneKey('chat', 'gemini-3.8-flash')).toBeNull(); // OR key cannot sign it
  });

  it('routes slash-shaped ids to openrouter', async () => {
    await freshVault();
    setKeySlot('gemini-free', 'AIza-x');
    expect(providerOfModel('openai/gpt-5')).toBe('openrouter');
    expect(resolveLaneKey('chat', 'openai/gpt-5')).toBeNull(); // gemini key cannot sign it
  });

  it('auto prefers the free slot before paid', async () => {
    await freshVault();
    setKeySlot('gemini-free', 'AIza-free');
    setKeySlot('gemini-paid', 'AIza-paid');
    const resolved = resolveLaneKey('chat', 'gemini-3.5-flash-lite');
    expect(resolved?.keySlot).toBe('gemini-free');
  });

  it('an explicit lane binding beats auto, and falls through when empty', async () => {
    const storage = await freshVault();
    setKeySlot('gemini-free', 'AIza-free');
    setKeySlot('gemini-paid', 'AIza-paid');
    setLaneKey('chat', 'gemini-paid');
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')?.keySlot).toBe('gemini-paid');

    // Paid key cleared → auto/in-order picks the free one rather than nothing.
    setKeySlot('gemini-paid', null);
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')?.keySlot).toBe('gemini-free');

    // A binding for the wrong provider is ignored entirely.
    setLaneKey('extract', 'openrouter-free');
    expect(resolveLaneKey('extract', 'gemini-3.5-flash-lite')?.keySlot).toBe('gemini-free');
    expect(storage.has('markbrain:laneKeys')).toBe(true);
  });

  it('auto never leaks a key from the other provider', async () => {
    await freshVault();
    setKeySlot('openrouter-free', 'sk-or-abc');
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
  it('declares exactly the four slots of D8 + design 24 (OpenRouter split free/paid)', () => {
    expect([...KEY_SLOTS]).toEqual(['gemini-free', 'gemini-paid', 'openrouter-free', 'openrouter-paid']);
  });
});

describe('OpenRouter tier order mirrors the Gemini law (design 24 §2)', () => {
  it('FREE tier auto-picks openrouter-free before openrouter-paid', async () => {
    await freshVault();
    setKeySlot('openrouter-free', 'sk-or-free');
    setKeySlot('openrouter-paid', 'sk-or-paid');
    expect(resolveLaneKey('chat', 'nvidia/nemotron-3.5-lightning:free')?.keySlot).toBe('openrouter-free');
  });

  it('PAID tier auto-picks openrouter-paid on every OpenRouter lane', async () => {
    await freshVault();
    setKeySlot('openrouter-free', 'sk-or-free');
    setKeySlot('openrouter-paid', 'sk-or-paid');
    await setVaultChatTier('paid');
    for (const model of ['nvidia/nemotron-3.5-lightning:free', 'z-ai/glm-5.3-flash', 'openai/gpt-5']) {
      expect(resolveLaneKey('chat', model)?.keySlot, model).toBe('openrouter-paid');
    }
  });

  it('PAID tier with an empty paid slot falls back to the free key', async () => {
    await freshVault();
    setKeySlot('openrouter-free', 'sk-or-free');
    await setVaultChatTier('paid');
    expect(resolveLaneKey('chat', 'nvidia/nemotron-3.5-lightning:free')?.keySlot).toBe('openrouter-free');
  });

  it('FREE tier with only the paid slot filled falls back to it', async () => {
    await freshVault();
    setKeySlot('openrouter-paid', 'sk-or-paid');
    await setVaultChatTier('free');
    expect(resolveLaneKey('chat', 'nvidia/nemotron-3.5-lightning:free')?.keySlot).toBe('openrouter-paid');
  });

  it('the tier order never leaks across providers', async () => {
    await freshVault();
    setKeySlot('openrouter-free', 'sk-or-free');
    setKeySlot('openrouter-paid', 'sk-or-paid');
    await setVaultChatTier('paid');
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')).toBeNull();
  });
});

describe('mode isolation (21C §2.2)', () => {
  it('plaintext markbrain:keys:* leftovers NEVER sign — vault RAM is the only source', async () => {
    stubWindow({
      'markbrain:keys:gemini-free': 'AIzaLEFTOVER-JUNK',
      'markbrain:keys:openrouter-free': 'sk-or-LEFTOVER',
      'markbrain:laneKeys': JSON.stringify({ chat: 'gemini-free' }),
    });
    expect(getKeySlot('gemini-free')).toBeNull();
    expect(getKeySlot('openrouter-free')).toBeNull();
    expect(listFilledKeySlots()).toEqual([]);
    expect(anyKeyConfigured()).toBe(false);
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')).toBeNull();
  });

  it('locked vault reads as empty until unlocked (isLocalVaultLockedError path)', async () => {
    await freshVault();
    setKeySlot('gemini-free', 'AIza-free');
    await sealLocalVault(); // deterministic envelope before the "reload"
    // Simulate reload: vault envelope on disk, RAM gone.
    lockLocalVault();
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')).toBeNull();
    const ok = await unlockLocalVault(PASS);
    expect(ok).toBe(true);
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')?.apiKey).toBe('AIza-free');
  });

  it('vps mode: resolveLaneKey is always null — the browser never holds raw keys', async () => {
    const storage = await freshVault();
    setKeySlot('gemini-free', 'AIza-free'); // even a filled local vault…
    setWorkspaceMode('vps');
    saveVpsSession({
      baseUrl: '',
      token: 'tok',
      userId: 1,
      email: 'owner@example.com',
      isOwner: true,
      vaultUnlocked: true,
    });
    expect(getKeySlot('gemini-free')).toBeNull();
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')).toBeNull();
    expect(resolveLaneKey('chat', 'openai/gpt-5')).toBeNull();
    void storage;
  });
});
