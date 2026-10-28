/**
 * Package 3 §3.4 — THE bijection test.
 *
 * A snapshot seeded with zero nulls/empties across ALL tables/fields is
 * exported to the plaintext tree and imported back into a fresh snapshot;
 * the result must deep-equal the original. The reflective coverage walk is
 * the rot detector: any field added to the types but left `undefined` in the
 * fixture (or `undefined` anywhere inside it) fails loudly here.
 */
import { describe, it, expect } from 'vitest';
import { snapshotToTree, treeToSnapshot, exportProjectTarGz, importProjectTarGz, exportProjectsTarGz } from '../domains/plaintextTree';
import { walkForUndefined, makeSnapshot, P_ID } from './fixtures/plaintextFixture';
import type { ProjectSnapshot } from '../services/stores/projectStore';
import type Database from 'better-sqlite3';
import { initDb, closeDbForTests } from '../../server/db';
import { createUser } from '../../server/lib/users';
import { applyProjectSnapshotDiff, loadProjectForUser } from '../../server/db/projectRepo';

// ---------------------------------------------------------------------------
// SQLite dump helpers ([19277]: "Do SQL export again - do they match?")
// ---------------------------------------------------------------------------

/** The 8 project domain tables the bijection must cover. */
const DOMAIN_TABLES = [
  'projects', 'threads', 'folders', 'turns', 'chapters', 'artifacts', 'artifact_revisions', 'edges',
] as const;

/**
 * SQL dump of every domain table. The only normalized field is
 * artifacts.updated_at — a wall-clock Date.now() at write time, not snapshot
 * content. JSON doc columns (doc_json/edge_json/meta_json/…) are compared
 * PARSED: the two databases serialize the same object with different key
 * order (insertion order vs spread order), and SQL-dump equality here means
 * the same rows hold the same DATA, not the same JSON bytes. Everything else
 * must match exactly.
 */
