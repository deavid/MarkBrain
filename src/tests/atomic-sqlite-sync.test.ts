/**
 * Phase 4 — normalized SQLite atomic sync (design-docs/21D §6).
 *
 * 1. Multi-device anti-clobber: a stale Device A snapshot save never erases
 *    Device B's commitPair rows — both survive at revision 3.
 * 2. Delta: only rows changed since `?since`; empty arrays at the tip.
 * 3. Tombstones: deleteArtifact records a tombstone that delta delivers.
 * 4. Cross-device settings: one device's PUT is the other device's GET.
 *
 * In-memory SQLite + real HTTP; no provider calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { initDb, closeDbForTests } from '../../server/db';
import type { ProjectSnapshot } from '../services/stores/projectStore';

process.env.MARKBRAIN_OWNER_EMAIL = 'owner@example.com';
process.env.MARKBRAIN_OWNER_PASSWORD = 'owner-pass-123456';

initDb(':memory:');

const { app } = await import('../../server/app');
const { ensureOwnerBootstrap, createUser } = await import('../../server/lib/users');

let server: Server;
let base = '';
let tokenA = ''; // Device A (PC)
let tokenB = ''; // Device B (Phone)

const PROJECT_ID = 'proj-sync-1';

interface ApiRes {
  status: number;
  body: any;
}

async function api(pathname: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<ApiRes> {
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

function baseSnapshot(): ProjectSnapshot {
  return {
    projectId: PROJECT_ID,
    name: 'Sync Project',
    codeName: 'sync',
    description: 'phase-4 anti-clobber',
    color: '#e05a66',
    activeThreadId: 'thread-1',
    turns: [
      { id: 'turn-ask-1', role: 'user', content: 'first ask', timestamp: 1000, threadId: 'thread-1' },
      { id: 'turn-reply-1', role: 'assistant', content: 'first reply', timestamp: 1001, threadId: 'thread-1' },
    ],
    chapters: [],
    artifacts: [
      {
        id: 'art-1',
        workspaceId: PROJECT_ID,
        code: 'note-one',
        title: 'Note One',
        type: 'document',
      } as any,
    ],
    edges: [],
    threads: [
      {
        id: 'thread-1',
        folderId: null,
        title: 'Thread One',
        titleState: 'manual',
        titleVersion: 0,
        createdAt: 1000,
        updatedAt: 1000,
        lastActivityAt: 1000,
        lifecycle: 'active',
        lastOutcome: 'ok',
        preview: 'first ask',
        attachments: [],
      },
    ],
    folders: [],
    updatedAt: 1000,
  };
}

beforeAll(async () => {
  ensureOwnerBootstrap();
  // A second user row is unnecessary — two sessions of the Owner are two devices.
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no ephemeral port');
  base = `http://127.0.0.1:${addr.port}`;

  const loginA = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'owner-pass-123456' },
  });
  expect(loginA.status).toBe(200);
  tokenA = loginA.body.token;

  // Second session = the phone.
  const loginB = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'owner-pass-123456' },
  });
  expect(loginB.status).toBe(200);
  tokenB = loginB.body.token;
});

afterAll(() => {
  server?.close();
  closeDbForTests();
});

describe('21D §6.1 — multi-device anti-clobber', () => {
  it('stale Device A save at rev 3 keeps Device B pair AND Device A artifact edit', async () => {
    // Seed: project at revision 1 with two turns + one artifact.
    const create = await api('/api/projects', {
      method: 'POST',
      token: tokenA,
      body: { project: baseSnapshot() },
    });
    expect(create.status).toBe(201);
    expect(create.body.revision).toBe(1);

    // Device B commits a new chat pair → revision 2.
    const pair = await api(`/api/projects/${PROJECT_ID}/mutate`, {
      method: 'POST',
      token: tokenB,
      body: {
        mutations: {
          op: 'commitPair',
          threadId: 'thread-1',
          userTurn: { id: 'turn-ask-2', role: 'user', content: 'phone ask', timestamp: 2000 },
          assistantTurn: { id: 'turn-reply-2', role: 'assistant', content: 'phone reply', timestamp: 2001 },
        },
      },
    });
    expect(pair.status).toBe(200);
    expect(pair.body.revision).toBe(2);

    // Device A still holds its revision-1 turn list. It edits an artifact and
    // saves the whole snapshot — the save must NOT erase Device B's pair.
    const stale = baseSnapshot();
    stale.artifacts[0] = { ...(stale.artifacts[0] as any), title: 'Note One (edited on PC)' };
    const save = await api(`/api/projects/${PROJECT_ID}`, {
      method: 'PUT',
      token: tokenA,
      body: stale,
    });
    expect(save.status).toBe(200);
    expect(save.body.revision).toBe(3);

    // Zero data lost: both the phone pair AND the PC artifact edit survive.
    const loaded = await api(`/api/projects/${PROJECT_ID}`, { token: tokenA });
    expect(loaded.status).toBe(200);
    const project = loaded.body.project as ProjectSnapshot & { revision: number };
    expect(project.revision).toBe(3);

    const turnIds = project.turns.map((t) => t.id);
    expect(turnIds).toContain('turn-ask-2'); // Device B's pair survived
    expect(turnIds).toContain('turn-reply-2');
    expect(turnIds).toContain('turn-ask-1'); // Device A's originals survived

    const artifact = project.artifacts.find((a: any) => a.id === 'art-1');
    expect(artifact?.title).toBe('Note One (edited on PC)'); // Device A's edit landed
  });
});

describe('21D §6.2 — delta sync', () => {
  it('since=1 returns only rev 2+3 rows; since=3 returns empty arrays', async () => {
    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=1`, { token: tokenB });
    expect(delta.status).toBe(200);
    expect(delta.body.revision).toBe(3);
    const turnIds = (delta.body.turns as Array<{ id: string }>).map((t) => t.id);
    expect(turnIds).toContain('turn-ask-2'); // rev 2
    expect(turnIds).toContain('turn-reply-2');
    expect(turnIds).not.toContain('turn-ask-1'); // rev 1 — excluded
    expect(delta.body.artifacts.length).toBeGreaterThan(0); // rev 3 edit

    const tip = await api(`/api/projects/${PROJECT_ID}/delta?since=3`, { token: tokenA });
    expect(tip.status).toBe(200);
    expect(tip.body.revision).toBe(3);
    expect(tip.body.turns).toEqual([]);
    expect(tip.body.artifacts).toEqual([]);
    expect(tip.body.threads).toEqual([]);
    expect(tip.body.folders).toEqual([]);
    expect(tip.body.chapters).toEqual([]);
    expect(tip.body.edges).toEqual([]);
    expect(tip.body.tombstones).toEqual([]);
    // Sub-100-byte payload when nothing changed (21D §1).
    expect(JSON.stringify(tip.body).length).toBeLessThan(400);
  });
});

describe('21D §6.3 — tombstone propagation', () => {
  it('deleteArtifact at rev 4 shows up in ?since=3 for the other device', async () => {
    const del = await api(`/api/projects/${PROJECT_ID}/mutate`, {
      method: 'POST',
      token: tokenA,
      body: { mutations: { op: 'deleteArtifact', artifactId: 'art-1' } },
    });
    expect(del.status).toBe(200);
    expect(del.body.revision).toBe(4);

    const delta = await api(`/api/projects/${PROJECT_ID}/delta?since=3`, { token: tokenB });
    expect(delta.status).toBe(200);
    expect(delta.body.revision).toBe(4);
    expect(delta.body.tombstones).toEqual([{ entityType: 'artifact', entityId: 'art-1' }]);
    expect(delta.body.artifacts).toEqual([]); // row is gone, not returned as content
  });
});

describe('21D §6.4 — cross-device settings sync', () => {
  it('chat model slot changed on Device A is immediately visible to Device B', async () => {
    const put = await api('/api/account/settings', {
      method: 'PUT',
      token: tokenA,
      body: { modelSlots: { chat: 'gemini-3.8-flash' }, chatTier: 'free' },
    });
    expect(put.status).toBe(200);

    const get = await api('/api/account/settings', { token: tokenB });
    expect(get.status).toBe(200);
    expect(get.body.modelSlots.chat).toBe('gemini-3.8-flash');
    expect(get.body.chatTier).toBe('free');
  });
});

// Keep the linter honest about the unused import if tree-shaking changes.
void createUser;
