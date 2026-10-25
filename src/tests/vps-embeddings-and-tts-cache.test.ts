/**
 * Phase 6 — VPS semantic indexing/search + Ogg TTS disk cache (design-docs/21F).
 *
 * Provider + ffmpeg encoder are MOCKED — zero external calls, no ffmpeg
 * binary needed. Real SQLite, real routes, real cache key/store logic.
 *
 * 1. Local mode: 0 embedding traffic; lexical search still finds sections.
 * 2. VPS: artifact save indexes sections; unchanged save / re-enqueue = 0 new
 *    provider calls; search ranks + reuses near-duplicate query vectors.
 * 3. TTS: first call MISS (OggS bytes, 1 upstream), second call HIT (0 more).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { initDb, closeDbForTests, getDb } from '../../server/db';

process.env.MARKBRAIN_OWNER_EMAIL = 'owner@example.com';
process.env.MARKBRAIN_OWNER_PASSWORD = 'owner-pass-123456';

/* ── deterministic vector + provider mock ─────────────────────────────────── */

const counters = { qa: 0, embed: 0, tts: 0 };

function vecOf(text: string): number[] {
  // Bag-of-words hashing: shared tokens → shared dims → nonzero cosine.
  const v = new Array(768).fill(0);
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) h = Math.imul(h ^ tok.charCodeAt(i), 16777619);
    v[Math.abs(h) % 768] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

function pcmSine1s(): Buffer {
  const n = 24000;
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((i / 24000) * 2 * Math.PI * 440) * 12000), i * 2);
  return buf;
}

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      async generateContent(params: any) {
        const contents = params?.contents;
        const raw = typeof contents === 'string' ? contents : JSON.stringify(contents ?? '');
        if (params?.config?.speechConfig || (Array.isArray(contents) && JSON.stringify(contents).includes('speechMetadata'))) {
          counters.tts += 1;
          return {
            candidates: [
              { content: { parts: [{ inlineData: { data: pcmSine1s().toString('base64'), mimeType: 'audio/L16;rate=24000' } }] } },
            ],
          };
        }
        if (/high-recall search index/.test(raw)) {
          counters.qa += 1;
          return {
            text:
              // No SECTION line → parseQaPairs maps it onto the first real section heading.
              '=== QA ===\nQ: What does the ferret flashlight section say?\nA: It documents beam modes for night walks.\nKW: ferret, flashlight, beam, night',
          };
        }
        if (/Give this conversation a title/.test(raw)) return { text: 'Indexed Note Title' };
        return { text: 'DESCRIPTION: d\nSUMMARY: s' };
      },
      async embedContent(params: any) {
        counters.embed += 1;
        const contents = params?.contents;
        if (typeof contents === 'string') return { embeddings: [{ values: vecOf(contents) }] };
        if (Array.isArray(contents)) return { embeddings: contents.map((t: string) => ({ values: vecOf(String(t)) })) };
        return { embeddings: [{ values: vecOf('') }] };
      },
      async *generateContentStream() {
        yield { text: 'stream reply' };
      },
    };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

// ffmpeg is absent on this box — swap ONLY the encoder; key/cache/store stay real.
vi.mock('../../server/lib/ttsCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/lib/ttsCache')>();
  return {
    ...actual,
    encodePcmToOgg: async () => Buffer.concat([Buffer.from('OggS', 'ascii'), Buffer.alloc(48, 7)]),
  };
});

initDb(':memory:');

const { app } = await import('../../server/app');
const { ensureOwnerBootstrap } = await import('../../server/lib/users');
const { flushIndexerForTests } = await import('../../server/jobs/serverArtifactIndexer');

let server: Server;
let base = '';
let token = '';
const PROJECT_ID = 'proj-21f-1';

interface ApiRes {
  status: number;
  body: any;
  headers: Headers;
}

async function api(pathname: string, opts: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<ApiRes> {
  const res = await fetch(base + pathname, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (opts.raw) return { status: res.status, body: await res.arrayBuffer(), headers: res.headers };
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* binary */
  }
  return { status: res.status, body, headers: res.headers };
}

const NOTE_ARTIFACT = {
  id: 'art-ferret',
  workspaceId: PROJECT_ID,
  code: 'ferret-night-walks',
  title: 'Ferret Night Walks',
  type: 'document',
  category: 'note',
  isHighConcept: false,
  current: {
    subtitle: 'Beams and buddies',
    description: 'Night walk field notes',
    summary: 'Ferret flashlight guidance',
    body: '# Ferret Night Walks\n\n## Gear\nThe ferret flashlight has three beam modes for night walks with a skittish ferret.',
  },
  tags: ['ferret', 'flashlight'],
  createdAt: 1000,
  updatedAt: 1000,
  graph: { is_high_concept: false },
};

function seedProject(): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (project_id, user_id, name, code_name, description, color, active_thread_id,
       granularity_law, revision, updated_at) VALUES (?, 1, '21F', 'f', '', '#e05a66', NULL, 'user-only', 1, ?)`
  ).run(PROJECT_ID, now);
}

beforeAll(async () => {
  ensureOwnerBootstrap();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${addr.port}`;

  const login = await api('/api/auth/login', { method: 'POST', body: { email: 'owner@example.com', password: 'owner-pass-123456' } });
  expect(login.status).toBe(200);
  token = login.body.token;
  const key = await api('/api/account/keys', { method: 'PUT', body: { slot: 'gemini-free', apiKey: 'AIzaMockKey21F000000000000000000000000' } });
  expect(key.status).toBe(200);
  seedProject();
});

