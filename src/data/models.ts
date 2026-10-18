import { ModelOption } from '../types';

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    badge: 'Quick',
    powerRating: 2,
    latency: '~220ms',
    contextWindow: '1M tokens',
    description: 'Fast and cheap — quick replies and first drafts.',
    costMultiplier: 0.4,
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    badge: 'Daily Driver',
    powerRating: 4,
    latency: '~580ms',
    contextWindow: '1M tokens',
    description: 'Balanced and dependable for everyday thinking.',
    costMultiplier: 1.0,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    badge: 'Deep Dive',
    powerRating: 5,
    latency: '~1.6s',
    contextWindow: '2M tokens',
    description: 'Strongest model — deep synthesis over lots of material.',
    costMultiplier: 3.5,
  },
];