function dumpDomainTables(db: Database.Database): Record<string, unknown[]> {
  const dump: Record<string, unknown[]> = {};
  for (const table of DOMAIN_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid ASC`).all() as Array<Record<string, unknown>>;
    dump[table] = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === 'updated_at' && table === 'artifacts') {
          out[k] = 0;
        } else if (typeof v === 'string' && k.endsWith('_json') && (v.startsWith('{') || v.startsWith('['))) {
          try {
            out[k] = JSON.parse(v);
          } catch {
            out[k] = v; // unparseable doc: compare raw (a real rot signal)
          }
        } else {
          out[k] = v;
        }
      }
      return out;
    });
  }
  return dump;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('plaintext tree bijection (Package 3 §3.4)', () => {
  it('rot detector: fixture has no undefined values anywhere', () => {
    const snapshot = makeSnapshot();
    const errors: string[] = [];
    walkForUndefined(snapshot, 'snapshot', errors);
    expect(errors).toEqual([]);
  });

  it('snapshotToTree → treeToSnapshot is a bijection (exact deep equality)', () => {
    const snapshot = makeSnapshot();
    const entries = snapshotToTree(snapshot);
    const restored = treeToSnapshot(entries);
    expect(restored).toEqual(snapshot);
  });

  it('exportProjectTarGz → importProjectTarGz is byte-exact', async () => {
    const snapshot = makeSnapshot();
    const gz = await exportProjectTarGz(snapshot);
    const [restored] = await importProjectTarGz(gz);
    expect(restored).toEqual(snapshot);
  });

  it('multi-project export → import preserves every project exactly', async () => {
    const a = makeSnapshot();
    const b = makeSnapshot();
    const other: ProjectSnapshot = {
      ...b,
      projectId: 'proj-other',
      codeName: 'OTHER',
      name: 'Other Project',
    };
    const gz = await exportProjectsTarGz([a, other]);
    const restored = await importProjectTarGz(gz);
    expect(restored.length).toBe(2);
    expect(restored).toEqual([a, other]);
  });

  it('YAML frontmatter carries the graph with relationships and arbitrary keys', () => {
    const snapshot = makeSnapshot();
    const entries = snapshotToTree(snapshot);
    const core = entries.find((e) => e.path === 'FIXTURE/artifacts/CORE.md');
    expect(core).toBeDefined();
    const md = new TextDecoder().decode(core!.data);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('relationships:');
    expect(md).toContain('refines');
    expect(md).toContain('customKey');
    expect(md).toContain('yamlDocument');
    // Body extraction: everything after the closing frontmatter delimiter.
    const lines = md.split('\n');
    const openingIdx = lines.indexOf('---');
    const closingIdx = lines.indexOf('---', openingIdx + 1);
    const body = lines.slice(closingIdx + 1).join('\n');
    expect(body).toContain('# Core Document');
    expect(body).toContain('---'); // horizontal rule survives the frontmatter split
  });

  it('artifact body containing --- survives the frontmatter split', () => {
    const snapshot = makeSnapshot();
    const entries = snapshotToTree(snapshot);
    const restored = treeToSnapshot(entries);
    const core = restored.artifacts.find((a) => a.id === 'art-1');
    expect(core!.current.body).toBe(snapshot.artifacts[0].current.body);
    expect(core!.current.body).toContain('---');
  });

  it('empty-string layers round-trip as empty strings, not undefined', () => {
    const snapshot = makeSnapshot();
    const entries = snapshotToTree(snapshot);
    const restored = treeToSnapshot(entries);
    const draft = restored.artifacts.find((a) => a.id === 'art-2');
    expect(draft!.current.subtitle).toBe('');
    expect(draft!.current.description).toBe('');
    expect(draft!.current.summary).toBe('');
    expect(draft!.current.body).toBe('Body only, no layers.');
  });

  it('orphan turns (no threadId) survive the round-trip', () => {
    const snapshot = makeSnapshot();
    const entries = snapshotToTree(snapshot);
    expect(entries.some((e) => e.path === 'FIXTURE/threads/_orphan.json')).toBe(true);
    const restored = treeToSnapshot(entries);
    expect(restored.turns).toEqual(snapshot.turns);
    expect(restored.chapters).toEqual(snapshot.chapters);
  });

  it('artifact without code falls back to id in the filename', () => {
    const snapshot = makeSnapshot();
    const noCode = {
      ...snapshot,
      artifacts: [
        {
          ...snapshot.artifacts[2],
          code: '',
        },
      ],
      turns: [],
      chapters: [],
      threads: [],
      revisions: undefined,
    };
    const entries = snapshotToTree(noCode);
    expect(entries.some((e) => e.path === 'FIXTURE/artifacts/art-3.md')).toBe(true);
    const restored = treeToSnapshot(entries);
    expect(restored.artifacts[0]).toEqual(noCode.artifacts[0]);
  });

  it('project without threads/folders/revisions omits those optional files', () => {
    const snapshot: ProjectSnapshot = {
      projectId: 'proj-bare',
      turns: [],
      chapters: [],
      artifacts: [],
      edges: [],
      updatedAt: 1700000000000,
    };
    const entries = snapshotToTree(snapshot);
    const paths = entries.map((e) => e.path);
    expect(paths).toEqual(['proj-bare/project.json', 'proj-bare/edges.json']);
    const restored = treeToSnapshot(entries);
    expect(restored).toEqual(snapshot);
  });

  it('rot detector: a new field set to undefined inside the fixture trips it', () => {
    const snapshot = makeSnapshot() as unknown as Record<string, unknown>;
    snapshot.futuresField = undefined;
    const errors: string[] = [];
    walkForUndefined(snapshot, 'snapshot', errors);
    expect(errors).toContain('undefined value at snapshot.futuresField');
  });

  // -------------------------------------------------------------------------
  // Full SQLite round-trip ([19277]: the dump-coverage proof)
  // -------------------------------------------------------------------------

  it('full SQLite round-trip: DB_1 → Plaintext TarGz → DB_2 produces identical SQL dumps across all domain tables, with zero NULL or empty columns in DB_1', async () => {
    const db1 = initDb(':memory:');
    const user1 = createUser('roundtrip-a@example.com', 'pass-123456');
    // An unknown-to-today's-types project field: the fixture must exercise
    // projects.doc_json (the envelope) or the coverage check below fails.
    const seeded = makeSnapshot() as unknown as Record<string, unknown>;
    seeded.futureProjectSetting = 'enabled';
    applyProjectSnapshotDiff(user1.id, seeded as unknown as ProjectSnapshot);

    // ── Schema reflection: every domain table used, every column populated ──
    const empty = new Set(['', '{}', '[]']);
    for (const table of DOMAIN_TABLES) {
      const cols = (db1.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
      const rows = db1.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
      expect(rows.length, `${table} has no rows in DB_1`).toBeGreaterThanOrEqual(1);
      for (const col of cols) {
        // Every column must carry at least one real value across the table's
        // rows — a column nobody ever populates is dead schema (rot).
        const hasRealValue = rows.some((r) => {
          const v = r[col];
          if (v === null || v === undefined) return false;
          if (typeof v === 'string' && empty.has(v)) return false;
          return true;
        });
        expect(hasRealValue, `${table}.${col} is NULL/empty in every row of DB_1`).toBe(true);
      }
      // doc_json/edge_json fidelity: every envelope doc must parse (a
      // truncated or mangled doc would break every read that prefers
      // doc_json over the legacy columns). meta_json may legally be 'null'
      // (a turn with no meta) and nulls INSIDE a doc are legal domain values
      // (e.g. attachments' turnIndex: null) — the undefined rot check runs on
      // the fixture BEFORE serialization above.
      for (const row of rows) {
        for (const jc of ['doc_json', 'edge_json']) {
          if (!cols.includes(jc)) continue;
          const raw = row[jc];
          if (typeof raw !== 'string' || raw === '{}') continue;
          const doc = JSON.parse(raw) as Record<string, unknown>;
          expect(doc, `${table}.${jc} did not parse to a domain doc`).toBeTruthy();
        }
      }
    }

    // ── DB_1 → plaintext tar.gz → fresh DB_2 ──
    // initDb() closes the previous handle (process-wide singleton), so DB_1's
    // dump must be captured BEFORE opening DB_2.
    const dump1 = dumpDomainTables(db1);
    const loaded1 = loadProjectForUser(user1.id, P_ID);
    expect(loaded1).not.toBeNull();
    const archive = await exportProjectTarGz(loaded1!);

    const db2 = initDb(':memory:');
    const user2 = createUser('roundtrip-b@example.com', 'pass-123456');
    const [imported] = await importProjectTarGz(archive);
    applyProjectSnapshotDiff(user2.id, imported);

    // ── SQL dump equality ──
    expect(dumpDomainTables(db2)).toEqual(dump1);
  });

  it('future-field survival + external body edit detection (bodyHash)', async () => {
    // Future fields: a new artifact field and a new project-level setting
    // (both unknown to today's types) must survive the plaintext tree.
    const snapshot = makeSnapshot();
    (snapshot.artifacts[0] as unknown as Record<string, unknown>).futureAltitude = 'canopy';
    (snapshot as unknown as Record<string, unknown>).futureProjectSetting = 'enabled';
    const entries = snapshotToTree(snapshot);
    const restored = treeToSnapshot(entries);
    expect((restored as unknown as Record<string, unknown>).futureProjectSetting).toBe('enabled');
    expect((restored.artifacts[0] as unknown as Record<string, unknown>).futureAltitude).toBe('canopy');

    // External edit: someone edits the .md body in VS Code / Git without
    // touching the frontmatter — the stale layers must be detected. art-3
    // (NO-CODE.md) has non-empty description/summary and NO layersStaleAt, so
    // the assertion actually proves detection (art-1 already ships with
    // layersStaleAt in the fixture, which would make it vacuously true).
    const seeded = makeSnapshot();
    const seededEntries = snapshotToTree(seeded).map((e) => ({ ...e }));
    const noCodePath = 'FIXTURE/artifacts/NO-CODE.md';
    const noCodeEntry = seededEntries.find((e) => e.path === noCodePath);
    expect(noCodeEntry).toBeDefined();
    const md = new TextDecoder().decode(noCodeEntry!.data);
    const edited = md.replace('Body without graph.', 'Body EDITED OUTSIDE MARKBRAIN.');
    expect(edited).not.toBe(md);
    const draftPath = 'FIXTURE/artifacts/DRAFT.md';
    const draftMd = new TextDecoder().decode(seededEntries.find((e) => e.path === draftPath)!.data);
    const editedEntries = seededEntries.map((e) => {
      if (e.path === noCodePath) return { ...e, data: new TextEncoder().encode(edited) };
      if (e.path === draftPath) {
        return { ...e, data: new TextEncoder().encode(draftMd.replace('Body only, no layers.', 'Draft body edited too.')) };
      }
      return e;
    });
    const restoredEdited = treeToSnapshot(editedEntries);
    const noCode = restoredEdited.artifacts.find((a) => a.id === 'art-3');
    expect(noCode).toBeDefined();
    // THE detection: art-3 had no layersStaleAt before the edit.
    expect(seeded.artifacts.find((a) => a.id === 'art-3')!.layersStaleAt).toBeUndefined();
    expect(typeof noCode!.layersStaleAt).toBe('number');
    // Negative case: DRAFT has empty description/summary — nothing stale to
    // protect, so the edit must NOT fabricate a layersStaleAt.
    const draft = restoredEdited.artifacts.find((a) => a.id === 'art-2');
    expect(draft).toBeDefined();
    expect(draft!.layersStaleAt).toBeUndefined();
  });
});

