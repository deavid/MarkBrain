/**
 * Package 1 (design-docs/28 §1.5) — the AI upsert bugs, regression-guarded.
 *
 * Bug 1 (client, sendQueue.applyBufferedArtifacts): an <artifact_upsert> on an
 *        existing note recorded a revision but FORGOT the upsertArtifact call —
 *        existing notes never actually changed. Test asserts BOTH happen now:
 *        the upsert applies the new layers AND the revision captures the OLD
 *        layers with chat provenance.
 * Bug 2 (server, projectRepo.commitJobPairTransaction): the server upsert
 *        overwrote the artifact with no revision row. Test runs a real
 *        commit against an in-memory SQLite DB and asserts the
 *        artifact_revisions row holds the OLD state with actor 'ai'.
 *
 * No happy-dom, no network: fetch never fires (the index enqueue stays in-DB).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { SendQueue } from '../application/sendQueue';
import { ArtifactVersioningDomain } from '../domains/01-artifact-versioning/ArtifactVersioningDomain';
import type { ExtractedArtifactUpsert } from '../domains/03-stream-protocol';
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';
import { initDb, closeDbForTests, getDb } from '../../server/db';

process.env.MARKBRAIN_OWNER_EMAIL = 'owner@example.com';
process.env.MARKBRAIN_OWNER_PASSWORD = 'owner-pass-123456';

const EXISTING_ART: UniversalArtifactDocument = {
  id: 'art-1',
  workspaceId: 'proj-1',
  code: 'note-one',
  title: 'Old Title',
  type: 'document',
  category: 'note',
  isHighConcept: false,
  current: {
    subtitle: 'old subtitle',
    description: 'old description',
    summary: 'old summary',
    body: 'old body',
  },
  tags: [],
  createdAt: 1,
  updatedAt: 1,
};

function makeUpsert(id: string, body: string): ExtractedArtifactUpsert {
  return {
    id,
    title: 'New Title',
    type: 'document',
    content: {
      subtitle: 'new subtitle',
      description: 'new description',
      summary: 'new summary',
      body,
    },
  } as ExtractedArtifactUpsert;
}

describe('client path — applyBufferedArtifacts on an existing artifact', () => {
  it('upserts the new layers AND records a revision of the old state with provenance', () => {
    const versioning = new ArtifactVersioningDomain();
    const upsertArtifact = vi.fn((doc: UniversalArtifactDocument) => doc);
    const deps = {
      artifacts: {
        getArtifact: vi.fn((idOrCode: string) =>
          idOrCode === 'note-one' || idOrCode === 'art-1' ? EXISTING_ART : undefined
        ),
        upsertArtifact,
      },
      versioning,
      threadRegistry: { attachArtifact: vi.fn() },
    };
    const queue = new SendQueue(() => deps as never);
    (queue as unknown as {
      applyBufferedArtifacts: (
        chain: unknown,
        threadId: string,
        buffered: ExtractedArtifactUpsert[],
        turnIndex: number,
        turnId: string
      ) => void;
    }).applyBufferedArtifacts(
      { deps: deps as never, ctx: { projectId: 'proj-1' } },
      'thread-1',
      [makeUpsert('note-one', 'new body')],
      3,
      'turn-ai-9'
    );

    // THE BUG: the upsert must actually apply the new layers.
    expect(upsertArtifact).toHaveBeenCalledTimes(1);
    const applied = upsertArtifact.mock.calls[0][0] as UniversalArtifactDocument;
    expect(applied.id).toBe('art-1');
    expect(applied.title).toBe('New Title');
    expect(applied.current).toEqual({
      subtitle: 'new subtitle',
      description: 'new description',
      summary: 'new summary',
      body: 'new body',
    });
    // An AI rewrite touches every layer — any stale flag is cleared.
    expect(applied.layersStaleAt).toBeUndefined();

    // The revision snapshots the OLD state (before the overwrite), with provenance.
    const history = versioning.getHistory('art-1');
    expect(history).toHaveLength(1);
    expect(history[0].actor).toBe('ai');
    expect(history[0].changeSummary).toBe('Update from chat: new description');
    expect(history[0].title).toBe('Old Title');
    expect(history[0].layers).toEqual(EXISTING_ART.current);
    expect(history[0].provenance).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-ai-9',
      turnIndex: 3,
    });
  });

  it('a NEW artifact gets its v1 birth revision with provenance', () => {
    const versioning = new ArtifactVersioningDomain();
    const deps = {
      artifacts: {
        getArtifact: vi.fn(() => undefined),
        upsertArtifact: vi.fn((doc: UniversalArtifactDocument) => doc),
      },
      versioning,
      threadRegistry: { attachArtifact: vi.fn() },
    };
    const queue = new SendQueue(() => deps as never);
    (queue as unknown as {
      applyBufferedArtifacts: (
        chain: unknown,
        threadId: string,
        buffered: ExtractedArtifactUpsert[],
        turnIndex: number,
        turnId: string
      ) => void;
    }).applyBufferedArtifacts(
      { deps: deps as never, ctx: { projectId: 'proj-1' } },
      'thread-1',
      [makeUpsert('art-new-1', 'born body')],
      0,
      'turn-ai-1'
    );
    const history = versioning.getHistory('art-new-1');
    expect(history).toHaveLength(1);
    expect(history[0].version).toBe(1);
    expect(history[0].actor).toBe('ai');
    expect(history[0].layers.body).toBe('born body');
    expect(history[0].provenance?.turnId).toBe('turn-ai-1');
  });
});

describe('server path — commitJobPairTransaction records revisions in SQLite', () => {
  const PROJECT_ID = 'proj-rev-test';
  initDb(':memory:');

  beforeAll(async () => {
    const { ensureOwnerBootstrap } = await import('../../server/lib/users');
    ensureOwnerBootstrap();
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO projects (project_id, user_id, name, code_name, description, color, active_thread_id,
         granularity_law, revision, updated_at) VALUES (?, 1, 'Rev Test', 'revtest', '', '#e05a66', NULL, 'user-only', 1, ?)`
    ).run(PROJECT_ID, now);
    db.prepare(
      `INSERT INTO threads (user_id, project_id, thread_id, title, title_version, folder_id, created_at, updated_at, doc_json, revision)
       VALUES (1, ?, ?, 'Thread', 1, NULL, ?, ?, ?, 1)`
    ).run(PROJECT_ID, 'thread-1', now, now, JSON.stringify({ id: 'thread-1', title: 'Thread', attachments: [] }));
    // An artifact whose server doc still holds the OLD state.
    db.prepare(
      `INSERT INTO artifacts (user_id, project_id, artifact_id, doc_json, updated_at, revision) VALUES (1, ?, ?, ?, ?, 1)`
    ).run(PROJECT_ID, 'art-1', JSON.stringify(EXISTING_ART), now);
  });

  afterAll(() => {
    closeDbForTests();
  });

  function revisionRows(): Array<{ version: number; actor: string; title: string; layers_json: string }> {
    return getDb()
      .prepare(
        'SELECT version, actor, title, layers_json FROM artifact_revisions WHERE user_id = 1 AND project_id = ? AND artifact_id = ? ORDER BY version ASC'
      )
      .all(PROJECT_ID, 'art-1') as Array<{ version: number; actor: string; title: string; layers_json: string }>;
  }

  it('an upsert of an existing artifact inserts an artifact_revisions row with the OLD layers and actor ai', async () => {
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
          id: 'art-1',
          title: 'New Title',
          type: 'document',
          content: { subtitle: 'new subtitle', description: 'new description', summary: 'new summary', body: 'new body' },
        },
      ],
      shifts: [],
      pairKey: 'pair-rev-1',
    });

    const rows = revisionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe('ai');
    expect(rows[0].title).toBe('Old Title'); // the OLD title, snapshotted pre-overwrite
    const layers = JSON.parse(rows[0].layers_json);
    expect(layers).toEqual(EXISTING_ART.current);
    expect(rows[0].version).toBe(1);

    // And the artifact itself really moved to the new state.
    const doc = JSON.parse(
      (
        getDb()
          .prepare('SELECT doc_json FROM artifacts WHERE user_id = 1 AND project_id = ? AND artifact_id = ?')
          .get(PROJECT_ID, 'art-1') as { doc_json: string }
      ).doc_json
    );
    expect(doc.current.body).toBe('new body');
  });

  it('a NEW artifact gets its version-1 birth revision', async () => {
    const { commitJobPairTransaction } = await import('../../server/db/projectRepo');
    commitJobPairTransaction({
      userId: 1,
      projectId: PROJECT_ID,
      threadId: 'thread-1',
      kind: 'send',
      targetTurnId: null,
      askText: 'ask 2',
      replyText: 'reply 2',
      model: 'gemini-free',
      stagedAttachments: [],
      artifacts: [
        {
          id: 'art-new-2',
          title: 'Fresh Note',
          type: 'document',
          content: { subtitle: '', description: 'born desc', summary: '', body: 'born body' },
        },
      ],
      shifts: [],
      pairKey: 'pair-rev-2',
    });
    const rows = getDb()
      .prepare(
        'SELECT version, actor, title, layers_json FROM artifact_revisions WHERE user_id = 1 AND project_id = ? AND artifact_id = ?'
      )
      .all(PROJECT_ID, 'art-new-2') as Array<{ version: number; actor: string; title: string; layers_json: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].actor).toBe('ai');
    expect(JSON.parse(rows[0].layers_json).body).toBe('born body');
  });

  it('deleting an artifact deletes its revision rows too', async () => {
    const { applyAtomicMutation } = await import('../../server/db/projectRepo');
    applyAtomicMutation(1, PROJECT_ID, [{ op: 'deleteArtifact', artifactId: 'art-1' } as never]);
    expect(revisionRows()).toHaveLength(0);
  });
});
