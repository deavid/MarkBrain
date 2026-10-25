#!/usr/bin/env tsx
/**
 * CLI user administration (design-docs/21B §5).
 *
 *   npm run user -- create <email> --password <password> [--owner]
 *   npm run user -- list
 *   npm run user -- enable <email>
 *   npm run user -- disable <email>
 *   npm run user -- passwd <email> --password <newPassword>
 *
 * Talks to the same SQLite file the server uses (MARKBRAIN_DB_PATH or
 * <cwd>/data/markbrain.sqlite). Never prints hashes, salts, or keys.
 */
import '../server/lib/env';
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
  npm run user -- passwd <email> --password <newPassword>`);
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
        const password = flagValue(args, '--password');
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
        const password = flagValue(args, '--password');
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
