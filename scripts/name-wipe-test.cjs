#!/usr/bin/env node
/* Live repro for review P0#3: create project → send → reload → sidebar must
 * show the human-readable name, NOT the raw `proj-…` id.
 * (The bug: IndexedDB put() replaces the record; if the auto-save caller omits
 * name/codeName/description/color, meta is wiped on first send + reload.) */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
function req(c) { for (const p of [c, `/tmp/pw/node_modules/${c}`, path.join(ROOT, 'node_modules', c)]) { try { return require(p); } catch {} } console.error(`${c} missing`); process.exit(1); }
const { chromium } = req('playwright-core');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true });
  const page = await browser.newPage();
  const url = process.env.MARKBRAIN_URL || 'http://localhost:3031';

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue locally', timeout: 20000 }).click();
  log('local mode chosen');

  // Fresh storage → genesis form
  const nameInput = page.getByPlaceholder('e.g. Side Project Ideas');
  const composer = page.getByPlaceholder(/Pour it out/);
  const genesisSeen = await Promise.race([
    nameInput.waitFor({ timeout: 15000 }).then(() => true).catch(() => false),
    composer.waitFor({ timeout: 15000 }).then(() => false).catch(() => false),
  ]);
  if (genesisSeen) {
    await nameInput.fill('Name Wipe Probe');
    await page.getByPlaceholder('e.g. SIDE-IDEAS').fill('WIPE-PROBE');
    await page.getByText('Create & Launch Workspace').click();
    log('project created');
  } else {
    log('existing storage — creating a fresh project via launcher instead');
    // Fall through: still valid if sidebar already lists a named project,
    // but for a clean repro prefer fresh storage.
  }
  await composer.waitFor({ timeout: 20000 });
  log('composer up');

  // Trigger the debounced auto-save: one real send
  await composer.fill('Name-wipe probe: one short sentence please.');
  await composer.press('Enter');
  log('send triggered');
  await page.getByTitle('Stop generating').waitFor({ timeout: 20000 }).catch(() => {});
  await page.getByTitle('Stop generating').waitFor({ state: 'detached', timeout: 60000 });
  log('stream ended');
  await page.waitForTimeout(1500); // let the 500ms debounce flush

  // THE REPRO: reload and inspect the sidebar
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue locally', timeout: 10000 }).click().catch(() => {});
  await page.waitForTimeout(3000);
  const body = await page.locator('body').innerText();
  const hasName = body.includes('Name Wipe Probe');
  const hasRawId = /proj-[a-z0-9]{6,}-[a-z0-9]+/.test(body);

  console.log('\n=== NAME-WIPE REPRO (P0#3) ===');
  console.log('sidebar shows human name:', hasName);
  console.log('sidebar shows raw proj- id:', hasRawId);
  const pass = hasName && !hasRawId;
  console.log(pass ? '\nPASS — meta survived auto-save + reload' : '\nFAIL — meta wiped');
  await browser.close();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });