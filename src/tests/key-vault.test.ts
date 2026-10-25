/**
 * keyVault — Tier 2 credential storage (design-docs/16 §4.2, Phase 3).
 * Pins the security contract: wrong passphrase cannot unlock, locked vault
 * reads keys as absent, plaintext dies at encryption time, and the whole
 * thing is genuine AES-GCM under PBKDF2 — never theatre.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  _resetVaultForTests,
  changePassphrase,
  disableVault,
  enableVault,
  isUnlocked,
  isVaultEnabled,
  lockVault,
  peekSlots,
  saveSlots,
  setSlotInVault,
  unlockVault,
  vaultSupported,
} from '../data/keyVault';
import {
  enableVaultForKeys,
  disableVaultForKeys,
  getKeySlot,
  setKeySlot,
  lockVaultForKeys,
  unlockVaultForKeys,
} from '../data/keySlots';

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

const PASS = 'correct-horse-battery';
const OTHER = 'wrong-passphrase-here';

beforeEach(() => {
  stubWindow();
  _resetVaultForTests();
});

afterEach(() => {
  _resetVaultForTests();
  vi.unstubAllGlobals();
});

describe('vault support', () => {
  it('WebCrypto is available in this environment (Node 22)', () => {
    expect(vaultSupported()).toBe(true);
  });
});

describe('enable / unlock / lock', () => {
  it('encrypts on enable — plaintext key material is not in localStorage', async () => {
    const storage = stubWindow();
    _resetVaultForTests();
    await enableVault(PASS, { 'gemini-free': 'AIza-SECRET-1' });

    const stored = Array.from(storage.entries())
      .map(([, v]) => v)
      .join(' ');
    expect(stored).not.toContain('AIza-SECRET-1');
    expect(stored).toContain('ciphertextB64');

    // …but the unlocked session can still read it.
    expect(peekSlots()).toEqual({ 'gemini-free': 'AIza-SECRET-1' });
  });

  it('rejects a short passphrase rather than pretending to encrypt', async () => {
    await expect(enableVault('short', {})).rejects.toThrow(/at least 8/);
    expect(isVaultEnabled()).toBe(false);
  });

  it('wrong passphrase returns false and leaves the vault locked', async () => {
    await enableVault(PASS, { openrouter: 'sk-or-SECRET-2' });
    lockVault();
    expect(isUnlocked()).toBe(false);

    const ok = await unlockVault(OTHER);
    expect(ok).toBe(false);
    expect(isUnlocked()).toBe(false);
    expect(peekSlots()).toBeNull();
  });

  it('right passphrase unlocks and restores the exact slots', async () => {
    await enableVault(PASS, { 'gemini-paid': 'AIza-PAID-3', openrouter: 'sk-or-3' });
    lockVault();
    const ok = await unlockVault(PASS);
    expect(ok).toBe(true);
    expect(peekSlots()).toEqual({ 'gemini-paid': 'AIza-PAID-3', openrouter: 'sk-or-3' });
  });

  it('lockVault wipes memory — keys read as absent while locked', async () => {
    await enableVault(PASS, { 'gemini-free': 'AIza-4' });
    lockVault();
    expect(peekSlots()).toBeNull();
    expect(isUnlocked()).toBe(false);
  });
});

describe('slot writes while unlocked', () => {
  it('setSlotInVault updates memory immediately and persists encrypted', async () => {
    const storage = stubWindow();
    _resetVaultForTests();
    await enableVault(PASS, {});
    setSlotInVault('gemini-free', 'AIza-NEW-5');
    expect(peekSlots()).toEqual({ 'gemini-free': 'AIza-NEW-5' });
    // allow the async persist to settle
    await new Promise((r) => setTimeout(r, 10));
    const stored = Array.from(storage.values()).join(' ');
    expect(stored).not.toContain('AIza-NEW-5');
    expect(stored).toContain('ciphertextB64');
  });

  it('setSlotInVault refuses when locked — no silent writes', async () => {
    await enableVault(PASS, {});
    lockVault();
    expect(() => setSlotInVault('gemini-free', 'AIza-X')).toThrow(/locked/);
  });

  it('saveSlots replaces the map and empty values delete slots', async () => {
    await enableVault(PASS, { a: 'one', b: 'two' });
    await saveSlots({ a: 'one' });
    expect(peekSlots()).toEqual({ a: 'one' });
    setSlotInVault('a', null);
    expect(peekSlots()).toEqual({});
  });
});

describe('passphrase change and disable', () => {
  it('changePassphrase verifies the old one even when unlocked', async () => {
    await enableVault(PASS, { 'gemini-free': 'AIza-6' });
    await expect(changePassphrase(OTHER, 'new-passphrase-1')).rejects.toThrow(/wrong/);
    // still unlockable with the ORIGINAL passphrase
    lockVault();
    expect(await unlockVault(PASS)).toBe(true);
  });

  it('changePassphrase re-encrypts under the new passphrase', async () => {
    await enableVault(PASS, { 'gemini-free': 'AIza-7' });
    await changePassphrase(PASS, 'second-passphrase!');
    lockVault();
    expect(await unlockVault(PASS)).toBe(false);
    expect(await unlockVault('second-passphrase!')).toBe(true);
    expect(peekSlots()).toEqual({ 'gemini-free': 'AIza-7' });
  });

  it('disableVault hands the slots back and kills the ciphertext config', async () => {
    const storage = stubWindow();
    _resetVaultForTests();
    await enableVault(PASS, { openrouter: 'sk-or-8' });
    const slots = await disableVault(PASS);
    expect(slots).toEqual({ openrouter: 'sk-or-8' });
    expect(isVaultEnabled()).toBe(false);
    expect(storage.has('markbrain:keysVault')).toBe(false);
  });

  it('disableVault with the wrong passphrase throws and changes nothing', async () => {
    await enableVault(PASS, { openrouter: 'sk-or-9' });
    await expect(disableVault(OTHER)).rejects.toThrow(/wrong/);
    expect(isVaultEnabled()).toBe(true);
    expect(isUnlocked()).toBe(true);
  });
});

describe('keySlots façade (what app code touches)', () => {
  it('enableVaultForKeys migrates plaintext slots and removes the plaintext copies', async () => {
    const storage = stubWindow({ 'markbrain:keys:gemini-free': 'AIza-MIGRATE' });
    _resetVaultForTests();
    await enableVaultForKeys(PASS);
    expect(storage.has('markbrain:keys:gemini-free')).toBe(false);
    expect(getKeySlot('gemini-free')).toBe('AIza-MIGRATE');
  });

  it('locked vault → getKeySlot reads absent; unlock restores', async () => {
    stubWindow({ 'markbrain:keys:gemini-free': 'AIza-10' });
    _resetVaultForTests();
    await enableVaultForKeys(PASS);
    lockVaultForKeys();
    expect(getKeySlot('gemini-free')).toBeNull(); // honest degrade (D9)
    expect(await unlockVaultForKeys(PASS)).toBe(true);
    expect(getKeySlot('gemini-free')).toBe('AIza-10');
  });

  it('setKeySlot goes through the vault when enabled', async () => {
    stubWindow();
    _resetVaultForTests();
    await enableVaultForKeys(PASS);
    setKeySlot('openrouter', 'sk-or-THROUGH');
    expect(getKeySlot('openrouter')).toBe('sk-or-THROUGH');
    await new Promise((r) => setTimeout(r, 10));
    // nothing in plaintext storage
    const storage = stubWindow();
    expect(storage.has('markbrain:keys:openrouter')).toBe(false);
  });

  it('disableVaultForKeys restores Tier 1 plaintext storage', async () => {
    const storage = stubWindow({ 'markbrain:keys:gemini-paid': 'AIza-BACK' });
    _resetVaultForTests();
    await enableVaultForKeys(PASS);
    await disableVaultForKeys(PASS);
    expect(storage.get('markbrain:keys:gemini-paid')).toBe('AIza-BACK');
    expect(getKeySlot('gemini-paid')).toBe('AIza-BACK');
  });

  it('without a vault, Tier 1 plaintext behaves exactly as before', () => {
    const storage = stubWindow();
    _resetVaultForTests();
    setKeySlot('gemini-free', '  AIza-T1  ');
    expect(getKeySlot('gemini-free')).toBe('AIza-T1');
    expect(storage.get('markbrain:keys:gemini-free')).toBe('AIza-T1');
    setKeySlot('gemini-free', null);
    expect(storage.has('markbrain:keys:gemini-free')).toBe(false);
    expect(getKeySlot('gemini-free')).toBeNull();
  });
});
