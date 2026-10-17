#!/usr/bin/env node
/**
 * scripts/headless-capture.cjs — run MarkBrain headlessly and screenshot it,
 * zero human interaction. Auth is mocked at the network/storage layer; no
 * repo code is modified and no real Google/Firestore/Gemini traffic happens
 * for writes.
 *
 * Full mechanics + caveats: design-docs/AGENT_RUNBOOK.md
 *
 * Usage:
 *   node scripts/headless-capture.cjs   (opens /?fixture=1 — dev fixture seam)
 *
 * Env overrides:
 *   MARKBRAIN_URL    default http://localhost:${PORT from .env || 3030}
 *   MARKBRAIN_SHOTS  output dir (default: $TMPDIR/markbrain-shots)
 *   CHROME_BIN       Chromium/Chrome executable (default: playwright cache,
 *                    then system chrome)
 *
 * Dependency bootstrap (once):
 *   npm i --prefix /tmp/pw playwright-core
 *   # …or install playwright-core as a devDependency of this repo.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.MARKBRAIN_SHOTS || path.join(os.tmpdir(), 'markbrain-shots');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let shotN = 0;

function requirePlaywright() {
  const candidates = ['playwright-core', '/tmp/pw/node_modules/playwright-core'];
  for (const c of candidates) {
    try { return require(c); } catch { /* try next */ }
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
    const dirs = fs.readdirSync(base)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse();
    for (const d of dirs) candidates.push(path.join(base, d, 'chrome-linux', 'chrome'));
  } catch { /* no playwright cache */ }
  candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  const found = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!found) {
    console.error('No Chromium/Chrome found. Set CHROME_BIN to an executable.');
    process.exit(1);
  }
  return found;
}

function readEnvFile() {
  const p = path.join(ROOT, '.env');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}
const envVal = (raw, key) => (raw.match(new RegExp(`^${key}="?([^"\\n]+)"?`, 'm')) || [])[1] || '';

