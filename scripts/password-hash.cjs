#!/usr/bin/env node
/**
 * Generate a MarkBrain password hash locally so the plaintext password never
 * crosses a command line, an Ansible invocation, or the network.
 *
 *   node scripts/password-hash.cjs                 (prompts on muted stdin)
 *   node scripts/password-hash.cjs --out hash.txt  (writes the hash to a file)
 *
 * Prints/writes exactly: scrypt$<saltHex>$<hashHex>  — the same format
 * server/lib/accountVault.ts stores in users.password_hash. Upload it to the
 * VPS as /etc/markbrain/secrets/owner-password-hash (or pass it via
 * --password-hash to scripts/user-admin.ts). Knowing the hash does NOT allow
 * login; the plaintext must still be kept somewhere safe for the human.
 */
const crypto = require('node:crypto');
const readline = require('node:readline');

const args = process.argv.slice(2);
let outFile = null;
const outIdx = args.indexOf('--out');
if (outIdx !== -1 && args[outIdx + 1]) outFile = args[outIdx + 1];
// No positional arguments: everything must be --flag or a --flag value.
const flagValues = new Set(outFile ? [outFile] : []);
const stray = args.filter((a, i) => !a.startsWith('-') && !flagValues.has(a) && !(outIdx !== -1 && i === outIdx + 1));
if (stray.length > 0) {
  console.error('error: no positional arguments — the password never goes on the command line');
  process.exit(1);
}

const PROMPT = 'password: ';

function readPassword() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY === true,
      prompt: PROMPT,
    });
    // Mute everything the readline layer writes except the prompt itself,
    // so the typed password never reaches the terminal or the transcript.
    rl._writeToOutput = function _writeToOutput(s) {
      if (s.includes(PROMPT)) rl.output.write(PROMPT);
    };
    rl.question(PROMPT, (answer) => {
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

function pipedPassword() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
  });
}

async function main() {
  const password = process.stdin.isTTY === true ? await readPassword() : await pipedPassword();
  if (password.length < 8) {
    console.error('error: password must be at least 8 characters');
    process.exit(1);
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const stored = `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
  if (outFile) {
    require('node:fs').writeFileSync(outFile, stored + '\n', { mode: 0o600 });
    console.error(`hash written to ${outFile} (mode 0600)`);
  } else {
    console.log(stored);
  }
}

main().catch((e) => {
  console.error('error:', e.message);
  process.exit(1);
});