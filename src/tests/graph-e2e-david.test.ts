/**
 * DAVID'S TEST (2026-10-30, verbatim spirit):
 *   1. Put some documents that clearly relate to each other as artifacts
 *   2. Ask the LLM to emit links
 *   3. Fake the LLM output to return the links
 *   4. Prove the links got stored
 *   5. Prove the links are visible from the graph interface
 *
 * The "fake LLM output" is not synthetic — it is David's REAL 14:22 reply
 * captured in the flight recorder (call-mvv2a7os-xvpzx2, 14 <link> tags),
 * exactly what the provider answered. The pipeline under test is the full
 * server half: demuxFullTurn (what the runner does with the raw stream) →
 * commitJobPairTransaction (what the runner passes) → edges in the DB →
 * assembleProject (what GET /api/projects/:id feeds the graph view).
 *
 * Runs on an in-memory DB. No provider, no network, no live data.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDbForTests, getDb } from '../../server/db';
import { StreamProtocolDomain } from '../../src/domains/03-stream-protocol';
import type { UniversalArtifactDocument } from '../../src/domains/01-artifact-document/types';

process.env.MARKBRAIN_OWNER_EMAIL = 'owner@example.com';
process.env.MARKBRAIN_OWNER_PASSWORD = 'owner-pass-123456';

const PROJECT_ID = 'proj-graph-e2e';
const THREAD_ID = 'thread-e2e';

/** The REAL raw LLM answer (flight recorder, 14:22 reply — 14 <link> tags). */
const RAW_LLM_OUTPUT = `These links trace the direct lineage of the project.

<link source="unhaunter-classic-mode-scope.md" target="unhaunter-v0-3-0-playtest-learnings.md" kind="refines" />
<link source="unhaunter-v0-3-0-playtest-learnings.md" target="unhaunter-stream-feedback-analysis.md" kind="relates_to" />
<link source="ghost-investigation-genre-comparative-analysis.md" target="escape-game-mode-design.md" kind="born_from" />
<link source="escape-game-mode-design.md" target="unhaunter-orion-v1-0-roadmap.md" kind="refines" />
<link source="random-topics-to-v1-0.md" target="unhaunter-orion-v1-0-roadmap.md" kind="refines" />
<link source="unhaunter-development-challenges-and-architecture.md" target="unhaunter-light-and-visibility-modeling.md" kind="parent_of" />
<link source="unhaunter-board-tile-sizes.md" target="unhaunter-development-challenges-and-architecture.md" kind="born_from" />
<link source="unhaunter-design-random-notes.md" target="unhaunter-design-and-mechanics-specification.md" kind="born_from" />
<link source="unhaunter-multiplayer-architecture.md" target="unhaunter-current-systems-reference.md" kind="refines" />
<link source="unhaunter-vision-narrative.md" target="unhaunter-vision-high-level-design.md" kind="relates_to" />
<link source="unhaunter-vision-high-level-design.md" target="unhaunter-game-design-reference.md" kind="relates_to" />
<link source="unhaunter-classic-mode-scope.md" target="unhaunter-campaign-progression-and-economy.md" kind="child_of" />
<link source="unhaunter-classic-mode-scope.md" target="unhaunter-current-systems-reference.md" kind="parent_of" />
<link source="unhaunter-long-term-vision-and-design-goals.md" target="unhaunter-orion-v1-0-roadmap.md" kind="refines" />

These links trace the direct lineage of the project: the early tile sizes and design notes feeding into core architecture and specifications.`;

function turnDoc(turnId: string): Record<string, unknown> {
  const row = getDb()
    .prepare('SELECT doc_json FROM turns WHERE user_id = 1 AND project_id = ? AND turn_id = ?')
    .get(PROJECT_ID, turnId) as { doc_json: string };
  return JSON.parse(row.doc_json);
}

