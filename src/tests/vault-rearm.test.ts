/**
 * design 25 client side — the tab-held rearm key + the shared lock signal.
 *
 * Pure unit tests: the transport is INJECTED (no network), no server needed.
 * (Phase 6: vaultReArm no longer imports gateway/api — the transport comes in
 * via setVaultReArmTransport, so the fake is wired through that seam now.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({ fail: false as boolean | number }));

const {
  rememberReArmKey,
  getReArmKey,
  forgetReArmKey,
  tryReArmVault,
  setVaultReArmTransport,
  isVaultLocked,
  setVaultLocked,
  subscribeVaultLock,
} = await import('../data/vaultReArm');

setVaultReArmTransport(async (_path: string, init?: RequestInit) => {
  if (typeof mockState.fail === 'number') return { ok: false, status: mockState.fail } as Response;
  if (mockState.fail === true) throw new Error('offline');
  expect(init?.body).toBeTruthy();
  return { ok: true, status: 200 } as Response;
});

describe('vaultReArm — the tab-held derived key', () => {
  beforeEach(() => {
    forgetReArmKey();
    setVaultLocked(false);
  });

  it('only accepts a 64-hex-char key and keeps it in RAM', () => {
    const hex = 'a'.repeat(64);
    rememberReArmKey(hex);
    expect(getReArmKey()).toBe(hex);

    rememberReArmKey('zz'.repeat(32)); // not hex → invalid input clears
    expect(getReArmKey()).toBe(null);

    rememberReArmKey(hex);
    rememberReArmKey(undefined);
    expect(getReArmKey()).toBe(null);
  });

  it('tryReArmVault POSTs the key and reports success; a rejection forgets the key', async () => {
    rememberReArmKey('b'.repeat(64));

    mockState.fail = false;
    await expect(tryReArmVault()).resolves.toBe(true);

    mockState.fail = 401; // manual lock elsewhere / password changed
    await expect(tryReArmVault()).resolves.toBe(false);
    expect(getReArmKey()).toBe(null); // dead secret never retried

    mockState.fail = true; // offline — key kept for the next tick
    rememberReArmKey('c'.repeat(64));
    await expect(tryReArmVault()).resolves.toBe(false);
    expect(getReArmKey()).toBe('c'.repeat(64));
  });
});

describe('vaultLockBus — one shared lock signal', () => {
  beforeEach(() => {
    setVaultLocked(false);
  });

  it('notifies subscribers only on change, and unsubscribe works', () => {
    const seen: boolean[] = [];
    const unsub = subscribeVaultLock(() => seen.push(isVaultLocked()));
    setVaultLocked(true);
    setVaultLocked(true); // no change → no notification
    setVaultLocked(false);
    unsub();
    setVaultLocked(true);
    expect(seen).toEqual([true, false]);
    setVaultLocked(false);
  });
});