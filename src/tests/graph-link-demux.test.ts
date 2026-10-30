/**
 * Graph-link demux (David's receipts law, 2026-10-30) — regression-guarded.
 *
 * Found live: the system instruction teaches <link source target kind/> when
 * graphLinks is ON, the model dutifully emitted ~10 per reply — and NOTHING
 * applied them. The tags rode the stored reply verbatim ("XML flying" in Raw
 * view, invisible HTML in rendered view), the edges table stayed at zero, and
 * no receipt ever appeared. Two replies from David's own session are in the
 * flight recorder proving it.
 *
 * These tests run commitJobPairTransaction against in-memory SQLite and
 * assert: tags stripped from stored prose, edges RESOLVED to artifact ids and
 * upserted when the capability is ON, receipts carried on the turn doc, and
 * nothing applied (but still stripped) when the capability is OFF.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDbForTests, getDb } from '../../server/db';

process.env.MARKBRAIN_OWNER_EMAIL = 'owner@example.com';
process.env.MARKBRAIN_OWNER_PASSWORD = 'owner-pass-123456';

const PROJECT_ID = 'proj-links-test';
const REPLY =
  'Here is my take.\n\n' +
  '<link source="note-one.md" target="note-two.md" kind="relates_to" />\n\n' +
  'More prose in between.\n\n' +
  '<link source="note-two.md" target="missing-note.md" kind="refines" />\n\n' +
  'And a malformed one: <link source="x.md" > no kind, dropped.\n\nDone.';

function seed(): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (project_id, user_id, name, code_name, description, color, active_thread_id,
       granularity_law, revision, updated_at) VALUES (?, 1, 'Links', 'links', '', '#e05a66', NULL, 'user-only', 1, ?)`
  ).run(PROJECT_ID, now);
  db.prepare(
    `INSERT INTO threads (user_id, project_id, thread_id, title, title_version, folder_id, created_at, updated_at, doc_json, revision)
     VALUES (1, ?, ?, 'Thread', 1, NULL, ?, ?, ?, 1)`
  ).run(PROJECT_ID, 'thread-1', now, now, JSON.stringify({ id: 'thread-1', title: 'Thread', attachments: [] }));
  const art = (id: string, code: string, title: string) =>
    db.prepare(
      `INSERT INTO artifacts (user_id, project_id, artifact_id, doc_json, updated_at, revision) VALUES (1, ?, ?, ?, ?, 1)`
    ).run(PROJECT_ID, id, JSON.stringify({
      id,
      workspaceId: PROJECT_ID,
      code,
      title,
      type: 'document',
      category: 'note',
      isHighConcept: false,
      current: { subtitle: '', description: '', summary: '', body: 'body' },
      tags: [],
      createdAt: now,
      updatedAt: now,
    }), now);
  art('art-1', 'note-one', 'Note One');
  art('art-2', 'note-two', 'Note Two');
}

function turnDoc(turnId: string): Record<string, unknown> {
  const row = getDb()
    .prepare('SELECT doc_json FROM turns WHERE user_id = 1 AND project_id = ? AND turn_id = ?')
    .get(PROJECT_ID, turnId) as { doc_json: string };
  return JSON.parse(row.doc_json);
}

describe('graph-link demux in commitJobPairTransaction', () => {
  initDb(':memory:');

  beforeAll(async () => {
    const { ensureOwnerBootstrap } = await import('../../server/lib/users');
    ensureOwnerBootstrap();
    seed();
  });

  afterAll(() => {
    closeDbForTests();
  });

  it('capability ON: strips tags from prose, upserts resolved edges, rides receipts on the turn', async () => {
    const { commitJobPairTransaction } = await import('../../server/db/projectRepo');
    const { revision } = commitJobPairTransaction({
      userId: 1,
      projectId: PROJECT_ID,
      threadId: 'thread-1',
      kind: 'send',
      targetTurnId: null,
      askText: 'link my notes',
      replyText: REPLY,
      model: 'gemini-free',
      stagedAttachments: [],
      artifacts: [],
      shifts: [],
      capabilities: { graphLinks: true, writeArtifacts: true, autoChapter: false },
      pairKey: 'job-lx1-aaa',
    });

    // Prose is clean — not one <link> tag survives in the stored turn.
    const doc = turnDoc('turn-ai-job-lx1-aaa');
    expect((doc.content as string).includes('<link')).toBe(false);
    expect((doc.content as string).includes('Here is my take.')).toBe(true);

    // The resolvable link became a REAL edge with resolved artifact ids.
    const edges = getDb()
      .prepare('SELECT edge_id, edge_json FROM edges WHERE user_id = 1 AND project_id = ?')
      .all(PROJECT_ID) as Array<{ edge_id: string; edge_json: string }>;
    expect(edges).toHaveLength(1);
    const edge = JSON.parse(edges[0].edge_json);
    expect(edge.sourceId).toBe('art-1');
    expect(edge.targetId).toBe('art-2');
    expect(edge.kind).toBe('relates_to');
    void revision;

    // Receipts ride the turn: BOTH links (the unresolvable one is a receipt
    // with null ids — the proof the model ASKED, even when it cannot land).
    const receipts = doc.extractedLinks as Array<Record<string, unknown>>;
    expect(receipts).toHaveLength(2);
    expect(receipts[0]).toMatchObject({ sourceId: 'art-1', targetId: 'art-2', kind: 'relates_to', applied: true });
    expect(receipts[1]).toMatchObject({ sourceId: 'art-2', targetId: null, kind: 'refines', applied: false });
  });

  it('PIPELINE regression: demux → commit handoff preserves links the way the runner actually calls it', async () => {
    // THE REAL SEQUENCE (server/jobs/chatJobRunner.ts): the runner demuxes the
    // raw provider text and hands the commit the CLEAN text — the tags are
    // gone by the time commitJobPairTransaction runs. The demuxer parses the
    // links into demuxed.links; the runner must pass them through. This test
    // failed against the first "fix", which re-parsed a replyText that never
    // contains tags — a seam the real pipeline does not have.
    const { StreamProtocolDomain } = await import('../../src/domains/03-stream-protocol');
    const { commitJobPairTransaction } = await import('../../server/db/projectRepo');

    const raw =
      'Prose first.\n\n' +
      '<link source="note-one.md" target="note-two.md" kind="relates_to" />\n\n' +
      'Prose after.';
    const demuxed = new StreamProtocolDomain().demuxFullTurn(raw);
    expect(demuxed.links).toHaveLength(1); // the demuxer parsed it

    commitJobPairTransaction({
      userId: 1,
      projectId: PROJECT_ID,
      threadId: 'thread-1',
      kind: 'send',
      targetTurnId: null,
      askText: 'pipeline ask',
      replyText: demuxed.cleanText.trim(), // ← what the runner actually passes
      links: demuxed.links,               // ← what the runner MUST pass through
      model: 'gemini-free',
      stagedAttachments: [],
      artifacts: [],
      shifts: [],
      capabilities: { graphLinks: true, writeArtifacts: true, autoChapter: false },
      pairKey: 'job-lx3-ccc',
    });

    const edges = getDb()
      .prepare('SELECT edge_json FROM edges WHERE user_id = 1 AND project_id = ?')
      .all(PROJECT_ID) as Array<{ edge_json: string }>;
    const linkEdge = edges.map((e) => JSON.parse(e.edge_json)).find((e) => e.kind === 'relates_to' && e.sourceId === 'art-1' && e.targetId === 'art-2');
    expect(linkEdge).toBeTruthy(); // ← FAILED before the runner passed links through

    const doc = turnDoc('turn-ai-job-lx3-ccc');
    expect((doc.content as string).includes('<link')).toBe(false);
    expect((doc.extractedLinks as unknown[]).length).toBe(1);
  });

  it('capability OFF: no edges, tags still stripped — but the ATTEMPT is a visible receipt', async () => {
    const { commitJobPairTransaction } = await import('../../server/db/projectRepo');
    commitJobPairTransaction({
      userId: 1,
      projectId: PROJECT_ID,
      threadId: 'thread-1',
      kind: 'send',
      targetTurnId: null,
      askText: 'again',
      replyText: REPLY,
      model: 'gemini-free',
      stagedAttachments: [],
      artifacts: [],
      shifts: [],
      // capabilities absent → defaults → graphLinks: false
      pairKey: 'job-lx2-bbb',
    });

    const edges = getDb()
      .prepare('SELECT edge_id FROM edges WHERE user_id = 1 AND project_id = ?')
      .all(PROJECT_ID);
    expect(edges).toHaveLength(1); // unchanged from the ON test — nothing applied
    const doc = turnDoc('turn-ai-job-lx2-bbb');
    expect((doc.content as string).includes('<link')).toBe(false);
    // David's receipts law: an IGNORED attempt is exactly what must be
    // visible — silently dropping it is the "XML flying, nothing applied" bug.
    const receipts = doc.extractedLinks as Array<Record<string, unknown>>;
    expect(receipts).toHaveLength(2);
    expect(receipts.every((r) => r.applied === false)).toBe(true);
  });
});
