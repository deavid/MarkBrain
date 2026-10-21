/**
 * Cleanup tool — headless acceptance (fixture boot, 1440×900).
 *
 * Runs the real law on the fixture project, not on mocks:
 *   bulk archive → blocked artifact named → archive the blocker → typed DELETE
 *   (default: the archived chat survives and loses the attachment)
 *   → then delete that chat from the chats tab and watch the fallback take over.
 *
 * Run:  bun run dev   (PORT from .env)  then  node scripts/cleanup-tool-test.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_LAYERS = [
  path.join(ROOT, '.env'),
  path.join(ROOT, '.env.shared'),
  path.join(ROOT, '..', 'MarkBrain', '.env.markbrain-main.shared'),
];
function parseEnv(text) {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v[0] === '"' || v[0] === "'") && v[0] === v[v.length - 1]) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
for (const f of ENV_LAYERS) {
  try { parseEnv(fs.readFileSync(f, 'utf8')); } catch { /* absent layer */ }
}

const { chromium } = require('/tmp/pw/node_modules/playwright-core');
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const APP = process.env.MARKBRAIN_URL || `http://localhost:${process.env.PORT || '3036'}`;
const API_KEY = process.env.FIREBASE_API_KEY;
const PROJECT = process.env.FIREBASE_PROJECT_ID;
if (!API_KEY) { console.log('FIREBASE_API_KEY missing from the layered env'); process.exit(2); }

let failures = 0;
const check = (ok, label, extra) => {
  if (!ok) failures++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
};

