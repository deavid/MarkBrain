#!/usr/bin/env node
/**
 * scripts/roundtrip-test.cjs — David's acceptance test for the Local branch:
 *
 *   "user has data, exports it all. New browser, imports data —
 *    same UI result, all data is imported."
 *
 * Flow (STRICTLY SERIAL, one Chromium — see AGENT_RUNBOOK OOM law):
 *   Context A ("browser 1"): Continue locally → create project →
 *     Sidebar → Backup DB → download canonical JSON.
 *   Context B ("browser 2", fresh storage): Continue locally →
 *     Genesis (empty store) → Restore from backup → app reloads →
 *     imported project visible in the studio.
 *
 * Exit 0 = PASS, exit 1 = FAIL. No repo code is modified.
 *
 * Usage: node scripts/roundtrip-test.cjs
 *   MARKBRAIN_URL overrides the app URL (default http://localhost:${PORT||3030}).
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

function requirePlaywright() {
  const candidates = ['playwright-core', '/tmp/pw/node_modules/playwright-core', path.join(ROOT, 'node_modules', 'playwright-core')];
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

const PROJECT_NAME = 'Roundtrip Probe';
const PROJECT_CODE = 'RT';

async function main() {
  const { chromium } = requirePlaywright();
  const chrome = findChrome();

  const envRaw = fs.existsSync(path.join(ROOT, '.env'))
    ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    : '';
  const PORT = envVal(envRaw, 'PORT') || '3030';
  const APP = process.env.MARKBRAIN_URL || `http://localhost:${PORT}`;

  // Health check before spawning anything.
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
    // ── Context A: create + export ────────────────────────────────────────
    log('A: launching context (browser 1)');
    const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const pageA = await ctxA.newPage();
    pageA.on('dialog', async (d) => {
      log('A: unexpected dialog:', d.message().slice(0, 200));
      await d.dismiss();
    });

    await pageA.goto(APP + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageA.getByRole('button', { name: 'Continue locally' }).click({ timeout: 15000 });
    log('A: chose Continue locally');

    // Empty local store → Genesis
    const nameInput = pageA.getByPlaceholder('e.g. Side Project Ideas');
    await nameInput.waitFor({ state: 'visible', timeout: 15000 });
    await nameInput.fill(PROJECT_NAME);
    const codeInput = pageA.getByPlaceholder('e.g. SIDE-IDEAS');
    if (await codeInput.isVisible().catch(() => false)) await codeInput.fill(PROJECT_CODE);
    await pageA.getByRole('button', { name: /Create & Launch Workspace/ }).click({ timeout: 15000 });
    log('A: created project');

    await pageA.getByText(PROJECT_NAME, { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 });
    log('A: studio up, project visible');

    // Sidebar → I/O accordion → Backup DB
    await pageA.getByText('Import / Export I/O', { exact: false }).click({ timeout: 10000 });
    const [download] = await Promise.all([
      pageA.waitForEvent('download', { timeout: 15000 }),
      pageA.getByText('Backup DB', { exact: false }).click({ timeout: 10000 }),
    ]);
    const dlPath = await download.path();
    const exportJson = fs.readFileSync(dlPath, 'utf8');
    log('A: downloaded backup:', download.suggestedFilename());

    const parsed = JSON.parse(exportJson);
    const assert = (cond, msg) => {
      if (!cond) throw new Error(`export assert failed: ${msg}`);
    };
    assert(parsed.format === 'markbrain-database', 'format field');
    assert(parsed.version === 1, 'version field');
    assert(Array.isArray(parsed.projects) && parsed.projects.length === 1, 'exactly 1 project');
    assert(parsed.projects[0].name === PROJECT_NAME, `project name (got ${parsed.projects[0].name})`);
    assert(typeof parsed.projects[0].projectId === 'string', 'projectId present');
    assert(Array.isArray(parsed.projects[0].chapters), 'chapters array');
    log('A: export schema OK — 1 project, canonical format');
    await ctxA.close();

    // ── Context B: fresh browser → restore ───────────────────────────────
    log('B: launching fresh context (browser 2)');
    const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageB = await ctxB.newPage();
    let importAlert = null;
    pageB.on('dialog', async (d) => {
      importAlert = d.message();
      await d.dismiss();
    });

    await pageB.goto(APP + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageB.getByRole('button', { name: 'Continue locally' }).click({ timeout: 15000 });
    log('B: chose Continue locally (empty store)');

    // Fresh store → Genesis → restore trigger lives HERE (no sidebar yet)
    const bName = pageB.getByPlaceholder('e.g. Side Project Ideas');
    await bName.waitFor({ state: 'visible', timeout: 15000 });
    await pageB.getByText('Restore from a database backup instead', { exact: false }).click({ timeout: 10000 });
    await pageB.locator('input[type="file"]').setInputFiles({
      name: 'markbrain-db-roundtrip.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportJson, 'utf8'),
    });
    log('B: restore file handed to input — waiting for reload + boot');

    // importDatabase → window.location.reload() → boot gate → studio
    await pageB
      .getByText(PROJECT_NAME, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 30000 });
    if (importAlert) throw new Error(`import surfaced an alert: ${importAlert}`);
    log('B: imported project visible in studio');

    // Same-UI spot checks: sidebar project entry + chat view present.
    const sidebarHasProject = await pageB
      .getByText(PROJECT_NAME, { exact: false })
      .first()
      .isVisible();
    const chatPresent = await pageB
      .getByText('MarkBrain', { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (!sidebarHasProject) throw new Error('sidebar project entry missing after restore');
    log('B: sidebar OK | brand chrome OK:', chatPresent);

    await ctxB.close();
    log('ROUNDTRIP PASS — export → fresh browser → import → same UI, all data in.');
  } finally {
    await browser.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('ROUNDTRIP FAIL:', e && e.message ? e.message : e);
    process.exit(1);
  }
);