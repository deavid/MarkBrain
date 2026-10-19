// Canonical, server-owned model catalog — the single source of truth for
// which models this deployment offers. Served at GET /api/models and used by
// routes/chat.ts to validate incoming model ids, so the allowlist and the
// catalog cannot diverge.
//
// This is the seam OpenRouter will slot into later: entries carry a `provider`
// field ('gemini' for now). Deliberately NO provider abstraction, routing
// tables, or caching — keep it dead simple.

/** Which backend serves a model. 'openrouter' gets unioned in later. */
export type ModelProvider = 'gemini';

/** A catalog entry as advertised to clients, incl. current availability. */
export interface CatalogModel {
  id: string;
  provider: ModelProvider;
  /** API key present / provider reachable-enough to list right now. */
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

/** Static entries (availability is computed per-request — see getModelCatalog). */
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

/** The model used when a request names an unknown/unavailable model. */
export const DEFAULT_MODEL_ID = 'gemini-3.5-flash-lite';

/** Is the provider behind an entry currently usable (API key present)? */
function isProviderAvailable(provider: ModelProvider): boolean {
  switch (provider) {
    case 'gemini':
      return Boolean(process.env.GEMINI_API_KEY);
  }
}

/** Full catalog with fresh availability — used by GET /api/models. */
export function getModelCatalog(): CatalogModel[] {
  return CATALOG_ENTRIES.map((entry) => ({
    ...entry,
    available: isProviderAvailable(entry.provider),
  }));
}

/** Model ids chat requests may name (derived from the catalog, never divergent). */
export function listValidModelIds(): string[] {
  return CATALOG_ENTRIES.map((entry) => entry.id);
}

/**
 * Resolve a client-requested model id against the catalog.
 * Unknown model → the catalog default (same failover as the old hard-coded
 * `validModels.includes(model) ? model : 'gemini-3.5-flash-lite'`).
 */
export function resolveModelId(requested: unknown): string {
  return typeof requested === 'string' && listValidModelIds().includes(requested)
    ? requested
    : DEFAULT_MODEL_ID;
}