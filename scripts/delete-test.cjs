#!/usr/bin/env node
/**
 * scripts/delete-test.cjs — project-deletion acceptance test (Local branch).
 *
 * Flow (STRICTLY SERIAL, one Chromium — see AGENT_RUNBOOK OOM law):
 *   Continue locally → create a project → open the Workspace Deck →
 *   trash icon → confirmation modal (target named, consequences listed) →
 *   Delete permanently → last project dies → Project Genesis returns →
 *   IndexedDB store verified empty.
 *
 * Exit 0 = PASS, exit 1 = FAIL.
 *
 * Usage: node scripts/delete-test.cjs
 *   MARKBRAIN_URL overrides the app URL (default http://localhost:${PORT||3030}).
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

function requirePlaywright() {
  const candidates = ['playwright-core', '/tmp/pw/node_modules/playwright-core'];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* next */
    }
  }
  console.error(
    'playwright-core not found. Bootstrap with:\n' +
      '  npm i --prefix /tmp/pw playwright-core\n' +
      'or add it as a devDependency.'
  );
  process.exit(1);
}

function findChrome() {
  const candidates = [];
  if (process.env.CHROME_BIN) candidates.push(process.env.CHROME_BIN);
  try {
    const base = path.join(os.homedir(), '.cache', 'ms-playwright');
    const dirs = fs
      .readdirSync(base)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse();
    for (const d of dirs) candidates.push(path.join(base, d, 'chrome-linux', 'chrome'));
  } catch {
    /* no playwright cache */
  }
  candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  const found = candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
  if (!found) {
    console.error('No Chromium/Chrome found. Set CHROME_BIN to an executable.');
    process.exit(1);
  }
  return found;
}

function envVal(raw, key) {
  return (raw.match(new RegExp(`^${key}="?([^"\\n]+)"?`, 'm')) || [])[1] || '';
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const PROJECT_NAME = 'Doomed Probe';

async function main() {
  const { chromium } = requirePlaywright();
  const chrome = findChrome();

  const envRaw = fs.existsSync(path.join(ROOT, '.env'))
    ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    : '';
  const PORT = envVal(envRaw, 'PORT') || '3030';
  const APP = process.env.MARKBRAIN_URL || `http://localhost:${PORT}`;

  try {
    const r = await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`health ${r.status}`);
  } catch (e) {
    console.error(`App not reachable at ${APP} — start it first:  bun run dev`);
    process.exit(1);
  }

  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
    page.on('dialog', async (d) => {
      console.log('[dialog]', d.message().slice(0, 200));
      await d.dismiss();
    });

    await page.goto(APP + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByRole('button', { name: 'Continue locally' }).click({ timeout: 15000 });
    await page.getByPlaceholder('e.g. Side Project Ideas').waitFor({ timeout: 15000 });
    await page.getByPlaceholder('e.g. Side Project Ideas').fill(PROJECT_NAME);
    await page.getByRole('button', { name: /Create & Launch Workspace/ }).click({ timeout: 15000 });
    await page.getByText(PROJECT_NAME).first().waitFor({ timeout: 30000 });
    log(`created "${PROJECT_NAME}"`);

    // Open the Workspace Deck: "Active Project" accordion → "Create / Switch in Deck"
    await page.locator('button:has-text("Active Project")').first().click({ timeout: 10000 });
    await page.locator('button:has-text("Create / Switch in Deck")').first().click({ timeout: 10000 });
    await page.getByText('Active Project Repositories').waitFor({ timeout: 10000 });
    log('launcher open');

    await page.locator('[aria-label*="Delete project"]').first().click({ timeout: 10000 });
    await page.getByText(`Delete “${PROJECT_NAME}”?`).waitFor({ timeout: 5000 });
    const hasConsequences = await page.locator('text=ALL of its data').isVisible();
    if (!hasConsequences) throw new Error('confirmation copy missing consequences line');
    log('confirmation modal OK (target named, consequences listed)');

    await page.getByRole('button', { name: /Delete permanently/ }).click({ timeout: 10000 });
    // Last project → Project Genesis must return
    await page.getByPlaceholder('e.g. Side Project Ideas').waitFor({ timeout: 15000 });
    log('deleted → Genesis returned');

    const idb = await page.evaluate(
      () =>
        new Promise((res) => {
          const req = indexedDB.open('markbrain-local', 1);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('projects')) {
              res({ count: 0 });
              db.close();
              return;
            }
            const q = db.transaction('projects', 'readonly').objectStore('projects').count();
            q.onsuccess = () => {
              res({ count: q.result });
              db.close();
            };
          };
          req.onerror = () => res({ err: String(req.error) });
        })
    );
    if (idb.count !== 0) throw new Error('IDB not empty after delete: ' + JSON.stringify(idb));
    log('IndexedDB empty ✓');
    await ctx.close();
    log('DELETE TEST PASS');
  } finally {
    await browser.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('DELETE TEST FAIL:', e && e.message ? e.message : e);
    process.exit(1);
  }
);
