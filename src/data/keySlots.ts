/**
 * keySlots — user-supplied API credentials (BYOK, design-docs/16 D8/D9, §4.2 Tier 1).
 *
 * Three optional key slots, all optional, all device-local:
 *   gemini-free   the AI Studio free-quota key
 *   gemini-paid   the AI Studio paid key (the "put money on it" flip, D8)
 *   openrouter    the OpenRouter key
 *
 * STORAGE: plaintext localStorage + provider-side key restrictions (referrer
 * lock / domain allowlist) as the real wall. Known XSS exposure — accepted.
 * Do not "upgrade" this file with client-side crypto (base64, XOR, a
 * passphrase vault): browsers already protect localStorage, and a key the
 * page can read while running is a key any injected script can read too.
 * (The passphrase vault was built, reviewed, and removed for exactly that
 * reason — it added UI, not security.)
 *
 * HARD RULES (§4.4):
 * - Keys never enter ProjectSnapshot, exports, search-index records, or QR
 *   payloads. This module is the ONLY place that reads/writes them.
 * - Keys are never logged (not even length).
 * - Empty slot = key absent = the app works without it (D9). Slots that were
 *   never filled store NOTHING (no empty-string keys sitting in storage).
 */
export type KeySlotId = 'gemini-free' | 'gemini-paid' | 'openrouter';

export type KeyProvider = 'gemini' | 'openrouter';

export const KEY_SLOTS: readonly KeySlotId[] = ['gemini-free', 'gemini-paid', 'openrouter'];

export interface KeySlotInfo {
  id: KeySlotId;
  provider: KeyProvider;
  label: string;
  /** What the slot is for — shown next to the input. */
  hint: string;
}

export const KEY_SLOT_INFO: Record<KeySlotId, KeySlotInfo> = {
  'gemini-free': {
    id: 'gemini-free',
    provider: 'gemini',
    label: 'Gemini Free',
    hint: 'AI Studio free-quota key. Big quota on lite models; 3.8-flash is ~20/day.',
  },
  'gemini-paid': {
    id: 'gemini-paid',
    provider: 'gemini',
    label: 'Gemini Paid',
    hint: 'AI Studio paid key. One-click swap when free quota runs out (D8).',
  },
  openrouter: {
    id: 'openrouter',
    provider: 'openrouter',
    label: 'OpenRouter',
    hint: 'One key, many models. Domain-allowlist it and set a spend limit.',
  },
};

const KEY_PREFIX = 'markbrain:keys:';
/** Which key signs each lane's requests. 'auto' = first filled slot for that provider. */
const LANE_KEYS_KEY = 'markbrain:laneKeys';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isKeySlotId(v: unknown): v is KeySlotId {
  return typeof v === 'string' && (KEY_SLOTS as readonly string[]).includes(v);
}

/** Trimmed non-empty key, or null. A whitespace-only paste counts as unfilled. */
export function getKeySlot(id: KeySlotId): string | null {
  const raw = storage()?.getItem(KEY_PREFIX + id) ?? null;
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Store a key, or clear the slot with null/empty. Cleared slots store nothing. */
export function setKeySlot(id: KeySlotId, value: string | null): void {
  const trimmed = (value ?? '').trim();
  const s = storage();
  if (!s) return;
  if (trimmed.length === 0) s.removeItem(KEY_PREFIX + id);
  else s.setItem(KEY_PREFIX + id, trimmed);
}

/** True when at least one slot is filled — the app boots fine either way (D9). */
export function anyKeyConfigured(): boolean {
  return KEY_SLOTS.some((id) => getKeySlot(id) !== null);
}

export function listFilledKeySlots(): KeySlotId[] {
  return KEY_SLOTS.filter((id) => getKeySlot(id) !== null);
}

/* ---------------------------------------------------------------- lane binding
 * Which key signs a lane. Lanes whose model lives on a provider only use a
 * key for THAT provider — a gemini model never signs with the OpenRouter key.
 */

/** 'auto' picks the first filled slot of the model's provider (free before paid). */
export type LaneKeyChoice = KeySlotId | 'auto';

const LANE_KEY_DEFAULT: LaneKeyChoice = 'auto';

const isLaneKeyChoice = (v: unknown): v is LaneKeyChoice => v === 'auto' || isKeySlotId(v);

export function loadLaneKeys(): Record<string, LaneKeyChoice> {
  const out: Record<string, LaneKeyChoice> = {};
  try {
    const raw = storage()?.getItem(LANE_KEYS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [lane, choice] of Object.entries(parsed as Record<string, unknown>)) {
          if (isLaneKeyChoice(choice)) out[lane] = choice;
        }
      }
    }
  } catch {
    /* junk → all auto */
  }
  return out;
}

export function setLaneKey(lane: string, choice: LaneKeyChoice): void {
  const s = storage();
  if (!s) return;
  const all = loadLaneKeys();
  if (choice === LANE_KEY_DEFAULT) delete all[lane];
  else all[lane] = choice;
  if (Object.keys(all).length === 0) s.removeItem(LANE_KEYS_KEY);
  else s.setItem(LANE_KEYS_KEY, JSON.stringify(all));
}

/** The provider a model id belongs to. OpenRouter ids are `vendor/model`. */
export function providerOfModel(modelId: string): KeyProvider {
  return modelId.includes('/') || modelId.startsWith('openrouter') ? 'openrouter' : 'gemini';
}

export interface ResolvedKey {
  keySlot: KeySlotId;
  provider: KeyProvider;
  apiKey: string;
}

/**
 * The credential that should sign one lane's request, or null when nothing is
 * filled — the caller then falls back to the server proxy (Phase 1) or shows
 * the honest "add a key" empty state (Phase 2+).
 */
export function resolveLaneKey(lane: string, modelId: string): ResolvedKey | null {
  const provider = providerOfModel(modelId);
  const choice = loadLaneKeys()[lane] ?? LANE_KEY_DEFAULT;
  // The binding is a PREFERENCE: try it first, then fall through to the
  // provider's auto order — a cleared preferred key must not strand the lane
  // on the proxy while another same-provider key is sitting right there (D9).
  const preferred =
    choice !== 'auto' && KEY_SLOT_INFO[choice].provider === provider ? [choice] : [];
  const auto = KEY_SLOTS.filter((id) => KEY_SLOT_INFO[id].provider === provider);
  const candidates = [...preferred, ...auto.filter((id) => !preferred.includes(id))];
  for (const id of candidates) {
    const apiKey = getKeySlot(id);
    if (apiKey) return { keySlot: id, provider, apiKey };
  }
  return null;
}
