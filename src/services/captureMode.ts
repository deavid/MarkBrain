/**
 * captureMode — it is the hermetic capture-mode backend: the fake project
 * fixture and the no-op/serving backend it runs on.
 *
 * Moved out of persistenceService + src/data/headlessFixture.ts (Phase 6):
 * one home for every capture-mode seam. `?fixture=1` and `?capture=1`
 * (dev server only) put the app in a read-ONLY capture state: every save
 * path becomes a no-op, so headless screenshot runs — fixture or
 * real-session — can never write anywhere. The fixture project is served by
 * persistenceService at the seam lines it keeps for exactly this purpose.
 *
 * `import.meta.env.DEV` is inlined at build time: in a production build
 * these functions collapse to `false` and the branches tree-shake away.
 */
import type { ProjectSnapshot } from './stores/projectStore';
import { estimateTokens } from '../../shared/estimateTokens';
const devParam = (name: string): boolean =>
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has(name);

export const isFixtureMode = (): boolean => devParam('fixture');
export const isCaptureMode = (): boolean => devParam('fixture') || devParam('capture');

/**
 * Evidence seam (`?slowsave=1`, dev only): every save hangs. Nothing is written
 * anywhere — the seam never consults a backend — so a fixture run stays
 * read-only, and the only thing that can end the hang is the acknowledgement
 * deadline. It exists so a journey can watch the watchdog fire, which is the
 * failure David hit live: Firestore retries a quota-blocked write forever, so
 * `setDoc` never settles and no `catch` ever runs.
 */
export const isSlowSaveSeam = (): boolean => devParam('slowsave');

/* ── Long-chat CUJ threads (Phase 1/2 journey 28) ────────────────────────── */

/**
 * thread-fx-2: a REAL long thread — 3 chapters, the older Full one default-
 * folded, the active one windowed. Turn bodies are real ~1700-token texts and
 * `contentTokens` is measured ON them (never a made-up number): every token
 * figure on screen — cap banner, chapter header, compiler telemetry — derives
 * from the same text, so no badge can contradict another.
 */
const LONG_BODY = (i: number): string =>
  `Fixture long thread turn #${i}. ` +
  'The active chapter keeps growing past the soft cap, which is exactly what this thread is here to show. '.repeat(61);

const LONG_TURNS: ProjectSnapshot['turns'] = Array.from({ length: 84 }, (_, i) => {
  const content = LONG_BODY(i);
  return {
    id: `turn-fx2-${i}`,
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content,
    timestamp: 1760000001000 + i,
    threadId: 'thread-fx-2',
    meta: { contentTokens: estimateTokens(content) },
  };
});

/** thread-fx-3: crossed 128k at turn #1, then two user turns landed → hard-blocked. Bodies real-sized for the same law. */
const OVER_CAP_BODY = (label: string): string =>
  `${label}. ` + 'This chapter blew past the 128k hard cap on purpose so the composer block can be watched hermetically. '.repeat(2375);