describe('DAVID GRAPH E2E — emit links → stored → visible in the graph view', () => {
  initDb(':memory:');

  beforeAll(async () => {
    const { ensureOwnerBootstrap } = await import('../../server/lib/users');
    ensureOwnerBootstrap();
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO projects (project_id, user_id, name, code_name, description, color, active_thread_id,
         granularity_law, revision, updated_at) VALUES (?, 1, 'Graph E2E', 'graphe2e', '', '#e05a66', NULL, 'user-only', 1, ?)`
    ).run(PROJECT_ID, now);
    db.prepare(
      `INSERT INTO threads (user_id, project_id, thread_id, title, title_version, folder_id, created_at, updated_at, doc_json, revision)
       VALUES (1, ?, ?, 'Thread', 1, NULL, ?, ?, ?, 1)`
    ).run(PROJECT_ID, THREAD_ID, now, now, JSON.stringify({ id: THREAD_ID, title: 'Thread', attachments: [] }));

    // STEP 1 — documents that clearly relate, as artifacts. One per slug the
    // model references: the artifacts' codes ARE the file names it links by.
    const slugs = [...new Set([...RAW_LLM_OUTPUT.matchAll(/(?:source|target)="([^"]+\.md)"/gi)].map((m) => m[1]))];
    for (const file of slugs) {
      const code = file.replace(/\.md$/i, '');
      const doc: UniversalArtifactDocument = {
        id: `art-${code}`,
        workspaceId: PROJECT_ID,
        code,
        title: code.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        type: 'document',
        category: 'note',
        isHighConcept: false,
        current: { subtitle: '', description: '', summary: '', body: `# ${code}` },
        tags: [],
        createdAt: now,
        updatedAt: now,
      } as unknown as UniversalArtifactDocument;
      db.prepare(
        `INSERT INTO artifacts (user_id, project_id, artifact_id, doc_json, updated_at, revision) VALUES (1, ?, ?, ?, ?, 1)`
      ).run(PROJECT_ID, doc.id, JSON.stringify(doc), now);
    }
  });

  afterAll(() => {
    closeDbForTests();
  });

  it('fake LLM output with links → stored as edges → returned by the graph read path', async () => {
    const { commitJobPairTransaction, loadProjectForUser } = await import('../../server/db/projectRepo');

    // STEPS 2+3 — the ask happened; the fake LLM output is RAW_LLM_OUTPUT.
    // The server half of the pipeline, composed EXACTLY as the runner does:
    const domain = new StreamProtocolDomain();
    const demuxed = domain.demuxFullTurn(RAW_LLM_OUTPUT);
    commitJobPairTransaction({
      userId: 1,
      projectId: PROJECT_ID,
      threadId: THREAD_ID,
      kind: 'send',
      targetTurnId: null,
      askText: 'how do my artifacts/docs relate to each other? link them.',
      replyText: demuxed.cleanText.trim(), // what the runner passes (tags stripped)
      links: demuxed.links,                // what the runner MUST pass through
      model: 'gemini-3.5-flash-lite',
      stagedAttachments: [],
      artifacts: [],
      shifts: [],
      capabilities: { graphLinks: true, writeArtifacts: true, autoChapter: false },
      pairKey: 'job-e2e-0001',
    });

    // STEP 4 — the links got STORED: one edge per <link>, ids resolved.
    const db = getDb();
    const edgeCount = (db
      .prepare('SELECT COUNT(*) AS c FROM edges WHERE user_id = 1 AND project_id = ?')
      .get(PROJECT_ID) as { c: number }).c;
    expect(edgeCount).toBe(14);


    // STEP 5 — VISIBLE FROM THE GRAPH INTERFACE: the graph view reads the
    // project payload (GET /api/projects/:id → loadProjectForUser →
    // snapshot.edges → SpatialGraph draws them). Assert the read path
    // returns every edge.
    const snap = loadProjectForUser(1, PROJECT_ID);
    expect(snap).toBeTruthy();
    expect(snap!.edges.length).toBe(14);
    // The graph receives REAL resolved edges, not slug soup: both ends are
    // artifact ids.
    for (const e of snap!.edges) {
      expect(e.sourceId).toMatch(/^art-/);
      expect(e.targetId).toMatch(/^art-/);
    }

    // Spot-check resolution: the slug actually maps to the artifact id.
    const refines = snap!.edges.find((e) => e.kind === 'refines' && e.sourceId === 'art-unhaunter-classic-mode-scope');
    expect(refines).toBeTruthy();
    expect(refines!.targetId).toBe('art-unhaunter-v0-3-0-playtest-learnings');


    // And the reply turn carries the receipts the chat renders.
    const turnRow = db
      .prepare('SELECT doc_json FROM turns WHERE user_id = 1 AND project_id = ? AND turn_id = ?')
      .get(PROJECT_ID, 'turn-ai-job-e2e-0001') as { doc_json: string };
    const turn = JSON.parse(turnRow.doc_json);
    expect(turn.extractedLinks).toHaveLength(14);
    expect(turn.extractedLinks.every((l: { applied: boolean }) => l.applied)).toBe(true);
    expect((turn.content as string).includes('<link')).toBe(false);
  });

  it('unlink breaks the link: edge deleted, tombstone, unlink receipt', async () => {
    const { commitJobPairTransaction } = await import('../../server/db/projectRepo');
    // Use two notes seeded in the project (classic-mode-scope & playtest).
    const l = new StreamProtocolDomain().demuxFullTurn(
      '<link source="unhaunter-classic-mode-scope.md" target="unhaunter-v0-3-0-playtest-learnings.md" kind="relates_to" />'
    );
    commitJobPairTransaction({
      userId: 1, projectId: PROJECT_ID, threadId: THREAD_ID, kind: 'send',
      targetTurnId: null, askText: 'link', replyText: l.cleanText.trim(),
      links: l.links, model: 'm', stagedAttachments: [], artifacts: [], shifts: [],
      capabilities: { graphLinks: true, writeArtifacts: true, autoChapter: false },
      pairKey: 'job-ul-1',
    });
    const before = (getDb().prepare('SELECT COUNT(*) c FROM edges WHERE user_id = 1 AND project_id = ?').get(PROJECT_ID) as { c: number }).c;

    // kind given → EXACTLY one edge dies (the pair also has a 'refines' edge
    // from the e2e above — a kind-less unlink would take both, by contract).
    const u = new StreamProtocolDomain().demuxFullTurn('<unlink source="unhaunter-classic-mode-scope.md" target="unhaunter-v0-3-0-playtest-learnings.md" kind="relates_to" />');
    commitJobPairTransaction({
      userId: 1, projectId: PROJECT_ID, threadId: THREAD_ID, kind: 'send',
      targetTurnId: null, askText: 'break it', replyText: u.cleanText.trim(),
      unlinks: u.unlinks, model: 'm', stagedAttachments: [], artifacts: [], shifts: [],
      capabilities: { graphLinks: true, writeArtifacts: true, autoChapter: false },
      pairKey: 'job-ul-2',
    });

    const after = (getDb().prepare('SELECT COUNT(*) c FROM edges WHERE user_id = 1 AND project_id = ?').get(PROJECT_ID) as { c: number }).c;
    const snap_after = (await import('../../server/db/projectRepo')).loadProjectForUser(1, PROJECT_ID);
    expect(after).toBe(before - 1);
    const tombs = getDb()
      .prepare("SELECT entity_id FROM tombstones WHERE user_id = 1 AND project_id = ? AND entity_type = 'edge'")
      .all(PROJECT_ID) as Array<{ entity_id: string }>;
    expect(tombs.length).toBe(1);
    // The other kind between the same pair survives.
    expect(snap_after!.edges.some((e) => e.kind === 'refines' && e.sourceId === 'art-unhaunter-classic-mode-scope')).toBe(true);
    const doc = turnDoc('turn-ai-job-ul-2');
    const receipts = doc.extractedLinks as Array<Record<string, unknown>>;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ action: 'unlink', applied: true, sourceFile: 'unhaunter-classic-mode-scope.md', targetFile: 'unhaunter-v0-3-0-playtest-learnings.md' });
  });
});
