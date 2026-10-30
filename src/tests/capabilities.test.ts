/**
 * Package 2 (design-docs/28 §2) — chat capability toggles.
 *
 * Locks down:
 *   1. resolveCapabilities merge order: DEFAULT ← project default ← thread.
 *   2. The compiler teaches a capability's XML block ONLY when it is ON; all
 *      three OFF → none of the schema words appear in the system instruction.
 *   3. The client apply path ignores rogue buffered shifts/upserts when the
 *      capability is OFF.
 *   4. The server commit path (commitJobPairTransaction, :memory: SQLite)
 *      gates exactly the same way.
 *
 * No happy-dom, no network: fetch never fires.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  DEFAULT_CHAT_CAPABILITIES,
  resolveCapabilities,
} from '../domains/06-chat-threads/types';
import {
  OpticalCompilerDomain,
  buildSystemInstruction,
} from '../domains/03-optical-compiler';
import { ArtifactDocumentDomain } from '../domains/01-artifact-document';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline';
import { SendQueue } from '../application/sendQueue';
import { planTurnCommit } from '../../shared/turnCommit/planTurnCommit';
import type { ExtractedTopicShift } from '../domains/03-stream-protocol';
import { initDb, closeDbForTests, getDb } from '../../server/db';

process.env.MARKBRAIN_OWNER_EMAIL = 'owner@example.com';
process.env.MARKBRAIN_OWNER_PASSWORD = 'owner-pass-123456';

describe('resolveCapabilities — DEFAULT ← project ← thread', () => {
  it('absent everything → the defaults', () => {
    expect(resolveCapabilities(null, null)).toEqual(DEFAULT_CHAT_CAPABILITIES);
    expect(resolveCapabilities(undefined)).toEqual(DEFAULT_CHAT_CAPABILITIES);
  });

  it('a project default overrides the default; the thread overrides the project', () => {
    const project = { autoChapter: true, graphLinks: true };
    expect(resolveCapabilities(null, project)).toEqual({
      autoChapter: true,
      writeArtifacts: true,
      graphLinks: true,
    });
    const thread = { autoChapter: false };
    expect(resolveCapabilities({ capabilities: thread }, project)).toEqual({
      autoChapter: false, // thread wins
      writeArtifacts: true,
      graphLinks: true,
    });
  });

  it('an empty thread partial falls through field by field', () => {
    expect(resolveCapabilities({ capabilities: {} }, { writeArtifacts: false })).toEqual({
      autoChapter: false,
      writeArtifacts: false,
      graphLinks: false,
    });
  });
});

describe('compiler — capability blocks in the system instruction', () => {
  it('all three OFF → none of the schema words appear at all', () => {
    const sys = buildSystemInstruction({
      autoChapter: false,
      writeArtifacts: false,
      graphLinks: false,
    });
    expect(sys).not.toContain('topic_shift');
    expect(sys).not.toContain('artifact_upsert');
    expect(sys).not.toContain('<link');
    // The base persona and the style law always ride along.
    expect(sys).toContain('You are MarkBrain');
    expect(sys).toContain('book report');
  });

  it('each flag independently adds its own block — and nothing else', () => {
    const auto = buildSystemInstruction({ autoChapter: true, writeArtifacts: false, graphLinks: false });
    expect(auto).toContain('topic_shift');
    expect(auto).not.toContain('artifact_upsert');
    expect(auto).not.toContain('<link');
    // The "rare" guidance sentence rides with the autoChapter block.
    expect(auto).toContain('Topic changes are rare');

    const notes = buildSystemInstruction({ autoChapter: false, writeArtifacts: true, graphLinks: false });
    expect(notes).toContain('artifact_upsert');
    expect(notes).not.toContain('topic_shift');
    expect(notes).not.toContain('<link');

    const links = buildSystemInstruction({ autoChapter: false, writeArtifacts: false, graphLinks: true });
    expect(links).toContain('<link');
    expect(links).not.toContain('topic_shift');
    expect(links).not.toContain('artifact_upsert');
  });

  it('compile() with capabilities omitted compiles the DEFAULT system instruction', () => {
    const artifacts = new ArtifactDocumentDomain('p', []);
    const segmentation = new ChapterSegmentationDomain('p', []);
    const timeline = new DialogueTimelineDomain('p', []);
    const compiler = new OpticalCompilerDomain(artifacts, segmentation, timeline);
    const out = compiler.compile({ attachments: [] });
    expect(out.systemInstruction).toBe(buildSystemInstruction(DEFAULT_CHAT_CAPABILITIES));
    expect(out.systemInstruction).toContain('artifact_upsert'); // writeArtifacts defaults ON
  });
});

describe('client apply path — rogue blocks are ignored when OFF (Phase 3: via the shared planner)', () => {
  function planWith(autoChapter: boolean) {
    return planTurnCommit({
      kind: 'send',
      threadId: 'thread-1',
      pairKey: 'pair-1',
      projectId: 'p1',
      askText: 'ask',
      cleanReply: 'reply',
      artifactUpserts: [],
      topicShift: { title: 'Rogue Chapter', subtitle: 'nope' },
      links: [],
      unlinks: [],
      stagedAttachments: [],
      capabilities: { ...DEFAULT_CHAT_CAPABILITIES, autoChapter },
      now: 1,
      ids: { userTurnId: 'u', assistantTurnId: 'a' },
      state: { artifacts: [], edges: [], threadTurnsCount: 2, chapters: [] },
    });
  }

  function makeDeps() {
    const upsertBoundary = vi.fn();
    const deps = {
      threadRegistry: {
        getActiveThreadId: () => 'thread-1',
        commitStagedAttachments: vi.fn(() => 0),
        attachArtifact: vi.fn(),
        ensureAttached: vi.fn(),
        patch: vi.fn(),
      },
      // Phase 4: the applier writes through the thread-keyed domain methods.
      timeline: { turnsFor: () => [], appendTurnFor: vi.fn(() => ({ id: 't' })), updateTurnFor: vi.fn() },
      artifacts: { upsertArtifact: vi.fn() },
      versioning: { recordSnapshot: vi.fn() },
      segmentation: { chaptersFor: () => [], upsertChapterAtBoundaryFor: upsertBoundary },
      triggerReRender: vi.fn(),
    };
    const queue = new SendQueue(() => deps as never);
    return { queue, upsertBoundary, deps };
  }

  it('autoChapter OFF → the planner emits NO chapter op, a rogue shift applies nothing', () => {
    const plan = planWith(false);
    expect(plan.chapterOp).toBeNull();
    const { queue, upsertBoundary, deps } = makeDeps();
    (queue as unknown as {
      applyTurnCommitPlan: (deps: unknown, threadId: string, plan: unknown) => void;
    }).applyTurnCommitPlan(deps, 'thread-1', plan);
    expect(upsertBoundary).not.toHaveBeenCalled();
  });

  it('autoChapter ON → the shift applies as before (askIndex = the ask)', () => {
    const plan = planWith(true);
    expect(plan.chapterOp).not.toBeNull();
    expect(plan.chapterOp!.askIndex).toBe(2);
    const { queue, upsertBoundary, deps } = makeDeps();
    (queue as unknown as {
      applyTurnCommitPlan: (deps: unknown, threadId: string, plan: unknown) => void;
    }).applyTurnCommitPlan(deps, 'thread-1', plan);
    expect(upsertBoundary).toHaveBeenCalledTimes(1);
    expect(upsertBoundary.mock.calls[0][1]).toBe('Rogue Chapter');
    expect(upsertBoundary.mock.calls[0][2]).toBe(2);
  });
});

describe('server commit path — commitJobPairTransaction gates the same way', () => {
  const PROJECT_ID = 'proj-caps-test';
  initDb(':memory:');

  beforeAll(async () => {
    const { ensureOwnerBootstrap } = await import('../../server/lib/users');
    ensureOwnerBootstrap();
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO projects (project_id, user_id, name, code_name, description, color, active_thread_id,
         granularity_law, revision, updated_at) VALUES (?, 1, 'Caps', 'caps', '', '#e05a66', NULL, 'user-only', 1, ?)`
    ).run(PROJECT_ID, now);
    db.prepare(
      `INSERT INTO threads (user_id, project_id, thread_id, title, title_version, folder_id, created_at, updated_at, doc_json, revision)
       VALUES (1, ?, ?, 'Thread', 1, NULL, ?, ?, ?, 1)`
    ).run(PROJECT_ID, 'thread-1', now, now, JSON.stringify({ id: 'thread-1', title: 'Thread', attachments: [] }));
  });

  afterAll(() => {
    closeDbForTests();
  });

  function artifactCount(): number {
    return (
      getDb()
        .prepare('SELECT COUNT(*) AS n FROM artifacts WHERE user_id = 1 AND project_id = ?')
        .get(PROJECT_ID) as { n: number }
    ).n;
  }

  function chapterCount(): number {
    return (
      getDb()
        .prepare('SELECT COUNT(*) AS n FROM chapters WHERE user_id = 1 AND project_id = ?')
        .get(PROJECT_ID) as { n: number }
    ).n;
  }

  async function commit(overrides: Record<string, unknown>): Promise<void> {
    const { commitJobPairTransaction } = await import('../../server/db/projectRepo');
    commitJobPairTransaction({
      userId: 1,
      projectId: PROJECT_ID,
      threadId: 'thread-1',
      kind: 'send',
      targetTurnId: null,
      askText: 'ask',
      replyText: 'reply',
      model: 'gemini-free',
      stagedAttachments: [],
      artifacts: [
        {
          id: 'rogue-1',
          title: 'Rogue Note',
          type: 'document',
          content: { subtitle: 's', description: 'd', summary: 'm', body: 'b' },
        },
      ],
      shifts: [{ title: 'Rogue Chapter', subtitle: 'nope' }],
      pairKey: 'pair-caps-1',
      ...overrides,
    });
  }

  it('writeArtifacts OFF → the rogue artifact is NEVER written; shifts ignored too', async () => {
    const before = artifactCount();
    await commit({ capabilities: { autoChapter: false, writeArtifacts: false, graphLinks: false } });
    expect(artifactCount()).toBe(before);
    expect(chapterCount()).toBe(0);
  });

  it('capabilities ON → the artifact lands and the chapter is cut', async () => {
    await commit({
      capabilities: { autoChapter: true, writeArtifacts: true, graphLinks: false },
      pairKey: 'pair-caps-2',
    });
    expect(artifactCount()).toBe(1);
    expect(chapterCount()).toBe(1);
  });

  it('capabilities ABSENT → legacy behavior: defaults apply (notes written, no auto chapters)', async () => {
    await commit({ artifacts: [], pairKey: 'pair-caps-3' });
    expect(chapterCount()).toBe(1); // from pair-caps-2; the absent-caps commit added no shift chapter
  });
});
