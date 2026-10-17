import { ModelOption } from '../types';

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    badge: 'Lightweight Scout',
    powerRating: 2,
    latency: '~220ms',
    contextWindow: '1M tokens',
    description: 'Fast, cost-efficient model for rapid token refinement and initial drafts.',
    costMultiplier: 0.4,
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    badge: 'Architect Core',
    powerRating: 4,
    latency: '~580ms',
    contextWindow: '1M tokens',
    description: 'Balanced systems reasoning model for design tokens, component contracts, and boundaries.',
    costMultiplier: 1.0,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    badge: 'Deep Synthesis Pro',
    powerRating: 5,
    latency: '~1.6s',
    contextWindow: '2M tokens',
    description: 'High-power multi-repository synthesis and complex state machine verification.',
    costMultiplier: 3.5,
  },
];
