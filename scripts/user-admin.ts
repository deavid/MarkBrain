#!/usr/bin/env tsx
/**
 * CLI user administration (design-docs/21B §5).
 *
 *   npm run user -- create <email> --password <password> [--owner]
 *   npm run user -- list
 *   npm run user -- enable <email>
 *   npm run user -- disable <email>
 *   npm run user -- passwd <email> --password <newPassword>
 *   (create/passwd also accept --password-file <path>, preferred over
 *    --password so the secret never lands on the command line)
 *
 * Talks to the same SQLite file the server uses (MARKBRAIN_DB_PATH or
 * <cwd>/data/markbrain.sqlite). Never prints hashes, salts, or keys.
 */
import '../server/lib/env';
import { readFileSync } from 'node:fs';
import { getDb } from '../server/db';
import {
  createUser,
  listUsers,
  findUserByEmail,
  setUserEnabled,
  changeUserPassword,
} from '../server/lib/users';

function flagValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return null;
  return args[i + 1];
}

/**
 * Resolves the password for create/passwd without putting it on the command
 * line: --password-file <path> (0600 file under /etc/markbrain/secrets/) wins
 * over --password <password>. A password on argv is visible in shell history
 * and in `ps` while the command runs — prefer the file.
 */
function passwordFrom(args: string[]): string | null {
  const file = flagValue(args, '--password-file');
  if (file) {
    const trimmed = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    if (trimmed.length === 0) fail(`password file is empty: ${file}`);
    return trimmed;
  }
  return flagValue(args, '--password');
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function usage(): never {
  console.log(`usage:
  npm run user -- create <email> --password <password> [--owner]
  npm run user -- list
  npm run user -- enable <email>
  npm run user -- disable <email>
  npm run user -- passwd <email> --password <newPassword>
  (create/passwd also accept --password-file <path> — preferred over
   --password so the secret never lands on the command line)`);
  process.exit(1);
}

function main(): void {
  getDb();
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) usage();

  try {
    switch (cmd) {
      case 'create': {
        const email = args[0];
        const password = passwordFrom(args);
        if (!email || !password) usage();
        const isOwner = args.includes('--owner');
        const user = createUser(email, password, { isOwner });
        console.log(`created ${user.email} (id=${user.id}, owner=${user.isOwner})`);
        break;
      }
      case 'list': {
        const users = listUsers();
        if (users.length === 0) {
          console.log('(no users — set MARKBRAIN_OWNER_EMAIL/PASSWORD and start the server to bootstrap)');
          break;
        }
        for (const u of users) {
          console.log(
            `${String(u.id).padStart(3)}  ${u.email.padEnd(36)}  owner=${u.isOwner ? 'yes' : 'no '}  enabled=${u.enabled ? 'yes' : 'no'}`
          );
        }
        break;
      }
      case 'enable':
      case 'disable': {
        const email = args[0];
        if (!email) usage();
        const user = findUserByEmail(email);
        if (!user) fail(`user not found: ${email}`);
        setUserEnabled(user.id, cmd === 'enable');
        console.log(`${cmd}d ${user.email}`);
        break;
      }
      case 'passwd': {
        const email = args[0];
        const password = passwordFrom(args);
        if (!email || !password) usage();
        const user = findUserByEmail(email);
        if (!user) fail(`user not found: ${email}`);
        changeUserPassword(user.id, password);
        console.log(`password updated for ${user.email}`);
        break;
      }
      default:
        usage();
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

main();