(async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const UID = 'cleanup-e2e-001';
  const ID_TOKEN = [
    b64url({ alg: 'RS256', typ: 'JWT' }),
    b64url({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: UID,
      auth_time: nowSec, iat: nowSec, exp: nowSec + 3600, email: 'cleanup.e2e@example.com',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com', identities: { 'google.com': ['cleanup.e2e@example.com'] } } }),
    'sig',
  ].join('.');
  const fakeUser = {
    uid: UID, displayName: 'Cleanup E2E', email: 'cleanup.e2e@example.com', emailVerified: true,
    photoURL: null, phoneNumber: null, isAnonymous: false,
    providerData: [{ providerId: 'google.com', uid: UID, displayName: 'Cleanup E2E', email: 'cleanup.e2e@example.com', photoURL: null }],
    apiKey: API_KEY, createdAt: String(nowSec - 86400), lastLoginAt: String(nowSec),
    stsTokenManager: { refreshToken: `cleanup-refresh-${nowSec}`, accessToken: ID_TOKEN, expirationTime: (nowSec + 3600) * 1000 },
  };

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(({ key, raw }) => {
    try { window.localStorage.setItem(`firebase:authUser:${key}:[DEFAULT]`, raw); } catch {}
  }, { key: API_KEY, raw: JSON.stringify(fakeUser) });
  await ctx.route(/firestore\.googleapis\.com/, () => {}); // hold — fixture seam
  await ctx.route(/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ users: [{ localId: UID, email: 'cleanup.e2e@example.com', displayName: 'Cleanup E2E',
      emailVerified: true, providerData: [{ providerId: 'google.com', rawId: UID, email: 'cleanup.e2e@example.com' }],
      createdAt: String((nowSec - 86400) * 1000), lastLoginAt: String(nowSec * 1000),
      idToken: ID_TOKEN, refreshToken: `cleanup-refresh-${nowSec}`, expiresIn: '3600' }] }),
  }));
  await ctx.route(/securetoken\.googleapis\.com/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ access_token: ID_TOKEN, id_token: ID_TOKEN, expires_in: '3600',
      refresh_token: `cleanup-refresh-${nowSec}`, token_type: 'Bearer', user_id: UID, project_id: PROJECT }),
  }));

  const page = await ctx.newPage();
  // HMR websocket noise when a second dev server holds vite's HMR port.
  const noise = /WebSocket|websocket|24678/;
  const errors = [];
  page.on('pageerror', (e) => { if (!noise.test(String(e))) errors.push(String(e).slice(0, 200)); });
  page.on('console', (m) => {
    if (m.type() !== 'error' || noise.test(m.text())) return;
    errors.push(`console: ${m.text().slice(0, 200)}`);
  });

  await page.goto(`${APP}?fixture=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(2500);

  const trigger = page.locator('button[title^="Archive chats and artifacts in bulk"]');
  await trigger.scrollIntoViewIfNeeded();
  check(await trigger.isVisible(), 'cleanup entry point sits in the sidebar');
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Cleanup tool' });
  await dialog.waitFor({ timeout: 5000 });
  check(true, 'tool opens');

  // ── park both artifacts (bulk archive) ─────────────────────────────────────
  await dialog.getByRole('button', { name: /^artifacts/ }).click();
  await dialog.getByRole('button', { name: 'active', exact: true }).click();
  const live = dialog.locator('input[type="checkbox"]');
  check((await live.count()) === 2, 'both live artifacts listed', `count=${await live.count()}`);
  await live.nth(0).check();
  await live.nth(1).check();
  await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
  await dialog.getByRole('button', { name: 'archived', exact: true }).click();
  check((await dialog.locator('input[type="checkbox"]').count()) === 2, 'bulk archive parked both');

  // ── the referential law ────────────────────────────────────────────────────
  const parked = dialog.locator('input[type="checkbox"]');
  await parked.nth(0).check();
  await parked.nth(1).check();
  await dialog.getByRole('button', { name: /^Delete/ }).click();
  let text = await dialog.innerText();
  check(/kept back/i.test(text), 'confirm step names what is kept back');
  check(text.includes('used by 1 active chat'), 'the blocking chat is named');
  const delBtn = dialog.getByRole('button', { name: 'Delete permanently' });
  check(await delBtn.isDisabled(), 'delete stays shut until the word is typed');

  await dialog.getByRole('button', { name: /^Archive those/ }).click();
  await page.waitForTimeout(500);
  text = await dialog.innerText();
  check(!/kept back/i.test(text), 'archiving the blocker clears the hold');
  check(text.includes('Also delete the 1 archived chat(s)'), 'cascade option appears');
  check(!(await dialog.locator('input[type="checkbox"]').first().isChecked()), 'cascade is opt-in');

  await dialog.locator('input[placeholder="DELETE"]').fill('DELETE');
  check(!(await delBtn.isDisabled()), 'delete unlocks with the typed word');
  await delBtn.click();
  await page.waitForTimeout(800);
  check((await dialog.count()) === 0, 'tool closes after the delete');

  // ── default path: the archived chat survives, minus the attachment ─────────
  await trigger.click();
  const after = page.getByRole('dialog', { name: 'Cleanup tool' });
  check((await after.innerText()).match(/artifacts · 0 archived/i) !== null, 'artifact tab reports 0 archived');
  await after.getByRole('button', { name: /^chats/ }).click();
  await after.getByRole('button', { name: 'archived', exact: true }).click();
  const chatRow = await after.innerText();
  check(chatRow.includes('Fixture Thread'), 'the referenced chat survived the default delete');
  check(/0 attachment/.test(chatRow), 'its attachment was detached', chatRow.split('\n').slice(-3).join(' / '));

  // ── chats tab: permanent delete + fallback ─────────────────────────────────
  await after.locator('input[type="checkbox"]').first().check();
  await after.getByRole('button', { name: /^Delete/ }).click();
  await after.locator('input[placeholder="DELETE"]').fill('DELETE');
  await after.getByRole('button', { name: 'Delete permanently' }).click();
  await page.waitForTimeout(800);
  await trigger.click();
  const final = page.getByRole('dialog', { name: 'Cleanup tool' });
  await final.getByRole('button', { name: 'archived', exact: true }).click();
  check((await final.innerText()).includes('Nothing archived in chats'), 'archived chat list is empty');
  await final.getByRole('button', { name: 'all', exact: true }).click();
  check((await final.innerText()).includes('Main'), 'a fallback chat took its place');

  check(errors.length === 0, 'no console/page errors', errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(failures === 0 ? '\nVERDICT: GREEN' : `\nVERDICT: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASHED:', e.message); process.exit(1); });
