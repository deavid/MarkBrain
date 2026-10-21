import { ModelOption } from '../types';

/** Boot/offline fallback while `GET /api/models` is in flight. The live catalog is server-owned (`server/lib/models.ts`); do not add a second model list here. */
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