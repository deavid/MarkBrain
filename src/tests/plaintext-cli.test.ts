/**
 * Package 6 §6.3 — Operator CLI round-trip test.
 *
 * Runs `scripts/plaintext-cli.ts` as a real subprocess against temp-file
 * SQLite DBs (the CLI opens its own DB handle; `:memory:` cannot cross the
 * process boundary). Seeded DB A → CLI export → fresh DB B → CLI import →
 * loaded snapshots must match. Reuses the Package 3 round-trip fixture
 * verbatim (fixtures/plaintextFixture.ts) so CLI and browser trees can't drift.
 *
 * Note: initDb() replaces the process-wide handle, so DB A is fully seeded
 * and read BEFORE initDb(dbBPath) is called — after that, every repo call
 * in this process targets DB B.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initDb, closeDbForTests } from '../../server/db';
import { listProjectsForUser, loadProjectForUser, applyProjectSnapshotDiff } from '../../server/db/projectRepo';
import { createUser, findUserByEmail } from '../../server/lib/users';
import { makeSnapshot, P_ID } from './fixtures/plaintextFixture';

// ---------------------------------------------------------------------------
// CLI invocation helper
// ---------------------------------------------------------------------------

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, '../..');
const CLI = path.join(repoRoot, 'scripts', 'plaintext-cli.ts');
const EMAIL = 'cli-roundtrip@example.com';
const PASSWORD = 'cli-pass-123456';

function runCli(cmd: 'export' | 'import', extraArgs: string[], dbPath: string): string {
  return execFileSync('npx', ['tsx', CLI, cmd, ...extraArgs], {
    cwd: repoRoot,
    env: { ...process.env, MARKBRAIN_DB_PATH: dbPath },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// ---------------------------------------------------------------------------
// temp layout + sequential DB seeding (singleton: A first, then B)
// ---------------------------------------------------------------------------

const tempRoot = mkdtempSync(path.join(tmpdir(), 'markbrain-cli-test-'));
const dbAPath = path.join(tempRoot, 'source.sqlite');
const dbBPath = path.join(tempRoot, 'target.sqlite');
const outDir = path.join(tempRoot, 'exported');
const importDir = path.join(tempRoot, 'exported-copy');

// --- DB A: user + fixture snapshot, then read back what the DB assembled ---
initDb(dbAPath);
const userA = createUser(EMAIL, PASSWORD);
expect(findUserByEmail(EMAIL)).not.toBeNull();
applyProjectSnapshotDiff(userA.id, makeSnapshot());
const loadedA = loadProjectForUser(userA.id, P_ID);
expect(loadedA).not.toBeNull();

// --- switch the process singleton to DB B: same user row, nothing else ---
initDb(dbBPath);
const userB = createUser(EMAIL, PASSWORD);
expect(userB.id).toBeGreaterThan(0);

afterAll(() => {
  closeDbForTests();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('plaintext CLI (Package 6)', () => {
  it('round-trips a seeded snapshot: export → fresh DB → import → equal', () => {
    // export DB A via CLI subprocess
    const exportOut = runCli('export', ['--user', EMAIL, '--out', outDir], dbAPath);
    expect(exportOut).toContain('exported');
    expect(existsSync(path.join(outDir, 'FIXTURE', 'project.json'))).toBe(true);
    expect(existsSync(path.join(outDir, 'FIXTURE', 'artifacts', 'CORE.md'))).toBe(true);

    // copy the exported tree so import reads a different dir than export wrote
    cpSync(outDir, importDir, { recursive: true });

    // import into DB B via CLI subprocess
    const importOut = runCli('import', ['--user', EMAIL, '--in', importDir], dbBPath);
    expect(importOut).toContain('imported');

    // loaded-from-DB-B must equal loaded-from-DB-A (revision may differ)
    const loadedB = loadProjectForUser(userB.id, P_ID);
    expect(loadedB).not.toBeNull();
    const { revision: _revA, ...restA } = loadedA!;
    const { revision: _revB, ...restB } = loadedB!;
    expect(restB).toEqual(restA);
  });

  it('leaves DB B consistent after the import (listProjectsForUser sees it)', () => {
    const projects = listProjectsForUser(userB.id);
    expect(projects.map((p) => p.projectId)).toEqual([P_ID]);
    expect(projects[0].codeName).toBe('FIXTURE');
    expect(projects[0].name).toBe('Fixture Project — fïxture');
  });

  it('rejects a non-existent user with a clean error', () => {
    expect(() =>
      runCli('export', ['--user', 'ghost@example.com', '--out', outDir], dbAPath)
    ).toThrow(/user not found: ghost@example\.com/);
  });

  it('rejects a non-existent input dir on import', () => {
    expect(() =>
      runCli('import', ['--user', EMAIL, '--in', path.join(tempRoot, 'no-such-dir')], dbBPath)
    ).toThrow(/input directory not found/);
  });

  it('reports (and does not throw) when --project matches nothing on export', () => {
    const out = runCli(
      'export',
      ['--user', EMAIL, '--project', 'proj-does-not-exist', '--out', outDir],
      dbAPath
    );
    expect(out).toContain('no project proj-does-not-exist');
  });

  it('rejects a missing --user flag with usage', () => {
    expect(() => runCli('export', ['--out', outDir], dbAPath)).toThrow();
  });
});
