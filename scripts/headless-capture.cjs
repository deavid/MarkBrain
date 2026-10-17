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
 *   node scripts/headless-capture.cjs          → fixture mode (default, zero cloud)
 *   node scripts/headless-capture.cjs --real   → real-data mode: seeds the
 *       HEADLESS_REFRESH_TOKEN from .env, lets the SDK do a REAL token refresh
 *       and REAL Firestore reads under ?capture=1 (all saves stay no-ops).
 *       Never touches Google cookies; only the owner-scope refresh token.
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

  // --- Mode: fixture (default, fully offline) vs real (--real) -------------
  // Real mode reads HEADLESS_REFRESH_TOKEN from .env (harvested from David's
  // own session, see AGENT_RUNBOOK §3.5). Writes are impossible either way:
  // ?capture=1 / ?fixture=1 flip isCaptureMode() in persistenceService.ts.
  const REAL = process.argv.includes('--real') || process.env.MARKBRAIN_CAPTURE_MODE === 'real';
  const REAL_REFRESH = envVal(env, 'HEADLESS_REFRESH_TOKEN');
  const REAL_USER_B64 = envVal(env, 'HEADLESS_AUTH_USER_B64'); // full verbatim record from David's browser
  if (REAL && !REAL_REFRESH) {
    console.error('Real mode requested but HEADLESS_REFRESH_TOKEN missing from .env.');
    process.exit(1);
  }
  log('mode:', REAL ? 'REAL (live token refresh + real Firestore reads, writes no-op)'
                    : 'fixture (zero cloud traffic)');

  // Pre-flight: is the dev server up? (npm run dev → tsx server.ts)
  try {
    const r = await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`health ${r.status}`);
  } catch {
    console.error(`App not reachable at ${APP} — start it first:  bun run dev`);
    process.exit(1);
  }

  // --- Seed user record ---------------------------------------------------
  // REAL mode. Ground truth from @firebase/auth dist (getAuth →
  // PersistenceUserManager.create with [indexedDBLocalPersistence,
  // browserLocalPersistence, …]): IndexedDB is the preferred persistence and
  // stores the record as {fbase_key: key, value: userObject} (DB
  // 'firebaseLocalStorageDb', store 'firebaseLocalStorage'). browserLocalPersistence
  // stores the BARE user object as JSON. On boot, create() reads the key from
  // EVERY persistence and migrates a parseable bare user object from localStorage
  // into IndexedDB. So: unwrap the harvested {fbase_key, value} envelope and
  // write wrapper.value as JSON — verbatim fields, zero mutation. Writing the
  // envelope itself to localStorage makes _fromJSON throw (no top-level uid) and
  // the SDK silently evicts the key. If the accessToken has expired by run time
  // the SDK does a genuine securetoken refresh; if still valid the session just
  // boots. Both real.
  // FIXTURE mode: fully synthetic record below; every cloud call intercepted.
  let seedRaw = null; // exact string written to localStorage (bare user JSON)
  if (REAL) {
    if (!REAL_USER_B64) {
      console.error(
        'Real mode needs HEADLESS_AUTH_USER_B64 in .env — the verbatim storage record\n' +
        '({"fbase_key":...,"value":{...}} envelope) harvested from the signed-in session.'
      );
      process.exit(1);
    }
    const envelope = JSON.parse(Buffer.from(REAL_USER_B64, 'base64').toString('utf8'));
    if (!envelope.value?.uid || !envelope.value?.stsTokenManager) {
      console.error('HEADLESS_AUTH_USER_B64 must be the {fbase_key, value} envelope with value.uid + value.stsTokenManager');
      process.exit(1);
    }
    seedRaw = JSON.stringify(envelope.value); // bare user object, fields untouched
    log('seed: bare user uid', envelope.value.uid, '| envelope stripped | zero mutation');
  }

  // --- Mock material (fixture mode only) ----------------------------------
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
  if (!REAL) seedRaw = JSON.stringify(fakeUser);

  // --- Browser + interception --------------------------------------------
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // (1) Seed Firebase local auth persistence before any app script runs.
  await ctx.addInitScript(
    ({ key, raw }) => {
      try {
        window.localStorage.setItem(`firebase:authUser:${key}:[DEFAULT]`, raw);
        window.localStorage.setItem('__mb_seeded', String(raw.length)); // proves init ran
      } catch { /* ignore */ }
    },
    { key: API_KEY, raw: seedRaw }
  );

  let held = 0;
  if (REAL) {
    // REAL mode: pass-through only — log auth/token endpoints so a failed
    // refresh is diagnosable, but never fulfill (reads are live; the app's
    // save paths are no-ops under ?capture=1; see persistenceService.ts).
    await ctx.route(/(identitytoolkit|securetoken)\.googleapis\.com/, async (route) => {
      const url = route.request().url().replace(/\?.*/, '');
      try {
        const res = await route.fetch();
        log('→', res.status(), url);
        await route.fulfill({ response: res });
      } catch (e) {
        log('→ network fail', url, String(e).slice(0, 200));
        await route.abort('failed');
      }
    });
    log('intercepts: pass-through logging only (live network)');
  } else {
    // (2) HOLD Firestore — never fulfill. Keeps listUserProjects pending, so
    // cloudProjectsCount stays null and the fixture seam serves the workspace.
    // Also guarantees zero cloud reads/writes from the capture session.
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
  }

  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('⚠️ pageerror:', String(e).slice(0, 300)));
  if (REAL) {
    page.on('requestfailed', (r) =>
      log('⚠️ reqfail', (r.failure() || {}).errorText, r.url().slice(0, 160)));
  }
  page.on('console', (m) => { if (m.type() === 'error') log('⚠️ console:', m.text().slice(0, 300)); });
  page.on('response', (r) => { if (r.status() >= 400) log('⚠️ resp', r.status(), r.url().slice(0, 160)); });

  const shot = async (name) => {
    const file = path.join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file });
    log('📸', file);
  };

  // fixture=1 → dev fixture seam serves synthetic project data;
  // capture=1 → real data path, but isCaptureMode() makes every save a no-op.
  const startUrl = APP + (APP.includes('?') ? '&' : '?') + (REAL ? 'capture=1' : 'fixture=1');
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
    const dbg = await page.evaluate(async () => {
      let idb = null;
      try {
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open('firebaseLocalStorageDb', 1);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        const rec = await new Promise((res, rej) => {
          const tx = db.transaction('firebaseLocalStorage', 'readonly');
          const q = tx.objectStore('firebaseLocalStorage').getAll();
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        });
        db.close();
        idb = rec.map((r) => ({ fbase_key: r.fbase_key, uid: r.value?.uid, hasToken: !!r.value?.stsTokenManager?.refreshToken }));
      } catch (e) { idb = 'ERR ' + e; }
      return {
        lsKeys: Object.keys(localStorage),
        idb,
        text: document.body.innerText.slice(0, 300),
      };
    });
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