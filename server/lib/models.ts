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
// surfaces as an honest fallback (see resolveModelId), never a quiet swap.

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
  /**
   * Quota/latency character shown in the picker. Free-tier reality lives
   * here, not in a tooltip invented by the UI — see 06_GEMINI_3_8_FLASH_LATENCY.
   */
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
    quotaNote: 'Free tier: high quota, consistently ~1s',
    name: 'Google: Gemini 3.5 Flash Lite',
    badge: 'Quick',
    powerRating: 2,
    latency: '~220ms',
    contextWindow: '1M tokens',
    description: 'Fast and cheap — quick replies and first drafts.',
    costMultiplier: 0.4,
  },
  {
    id: 'gemini-3.8-flash-lite',
    provider: 'gemini',
    capabilities: [...GENERATE_LANES],
    quotaNote: 'Free tier: large quota, usually ~1s',
    name: 'Google: Gemini 3.8 Flash Lite',
    badge: 'Snappy',
    powerRating: 3,
    latency: '~300ms',
    contextWindow: '1M tokens',
    description: 'Newer lite tier — a bit more capable than 3.5 for the same speed class.',
    costMultiplier: 0.5,
  },
  {
    id: 'gemini-3.8-flash',
    provider: 'gemini',
    capabilities: [...GENERATE_LANES],
    quotaNote: 'Free tier: 20 requests/day · latency swings 1.3s–2min under load',
    name: 'Google: Gemini 3.8 Flash',
    badge: 'Big brain',
    powerRating: 5,
    latency: '1.3s–2min',
    contextWindow: '1M tokens',
    description: 'Reasoning power when a reply matters. Free quota is tiny — expect 429s.',
    costMultiplier: 1.0,
  },
  {
    id: 'gemini-embedding-001',
    provider: 'gemini',
    capabilities: ['embed'],
    name: 'Google: Gemini Embedding',
    badge: 'Vectors',
    powerRating: 1,
    latency: '~120ms',
    contextWindow: '2,048 tokens',
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
    latency: '~400ms',
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

export interface ModelResolution {
  /** The model the request will actually use. */
  id: string;
  /** What the client asked for, when that had to be rejected. */
  fellBackFrom: string | null;
}

/**
 * Resolve a client-requested model id for one capability lane.
 *
 * Never a quiet swap (design-docs/16 §2): when the request is rejected the
 * caller receives `fellBackFrom` and is expected to TELL THE USER. An unknown
 * id or a wrong-capability model (embedding asked to chat) falls back to the
 * lane default with the evidence attached.
 */
export function resolveModelId(
  requested: unknown,
  capability: ModelCapability = 'chat'
): ModelResolution {
  const laneDefault = defaultModelFor(capability);
  if (typeof requested === 'string' && listValidModelIds(capability).includes(requested)) {
    return { id: requested, fellBackFrom: null };
  }
  return {
    id: laneDefault,
    fellBackFrom: typeof requested === 'string' && requested.length > 0 ? requested : null,
  };
}
