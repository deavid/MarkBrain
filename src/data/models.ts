import { ModelOption } from '../types';

/**
 * Minimal fallback used while GET /api/models is in flight or has failed, so
 * the model picker never renders empty (same always-populated state as the old
 * static list). Mirrors the server catalog default — server/lib/models.ts
 * `DEFAULT_MODEL_ID` / first entry — and is intentionally id/name-first; the
 * remaining ModelOption fields carry the same display values as before.
 *
 * The live lineup itself is server-owned: see gateway/api.ts `models()` and
 * the catalog state in App.tsx. This file must NOT grow back into a second
 * list.
 */
export const FALLBACK_MODEL: ModelOption = {
  id: 'gemini-3.5-flash-lite',
  name: 'Google: Gemini 3.5 Flash Lite',
  badge: 'Quick',
  powerRating: 2,
  latency: '~220ms',
  contextWindow: '1M tokens',
  description: 'Fast and cheap — quick replies and first drafts.',
  costMultiplier: 0.4,
};