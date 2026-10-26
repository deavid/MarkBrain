#!/usr/bin/env node
/**
 * recoverKeys.cjs — one-off vault key recovery (design 21B §3, read-only).
 *
 * The four API keys live AES-256-GCM-encrypted in user_secrets, decryptable
 * only with the vault key scrypt-derived from YOUR password. This script
 * derives it in memory, decrypts, and writes .env_keys (gitignored by the
 * .env* pattern — never commit it).
 *
 * The password is ALWAYS read from stdin with echo disabled — never a
 * positional arg, never an env var: it must not land in bash history,
 * `ps` output, or the terminal scrollback.
 *
 * Usage:
 *   node scripts/recoverKeys.cjs [--email you@example.com] [--db path] [--out path]
 *   echo "$PW" | node scripts/recoverKeys.cjs          # piped stdin also works
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const readline = require('node:readline');
const Database = require('better-sqlite3');

/* ── flags ────────────────────────────────────────────────────────────────── */

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) {
        console.error(`Flag ${a} expects a value.`);
        process.exit(1);
      }
      return argv[++i];
    };
    if (a === '--email') flags.email = next();
    else if (a === '--db') flags.db = next();
    else if (a === '--out') flags.out = next();
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node scripts/recoverKeys.cjs [--email EMAIL] [--db PATH] [--out PATH]\n' +
          'Password is prompted on stdin (echo off), or piped via stdin.'
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a} (flags only — the password never goes on the command line)`);
      process.exit(1);
    }
  }
  return flags;
}

const flags = parseFlags(process.argv.slice(2));

/* ── password from stdin, never echoed ───────────────────────────────────── */

async function readPassword() {
  // Piped stdin (echo 'pw' | node ...) — read to EOF, trim the newline.
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  // Interactive TTY: prompt with echo disabled.
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const PROMPT = 'Vault password: ';
    rl.question(PROMPT, (answer) => {
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
    // Mute everything EXCEPT the prompt itself — the typed password never echoes.
    rl._writeToOutput = function _writeToOutput(s) {
      if (s.includes(PROMPT)) rl.output.write(PROMPT);
    };
  });
}

/* ── decrypt ─────────────────────────────────────────────────────────────── */

async function main() {
  const password = await readPassword();
  if (!password) {
    console.error('No password entered.');
    process.exit(1);
  }

  const dbPath = flags.db || process.env.MARKBRAIN_DB_PATH || path.resolve(process.cwd(), 'data', 'markbrain.sqlite');
  if (!fs.existsSync(dbPath)) {
    console.error(`No database at ${dbPath}`);
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true });
  const user = flags.email
    ? db.prepare('SELECT id, email, kdf_salt FROM users WHERE email = ?').get(flags.email)
    : db.prepare('SELECT id, email, kdf_salt FROM users WHERE is_owner = 1').get();
  if (!user) {
    console.error('No matching user.');
    process.exit(1);
  }

  const vaultKey = crypto.scryptSync(password, Buffer.from(user.kdf_salt), 32, { N: 16384, r: 8, p: 1 });
  const row = db.prepare('SELECT iv, auth_tag, ciphertext FROM user_secrets WHERE user_id = ?').get(user.id);
  if (!row) {
    console.error('No saved keys for this account — nothing to recover.');
    process.exit(1);
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey, Buffer.from(row.iv));
  decipher.setAuthTag(Buffer.from(row.auth_tag));
  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(Buffer.from(row.ciphertext)), decipher.final()]);
  } catch {
    console.error('Decryption failed — wrong password?');
    process.exit(1);
  }
  const payload = JSON.parse(plaintext.toString('utf8'));
  if (payload.openrouter && !payload['openrouter-free']) payload['openrouter-free'] = payload.openrouter; // legacy alias

  const ENV_NAMES = {
    'gemini-free': 'GEMINI_FREE_KEY',
    'gemini-paid': 'GEMINI_PAID_KEY',
    'openrouter-free': 'OPENROUTER_FREE_KEY',
    'openrouter-paid': 'OPENROUTER_PAID_KEY',
  };

  const lines = [
    '# Recovered from the account vault — DO NOT COMMIT (.env* is gitignored).',
    `# Account: ${user.email} · generated ${new Date().toISOString()}`,
    '',
  ];
  let found = 0;
  for (const slot of ['gemini-free', 'gemini-paid', 'openrouter-free', 'openrouter-paid']) {
    if (payload[slot]) {
      lines.push(`${ENV_NAMES[slot]}=${payload[slot]}`);
      found += 1;
    } else {
      lines.push(`# ${ENV_NAMES[slot]}: (empty in the vault)`);
    }
  }
  const outPath = flags.out || path.resolve(process.cwd(), '.env_keys');
  fs.writeFileSync(outPath, lines.join('\n') + '\n', { mode: 0o600 });
  console.log(`Wrote ${outPath} with ${found}/4 key(s) for ${user.email}. chmod 600 applied.`);
  db.close();
}

void main();