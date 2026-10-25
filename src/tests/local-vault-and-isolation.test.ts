/**
 * Phase 3 — local vault + mode isolation (design-docs/21C §6).
 *
 * 1. Zero plaintext on disk: a saved key never appears in localStorage.
 * 2. RAM-only lifetime: lock kills resolveLaneKey, envelope survives,
 *    wrong passphrase fails, right passphrase restores.
 * 3. Namespace isolation: local:* storage is invisible from vps:* and back.
 * 4. Routing separation: vps → /api/* + Bearer, never direct; local →
 *    browser-direct with the unlocked RAM key.
 *
 * All network access is stubbed — no provider or server is ever contacted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LOCAL_VAULT_KEY,
  createOrResetLocalVault,
  setVaultSlot,
  sealLocalVault,
  lockLocalVault,
  unlockLocalVault,
  destroyLocalVault,
  isLocalVaultLockedError,
  setPbkdf2IterationsForTests,
} from '../data/localKeyVault';
import { resolveLaneKey, setKeySlot } from '../data/keySlots';
import {
  setWorkspaceMode,
  clearWorkspaceMode,
  saveVpsSession,
  clearVpsSession,
  getScopedStorageKey,
  WORKSPACE_MODE_KEY,
} from '../services/workspaceSession';
import { loadModelConfig, saveModelConfig, DEFAULT_MODEL_SLOTS, MODEL_CONFIG_KEY } from '../data/modelConfig';
import { chatStream } from '../gateway/api';

const PASS = 'correct-horse-battery';
const SECRET_KEY = 'AIzaSySecretKey12345678901234567890';

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
    location: { origin: 'http://localhost:3030', search: '' },
  });
  return storage;
}

interface RecordedFetch {
  url: string;
  authorization: string | undefined;
}

function stubFetchRecorder(): RecordedFetch[] {
  const calls: RecordedFetch[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url: String(input),
        authorization: headers.Authorization ?? headers.authorization,
      });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    })
  );
  return calls;
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

describe('1 — zero plaintext on disk', () => {
  it('a saved key never appears anywhere in localStorage', async () => {
    const storage = stubWindow();
    await createOrResetLocalVault(PASS);
    setKeySlot('gemini-free', SECRET_KEY);
    await sealLocalVault();

    const dump = [...storage.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
    expect(dump).not.toContain(SECRET_KEY);
    expect(dump).not.toContain('AIzaSy'); // no fragment of the key leaks

    const envelopeRaw = storage.get(LOCAL_VAULT_KEY);
    expect(envelopeRaw).toBeTruthy();
    const envelope = JSON.parse(envelopeRaw!);
    expect(envelope.version).toBe(1);
    expect(typeof envelope.saltHex).toBe('string');
    expect(typeof envelope.ivHex).toBe('string');
    expect(typeof envelope.ciphertextHex).toBe('string');
    // The plaintext key lives only in RAM:
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')?.apiKey).toBe(SECRET_KEY);
  });
});

describe('2 — RAM-only lifetime', () => {
  it('lock kills resolveLaneKey, keeps the envelope, unlock round-trips', async () => {
    stubWindow();
    await createOrResetLocalVault(PASS);
    setKeySlot('gemini-free', SECRET_KEY);
    await sealLocalVault();
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')?.apiKey).toBe(SECRET_KEY);

    // Simulate tab close/reload: RAM gone, disk intact.
    lockLocalVault();
    expect(isLocalVaultLockedError()).toBe(true);
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')).toBeNull();
    expect(localStorageHasEnvelope()).toBe(true);

    // Wrong passphrase: false, RAM stays empty.
    const bad = await unlockLocalVault('wrong-passphrase');
    expect(bad).toBe(false);
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')).toBeNull();

    // Right passphrase: original key restored from the envelope.
    const good = await unlockLocalVault(PASS);
    expect(good).toBe(true);
    expect(isLocalVaultLockedError()).toBe(false);
    expect(resolveLaneKey('chat', 'gemini-3.5-flash-lite')?.apiKey).toBe(SECRET_KEY);
  });
});

describe('3 — namespace isolation between modes', () => {
  it('model settings written in local mode are invisible in vps mode (and back)', async () => {
    const storage = stubWindow();
    // Local mode (absent → local behavior): write a non-default config.
    const cfg = { ...DEFAULT_MODEL_SLOTS, chat: 'gemini-4-argon' };
    saveModelConfig(cfg);
    const localKey = getScopedStorageKey(MODEL_CONFIG_KEY);
    expect(localKey.startsWith('markbrain:local:')).toBe(true);
    expect(storage.has(localKey)).toBe(true);
    expect(loadModelConfig()).toEqual(cfg);

    // Switch to vps with a session: different namespace → defaults, nothing leaked.
    setWorkspaceMode('vps');
    saveVpsSession({
      baseUrl: 'https://vps.example',
      token: 'tok',
      userId: 1,
      email: 'Deavid@Example.com'.toLowerCase(),
      isOwner: true,
      vaultUnlocked: true,
    });
    const vpsKey = getScopedStorageKey(MODEL_CONFIG_KEY);
    expect(vpsKey.startsWith('markbrain:vps:')).toBe(true);
    expect(vpsKey).not.toBe(localKey);
    expect(storage.get(vpsKey)).toBeUndefined(); // no bleed from local
    expect(loadModelConfig()).toEqual(DEFAULT_MODEL_SLOTS); // reads its own (empty) namespace

    // The local record is still there, untouched, under its own name.
    expect(storage.get(localKey)).toBe(JSON.stringify(cfg));
  });

  it('draft storage keys are mode-scoped — local drafts never surface in vps', async () => {
    const storage = stubWindow();
    const localDraftKey = getScopedStorageKey('draftQueue');
    storage.set(localDraftKey, JSON.stringify([{ id: 'draft-local-1' }]));
    expect(localDraftKey.startsWith('markbrain:local:')).toBe(true);

    setWorkspaceMode('vps');
    saveVpsSession({
      baseUrl: '',
      token: 'tok',
      userId: 1,
      email: 'deavidsedice@gmail.com',
      isOwner: false,
      vaultUnlocked: true,
    });
    const vpsDraftKey = getScopedStorageKey('draftQueue');
    expect(vpsDraftKey).not.toBe(localDraftKey);
    expect(storage.get(vpsDraftKey)).toBeUndefined(); // vps namespace sees no local draft
    expect(WORKSPACE_MODE_KEY).toBeTruthy();
  });
});

describe('4 — routing separation in gateway/api.ts', () => {
  it('vps mode: /api/* with Bearer token, never browser-direct', async () => {
    stubWindow();
    setWorkspaceMode('vps');
    saveVpsSession({
      baseUrl: 'https://vps.example',
      token: 'tok-abc-123',
      userId: 1,
      email: 'deavidsedice@gmail.com',
      isOwner: true,
      vaultUnlocked: true,
    });
    const calls = stubFetchRecorder();

    const res = await chatStream({
      model: 'gemini-3.5-flash-lite',
      compiledPrompt: 'hello',
      projectTitle: 'T',
    });
    expect(res.ok).toBe(true);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://vps.example/api/chat/stream');
    expect(calls[0].authorization).toBe('Bearer tok-abc-123');
    // Never the provider host — direct.ts must not run in vps mode.
    expect(calls[0].url).not.toContain('generativelanguage.googleapis.com');
    expect(calls[0].url).not.toContain('openrouter.ai');
  });

  it('local mode: browser-direct with the unlocked RAM key, no Authorization', async () => {
    stubWindow();
    setWorkspaceMode('local');
    await createOrResetLocalVault(PASS);
    setKeySlot('gemini-free', SECRET_KEY);

    const calls = stubFetchRecorder();
    const res = await chatStream({
      model: 'gemini-3.5-flash-lite',
      compiledPrompt: 'hello',
      projectTitle: 'T',
    });
    expect(res.ok).toBe(true);

    expect(calls.length).toBe(1);
    // Direct lane: provider host, no Bearer, no same-origin proxy path.
    expect(calls[0].url).toContain('generativelanguage.googleapis.com');
    expect(calls[0].url).not.toContain('/api/chat/stream');
    expect(calls[0].authorization).toBeUndefined();
  });
});

function localStorageHasEnvelope(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(LOCAL_VAULT_KEY) !== null;
  } catch {
    return false;
  }
}
