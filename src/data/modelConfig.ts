/**
 * modelConfig — capability-slot model selection (design-docs/16 §3.1, D2/D7).
 *
 * Not one global model: seven lanes, each pointing at a model id. Chat is the
 * slot that matters ("big brain when it pays"), infrastructure lanes default
 * to the free-quota models. Persisted in localStorage like searchConfig —
 * meta-use of localStorage, not a data mirror. Default state is the ABSENCE of
 * the key; anything unreadable falls back to the defaults per-slot.
 *
 * Keys themselves (BYOK) arrive in Phase 1; this module is only which model
 * each lane asks the (still server-proxied) endpoint for.
 */

export const MODEL_SLOTS = [
  'chat',
  'extract',
  'summarize',
  'qaGen',
  'title',
  'embed',
  'tts',
] as const;

export type ModelSlot = (typeof MODEL_SLOTS)[number];

export type ModelSlotConfig = Record<ModelSlot, string>;

export const MODEL_CONFIG_KEY = 'markbrain:modelConfig';

/** Mode-scoped: a model setting in Local never bleeds into VPS and vice versa (21C §1). */
// DOCUMENTED RESIDUAL SEAM (Phase 6 — data reaching up, accepted): the scoped
// storage key + workspace mode come from services/workspaceSession and are
// read per call on purpose (mode can flip at runtime); threading them through
// every caller would balloon. Accepted and named here. The gateway/api import
// below stays DYNAMIC for the same cycle reason as before (api imports
// DEFAULT_MODEL_SLOTS from this module).
import { getScopedStorageKey, getWorkspaceMode } from '../services/workspaceSession';
// gateway/api is imported DYNAMICALLY inside the vps push/hydrate helpers:
// a static import would cycle modelConfig → api → … → modelConfig and leave
// DEFAULT_MODEL_SLOTS undefined at module-eval time for draftSearchEngine.

/** Mirrors server/lib/models.ts CAPABILITY_DEFAULTS — same lane defaults. */
export const DEFAULT_MODEL_SLOTS: ModelSlotConfig = {
  chat: 'gemini-3.5-flash-lite',
  extract: 'gemini-3.5-flash-lite',
  summarize: 'gemini-3.5-flash-lite',
  qaGen: 'gemini-3.5-flash-lite',
  title: 'gemini-3.5-flash-lite',
  embed: 'nvidia/nemotron-3-embed-1b:free',
  tts: 'gemini-3.8-flash-lite-tts',
};

/** Model ids are provider-ish tokens — reject anything that is not one. Slashes
 *  are legal: OpenRouter ids are `openai/gpt-5` shaped. */
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

function sanitizeModelId(v: unknown, fallback: string): string {
  return typeof v === 'string' && MODEL_ID_RE.test(v) ? v : fallback;
}

/** Merge any partial/junk object onto the defaults; unknown keys are dropped. */
export function normalizeModelConfig(raw: unknown): ModelSlotConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_MODEL_SLOTS };
  for (const slot of MODEL_SLOTS) {
    out[slot] = sanitizeModelId(src[slot], DEFAULT_MODEL_SLOTS[slot]);
  }
  return out;
}

export function loadModelConfig(): ModelSlotConfig {
  try {
    if (typeof window === 'undefined') return { ...DEFAULT_MODEL_SLOTS };
    const raw = window.localStorage.getItem(getScopedStorageKey(MODEL_CONFIG_KEY));
    if (!raw) return { ...DEFAULT_MODEL_SLOTS };
    return normalizeModelConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_MODEL_SLOTS };
  }
}

export function saveModelConfig(config: ModelSlotConfig): void {
  try {
    if (typeof window === 'undefined') return;
    const normalized = normalizeModelConfig(config);
    // Default state is the absence of a key — same contract as searchConfig.
    const isDefault = MODEL_SLOTS.every((s) => normalized[s] === DEFAULT_MODEL_SLOTS[s]);
    const scoped = getScopedStorageKey(MODEL_CONFIG_KEY);
    if (isDefault) window.localStorage.removeItem(scoped);
    else window.localStorage.setItem(scoped, JSON.stringify(normalized));
    // 21D §5: Connected VPS mode pushes to the account so PC + phone agree.
    if (getWorkspaceMode() === 'vps') {
      void import('../gateway/api')
        .then(({ putAccountSettings }) => putAccountSettings({ modelSlots: normalized }))
        .catch(() => {
          /* offline — local scoped copy still applied; next save/hydrate reconciles */
        });
    }
  } catch {
    // Private-mode storage failure must not break the settings modal.
  }
}

/**
 * 21D §5: pull the account's model slots into this device's scoped storage.
 * Called on VPS login/boot; also available after settings tab loads.
 */
export async function hydrateAccountSettingsFromVps(): Promise<void> {
  if (getWorkspaceMode() !== 'vps') return;
  try {
    const { getAccountSettings } = await import('../gateway/api');
    const res = await getAccountSettings();
    if (!res.ok) return;
    const body = (await res.json()) as { modelSlots?: Record<string, string> };
    if (body?.modelSlots && typeof body.modelSlots === 'object') {
      const normalized = normalizeModelConfig(body.modelSlots);
      if (typeof window !== 'undefined') {
        const scoped = getScopedStorageKey(MODEL_CONFIG_KEY);
        const isDefault = MODEL_SLOTS.every((s) => normalized[s] === DEFAULT_MODEL_SLOTS[s]);
        if (isDefault) window.localStorage.removeItem(scoped);
        else window.localStorage.setItem(scoped, JSON.stringify(normalized));
      }
    }
  } catch {
    /* offline boot — scoped local copy stands in */
  }
}

/**
 * The model one lane should ask for right now. Reads storage per call on
 * purpose: a settings change applies to the next request without a reload.
 */
export function getModelForSlot(slot: ModelSlot): string {
  return loadModelConfig()[slot];
}

/**
 * Change detector for the embed slot: vectors from different embedding models
 * are NOT comparable (§3.4), so the UI warns that switching re-embeds
 * everything — the whole index reads as stale until it is rebuilt.
 */
export function isEmbedModelChange(oldConfig: ModelSlotConfig | null, next: ModelSlotConfig): boolean {
  if (!oldConfig) return false;
  return oldConfig.embed !== next.embed;
}

/**
 * The chat lane's model, resolved per call from the chat slot — the slot is
 * the source of truth (design-docs/16), NOT any React state snapshot. This is
 * the fix for "settings show 3.8 but sends use 3.5": the popup writes the slot
 * and the next request must see it.
 *
 * Never silently swaps to a different model: an id the catalog does not know
 * is sent AS-IS (surfacing a config problem) rather than quietly substituted.
 */
export function resolveChatModelOption<T extends { id: string; name: string }>(
  catalog: T[],
  fallback: T
): T {
  const slotId = getModelForSlot('chat');
  const known = catalog.find((m) => m.id === slotId);
  if (known) return known;
  if (slotId) return { ...fallback, id: slotId, name: slotId };
  return fallback;
}
