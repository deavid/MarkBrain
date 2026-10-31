/**
 * The demux outcome, RECORDED (plan doc 30 Phase 4).
 *
 * The inspector's "Extracted Actions" view needs data that was thrown away:
 * what the demuxer extracted from the reply and what the commit planner
 * DID with it — applied or ignored, and WHY. That decision lives in the
 * pure planner (planTurnCommit), so the outcome is derived there — pure,
 * shared by the client and server commit paths — and stored on the
 * flight-recorder row.
 *
 * Also pinned here: `usageEstimated` — the honest provider-reported vs
 * estimated flag. (The fixture stream fabricates usage; without the flag
 * the "Provider-reported" label would lie.)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { planTurnCommit, callOutcome, type TurnCommitRequest } from '../../shared/turnCommit/planTurnCommit';
import type { ChatCapabilities } from '../../shared/types/threads';
import { initDb, getDb, closeDbForTests } from '../../server/db';

const CAPS: ChatCapabilities = { autoChapter: true, writeArtifacts: true, graphLinks: true };

function baseReq(over: Partial<TurnCommitRequest>): TurnCommitRequest {
  return {
    kind: 'send',
    threadId: 't1',
    pairKey: 'p1',
    projectId: 'proj1',
    askText: 'the ask',
    cleanReply: 'The clean reply.',
    artifactUpserts: [],
    topicShift: null,
    links: [],
    unlinks: [],
    stagedAttachments: [],
    capabilities: CAPS,
    now: 1000,
    ids: { userTurnId: 'turn-u', assistantTurnId: 'turn-a' },
    state: { artifacts: [], edges: [], threadTurnsCount: 0, chapters: [] },
    ...over,
  };
}

const upsert = (id: string, title: string) => ({
  id,
  title,
  type: 'document' as const,
  content: { subtitle: 's', description: 'd', summary: 'sum', body: 'b' },
});

describe('callOutcome — what the demuxer extracted and what the planner did with it', () => {
  it('a new artifact upsert becomes CREATED; an existing one UPDATED', () => {
    const req = baseReq({ artifactUpserts: [upsert('brand-new-note', 'Brand New Note'), upsert('coin-debasement', 'Coin Debasement')] });
    const plan = planTurnCommit({
      ...req,
      state: { ...req.state, artifacts: [{ id: 'a1', code: 'coin-debasement', title: 'Coin Debasement' }] },
    });
    const o = callOutcome(req, plan);
    expect(o.artifacts).toHaveLength(2);
    expect(o.artifacts[0]).toMatchObject({ file: 'brand-new-note', result: 'created' });
    expect(o.artifacts[1]).toMatchObject({ file: 'coin-debasement', result: 'updated' });
  });

  it('writeArtifacts OFF: every upsert is DROPPED, with the reason', () => {
    const req = baseReq({
      capabilities: { ...CAPS, writeArtifacts: false },
      artifactUpserts: [upsert('note-x', 'Note X')],
    });
    const o = callOutcome(req, planTurnCommit(req));
    expect(o.artifacts[0]).toMatchObject({ file: 'note-x', result: 'dropped', reason: 'writeArtifacts is off' });
  });

  it('topicShift with autoChapter ON: applied, and the plan says what happened to the chapter', () => {
    const req = baseReq({ topicShift: { title: 'The Crisis' } });
    const o = callOutcome(req, planTurnCommit(req));
    expect(o.topicShift).toMatchObject({ title: 'The Crisis', applied: true });
    expect(o.topicShift?.reason).toMatch(/chapter/i);
  });

  it('topicShift with autoChapter OFF: IGNORED, reason says why', () => {
    const req = baseReq({ capabilities: { ...CAPS, autoChapter: false }, topicShift: { title: 'The Crisis' } });
    const o = callOutcome(req, planTurnCommit(req));
    expect(o.topicShift).toMatchObject({ title: 'The Crisis', applied: false, reason: 'autoChapter is off' });
  });

  it('no topicShift in the reply → null, not a fabricated entry', () => {
    const o = callOutcome(baseReq({}), planTurnCommit(baseReq({})));
    expect(o.topicShift).toBeNull();
  });

  it('links: applied when graphLinks ON and both slugs resolve', () => {
    const req = baseReq({
      links: [{ source: 'coin-debasement.md', target: 'roman-empire.md', kind: 'relates_to' as any }],
      state: {
        ...baseReq({}).state,
        artifacts: [
          { id: 'a1', code: 'coin-debasement', title: 'Coin Debasement' },
          { id: 'a2', code: 'roman-empire', title: 'Roman Empire' },
        ],
      },
    });
    const o = callOutcome(req, planTurnCommit(req));
    expect(o.links[0]).toMatchObject({ action: 'link', sourceFile: 'coin-debasement.md', applied: true });
  });

  it('links: ignored with a reason when the slug does not resolve', () => {
    const req = baseReq({
      links: [{ source: 'ghost-note.md', target: 'also-ghost.md', kind: 'relates_to' as any }],
    });
    const o = callOutcome(req, planTurnCommit(req));
    expect(o.links[0].applied).toBe(false);
    expect(o.links[0].reason).toMatch(/did not resolve/i);
  });

  it('links: ignored with a reason when graphLinks is off', () => {
    const req = baseReq({
      capabilities: { ...CAPS, graphLinks: false },
      links: [{ source: 'a.md', target: 'b.md', kind: 'relates_to' as any }],
    });
    const o = callOutcome(req, planTurnCommit(req));
    expect(o.links[0].applied).toBe(false);
    expect(o.links[0].reason).toBe('graphLinks is off');
  });

  it('carries the clean reply and the raw vs clean char weights', () => {
    const req = baseReq({
      cleanReply: 'The clean reply, tags stripped.',
      artifactUpserts: [upsert('n', 'N')],
    });
    const o = callOutcome(req, planTurnCommit(req));
    expect(o.cleanReply).toBe('The clean reply, tags stripped.');
    expect(o.cleanChars).toBe('The clean reply, tags stripped.'.length);
    expect(o.rawChars).toBeGreaterThan(0);
  });
});

/* ── Storage: the row carries the outcome ─────────────────────────────────── */

