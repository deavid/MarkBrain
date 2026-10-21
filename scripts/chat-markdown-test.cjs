#!/usr/bin/env node
/**
 * scripts/chat-markdown-test.cjs — the bubble-view journey, in a real browser.
 *
 * Unit tests cover the pieces (messageIsRaw/flipMessageView, MessageBody,
 * copyText); this covers the wiring the pieces cannot reach: two roles in one
 * feed, a Raw chip that flips one bubble, Copy landing the *markdown source* on
 * the real clipboard, the sidebar switch flipping every bubble, and the choice
 * surviving a reload.
 *
 * Usage (needs a dev server: `npm run dev` in one terminal):
 *   node scripts/chat-markdown-test.cjs
 *
 * Env: MARKBRAIN_URL (default http://localhost:${PORT from .env || 3030}),
 *      CHROME_BIN  (default /usr/bin/google-chrome or the playwright cache)
 *
 * The model's reply is optional on purpose: the assertions about the *reply*
 * bubble run only if one arrives (a rate-limited key is not a UI bug). Every
 * assertion about the user bubble, the toggle and the clipboard always runs.
 * Exit code 1 on any failure.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const log = (...a) => console.log(...a);

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
  checks++;
  if (ok) log(`  PASS  ${name}`);
  else {
    failures++;
    log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function req(c) {
  for (const p of [c, `/tmp/pw/node_modules/${c}`, path.join(ROOT, 'node_modules', c)]) {
    try { return require(p); } catch { /* try next */ }
  }
  log(`${c} missing. Bootstrap: npm i --prefix /tmp/pw playwright-core`);
  process.exit(1);
}

function findChrome() {
  const candidates = [process.env.CHROME_BIN];
  try {
    const base = path.join(os.homedir(), '.cache', 'ms-playwright');
    fs.readdirSync(base)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse()
      .forEach((d) => candidates.push(path.join(base, d, 'chrome-linux', 'chrome')));
  } catch { /* no playwright cache */ }
  candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  const found = candidates.find((p) => { try { return !!p && fs.existsSync(p); } catch { return false; } });
  if (!found) {
    log('No Chromium/Chrome found. Set CHROME_BIN to an executable.');
    process.exit(1);
  }
  return found;
}

