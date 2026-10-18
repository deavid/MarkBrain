import { ModelOption } from '../types';

// Google-side lineup is intentionally a single model: Flash Lite only.
// Additional providers (OpenRouter: Xiaomi MiMo, GLM, Qwen, …) get added here
// over time as we adapt them.
export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Google: Gemini 3.5 Flash Lite',
    badge: 'Quick',
    powerRating: 2,
    latency: '~220ms',
    contextWindow: '1M tokens',
    description: 'Fast and cheap — quick replies and first drafts.',
    costMultiplier: 0.4,
  },
];