const OVER_CAP_TURNS: ProjectSnapshot['turns'] = (
  [
    ['turn-fx3-0', 'user', 'Fixture over-cap ask'],
    ['turn-fx3-1', 'assistant', 'Fixture over-cap reply'],
    ['turn-fx3-2', 'user', 'Fixture over-cap follow-up one'],
    ['turn-fx3-3', 'assistant', 'Fixture over-cap reply two'],
    ['turn-fx3-4', 'user', 'Fixture over-cap follow-up two'],
  ] as const
).map(([id, role, label], i) => {
  // The first two turns ARE the 65k-token monsters that cross the cap; the
  // three tail turns are the grace sends.
  const content = i < 2 ? OVER_CAP_BODY(label) : `${label}.`;
  return {
    id,
    role,
    content,
    timestamp: 1760000002000 + i,
    threadId: 'thread-fx-3',
    meta: { contentTokens: estimateTokens(content) },
  };
});
/**
 * HEADLESS FIXTURE — deliberately synthetic data for agent-driven capture.
 *
 * Loaded ONLY in dev when the URL carries ?fixture=1 (isFixtureMode above).
 * It is not demo data, not a fallback, not a seed: outside that flag it
 * cannot load. A production build inlines DEV=false and tree-shakes every
 * branch that reads it.
 *
 * Shape: exactly one ProjectSnapshot — the same typed document the server
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
  // One thread with ONE attachment; journey 14 attaches the second through
  // the picker, which is the only proof that the flow is wired end to end.
  activeThreadId: 'thread-fx-1',
  threads: [
    {
      id: 'thread-fx-1',
      folderId: null,
      title: 'Fixture Thread',
      titleState: 'manual',
      titleVersion: 2,
      createdAt: 1760000000000,
      updatedAt: 1760000000003,
      lastActivityAt: 1760000000003,
      lifecycle: 'active',
      lastOutcome: 'ok',
      preview: 'Fixture turn: what does a headless capture need to see?',
      attachments: [
        { artifactId: 'art-fx-alpha', granularity: 'full', addedAt: 1760000000000 },
      ],
    },
    {
      id: 'thread-fx-2',
      folderId: null,
      title: 'Fixture Long Thread',
      titleState: 'manual',
      titleVersion: 0,
      createdAt: 1760000000000,
      updatedAt: 1760000001000,
      lastActivityAt: 1760000001000,
      lifecycle: 'active',
      lastOutcome: 'ok',
      preview: 'Fixture long thread turn #83',
      attachments: [],
    },
    {
      id: 'thread-fx-3',
      folderId: null,
      title: 'Fixture Over Cap',
      titleState: 'manual',
      titleVersion: 0,
      createdAt: 1760000000000,
      updatedAt: 1760000002000,
      lastActivityAt: 1760000002000,
      lifecycle: 'active',
      lastOutcome: 'ok',
      preview: 'Fixture over-cap follow-up two',
      attachments: [],
    },
  ],
  chapters: [
    {
      id: 'chap-fx-1',
      workspaceId: 'proj-fixture',
      title: 'Chapter 1: Fixture Genesis',
      subtitle: 'Why the headless fixture exists.',
      summary: 'Synthetic chapter for headless capture.',
      description: '',
      granularity: 'full',
      status: 'active',
      startIndex: 0,
      createdAt: 1760000000000,
    },
    {
      id: 'chap-fx-2a',
      workspaceId: 'proj-fixture',
      threadId: 'thread-fx-2',
      title: 'Chapter 2a: The Old Ground',
      subtitle: '',
      summary: 'Older Full chapter — starts FOLDED (long-chat default-fold).',
      description: '',
      granularity: 'full',
      status: 'completed',
      startIndex: 0,
      endIndex: 20,
      createdAt: 1760000000000,
    },
    {
      id: 'chap-fx-2b',
      workspaceId: 'proj-fixture',
      threadId: 'thread-fx-2',
      title: 'Chapter 2b: The Middle',
      subtitle: '',
      summary: 'Within the last-two live window — unfolded.',
      description: '',
      granularity: 'full',
      status: 'completed',
      startIndex: 20,
      endIndex: 40,
      createdAt: 1760000000000,
    },
    {
      id: 'chap-fx-2c',
      workspaceId: 'proj-fixture',
      threadId: 'thread-fx-2',
      title: 'Chapter 2c: The Long Now',
      subtitle: '',
      summary: 'Active chapter — 44 turns ≈ 74.8k tokens: soft-cap banner + turn window.',
      description: '',
      granularity: 'full',
      status: 'active',
      startIndex: 40,
      createdAt: 1760000000000,
    },
    {
      id: 'chap-fx-3',
      workspaceId: 'proj-fixture',
      threadId: 'thread-fx-3',
      title: 'Chapter 3: Past The Cap',
      subtitle: '',
      summary: 'Crossed 128k with two user turns after → hard-blocked composer.',
      description: '',
      granularity: 'full',
      status: 'active',
      startIndex: 0,
      createdAt: 1760000000000,
    },
  ],
  turns: [
    ...LONG_TURNS,
    ...OVER_CAP_TURNS,
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
        // Flight-recorder linkage (plan doc 30): the receipt the bubble's
        // inspect-call button opens. Journey 24 seeds this exact id into
        // markbrain-call-logs before clicking it — hermetic, no network.
        callId: 'cuj-call-1',
      },    },
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
        subtitle: 'Synthetic artifact A for graph rendering.',
        description: 'Synthetic artifact A for graph rendering.',
        summary: 'Synthetic summary A.',
        body: 'Synthetic body A — proves artifact detail surfaces render.',
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
        subtitle: 'Synthetic artifact B for graph rendering.',
        description: 'Synthetic artifact B for graph rendering.',
        summary: 'Synthetic summary B.',
        body: 'Synthetic body B.',
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
/** Fixture-mode loads: the fixture project for its own id, confirmed absence otherwise. */
export function fixtureProjectSnapshot(projectId: string): ProjectSnapshot | null {
  return projectId === HEADLESS_FIXTURE.projectId ? HEADLESS_FIXTURE : null;
}

/** Fixture-mode listing: exactly the one fixture project. */
export function fixtureProjectList(): ProjectSnapshot[] {
  return [HEADLESS_FIXTURE];
}
