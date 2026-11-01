/**
 * Long-chat scalability Phase 3 (design-docs/31 §3.4 + BUGS/LONG_CHAT_PHASE_1_2_PLAN.md §3,
 * Appendix A.6): Storage & Sync.
 *
 * RED-first, two halves:
 *   A. SERVER: composite index on turns(user_id, project_id, thread_id, seq)
 *      + the paginated tail-first turns endpoint so a client never parses a
 *      multi-megabyte monolithic project payload.
 *   B. LOCAL (IndexedDB): turns split out of the monolithic projects blob
 *      into an indexed per-turn object store, so appending a message writes
 *      only the changed records. Node has no IndexedDB, so the store's logic
 *      lives in pure functions (pack / diff / reassemble / migrate) tested
 *      here; the IDB wiring in localBackend stays a thin shell around them.
 *
 * Real in-memory SQLite + real HTTP for the server half; no provider calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { initDb, getDb, closeDbForTests } from '../../server/db';
import type { ProjectSnapshot, Turn } from '../services/stores/projectStore';
import {
  toTurnRecord,
  diffTurnRecords,
  reassembleProject,
  migrateProjectBlob,
  turnSignature,
  type TurnRecord,
} from '../services/turnRecords';

/* ── A. server ──────────────────────────────────────────────────────────── */

process.env.MARKBRAIN_OWNER_EMAIL = 'owner@example.com';
process.env.MARKBRAIN_OWNER_PASSWORD = 'owner-pass-123456';

initDb(':memory:');

const { app } = await import('../../server/app');
const { ensureOwnerBootstrap } = await import('../../server/lib/users');

let server: Server;
let base = '';
let token = '';

const PROJECT_ID = 'proj-long-chat';

interface ApiRes {
  status: number;
  body: any;
}

async function api(
  pathname: string,
  opts: { method?: string; token?: string; body?: unknown } = {}
): Promise<ApiRes> {
  const res = await fetch(base + pathname, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

const turn = (i: number, threadId: string): Turn => ({
  id: `turn-${threadId}-${i}`,
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `body ${threadId} #${i} — ${'x'.repeat(20)}`,
  timestamp: 1000 + i,
  threadId,
});

function snapshotWith(nThreadA: number, nThreadB: number): ProjectSnapshot {
  const turns = [
    ...Array.from({ length: nThreadA }, (_, i) => turn(i, 'thread-a')),
    ...Array.from({ length: nThreadB }, (_, i) => turn(i, 'thread-b')),
  ];
  return {
    projectId: PROJECT_ID,
    name: 'Long Chat',
    codeName: 'LONG',
    description: 'phase-3 paginated turns',
    color: '#e05a66',
    activeThreadId: 'thread-a',
    turns,
    chapters: [],
    artifacts: [],
    edges: [],
    threads: [
      { id: 'thread-a', folderId: null, title: 'A', titleState: 'manual', titleVersion: 0, createdAt: 1000, updatedAt: 1000, lastActivityAt: 1000, lifecycle: 'active' as const, lastOutcome: 'ok' as const, preview: '', attachments: [] },
      { id: 'thread-b', folderId: null, title: 'B', titleState: 'manual', titleVersion: 0, createdAt: 1000, updatedAt: 1000, lastActivityAt: 1000, lifecycle: 'active' as const, lastOutcome: 'ok' as const, preview: '', attachments: [] },
    ],
    folders: [],
    updatedAt: 1000,
  };
}

beforeAll(async () => {
  ensureOwnerBootstrap();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no ephemeral port');
  base = `http://127.0.0.1:${addr.port}`;
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'owner-pass-123456' },
  });
  expect(login.status).toBe(200);
  token = login.body.token;

  const create = await api('/api/projects', {
    method: 'POST',
    token,
    body: { project: snapshotWith(250, 30) },
  });
  expect(create.status).toBe(201);
});

afterAll(() => {
  server?.close();
  closeDbForTests();
});

describe('Phase 3.1 — composite index on turns', () => {
  it('the annealer created turns(user_id, project_id, thread_id, seq)', () => {
    const row = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_turns_user_project_thread_seq'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('idx_turns_user_project_thread_seq');
  });
});