async function main() {
  const { chromium } = requirePlaywright();
  const chrome = findChrome();
  fs.mkdirSync(OUT, { recursive: true });

  const env = readEnvFile();
  const API_KEY = envVal(env, 'FIREBASE_API_KEY');
  const PROJECT = envVal(env, 'FIREBASE_PROJECT_ID');
  const PORT = envVal(env, 'PORT') || '3030';
  const APP = process.env.MARKBRAIN_URL || `http://localhost:${PORT}`;
  if (!API_KEY) {
    console.error('FIREBASE_API_KEY missing from .env — auth mock needs it to match the client config.');
    process.exit(1);
  }

  // Pre-flight: is the dev server up? (npm run dev → tsx server.ts)
  try {
    const r = await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`health ${r.status}`);
  } catch {
    console.error(`App not reachable at ${APP} — start it first:  npm run dev`);
    process.exit(1);
  }

  // --- Mock material ------------------------------------------------------
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const UID = 'headless-capture-001';
  const EMAIL = 'headless.capture@example.com';

  // Syntactically valid JWT with exp 1h out → no token refresh during capture.
  const ID_TOKEN = [
    b64url({ alg: 'RS256', typ: 'JWT' }),
    b64url({
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      sub: UID,
      auth_time: nowSec,
      iat: nowSec,
      exp: nowSec + 3600,
      email: EMAIL,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com', identities: { 'google.com': [EMAIL] } },
    }),
    'sig',
  ].join('.');

  const REFRESH_TOKEN = `headless-refresh-${nowSec}`;
  const fakeUser = {
    uid: UID,
    displayName: 'Headless Capture',
    email: EMAIL,
    emailVerified: true,
    photoURL: null,
    phoneNumber: null,
    isAnonymous: false,
    providerData: [
      { providerId: 'google.com', uid: UID, displayName: 'Headless Capture', email: EMAIL, photoURL: null },
    ],
    apiKey: API_KEY, // must match vite-injected config.apiKey or hydration discards the user
    createdAt: String(nowSec - 86400),
    lastLoginAt: String(nowSec),
    stsTokenManager: {
      refreshToken: REFRESH_TOKEN,
      accessToken: ID_TOKEN,
      expirationTime: (nowSec + 3600) * 1000, // ms epoch
    },
  };

  // --- Browser + interception --------------------------------------------
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // (1) Seed Firebase local auth persistence before any app script runs.
  await ctx.addInitScript(
    ({ key, user }) => {
      try {
        window.localStorage.setItem(`firebase:authUser:${key}:[DEFAULT]`, JSON.stringify(user));
      } catch { /* ignore */ }
    },
    { key: API_KEY, user: fakeUser }
  );

  // (2) HOLD Firestore — never fulfill. Keeps listUserProjects pending, so
  // cloudProjectsCount stays null and the workspace keeps its local demo data.
  // Also guarantees zero cloud reads/writes from the capture session.
  let held = 0;
  await ctx.route(/firestore\.googleapis\.com/, () => { held++; });

  // (3) Fulfill accounts:lookup — Auth verifies the seeded user here; a 400
  // clears the session and dumps us back at the gate.
  await ctx.route(/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/, (route) => {
    log('→ serving accounts:lookup');
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        users: [{
          localId: UID,
          email: EMAIL,
          displayName: 'Headless Capture',
          emailVerified: true,
          providerData: [{ providerId: 'google.com', rawId: UID, email: EMAIL, displayName: 'Headless Capture' }],
          createdAt: String((nowSec - 86400) * 1000),
          lastLoginAt: String(nowSec * 1000),
          idToken: ID_TOKEN,
          refreshToken: REFRESH_TOKEN,
          expiresIn: '3600',
        }],
      }),
    });
  });

  // Fallback: token refresh, should not fire while expirationTime is far future.
  await ctx.route(/securetoken\.googleapis\.com/, (route) => {
    log('→ serving securetoken refresh');
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: ID_TOKEN, id_token: ID_TOKEN, expires_in: '3600',
        refresh_token: REFRESH_TOKEN, token_type: 'Bearer',
        user_id: UID, project_id: PROJECT,
      }),
    });
  });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('⚠️ pageerror:', String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') log('⚠️ console:', m.text().slice(0, 300)); });
  page.on('response', (r) => { if (r.status() >= 400) log('⚠️ resp', r.status(), r.url().slice(0, 160)); });

  const shot = async (name) => {
    const file = path.join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file });
    log('📸', file);
  };

  const startUrl = APP + (APP.includes('?') ? '&' : '?') + 'fixture=1';
  log('navigating →', startUrl);
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Detect which screen rendered: main app (textarea) vs auth gate.
  const mainApp = page.locator('textarea').first();
  const authGate = page.getByText('Continue with Google', { exact: false }).first();
  let screen = 'unknown';
  try {
    await Promise.race([
      mainApp.waitFor({ state: 'visible', timeout: 30000 }).then(() => (screen = 'main')),
      authGate.waitFor({ state: 'visible', timeout: 30000 }).then(() => (screen = 'authgate')),
    ]);
  } catch { /* keep unknown */ }
  log('screen:', screen, '| firestore held:', held);

  await page.waitForTimeout(3000);
  if (screen !== 'main') {
    await shot(screen);
    const dbg = await page.evaluate(() => ({
      lsKeys: Object.keys(localStorage),
      text: document.body.innerText.slice(0, 300),
    }));
    log('debug:', JSON.stringify(dbg));
    await browser.close();
    process.exit(screen === 'unknown' ? 1 : 0);
  }

  // Stage 1: chat / dialogue view (default).
  await shot('chat-view');

  // Stage 2: spatial graph view.
  try {
    await page.getByText('Spatial Graph', { exact: false }).first().click({ timeout: 5000 });
    await page.waitForTimeout(3000);
    await shot('spatial-graph');
  } catch (e) { log('graph click failed:', String(e).slice(0, 200)); }

  // Stage 3: mobile viewport (docs: min phone 350×700).
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(2000);
    await shot('mobile');
  } catch (e) { log('mobile shot failed:', String(e).slice(0, 200)); }

  log('done. firestore held total:', held);
  await browser.close();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });