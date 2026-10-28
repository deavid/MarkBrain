/**
 * design 25 §1.1 — send pre-flight: never attempt a send that cannot work.
 *
 * "No API key configured" is a SECOND blocked state beside the locked vault.
 * With no keys, the user used to get a FAILED draft; now the composer routes
 * them to Model Settings → Keys before anything is attempted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mode: 'local' | 'vps' | null = 'vps';
vi.mock('../services/workspaceSession', () => ({
  getWorkspaceMode: () => mode,
}));
vi.mock('../data/keySlots', () => ({
  // local mode: gemini free key present only when this flag is set
  resolveLaneKey: () => (localHasKey ? { keySlot: 'gemini-free', provider: 'gemini', apiKey: 'k' } : null),
}));
vi.mock('../data/vaultReArm', () => ({
  isVaultLocked: () => vaultLocked,
}));
vi.mock('../services/persistenceService', () => ({
  isCaptureMode: () => captureMode,
}));

let vaultLocked = false;
let localHasKey = false;
let captureMode = false;

const { setServerKeySnapshot, resetServerKeySnapshot, isKeyConfiguredForModel, evaluateSendReadiness } =
  await import('../data/sendReadiness');

describe('sendReadiness — the composer pre-flight', () => {
  beforeEach(() => {
    vaultLocked = false;
    localHasKey = false;
    captureMode = false;
    mode = 'vps';
    resetServerKeySnapshot();
  });

  it('VPS: keys configured per provider + tier law (paid tier needs the paid key)', () => {
    setServerKeySnapshot({
      keys: { 'gemini-free': { configured: true }, 'gemini-paid': { configured: false }, 'openrouter-free': { configured: false }, 'openrouter-paid': { configured: false } },
      chatTier: 'free',
      vaultUnlocked: true,
    });
    expect(isKeyConfiguredForModel('gemini-3.5-flash-lite')).toBe(true);
    expect(isKeyConfiguredForModel('nvidia/nemotron:free')).toBe(false); // no openrouter key

    setServerKeySnapshot({
      keys: { 'gemini-free': { configured: true }, 'gemini-paid': { configured: true } },
      chatTier: 'paid',
    });
    expect(isKeyConfiguredForModel('gemini-3.5-flash-lite')).toBe(true);
    setServerKeySnapshot({
      keys: { 'gemini-free': { configured: true }, 'gemini-paid': { configured: false } },
      chatTier: 'paid',
    });
    expect(isKeyConfiguredForModel('gemini-3.5-flash-lite')).toBe(false); // paid tier, no paid key
  });

  it('VPS: unknown snapshot never gates on guesses; locked vault wins over everything', () => {
    expect(evaluateSendReadiness('gemini-3.5-flash-lite')).toEqual({ ok: true, reason: null });

    setServerKeySnapshot({ keys: { 'gemini-free': { configured: true } }, chatTier: 'free' });
    vaultLocked = true;
    expect(evaluateSendReadiness('gemini-3.5-flash-lite')).toEqual({ ok: false, reason: 'vault-locked' });
    vaultLocked = false;
  });

  it('local: resolveLaneKey decides; blocked reasons route the composer', () => {
    mode = 'local';
    expect(evaluateSendReadiness('gemini-3.5-flash-lite')).toEqual({ ok: false, reason: 'no-key' });
    localHasKey = true;
    expect(evaluateSendReadiness('gemini-3.5-flash-lite')).toEqual({ ok: true, reason: null });
  });
});
describe('sendReadiness — capture mode (fixture stream needs no key)', () => {
  beforeEach(() => {
    vaultLocked = true;
    localHasKey = false;
    captureMode = true;
    mode = 'local';
    resetServerKeySnapshot();
  });

  it('is ready with no key and a locked vault — the fake stream has no preconditions', () => {
    expect(evaluateSendReadiness('gemini-3.5-flash-lite')).toEqual({ ok: true, reason: null });
  });
});
