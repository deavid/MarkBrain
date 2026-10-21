// Canonical, server-owned model catalog — the single source of truth for
// which models this deployment offers. Served at GET /api/models and used by
// routes/chat.ts to validate incoming model ids, so the allowlist and the
// catalog cannot diverge.
//
// This is the seam OpenRouter will slot into later: entries carry a `provider`
// field ('gemini' for now). Deliberately NO provider abstraction, routing
// tables, or caching — keep it dead simple.

export type ModelProvider = 'gemini';

export interface CatalogModel {
  id: string;
  provider: ModelProvider;
  available: boolean;
  // Display metadata — mirrors ModelOption in src/data/models.ts (which is
  // owned by the client; the server copy here is the source of truth).
  name: string;
  badge: string;
  powerRating: number;
  latency: string;
  contextWindow: string;
  description: string;
  costMultiplier: number;
}

const CATALOG_ENTRIES: ReadonlyArray<Omit<CatalogModel, 'available'>> = [
  {
    id: 'gemini-3.5-flash-lite',
    provider: 'gemini',
    name: 'Google: Gemini 3.5 Flash Lite',
    badge: 'Quick',
    powerRating: 2,
    latency: '~220ms',
    contextWindow: '1M tokens',
    description: 'Fast and cheap — quick replies and first drafts.',
    costMultiplier: 0.4,
  },
];

export const DEFAULT_MODEL_ID = 'gemini-3.5-flash-lite';

function isProviderAvailable(provider: ModelProvider): boolean {
  switch (provider) {
    case 'gemini':
      return Boolean(process.env.GEMINI_API_KEY);
  }
}

export function getModelCatalog(): CatalogModel[] {
  return CATALOG_ENTRIES.map((entry) => ({
    ...entry,
    available: isProviderAvailable(entry.provider),
  }));
}

export function listValidModelIds(): string[] {
  return CATALOG_ENTRIES.map((entry) => entry.id);
}

/**
 * Resolve a client-requested model id against the catalog. Anything unknown
 * falls back to the catalog default — a stale client must never be able to send
 * a model id the server cannot serve.
 */
export function resolveModelId(requested: unknown): string {
  return typeof requested === 'string' && listValidModelIds().includes(requested)
    ? requested
    : DEFAULT_MODEL_ID;
}