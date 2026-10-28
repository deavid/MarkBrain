#!/usr/bin/env tsx
/**
 * Operator SQLite snapshot (Stream A of the backup decision —
 * design-docs/DECISIONS_BACKUP_SQLITE_VS_PLAINTEXT.md §4).
 *
 *   npm run backup-sqlite -- --out /path/to/markbrain-snapshot.sqlite [--keep-call-logs]
 *
 * Uses SQLite's ONLINE backup API (better-sqlite3 `db.backup()`): safe to run
 * while the server is live, consistent snapshot, no locks on the source.
 *
 * By default the snapshot copy has `api_call_logs` DELETED + VACUUMed: those
 * are Tier-3 disposable 7-day wire logs — archiving them bloats every backup
 * with data whose only consumer is live debugging. Pass --keep-call-logs to
 * keep them (e.g. to hand a forensics copy around).
 *
 * The SOURCE database is never touched.
 */
import '../server/lib/env';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function flagValue(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return null;
  return args[i + 1];
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function usage(): never {
  console.log(`usage:
  npm run backup-sqlite -- --out <path> [--keep-call-logs]

Opens the live database (MARKBRAIN_DB_PATH or <cwd>/data/markbrain.sqlite),
snapshots it with SQLite's online backup API, and strips the ephemeral
api_call_logs wire-log table from the snapshot copy (VACUUM included).`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (flag(args, '--help') || flag(args, '-h')) usage();
  const out = flagValue(args, '--out');
  if (!out) fail('--out <path> is required');
  const keepCallLogs = flag(args, '--keep-call-logs');

  const sourcePath = process.env.MARKBRAIN_DB_PATH || path.resolve(process.cwd(), 'data', 'markbrain.sqlite');
  const source = new Database(sourcePath, { readonly: true });

  try {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    // Online backup API: consistent snapshot while the server keeps serving.
    await source.backup(out);
  } finally {
    source.close();
  }

  // Clean the SNAPSHOT copy only — the live DB keeps its logs. The guard is
  // for databases that predate the flight recorder (or a hand-rolled DB):
  // a snapshot command must never die because a disposable table is absent.
  const snapshot = new Database(out);
  try {
    const hasCallLogs = Boolean(
      snapshot.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'api_call_logs'").get()
    );
    if (hasCallLogs && !keepCallLogs) {
      const stripped = snapshot.prepare('DELETE FROM api_call_logs').run();
      snapshot.exec('VACUUM');
      console.log(`snapshot written: ${out} (api_call_logs stripped: ${stripped.changes} rows, VACUUMed)`);
    } else if (!hasCallLogs) {
      console.log(`snapshot written: ${out} (no api_call_logs table in this database — nothing to strip)`);
    } else {
      console.log(`snapshot written: ${out} (api_call_logs kept)`);
    }
  } finally {
    snapshot.close();
  }
}

main().catch((err) => {
  fail((err as Error).message);
});