function envPort() {
  try {
    const m = /^\s*PORT\s*=\s*(\d+)/m.exec(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'));
    if (m) return m[1];
  } catch { /* no .env */ }
  return '3030';
}

const SAMPLE = [
  'Probe: **bold**, `inline`, and a fence.',
  '',
  '```ts',
  'const x = 1 < 2;',
  '```',
  '',
  '1. one',
  '2. two',
].join('\n');

const EXPECTED_TAGS = ['strong', 'code', 'pre', 'ol', 'li'];

async function main() {
  const { chromium } = req('playwright-core');
  const APP = process.env.MARKBRAIN_URL || `http://localhost:${envPort()}`;
  const origin = new URL(APP).origin;

  try {
    const r = await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`health ${r.status}`);
  } catch {
    log(`App not reachable at ${APP} — start it first: npm run dev`);
    process.exit(1);
  }

  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => { const s = String(e); if (!s.includes('WebSocket')) pageErrors.push(s.slice(0, 200)); });

  log(`\n${APP} — chat markdown journey\n`);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });

  // Local backend: the journey must not touch a real account. The gate mounts
  // after domcontentloaded, so wait for the button rather than counting it.
  const localBtn = page.getByRole('button', { name: 'Use local storage instead' });
  const needsAuth = await localBtn.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (needsAuth) await localBtn.click();

  const nameInput = page.getByPlaceholder('e.g. Side Project Ideas');
  const composer = page.getByPlaceholder(/Pour it out/);
  const genesis = await Promise.race([
    nameInput.waitFor({ timeout: 15000 }).then(() => true).catch(() => false),
    composer.waitFor({ timeout: 15000 }).then(() => false).catch(() => false),
  ]);
  if (genesis) {
    await nameInput.fill('Markdown Probe');
    await page.getByPlaceholder('e.g. SIDE-IDEAS').fill('MDPROBE');
    await page.getByText('Create & Launch Workspace').click();
  }
  log(`  boot: genesis=${genesis}`);
  try {
    await composer.waitFor({ timeout: 20000 });
  } catch (e) {
    log('composer never appeared; body:', (await page.evaluate(() => document.body.innerText)).slice(0, 500));
    throw e;
  }

  await composer.fill(SAMPLE);
  await composer.press('Enter');

  const bubbles = page.locator('[data-testid="message-markdown"], [data-testid="message-raw"]');
  await bubbles.first().waitFor({ timeout: 20000 });

  // ── 1. The user's own message renders as markdown ────────────────────────
  const userMd = page.locator('[data-testid="message-markdown"]').first();
  await userMd.waitFor({ timeout: 20000 });
  const userTags = [...new Set(
    [...(await userMd.innerHTML()).matchAll(/<([a-z0-9]+)[\s>]/g)].map((m) => m[1])
  )];
  check(
    'user bubble renders markdown (strong/code/pre/ol/li)',
    EXPECTED_TAGS.every((t) => userTags.includes(t)),
    `got ${userTags.join(',')}`
  );
  check('user bubble is a raised host', (await userMd.getAttribute('class') || '').includes('md-chat-raised'));

  // ── 2. Raw flips ONE bubble, and flips back ──────────────────────────────
  const userHeaderRaw = page.getByRole('button', { name: 'Raw', exact: true }).first();
  await userHeaderRaw.click();
  await page.waitForTimeout(250);
  const rawCount = await page.locator('[data-testid="message-raw"]').count();
  const rawText = rawCount ? await page.locator('[data-testid="message-raw"]').first().innerText() : '';
  check('Raw shows this bubble as source', rawCount === 1 && rawText.includes('**bold**') && rawText.includes('```ts'), `count=${rawCount}`);
  check('raw view shows that source verbatim', rawText.trim() === SAMPLE.trim(), JSON.stringify(rawText.slice(0, 40)));

  await userHeaderRaw.click();
  await page.waitForTimeout(250);
  check(
    'Raw is a toggle (rendered again)',
    (await page.locator('[data-testid="message-raw"]').count()) === 0 &&
      (await page.locator('[data-testid="message-markdown"]').count()) >= 1
  );

  // ── 3. Copy puts the markdown SOURCE on the clipboard ────────────────────
  await page.getByRole('button', { name: /^Copy .* as markdown$/ }).first().click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('copy writes the exact source', clip === SAMPLE, JSON.stringify(clip.slice(0, 60)));

  // ── 4. The reply bubble, if the model answered ───────────────────────────
  let replied = false;
  for (let i = 0; i < 45 && !replied; i++) {
    replied = (await bubbles.count()) >= 2;
    if (!replied) await page.waitForTimeout(1000);
  }
  if (replied) {
    const last = page.locator('[data-testid="message-markdown"]').last();
    const lastClass = (await last.getAttribute('class')) || '';
    check('reply bubble is a sunken host', lastClass.includes('md-chat-sunken'));
    const rawBtns = page.getByRole('button', { name: 'Raw', exact: true });
    check('both roles carry a Raw control', (await rawBtns.count()) >= 2, `count=${await rawBtns.count()}`);
    check('both roles carry a Copy control', (await page.getByRole('button', { name: /^Copy .* as markdown$/ }).count()) >= 2);
    await rawBtns.last().click();
    await page.waitForTimeout(250);
    check('reply Raw shows its source', (await page.locator('[data-testid="message-raw"]').count()) === 1);
    await rawBtns.last().click();
  } else {
    log('  SKIP  reply assertions — no reply arrived (model/key), UI checks still valid');
  }

  // ── 5. Sidebar switch is global, and survives a reload ───────────────────
  await page.getByRole('button', { name: 'Chat text: Raw' }).click();
  await page.waitForTimeout(400);
  check(
    'global Raw flips every bubble',
    (await page.locator('[data-testid="message-markdown"]').count()) === 0 &&
      (await page.locator('[data-testid="message-raw"]').count()) >= 1
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="message-raw"], [data-testid="message-markdown"]').first().waitFor({ timeout: 20000 });
  check('raw default survives a reload', (await page.locator('[data-testid="message-raw"]').count()) >= 1);

  await page.getByRole('button', { name: 'Chat text: Markdown' }).click();
  await page.waitForTimeout(400);
  check(
    'global Markdown restores rendering',
    (await page.locator('[data-testid="message-markdown"]').count()) >= 1 &&
      (await page.locator('[data-testid="message-raw"]').count()) === 0
  );

  // ── 6. Mobile width: the two controls must not push the header apart ─────
  await page.setViewportSize({ width: 390, height: 820 });
  await page.waitForTimeout(500);
  const closeBtn = page.getByRole('button', { name: /close/i }).first();
  if (await closeBtn.count()) await closeBtn.click().catch(() => {});
  await page.waitForTimeout(400);
  const header = page.locator('[data-testid="message-markdown"]').first();
  const box = await header.boundingBox();
  check('bubble stays inside a 390px viewport', !!box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  log(`\n${checks - failures}/${checks} checks passed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  log('PROBE ERROR', e);
  process.exit(1);
});
