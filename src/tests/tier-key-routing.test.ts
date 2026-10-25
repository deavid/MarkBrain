/**
 * Key tier routing (David's bug report, 2026-10-25): CHAT TIER = PAID must
 * route EVERY Gemini lane — chat, extract, summarize, title, qaGen, embed,
 * tts — to the paid key. The chat-only reading made embeddings burn the free
 * quota while chat alone ran paid (the bug that forced the paid key into the
 * FREE slot). FREE tier prefers the free key with paid as fallback.
 *
 * Covers the server resolver (`resolveServerLaneKey`) AND the Local-mode
 * auto-order (`resolveLaneKey`) — the same law in both modes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initDb, closeDbForTests, getDb } from '../../server/db';

initDb(':memory:');

const FREE_KEY = 'AIzaFREE000000000000000000000000000';
const PAID_KEY = 'AIzaPAID111111111111111111111111111';
const OR_KEY = 'sk-or-OPEN22222222222222222222222222';

const { createUser, findUserByEmail } = await import('../../server/lib/users');
const { unlockVaultWithPassword, writeKeysPayload, readKeysPayload, resolveServerLaneKey, NoKeyError } = await import(
  '../../server/lib/accountVault'
);

const ALL_GEMINI_LANES = ['chat', 'extract', 'summarize', 'title', 'qaGen', 'embed', 'tts'] as const;

let userId = 0;

function setTier(tier: 'free' | 'paid'): void {
  getDb()
    .prepare(
      `INSERT INTO user_settings (user_id, model_slots_json, chat_tier, updated_at) VALUES (?, '{}', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET chat_tier = excluded.chat_tier, updated_at = excluded.updated_at`
    )
    .run(userId, tier, Date.now());
}

function seedKeys(free: string | null, paid: string | null, openrouter: string | null = null): void {
  const payload: Record<string, string | undefined> = {};
  if (free) payload['gemini-free'] = free;
  if (paid) payload['gemini-paid'] = paid;
  if (openrouter) payload.openrouter = openrouter;
  // writeKeysPayload replaces wholesale — exactly the PUT /api/account/keys shape.
  writeKeysPayload(userId, payload as never);
}

beforeEach(() => {
  if (userId === 0) {
    const user = createUser('owner@example.com', 'tier-test-pass-123', { isOwner: true });
    userId = user.id;
    unlockVaultWithPassword(userId, 'tier-test-pass-123');
  }
});

afterAll(() => {
  closeDbForTests();
});

import { afterAll } from 'vitest';

describe('server: tier is account-wide (every Gemini lane)', () => {
  it('PAID tier → every lane (chat, extract, summarize, title, qaGen, embed, tts) gets the PAID key', () => {
    seedKeys(FREE_KEY, PAID_KEY);
    setTier('paid');
    for (const lane of ALL_GEMINI_LANES) {
      expect(resolveServerLaneKey(userId, lane, 'gemini-embedding-001'), lane).toBe(PAID_KEY);
    }
  });

  it('FREE tier → every lane prefers the FREE key (the generous-quota key)', () => {
    seedKeys(FREE_KEY, PAID_KEY);
    setTier('free');
    for (const lane of ALL_GEMINI_LANES) {
      expect(resolveServerLaneKey(userId, lane, 'gemini-3.5-flash-lite'), lane).toBe(FREE_KEY);
    }
  });

  it('PAID tier with an empty paid slot falls back to the free key (never a crash)', () => {
    seedKeys(FREE_KEY, null);
    setTier('paid');
    for (const lane of ALL_GEMINI_LANES) {
      expect(resolveServerLaneKey(userId, lane, 'gemini-3.5-flash-lite'), lane).toBe(FREE_KEY);
    }
  });

  it('FREE tier with an empty free slot falls back to the paid key', () => {
    seedKeys(null, PAID_KEY);
    setTier('free');
    for (const lane of ALL_GEMINI_LANES) {
      expect(resolveServerLaneKey(userId, lane, 'gemini-3.5-flash-lite'), lane).toBe(PAID_KEY);
    }
  });

  it('OpenRouter models always sign with the openrouter key, tier-independent', () => {
    seedKeys(FREE_KEY, PAID_KEY, OR_KEY);
    setTier('paid');
    expect(resolveServerLaneKey(userId, 'chat', 'openai/gpt-5')).toBe(OR_KEY);
    setTier('free');
    expect(resolveServerLaneKey(userId, 'embed', 'openai/gpt-5')).toBe(OR_KEY);
  });

  it('no keys configured → honest NoKeyError naming the provider', () => {
    seedKeys(null, null);
    setTier('paid');
    for (const lane of ALL_GEMINI_LANES) {
      expect(() => resolveServerLaneKey(userId, lane, 'gemini-3.5-flash-lite'), lane).toThrow(NoKeyError);
    }
  });
});

describe('local mode: the same law in the client auto-order', () => {
  beforeEach(() => {
    setPbkdf2IterationsForTests(1000);
  });

  afterEach(() => {
    destroyLocalVault();
    vi.unstubAllGlobals();
  });

  it('PAID tier auto-picks the paid key on every lane; FREE tier picks free', async () => {
    stubWindow();
    await createOrResetLocalVault('tier-pass-123');
    await setVaultSlot('gemini-free', FREE_KEY);
    await setVaultSlot('gemini-paid', PAID_KEY);

    await setVaultChatTier('paid');
    for (const lane of ['chat', 'extract', 'summarize', 'title', 'qaGen', 'embed', 'tts']) {
      const resolved = resolveLaneKey(lane, lane === 'embed' ? 'gemini-embedding-001' : 'gemini-3.5-flash-lite');
      expect(resolved?.keySlot, lane).toBe('gemini-paid');
    }

    await setVaultChatTier('free');
    for (const lane of ['chat', 'extract', 'summarize', 'title', 'qaGen', 'embed', 'tts']) {
      const resolved = resolveLaneKey(lane, lane === 'embed' ? 'gemini-embedding-001' : 'gemini-3.5-flash-lite');
      expect(resolved?.keySlot, lane).toBe('gemini-free');
    }
  });

  it('an explicit lane binding still wins over the tier preference', async () => {
    stubWindow();
    await createOrResetLocalVault('tier-pass-123');
    await setVaultSlot('gemini-free', FREE_KEY);
    await setVaultSlot('gemini-paid', PAID_KEY);
    await setVaultChatTier('paid');
    setLaneKey('embed', 'gemini-free');
    expect(resolveLaneKey('embed', 'gemini-embedding-001')?.keySlot).toBe('gemini-free');
    setLaneKey('embed', 'auto');
    expect(resolveLaneKey('embed', 'gemini-embedding-001')?.keySlot).toBe('gemini-paid');
  });
});

// local-mode imports + helpers (kept at the bottom for the server block's primacy)
import {
  createOrResetLocalVault,
  destroyLocalVault,
  setVaultSlot,
  setVaultChatTier,
  setPbkdf2IterationsForTests,
} from '../data/localKeyVault';
import { resolveLaneKey, setLaneKey } from '../data/keySlots';

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
    location: { origin: 'http://localhost:3032' },
  });
  return storage;
}