afterAll(() => {
  server?.close();
  closeDbForTests();
});

describe('21F A.1 — local mode: lexical only, zero embedding traffic', () => {
  it('shouldIndexInBrowser is false without vps mode; lexical search still finds sections', async () => {
    // Absent/local mode (no workspaceMode key in an empty storage) → lexical only.
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, location: { origin: 'http://x' } });
    const { shouldIndexInBrowser } = await import('../application/artifactIndexer');
    expect(shouldIndexInBrowser()).toBe(false);

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { scoreArtifactsAgainstDraft } = await import('../domains/search/draftSearchEngine');
    const { DEFAULT_SEARCH_CONFIG } = await import('../domains/search/searchConfig');
    const results = scoreArtifactsAgainstDraft({
      draftText: 'ferret flashlight beam',
      clauseVectors: [],
      artifacts: [NOTE_ARTIFACT as any],
      indexMap: new Map(),
      attachedArtifactIds: new Set<string>(),
      config: { ...DEFAULT_SEARCH_CONFIG, vecSections: false, vecQa: false },
    } as any);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].artifactId).toBe('art-ferret');
    // Creating/editing artifacts in local mode never touches the network here.
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('21F A.2 — vps: server indexing dedup + search query cache', () => {
  it('indexes on save, 0 new calls on unchanged re-enqueue, search reuses near-dupe query vectors', async () => {
    // Save the artifact through the real snapshot-diff route → enqueue.
    const snapshot = {
      projectId: PROJECT_ID,
      name: '21F',
      turns: [],
      chapters: [],
      artifacts: [NOTE_ARTIFACT],
      edges: [],
      updatedAt: Date.now(),
    };
    const save = await api(`/api/projects/${PROJECT_ID}`, { method: 'PUT', body: snapshot });
    expect(save.status).toBe(200);

    await flushIndexerForTests();
    const rows = getDb()
      .prepare('SELECT COUNT(*) AS n FROM artifact_index_sections WHERE user_id = 1 AND project_id = ?')
      .get(PROJECT_ID) as { n: number };
    expect(rows.n).toBeGreaterThan(0);
    expect(counters.qa).toBeGreaterThanOrEqual(1);
    expect(counters.embed).toBeGreaterThanOrEqual(1);

    const qaAfterFirst = counters.qa;
    const embedAfterFirst = counters.embed;

    // Re-enqueue the SAME content → content_hash match → 0 provider calls.
    const { enqueueIndex } = await import('../../server/jobs/serverArtifactIndexer');
    enqueueIndex(1, PROJECT_ID, 'art-ferret');
    await flushIndexerForTests();
    expect(counters.qa).toBe(qaAfterFirst);
    expect(counters.embed).toBe(embedAfterFirst);

    // Search ranks a match.
    const search = await api(`/api/projects/${PROJECT_ID}/search`, {
      method: 'POST',
      body: { query: 'ferret flashlight beam modes' },
    });
    expect(search.status).toBe(200);
    expect(search.body.results.length).toBeGreaterThan(0);
    expect(search.body.results[0].artifactId).toBe('art-ferret');
    expect(search.body.indexStatus.indexedArtifacts).toBeGreaterThanOrEqual(1);
    expect(search.body.indexStatus.totalArtifacts).toBeGreaterThanOrEqual(1);
    const embedAfterSearch = counters.embed;

    // Near-duplicate query (editDistance 1) reuses the cached query vector.
    const search2 = await api(`/api/projects/${PROJECT_ID}/search`, {
      method: 'POST',
      body: { query: 'ferret flashlight beam mode' },
    });
    expect(search2.status).toBe(200);
    expect(counters.embed).toBe(embedAfterSearch); // 0 additional embedContent calls

    // Status endpoint answers the clean indicator shape.
    const status = await api(`/api/projects/${PROJECT_ID}/search/status`);
    expect(status.status).toBe(200);
    expect(typeof status.body.indexedArtifacts).toBe('number');
    expect(['idle', 'indexing', 'error']).toContain(status.body.state);
  });
});

describe('21F B.3 — TTS Ogg re-encode + disk cache', () => {
  it('first call MISS with OggS bytes (1 upstream), second call HIT (0 more)', async () => {
    counters.tts = 0;
    const reqBody = { text: 'The ferret needs a small flashlight for night walks.', voice: 'Kore', model: 'gemini-3.8-flash-lite-tts' };

    const first = await api('/api/tts', { method: 'POST', body: reqBody, raw: true });
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('audio/ogg');
    expect(first.headers.get('x-tts-cache')).toBe('MISS');
    const bytes = Buffer.from(first.body as ArrayBuffer);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('OggS');
    expect(counters.tts).toBe(1);

    const second = await api('/api/tts', { method: 'POST', body: reqBody, raw: true });
    expect(second.status).toBe(200);
    expect(second.headers.get('content-type')).toBe('audio/ogg');
    expect(second.headers.get('x-tts-cache')).toBe('HIT');
    expect(counters.tts).toBe(1); // zero additional upstream calls
  });
});
