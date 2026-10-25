// Canonical, server-owned model catalog — the single source of truth for
// which models this deployment offers. Served at GET /api/models and used by
// routes to validate incoming model ids per CAPABILITY, so the allowlist and
// the catalog cannot diverge.
//
// This is the seam OpenRouter will slot into later: entries carry a `provider`
// field ('gemini' for now). Deliberately NO provider abstraction, routing
// tables, or caching — keep it dead simple. (design-docs/16, Phase 0.)
//
// Every entry declares which capability lanes it may serve. An embeddings
// model must never answer a chat request and vice versa — a typo in the client
// surfaces as a hard error (see requireModelId) — errors are final, no swap.

export type ModelProvider = 'gemini';

/**
 * The seven lanes of design-docs/16 §3.1. A model lists the lanes it can
 * serve; a request names the lane it is for.
 */
export type ModelCapability =
  | 'chat'
  | 'extract'
  | 'summarize'
  | 'qaGen'
  | 'title'
  | 'embed'
  | 'tts';

export interface CatalogModel {
  id: string;
  provider: ModelProvider;
  available: boolean;
  /** Lanes this model may serve. */
  capabilities: ModelCapability[];
  /** Unused by the UI — we are not the source of truth for provider quotas. */
  quotaNote?: string;
  // Display metadata — mirrors ModelOption in src/types (which is
  // owned by the client; the server copy here is the source of truth).
  name: string;
  badge: string;
  powerRating: number;
  latency: string;
  contextWindow: string;
  description: string;
  costMultiplier: number;
}

const GENERATE_LANES: ModelCapability[] = ['chat', 'extract', 'summarize', 'qaGen', 'title'];

const CATALOG_ENTRIES: ReadonlyArray<Omit<CatalogModel, 'available'>> = [
  {
    id: 'gemini-3.5-flash-lite',
    provider: 'gemini',
    capabilities: [...GENERATE_LANES],
    name: 'Google: Gemini 3.5 Flash Lite',
    badge: 'Lite',
    powerRating: 2,
    latency: '—',
    contextWindow: '—',
    description: 'High-volume, low-cost extraction, parsing, and quick replies.',
    costMultiplier: 0.4,
  },
  {
    id: 'gemini-3.8-flash',
    provider: 'gemini',
    capabilities: [...GENERATE_LANES],
    name: 'Google: Gemini 3.8 Flash',
    badge: 'Flash',
    powerRating: 4,
    latency: '—',
    contextWindow: '—',
    description: 'Default workhorse — coding, general reasoning, production workflows.',
    costMultiplier: 1.0,
  },
  {
    id: 'gemini-4-argon',
    provider: 'gemini',
    capabilities: [...GENERATE_LANES],
    name: 'Google: Gemini 4 Argon',
    badge: 'Argon',
    powerRating: 5,
    latency: '—',
    contextWindow: '—',
    description:
      'Flagship frontier reasoning and long-horizon tasks. Paid tier only on current keys — a free key will get a real error, not a swap.',
    costMultiplier: 2.0,
  },
  {
    id: 'gemini-embedding-001',
    provider: 'gemini',
    capabilities: ['embed'],
    name: 'Google: Gemini Embedding',
    badge: 'Vectors',
    powerRating: 1,
    latency: '—',
    contextWindow: '—',
    description: 'Section/Q&A vectors for the proximity search index.',
    costMultiplier: 0.1,
  },
  {
    id: 'gemini-3.8-flash-lite-tts',
    provider: 'gemini',
    capabilities: ['tts'],
    name: 'Google: Gemini 3.8 Flash Lite TTS',
    badge: 'Voice',
    powerRating: 1,
    latency: '—',
    contextWindow: '—',
    description: 'Read-aloud voice synthesis.',
    costMultiplier: 0.3,
  },
];

export const DEFAULT_MODEL_ID = 'gemini-3.5-flash-lite';

/** Lane defaults (design-docs/16 §3.1): infrastructure lanes pin their own. */
const CAPABILITY_DEFAULTS: Record<ModelCapability, string> = {
  chat: DEFAULT_MODEL_ID,
  extract: DEFAULT_MODEL_ID,
  summarize: DEFAULT_MODEL_ID,
  qaGen: DEFAULT_MODEL_ID,
  title: DEFAULT_MODEL_ID,
  embed: 'gemini-embedding-001',
  tts: 'gemini-3.8-flash-lite-tts',
};

function isProviderAvailable(provider: ModelProvider): boolean {
  switch (provider) {
    case 'gemini':
      return Boolean(process.env.GEMINI_API_KEY);
  }
}

export function getModelCatalog(): CatalogModel[] {
  return CATALOG_ENTRIES.map((entry) => ({
    ...entry,
    capabilities: [...entry.capabilities],
    available: isProviderAvailable(entry.provider),
  }));
}

export function listValidModelIds(capability?: ModelCapability): string[] {
  return CATALOG_ENTRIES.filter(
    (e) => !capability || e.capabilities.includes(capability)
  ).map((e) => e.id);
}

export function defaultModelFor(capability: ModelCapability): string {
  return CAPABILITY_DEFAULTS[capability];
}

/**
 * The model this request will use — or the real reason it cannot run.
 *
 * David 2026-10-25: *"I don't want the smart downgrade — I want the actual
 * error … remove the downgrade and make errors final."* No substitution
 * exists anymore. "No preference" (missing/empty) gets the lane default; an
 * unknown id or a wrong-capability model is a HARD error, surfaced as-is.
 */
export function requireModelId(
  requested: unknown,
  capability: ModelCapability = 'chat'
): string {
  const laneDefault = defaultModelFor(capability);
  if (requested === undefined || requested === null || requested === '') return laneDefault;
  if (typeof requested === 'string' && listValidModelIds(capability).includes(requested)) {
    return requested;
  }
  throw new Error(`Model "${String(requested)}" is not available for ${capability} on this server.`);
}

/**
 * Route-safe variant: an unavailable model is an ERROR PAYLOAD, never a throw
 * that could escape a handler and kill the process (that happened once — the
 * whole node process died on a stale gemini-3.8-flash-lite slot).
 */
export function tryRequireModelId(
  requested: unknown,
  capability: ModelCapability = 'chat'
): { id: string } | { error: string } {
  try {
    return { id: requireModelId(requested, capability) };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : 'Model not available.' };
  }
}
