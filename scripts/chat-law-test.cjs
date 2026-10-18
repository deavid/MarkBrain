#!/usr/bin/env node
/* Ad-hoc self-review probe: one human send → verify stream works + instrumentation law.
 * Counts [MarkBrain:*] console lines between send click and stream end. */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
function req(c) { for (const p of [c, `/tmp/pw/node_modules/${c}`, path.join(ROOT, 'node_modules', c)]) { try { return require(p); } catch {} } console.error(`${c} missing`); process.exit(1); }
const { chromium } = req('playwright-core');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true });
  const page = await browser.newPage();
  const counts = { action: 0, info: 0, warn: 0, error: 0, other: 0 };
  const actions = [];
  const errors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (!t.includes('MarkBrain:')) return;
    if (t.includes('[ACTION]')) { counts.action++; actions.push(t.slice(0, 120)); }
    else if (t.includes('[INFO]')) counts.info++;
    else if (t.includes('[WARN]')) counts.warn++;
    else if (t.includes('[ERROR]')) { counts.error++; errors.push(t.slice(0, 160)); }
    else counts.other++;
  });

  const url = process.env.MARKBRAIN_URL || 'http://localhost:3031';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue locally', timeout: 20000 }).click();
  log('local mode chosen');

  // Fresh storage → genesis form; existing → composer. Wait for EITHER.
  const nameInput = page.getByPlaceholder('e.g. Side Project Ideas');
  const composer = page.getByPlaceholder(/Pour it out/);
  const genesisSeen = await Promise.race([
    nameInput.waitFor({ timeout: 15000 }).then(() => true).catch(() => false),
    composer.waitFor({ timeout: 15000 }).then(() => false).catch(() => false),
  ]);
  if (genesisSeen) {
    await nameInput.fill('Chat Probe');
    await page.getByPlaceholder('e.g. SIDE-IDEAS').fill('PROBE');
    await page.getByText('Create & Launch Workspace').click();
    log('project created');
  }
  await composer.waitFor({ timeout: 20000 });
  log('composer up');

  // Reset counters AFTER boot noise — only count during the send window
  counts.action = counts.info = counts.warn = counts.error = counts.other = 0;
  actions.length = errors.length = 0;

  // Long reply ON PURPOSE: forces many stream chunks → many re-renders →
  // stresses the ≤16 cap. A short-reply probe can pass by luck (review note).
  await composer.fill(
    'Self-review probe: write a 300-word essay on why overflow brains need notebooks. No lists.'
  );
  const t0 = Date.now();
  await composer.press('Enter'); // hero composer submits on Enter (0-message state)
  log('send triggered (Enter)');

  await page.getByTitle('Stop generating').waitFor({ timeout: 20000 });
  log('streaming started');
  await page.getByTitle('Stop generating').waitFor({ state: 'detached', timeout: 60000 });
  log(`stream ended in ${Date.now() - t0}ms`);
  await page.waitForTimeout(1500);

  const total = counts.action + counts.info + counts.warn + counts.error + counts.other;
  console.log('\n=== INSTRUMENTATION WINDOW (one human send) ===');
  console.log(JSON.stringify(counts), 'total:', total);
  console.log('ACTION lines:'); actions.forEach((a) => console.log('  ', a));
  if (errors.length) { console.log('ERROR lines:'); errors.forEach((e) => console.log('  ', e)); }

  const speakers = await page.getByText('MarkBrain', { exact: true }).count();
  console.log('assistant speaker markers:', speakers);

  const pass = total <= 16 && counts.error === 0 && speakers > 0;
  console.log(pass ? '\nLAW PASS (≤16 events, 0 errors, reply rendered)' : '\nLAW FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error('PROBE FAIL:', e.message); process.exit(1); });
