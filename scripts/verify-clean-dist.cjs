#!/usr/bin/env node
/**
 * Build guard: scans every file in `dist/` after `vite build` and fails with
 * exit code 1 if any API key prefix, Firebase config artifact, or private key
 * marker was bundled into the client assets.
 *
 * Wired into `npm run build` (design-docs/21A). A secret in dist/ is a
 * leak into every visitor's browser — never ship it.
 */
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const FORBIDDEN_PATTERNS = [
  { name: 'Google API key (AIza...)', regex: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: 'OpenRouter API key (sk-or-...)', regex: /sk-or-v1-[0-9a-f]{32,}/ },
  { name: 'OpenAI-style API key (sk-proj-...)', regex: /sk-proj-[0-9A-Za-z_-]{20,}/ },
  { name: 'Firebase config env leak', regex: /VITE_FIREBASE_API_KEY|firebaseapp\.com/ },
  {
    name: 'Private key PEM block',
    regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|css|html|json|map)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

if (!fs.existsSync(DIST_DIR)) {
  console.error(`[verify-clean-dist] ERROR: dist directory not found at ${DIST_DIR}`);
  process.exit(1);
}

const files = walk(DIST_DIR);
const violations = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  for (const pat of FORBIDDEN_PATTERNS) {
    const match = content.match(pat.regex);
    if (match) {
      violations.push({
        file: path.relative(DIST_DIR, file),
        rule: pat.name,
        sample: match[0].slice(0, 16) + '…',
      });
    }
  }
}

if (violations.length > 0) {
  console.error('[verify-clean-dist] FATAL: Secret or forbidden cloud identifier found in dist/:');
  for (const v of violations) {
    console.error(`  - ${v.file}: ${v.rule} (${v.sample})`);
  }
  process.exit(1);
}

console.log(`[verify-clean-dist] DIST CLEAN: scanned ${files.length} files, 0 secret patterns found.`);