beforeAll(() => {
  initDb(':memory:');
});

describe('the recorder stores the outcome on the flight-recorder row', () => {
  it('the schema has outcome_json and usage_estimated columns', () => {
    const cols = (getDb().prepare('PRAGMA table_info(api_call_logs)').all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    expect(cols).toContain('outcome_json');
    expect(cols).toContain('usage_estimated');
  });

  it('recordCallEnd round-trips outcome + usageEstimated through the row', async () => {
    const { recordCallStart, recordCallEnd, getCallLog } = await import('../../server/lib/callRecorder');
    const id = recordCallStart({
      userId: 7,
      kind: 'chat',
      model: 'gemini-test',
      request: { endpoint: 'generateContentStream', model: 'gemini-test' },
    });
    if (!id) throw new Error('recordCallStart returned null');
    recordCallEnd(id, {
      status: 'ok',
      responseText: 'raw with <topic_shift title="X" /> inside',
      usage: null,
      usageEstimated: true,
      outcome: {
        topicShift: { title: 'X', applied: false, reason: 'autoChapter is off' },
        artifacts: [{ file: 'n.md', title: 'N', result: 'created', reason: '' }],
        links: [],
        cleanReply: 'clean',
        rawChars: 40,
        cleanChars: 5,
      },
    });
    const row = getCallLog(7, id);
    expect(row?.usageEstimated).toBe(true);
    expect(row?.outcome?.topicShift).toMatchObject({ title: 'X', applied: false });
    expect(row?.outcome?.artifacts[0]).toMatchObject({ file: 'n.md', result: 'created' });
    expect(row?.outcome?.cleanReply).toBe('clean');
  });

  it('the local (IndexedDB) store exposes the same recordCallOutcome patch', async () => {
    const store = await import('../../src/services/callLogStore');
    expect(typeof (store as unknown as Record<string, unknown>).recordCallOutcome).toBe('function');
  });
});
