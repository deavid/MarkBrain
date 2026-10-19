import type { ProjectSnapshot } from '../services/persistenceService';

/**
 * HEADLESS FIXTURE — deliberately synthetic data for agent-driven capture.
 *
 * Loaded ONLY in dev when the URL carries ?fixture=1 (see
 * persistenceService.isFixtureMode). It is not demo data, not a fallback,
 * not a seed: outside that flag it cannot load. A production build inlines
 * DEV=false and tree-shakes every branch that reads it.
 *
 * Shape: exactly one ProjectSnapshot — the same typed document Firestore
 * holds — so the fixture cannot drift from the real format.
 */
export const HEADLESS_FIXTURE: ProjectSnapshot = {
  projectId: 'proj-fixture',
  name: 'Fixture Project',
  codeName: 'FIXTURE',
  description:
    'Synthetic headless-capture fixture. Not demo data: loads only via ?fixture=1 in dev.',
  color: '#5d87b8',
  updatedAt: 1760000000000,
  chapters: [
    {
      id: 'chap-fx-1',
      workspaceId: 'proj-fixture',
      title: 'Chapter 1: Fixture Genesis',
      summary: 'Synthetic chapter for headless capture.',
      keyPoints: [],
      status: 'active',
      startIndex: 0,
      createdAt: 1760000000000,
    },
  ],
  turns: [
    {
      id: 'turn-fx-1',
      role: 'user',
      content: 'Fixture turn: what does a headless capture need to see?',
      timestamp: 1760000000001,
    },
    {
      id: 'turn-fx-2',
      role: 'assistant',
      content:
        'Fixture reply: a chapter, a message pair, and two artifacts with edges — enough surface to prove chat, graph, and sidebar all render without touching real data.',
      timestamp: 1760000000002,
      meta: {
        model: 'gemini-3.5-flash-lite',
        inputTokens: 128,
        outputTokens: 64,
        totalTokens: 192,
        latencyMs: 1420,
        timeToFirstChunkMs: 280,
        isStreaming: false,
        streamState: 'completed',
        isFallback: true,
      },
    },
    {
      id: 'turn-fx-3',
      role: 'user',
      content: 'Fixture confirmation: capture complete, zero writes occurred.',
      timestamp: 1760000000003,
    },
  ],
  artifacts: [
    {
      id: 'art-fx-alpha',
      workspaceId: 'proj-fixture',
      code: 'fixture-alpha',
      title: 'Fixture Artifact Alpha',
      type: 'document',
      category: 'note',
      isHighConcept: true,
      current: {
        t0_label: 'Fixture Alpha',
        t1_abstract: 'Synthetic artifact A for graph rendering.',
        t2_summary: 'Synthetic summary A.',
        t3_body: 'Synthetic body A — proves artifact detail surfaces render.',
      },
      tags: ['fixture', 'headless'],
      createdAt: 1760000000000,
      updatedAt: 1760000000000,
      graph: { x: 220, y: 160, is_high_concept: true },
    },
    {
      id: 'art-fx-beta',
      workspaceId: 'proj-fixture',
      code: 'fixture-beta',
      title: 'Fixture Artifact Beta',
      type: 'document',
      category: 'note',
      isHighConcept: false,
      current: {
        t0_label: 'Fixture Beta',
        t1_abstract: 'Synthetic artifact B for graph rendering.',
        t2_summary: 'Synthetic summary B.',
        t3_body: 'Synthetic body B.',
      },
      tags: ['fixture'],
      createdAt: 1760000000000,
      updatedAt: 1760000000000,
      graph: { x: 560, y: 300, is_high_concept: false },
    },
  ],
  edges: [
    {
      id: 'edge-fx-1',
      sourceId: 'art-fx-alpha',
      targetId: 'art-fx-beta',
      kind: 'relates_to',
      weight: 1,
    },
  ],
};