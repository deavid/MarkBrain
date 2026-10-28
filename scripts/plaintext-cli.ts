#!/usr/bin/env tsx
/**
 * Operator plaintext CLI (design-docs/28_EXECUTION_PACK_1.md §6).
 *
 *   npm run export-plaintext -- --user <email> [--project <projectId>] --out <dir>
 *   npm run import-plaintext -- --user <email> [--project <projectId>] --in <dir>
 *
 * Talks to the same SQLite file the server uses (MARKBRAIN_DB_PATH or
 * <cwd>/data/markbrain.sqlite). Runs LOCALLY on the server box or against a
 * pulled .sqlite on the home PC. No HTTP endpoint, no network.
 *
 * Reuses Package 3's plaintextTree bijection (snapshotToTree / treeToSnapshot)
 * so the CLI's tree layout is byte-identical to the browser's tar.gz backup.
 */
import '../server/lib/env';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { initDb, getDb } from '../server/db';
import { findUserByEmail } from '../server/lib/users';
import {
  listProjectsForUser,
  loadProjectForUser,
  applyProjectSnapshotDiff,
} from '../server/db/projectRepo';
import { snapshotToTree, treeToSnapshot, groupEntriesByProject, safeFilename } from '../src/domains/plaintextTree';
import type { TarEntry } from '../src/utils/tarGz';
import type { ProjectSnapshot } from '../src/services/stores/projectStore';

// ---------------------------------------------------------------------------
// argv helpers (same style as scripts/user-admin.ts)
// ---------------------------------------------------------------------------

function flagValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return null;
  return args[i + 1];
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function usage(): never {
  console.log(`usage:
  npm run export-plaintext -- --user <email> [--project <projectId>] --out <dir>
  npm run import-plaintext -- --user <email> [--project <projectId>] --in <dir>

Env: MARKBRAIN_DB_PATH (defaults to <cwd>/data/markbrain.sqlite)`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// tree <-> disk helpers (dir mode, no archive: plain .md + .json on disk)
// ---------------------------------------------------------------------------

/** Recursively collect all file paths under dir (relative, POSIX-style). */
function walkDir(dir: string, base: string = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = base === '' ? name : `${base}/${name}`;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkDir(full, rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Read a directory tree into TarEntry[] with paths relative to `dir`.
 * Binary-safe: reads files as Buffers; JSON/YAML are text so this is fine.
 */
function readTree(dir: string): TarEntry[] {
  return walkDir(dir).map((rel) => ({
    path: rel.split(path.sep).join('/'),
    data: new Uint8Array(readFileSync(path.join(dir, ...rel.split('/')))),
  }));
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

function resolveUser(email: string): { id: number; email: string } {
  const user = findUserByEmail(email);
  if (!user) fail(`user not found: ${email}`);
  return user;
}

function cmdExport(email: string, outDir: string, projectId: string | null): void {
  const user = resolveUser(email);
  const snapshots = projectId
    ? [loadProjectForUser(user.id, projectId)].filter((s): s is ProjectSnapshot & { revision: number } => s !== null)
    : listProjectsForUser(user.id);

  if (snapshots.length === 0) {
    console.log(projectId ? `no project ${projectId} for ${user.email}` : `no projects for ${user.email}`);
    return;
  }

  mkdirSync(outDir, { recursive: true });
  for (const snap of snapshots) {
    const root = safeFilename(snap.codeName || snap.projectId);
    // snapshotToTree entries already carry the project-root prefix (`FIXTURE/...`),
    // so write them relative to outDir — nesting them again would double-prefix.
    const entries = snapshotToTree(snap);
    for (const entry of entries) {
      const filePath = path.join(outDir, ...entry.path.split('/'));
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, entry.data);
    }
    console.log(
      `exported ${root} → ${path.join(outDir, root)} (${entries.length} files, rev ${snap.revision ?? '?'})`
    );
  }
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

function cmdImport(email: string, inDir: string, projectId: string | null): void {
  const user = resolveUser(email);
  if (!existsSync(inDir)) fail(`input directory not found: ${inDir}`);
  if (!statSync(inDir).isDirectory()) fail(`input path is not a directory: ${inDir}`);

  const entries = readTree(inDir);
  if (entries.length === 0) fail(`input directory is empty: ${inDir}`);

  const groups = groupEntriesByProject(entries);
  const snapshots: ProjectSnapshot[] = [];
  for (const group of groups.values()) {
    const snap = treeToSnapshot(group);
    if (projectId && snap.projectId !== projectId) continue; // explicit filter
    snapshots.push(snap);
  }

  if (snapshots.length === 0) {
    fail(`no matching projects found in ${inDir}${projectId ? ` for ${projectId}` : ''}`);
  }

  const db = getDb();
  const tx = db.transaction(() => {
    for (const snap of snapshots) {
      applyProjectSnapshotDiff(user.id, snap);
    }
  });
  tx();

  for (const snap of snapshots) {
    console.log(`imported ${snap.codeName || snap.projectId} (id=${snap.projectId}) for ${user.email}`);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) usage();

  const email = flagValue(args, '--user');
  const outDir = flagValue(args, '--out');
  const inDir = flagValue(args, '--in');
  const projectId = flagValue(args, '--project');

  // Open the DB exactly like the server would (same path resolution).
  initDb(process.env.MARKBRAIN_DB_PATH);

  try {
    if (cmd === 'export') {
      if (!email || !outDir) usage();
      cmdExport(email, outDir, projectId);
    } else if (cmd === 'import') {
      if (!email || !inDir) usage();
      cmdImport(email, inDir, projectId);
    } else {
      usage();
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

main();