describe('Phase 3.1 — paginated tail-first turns endpoint', () => {
  it('serves thread-a tail-first, at most `limit` turns per page', async () => {
    const res = await api(`/api/projects/${PROJECT_ID}/turns?threadId=thread-a&limit=100`, { token });
    expect(res.status).toBe(200);
    const turns: Turn[] = res.body.turns;
    expect(turns.length).toBe(100);
    // Tail-first: the MOST RECENT seq first.
    expect(turns[0].id).toBe('turn-thread-a-249');
    expect(turns[99].id).toBe('turn-thread-a-150');
    expect(res.body.hasMore).toBe(true);
    expect(res.body.oldestSeq).toBeTypeOf('number');
  });

  it('pages upward with beforeSeq until exhausted', async () => {
    const p1 = await api(`/api/projects/${PROJECT_ID}/turns?threadId=thread-a&limit=100`, { token });
    const oldest = p1.body.oldestSeq as number;
    const p2 = await api(
      `/api/projects/${PROJECT_ID}/turns?threadId=thread-a&limit=100&beforeSeq=${oldest}`,
      { token }
    );
    expect(p2.status).toBe(200);
    const t2: Turn[] = p2.body.turns;
    expect(t2.length).toBe(100);
    expect(t2[0].id).toBe('turn-thread-a-149');
    expect(p2.body.hasMore).toBe(true);

    const p3 = await api(
      `/api/projects/${PROJECT_ID}/turns?threadId=thread-a&limit=100&beforeSeq=${p2.body.oldestSeq}`,
      { token }
    );
    const t3: Turn[] = p3.body.turns;
    expect(t3.length).toBe(50);
    expect(t3[0].id).toBe('turn-thread-a-49');
    expect(p3.body.hasMore).toBe(false);
  });

  it('threads never leak into each other', async () => {
    const res = await api(`/api/projects/${PROJECT_ID}/turns?threadId=thread-b&limit=200`, { token });
    const turns: Turn[] = res.body.turns;
    expect(turns.length).toBe(30);
    expect(turns.every((t) => t.threadId === 'thread-b')).toBe(true);
    expect(turns[0].id).toBe('turn-thread-b-29');
  });

  it('absent threadId → the WHOLE project, tail-first (bounded parse size)', async () => {
    const res = await api(`/api/projects/${PROJECT_ID}/turns?limit=50`, { token });
    const turns: Turn[] = res.body.turns;
    expect(turns.length).toBe(50);
    expect(res.body.hasMore).toBe(true);
  });

  it('unknown project → 404; bad limit → 400', async () => {
    const missing = await api('/api/projects/proj-nope/turns?threadId=thread-a', { token });
    expect(missing.status).toBe(404);
    const bad = await api(`/api/projects/${PROJECT_ID}/turns?limit=0`, { token });
    expect(bad.status).toBe(400);
  });
});

/* ── B. local IndexedDB (pure record core) ──────────────────────────────── */

const rec = (id: string, seq: number, content = 'c'): TurnRecord =>
  toTurnRecord('p1', { id, role: 'user', content, timestamp: 1000 + seq, threadId: 't1' }, seq);

/** A bare turn at the given position (diffTurnRecords takes Turn[], not records). */
const t = (id: string, seq: number, content = 'c'): Turn => ({
  id,
  role: 'user',
  content,
  timestamp: 1000 + seq,
  threadId: 't1',
});

describe('Phase 3.2 — per-turn record core (pure)', () => {
  it('toTurnRecord keys a turn by [projectId, id] with thread+seq for the index', () => {
    const r = rec('turn-1', 4);
    expect(r.projectId).toBe('p1');
    expect(r.id).toBe('turn-1');
    expect(r.threadId).toBe('t1');
    expect(r.seq).toBe(4);
  });

  it('a turn with no threadId records threadId "" (still addressable)', () => {
    const r = toTurnRecord('p1', { id: 'x', role: 'user', content: 'c', timestamp: 1 });
    expect(r.threadId).toBe('');
  });

  it('diff: first write upserts everything', () => {
    const d = diffTurnRecords(undefined, [t('a', 0), t('b', 1)]);
    expect(d.upserts.map((t) => t.id)).toEqual(['a', 'b']);
    expect(d.deletes).toEqual([]);
  });

  it('diff: unchanged turns write NOTHING (the append-per-message law)', () => {
    const prev = new Map([
      ['a', turnSignature(rec('a', 0))],
      ['b', turnSignature(rec('b', 1))],
    ]);
    const d = diffTurnRecords(prev, [t('a', 0), t('b', 1)]);
    expect(d.upserts).toEqual([]);
    expect(d.deletes).toEqual([]);
  });

  it('diff: one appended turn upserts exactly that record', () => {
    const prev = new Map([
      ['a', turnSignature(rec('a', 0))],
      ['b', turnSignature(rec('b', 1))],
    ]);
    const d = diffTurnRecords(prev, [t('a', 0), t('b', 1), t('c', 2)]);
    expect(d.upserts.map((t) => t.id)).toEqual(['c']);
    expect(d.deletes).toEqual([]);
  });

  it('diff: a regenerated reply (same id, new content) upserts it', () => {
    const prev = new Map([['b', turnSignature(rec('b', 1))]]);
    const d = diffTurnRecords(prev, [t('b', 1, 'REGENERATED REPLY')]);
    expect(d.upserts.map((t) => t.id)).toEqual(['b']);
  });

  it('diff: turns removed from the snapshot are deleted', () => {
    const prev = new Map([
      ['a', turnSignature(rec('a', 0))],
      ['gone', turnSignature(rec('gone', 1))],
    ]);
    const d = diffTurnRecords(prev, [t('a', 0)]);
    expect(d.deletes).toEqual(['gone']);
  });

  it('reassemble: blob + records → snapshot with turns ordered by seq', () => {
    const blob = { projectId: 'p1', name: 'N', turns: undefined };
    const records = [rec('late', 5), rec('early', 0), rec('mid', 2)];
    const snap = reassembleProject(blob as never, records);
    expect(snap.turns.map((t) => t.id)).toEqual(['early', 'mid', 'late']);
    expect(snap.name).toBe('N');
  });

  it('migrate: a legacy blob with embedded turns becomes records + a bare blob', () => {
    const legacy = {
      projectId: 'p1',
      name: 'Legacy',
      turns: [{ id: 'a', role: 'user', content: 'c', timestamp: 1, threadId: 't1' }],
      artifacts: [],
    };
    const { blob, records } = migrateProjectBlob(legacy as never);
    expect(records.length).toBe(1);
    expect(records[0].id).toBe('a');
    expect('turns' in blob).toBe(false);
    expect(blob.name).toBe('Legacy');
    // Roundtrip: migrate → reassemble is the identity.
    const back = reassembleProject(blob as never, records);
    expect(back.turns).toEqual(legacy.turns);
  });
});
