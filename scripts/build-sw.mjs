/*
 * Post-build step: stamp the real precache manifest into dist/sw.js.
 *
 * public/sw.js carries a __PRECACHE__ placeholder; here we walk dist/ and
 * replace it with every built file (hashed assets, fonts, icons, index.html
 * as '/'). This is what closes the "first visit" gap: without it the service
 * worker only starts controlling the page AFTER it registered, so runtime
 * caching never sees the initial assets and airplane mode shows an empty
 * shell. With the manifest, install() warms everything on first online visit.
 *
 * Run after `vite build` (wired as part of npm run build). Never edits
 * public/sw.js — only the copy in dist/.
 */
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '..', 'dist');

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const files = walk(dist).filter((f) => f !== 'sw.js');
const manifest = files.map((f) => (f === 'index.html' ? '/' : `/${f}`));
const lines = manifest.map((u) => `  '${u}',`).join('\n');

const swPath = path.join(dist, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes('__PRECACHE__')) throw new Error('dist/sw.js has no __PRECACHE__ placeholder');
sw = sw.replace('__PRECACHE__', `[\n${lines}\n]`);
fs.writeFileSync(swPath, sw);
console.log(`[build-sw] precache manifest: ${manifest.length} files`);
