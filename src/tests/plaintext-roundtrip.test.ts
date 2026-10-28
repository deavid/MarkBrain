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
import { walkForUndefined, makeSnapshot } from './fixtures/plaintextFixture';
import type { ProjectSnapshot } from '../services/stores/projectStore';

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
});
