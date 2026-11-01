/**
 * Project deletion must be AUTHORITATIVE (live bug 2026-11-01, VPS mode).
 *
 * Repro (real server + 250ms+ latency, delete-resurrection covers the
 * thread/artifact case — this file covers the PROJECT row itself):
 *
 *   1. Any debounced snapshot save armed just before the user confirms
 *      "Delete permanently" can fire INSIDE the DELETE round trip — the
 *      client still has the doomed project as its active workspace
 *      (removeProject runs only after the DELETE response lands).
 *   2. The late PUT reached the server AFTER the DELETE was processed.
 *      applyProjectSnapshotDiff upserted blindly → the project row came
 *      back. Same for POST create (404→create path in vpsStore.save) and
 *      for /mutate (it shells an empty project when the row is missing).
 *   3. Reload → the deleted project is sitting in the list again.
 *
 * The fix: deleting a project leaves a project-level tombstone; every write
 * that targets a tombstoned project is refused with 410 Gone (PUT, POST
 * create, /mutate). Explicit user intent still wins: replaceAll (database
 * import) clears tombstones, so an import containing the project re-creates
 * it on purpose.
 *
 * Real HTTP listener + in-memory SQLite; genai MOCKED (hermetic).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { initDb, closeDbForTests } from '../../server/db';

process.env.MARKBRAIN_OWNER_EMAIL = 'owner@example.com';
process.env.MARKBRAIN_OWNER_PASSWORD = 'owner-pass-123456';

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      async *generateContentStream() {
        yield { text: 'unused' };
      },
      async generateContent() {
        return { text: 'unused' };
      },
      async embedContent() {
        return { embeddings: [{ values: [0.5] }] };
      },
    };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

initDb(':memory:');

const { app } = await import('../../server/app');
const { ensureOwnerBootstrap } = await import('../../server/lib/users');

let server: Server;
let base = '';
let token = '';
const PROJECT_ID = 'proj-doomed-1';

interface ApiRes {
  status: number;
  body: any;
}

async function api(pathname: string, opts: { method?: string; body?: unknown } = {}): Promise<ApiRes> {
  const res = await fetch(base + pathname, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

function snapshotFor(projectId: string, name = 'Doomed'): Record<string, unknown> {
  return {
    projectId,
    name,
    turns: [
      { id: 't1', role: 'user', content: 'hello', timestamp: Date.now(), threadId: 'main' },
    ],
    threads: [
      {
        id: 'main',
        folderId: null,
        title: 'Main',
        titleState: 'auto',
        titleVersion: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastActivityAt: Date.now(),
        lifecycle: 'active',
        lastOutcome: 'ok',
        preview: '',
        attachments: [],
      },
    ],
    folders: [],
    activeThreadId: 'main',
    artifacts: [],
    edges: [],
  };
}

async function projectExists(projectId: string): Promise<boolean> {
  return (await api(`/api/projects/${projectId}`)).status === 200;
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
});

afterAll(() => {
  server?.close();
  closeDbForTests();
});

describe('project deletion is authoritative — late writes cannot resurrect', () => {
  it('setup: create + delete works, project is gone', async () => {
    const create = await api('/api/projects', { method: 'POST', body: { project: snapshotFor(PROJECT_ID) } });
    expect([201, 409]).toContain(create.status);
    expect(await projectExists(PROJECT_ID)).toBe(true);

    const del = await api(`/api/projects/${PROJECT_ID}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await projectExists(PROJECT_ID)).toBe(false);
  });

  it('a late snapshot PUT (debounced save in the DELETE round trip) does NOT resurrect — 410', async () => {
    // BEFORE THE FIX: PUT upserts blindly → 200 → project back on reload.
    const put = await api(`/api/projects/${PROJECT_ID}`, { method: 'PUT', body: snapshotFor(PROJECT_ID, 'Resurrected?') });
    expect(put.status).toBe(410);
    expect(await projectExists(PROJECT_ID)).toBe(false);
  });

  it('a POST create for a tombstoned project (offline outbox replay) does NOT resurrect — 410', async () => {
    // BEFORE THE FIX: vpsStore.save's 404→POST-create path re-created it.
    const create = await api('/api/projects', { method: 'POST', body: { project: snapshotFor(PROJECT_ID, 'Resurrected?') } });
    expect(create.status).toBe(410);
    expect(await projectExists(PROJECT_ID)).toBe(false);
  });

  it('a /mutate for a tombstoned project does NOT shell out an empty project — 410', async () => {
    // BEFORE THE FIX: applyAtomicMutation created an empty shell project for
    // the race (create + immediate commitPair) — same hole, cheaper trigger.
    const res = await api(`/api/projects/${PROJECT_ID}/mutate`, {
      method: 'POST',
      body: {
        op: 'commitPair',
        threadId: 'main',
        userTurn: { id: 't2', role: 'user', content: 'zombie', timestamp: Date.now() },
        assistantTurn: { id: 't3', role: 'assistant', content: 'zombie reply', timestamp: Date.now() },
      },
    });
    expect(res.status).toBe(410);
    expect(await projectExists(PROJECT_ID)).toBe(false);
  });

  it('delta sync for the deleted project still answers 404 (unchanged)', async () => {
    expect((await api(`/api/projects/${PROJECT_ID}/delta?since=0`)).status).toBe(404);
  });

  it('a NON-deleted project keeps full PUT/mutate access (no false 410)', async () => {
    const LIVE = 'proj-still-alive';
    const create = await api('/api/projects', { method: 'POST', body: { project: snapshotFor(LIVE) } });
    expect([201, 409]).toContain(create.status);

    const put = await api(`/api/projects/${LIVE}`, { method: 'PUT', body: snapshotFor(LIVE, 'Renamed') });
    expect(put.status).toBe(200);
    const mutate = await api(`/api/projects/${LIVE}/mutate`, {
      method: 'POST',
      body: {
        op: 'commitPair',
        threadId: 'main',
        userTurn: { id: 't2', role: 'user', content: 'hi', timestamp: Date.now() },
        assistantTurn: { id: 't3', role: 'assistant', content: 'reply', timestamp: Date.now() },
      },
    });
    expect(mutate.status).toBe(200);
  });

  it('explicit import (replaceAll) clears the tombstone — the user chose to bring it back', async () => {
    const res = await api('/api/projects/replace-all', {
      method: 'POST',
      body: { projects: [snapshotFor(PROJECT_ID, 'Imported Again')] },
    });
    expect(res.status).toBe(200);
    expect(await projectExists(PROJECT_ID)).toBe(true);

    // And deleting it again must work (delete → tombstone refreshed, not stuck).
    expect((await api(`/api/projects/${PROJECT_ID}`, { method: 'DELETE' })).status).toBe(200);
    expect(await projectExists(PROJECT_ID)).toBe(false);
    const put = await api(`/api/projects/${PROJECT_ID}`, { method: 'PUT', body: snapshotFor(PROJECT_ID) });
    expect(put.status).toBe(410);
  });
});
