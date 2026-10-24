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

/** Mirrors server/lib/models.ts CAPABILITY_DEFAULTS — same lane defaults. */
export const DEFAULT_MODEL_SLOTS: ModelSlotConfig = {
  chat: 'gemini-3.5-flash-lite',
  extract: 'gemini-3.5-flash-lite',
  summarize: 'gemini-3.5-flash-lite',
  qaGen: 'gemini-3.5-flash-lite',
  title: 'gemini-3.5-flash-lite',
  embed: 'gemini-embedding-001',
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
    const raw = window.localStorage.getItem(MODEL_CONFIG_KEY);
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
    if (isDefault) window.localStorage.removeItem(MODEL_CONFIG_KEY);
    else window.localStorage.setItem(MODEL_CONFIG_KEY, JSON.stringify(normalized));
  } catch {
    // Private-mode storage failure must not break the settings modal.
  }
}

/**
 * The model one lane should ask for right now. Reads storage per call on
 * purpose: a settings change applies to the next request without a reload.
 */
export function getModelForSlot(slot: ModelSlot): string {
  return loadModelConfig()[slot];
}
