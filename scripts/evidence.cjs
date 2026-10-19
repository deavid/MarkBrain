#!/usr/bin/env node
/**
 * scripts/evidence.cjs — deterministic evidence pack for LLM screening.
 *
 * Machine gathers, LLM judges. Runs a fixed journey suite + a geometry/occlusion
 * audit against the dev server (fixture auth, zero cloud writes), and writes a
 * self-contained pack: summary.json (machine verdicts, failures first),
 * per-journey steps + checkpoint screenshots + console slices, per-surface
 * audit JSON + culprit clip shots, aria snapshots. No image comparison anywhere.
 *
 * Pack contract: design-docs/EVIDENCE_PACK.md
 * Usage:  bun run dev  →  node scripts/evidence.cjs
 * Env:    MARKBRAIN_URL, MARKBRAIN_EVIDENCE_DIR, CHROME_BIN
 * Exit:   0 = green (warns allowed), 1 = at least one fail, 2 = harness error.
 *
 * Auth/env mechanics shared with headless-capture.cjs (layered env, read-only).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PACK = process.env.MARKBRAIN_EVIDENCE_DIR ||
  path.join(ROOT, 'evidence', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));

const VIEWPORTS = [
  { w: 350, h: 700, name: '350x700' },   // docs minimum phone
  { w: 390, h: 844, name: '390x844' },   // iPhone 14
  { w: 768, h: 1024, name: '768x1024' }, // tablet / docked-sidebar boundary
  { w: 1440, h: 900, name: '1440x900' }, // desktop
];
const DESKTOP = new Set(['768x1024', '1440x900']);
// Touch-target thresholds: min dimension <12px = fail, <16px = warn
// (project thresholds, David 2026-10-19; superseded WCAG 2.5.8 16/24).
const MIN_TOUCH = 16;
const HARD_MIN = 12;
const COVERAGE_MIN_HITS = 6; // of 9 sampled points
const OVERLAP_RATIO = 0.25;  // fail if intersection > 25% of smaller target

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const startedAt = new Date().toISOString();

// ── layered env (read-only) ─────────────────────────────────────────────────
const ENV_LAYERS = [
  path.join(ROOT, '.env'),
  path.join(ROOT, '.env.shared'),
  path.join(ROOT, '..', 'MarkBrain', '.env.markbrain-main.shared'),
];
function parseEnvFallback(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v[0] === '"' || v[0] === "'") && v[0] === v[v.length - 1]) v = v.slice(1, -1);
    if (!(m[1] in out)) out[m[1]] = v;
  }
  return out;
}
let dotenv = null;
try { dotenv = require('dotenv'); } catch { /* fallback parser */ }
for (const f of ENV_LAYERS) {
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const parsed = dotenv ? dotenv.parse(text) : parseEnvFallback(text);
  for (const [k, v] of Object.entries(parsed)) if (!(k in process.env)) process.env[k] = v;
}
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function requirePlaywright() {
  for (const c of ['playwright-core', '/tmp/pw/node_modules/playwright-core']) {
    try { return require(c); } catch { /* next */ }
  }
  log('playwright-core missing — npm i --prefix /tmp/pw playwright-core');
  process.exit(2);
}
function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const p = path.join(base, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* fall through */ }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(p)) return p;
  }
  log('no Chromium/Chrome found'); process.exit(2);
}

// ── pack store ──────────────────────────────────────────────────────────────
const summary = {
  generatedAt: startedAt,
  pack: PACK,
  app: null,
  mode: 'fixture',
  journeys: [],           // {id, caption, ok, failures[], warns[], files{steps,shots[]}, durationMs}
  audit: {},              // viewportName -> {surfaces: {name -> {fails, warns, file, shot}}}
  consoleErrors: [],      // real ones (fixture noise filtered)
  expectedNoise: [],
  pageErrors: [],
  httpErrors: [],
  totals: { journeyFails: 0, journeyWarns: 0, auditFails: 0, auditWarns: 0 },
  verdict: 'green',
};
const expectedNoise = /Firestore|Boot connection|Could not reach Cloud Firestore|offline mode|\[vite\] failed to connect|ws:\/\/localhost:\d+|WebSocket closed without opened|WebSocket handshake/i;

function mkDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

// journey-scoped run context
let J = null;
function step(action, detail, ok) {
  if (!J) return;
  J.steps.push({ t: new Date().toISOString(), action, detail, ok });
}
function fail(detail) { if (J) J.failures.push(detail); log('  ❌', detail); }
function warn(detail) { if (J) J.warns.push(detail); log('  ⚠️', detail); }
function check(cond, detail) { if (!cond) fail(detail); return !!cond; }
let shotCounter = 0;
async function shot(page, name) {
  const dir = mkDir(path.join(J.dir, 'shots'));
  const file = path.join(dir, `${String(++shotCounter).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  J.files.shots.push(path.relative(PACK, file));
  step('shot', name);
  log('  📸', path.basename(file));
}
async function journey(page, id, caption, fn) {
  const t0 = Date.now();
  shotCounter = 0;
  J = { id, caption, ok: true, failures: [], warns: [], steps: [],
        files: { steps: null, shots: [] }, dir: mkDir(path.join(PACK, 'journeys', id)) };
  summary.journeys.push(J);
  log('──', id, '—', caption);
  const errMark = summary.pageErrors.length;
  const conMark = summary.consoleErrors.length;
  const httpMark = summary.httpErrors.length;
  try {
    await fn(page);
  } catch (e) {
    fail(`threw: ${String(e).slice(0, 300)}`);
    // Failure context: enough to disprove hypotheses without re-running.
    try {
      await page.screenshot({ path: path.join(J.dir, 'fail-context.png') });
      J.files.failShot = 'fail-context.png';
      const ctxInfo = await page.evaluate(() => ({
        viewport: { w: innerWidth, h: innerHeight },
        centerStack: document.elementsFromPoint(innerWidth / 2, innerHeight / 2)
          .slice(0, 5).map((el) => (el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 140)),
        switcherOpen: !!document.querySelector('input[placeholder*="Search threads"]'),
        textareaDisabled: [...document.querySelectorAll('textarea')].every((t) => t.disabled),
        sendButtons: document.querySelectorAll('[title="Send message"]').length,
        startDialogue: [...document.querySelectorAll('button')].some((b) => /Start Dialogue/.test(b.textContent || '')),
        stopButtons: document.querySelectorAll('[title="Stop generating"]').length,
        bodyHead: document.body.innerText.slice(0, 600),
      }));
      fs.writeFileSync(path.join(J.dir, 'fail-context.json'), JSON.stringify(ctxInfo, null, 2));
      J.files.failContext = 'fail-context.json';
    } catch { /* context is best-effort */ }
  } finally {
    J.ok = J.failures.length === 0;
    J.durationMs = Date.now() - t0;
    J.consoleSlices = summary.consoleErrors.slice(conMark);
    J.pageSlices = summary.pageErrors.slice(errMark);
    J.httpSlices = summary.httpErrors.slice(httpMark);
    J.files.steps = path.relative(PACK, path.join(J.dir, 'steps.json'));
    fs.writeFileSync(path.join(J.dir, 'steps.json'), JSON.stringify({
      id, caption, ok: J.ok, failures: J.failures, warns: J.warns, durationMs: J.durationMs, steps: J.steps,
    }, null, 2));
    log(J.ok ? '  ✅' : '  ❌', id, J.failures.length ? `(${J.failures.length} fail)` : '');
    const failed = !J.ok;
    J = null;
    // Recovery: one failed journey must not cascade into the next.
    if (failed) {
      try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        const stop = page.locator('[title="Stop generating"]').first();
        if (await stop.isVisible({ timeout: 500 }).catch(() => false)) await stop.click({ timeout: 3000 });
        const dialogue = page.getByText('Dialogue', { exact: false }).first();
        if (!(await page.locator('textarea').first().isVisible().catch(() => false))) {
          await dialogue.click({ timeout: 3000 }).catch(() => {});
        }
        await page.waitForTimeout(700);
        log('  ↺ recovered for next journey');
      } catch { log('  ↺ recovery incomplete'); }
    }
  }
}

// convenience waits
const waitIdle = async (page, ms = 90_000) => {
  const stop = page.locator('[title="Stop generating"]').first();
  await stop.waitFor({ state: 'hidden', timeout: ms });
  await page.waitForTimeout(700);
};

// ── geometry audit (runs in the page) ───────────────────────────────────────
const AUDIT_FN = `(() => {
  const HARD_MIN = ${HARD_MIN}, MIN_TOUCH = ${MIN_TOUCH};
  const COVERAGE_MIN = ${COVERAGE_MIN_HITS}, OVERLAP_RATIO = ${OVERLAP_RATIO};
  const vw = innerWidth, vh = innerHeight;
  const toRect = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let seg = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(seg + '#' + node.id); break; }
      const title = node.getAttribute('title');
      const aria = node.getAttribute('aria-label');
      if (title) seg += '[title=' + JSON.stringify(title.slice(0, 40)) + ']';
      else if (aria) seg += '[aria-label=' + JSON.stringify(aria.slice(0, 40)) + ']';
      else {
        const cls = (node.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean)
          .filter((c) => !/^[a-z]{2}-\\[|hover:|focus:|sm:|md:|lg:|group/.test(c)).slice(0, 2);
        if (cls.length) seg += '.' + cls.join('.');
      }
      const parent = node.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      parts.unshift(seg);
      node = parent;
    }
    return parts.join(' > ');
  };
  const snippet = (el) => (el.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 200);
  const interactive = [...document.querySelectorAll(
    'button, a[href], input, textarea, select, [role=button], [onclick], [tabindex]:not([tabindex="-1"])'
  )];
  const visible = interactive.filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    if (cs.pointerEvents === 'none') return false;
    if (r.bottom < 1 || r.right < 1 || r.top > vh - 1 || r.left > vw - 1) return false;
    return true;
  });
  const hitAt = (x, y) => {
    if (x < 0 || y < 0 || x > vw || y > vh) return null;
    const el = document.elementFromPoint(x, y);
    return el;
  };
  const hitsSelf = (el, h) => h === el || (h ? el.contains(h) || h.contains(el) : false);
  const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);
  const intersects = (a, b) => {
    const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return x * y;
  };
  const isFullBleed = (r) => area(r) >= vw * vh * 0.85;
  // Intentional layering: an element (or an ancestor) that is full-bleed or
  // fixed chrome (drawer/modal/switcher — z>=40 or unindexed fixed) makes
  // everything it covers BACKGROUND, not an occlusion bug.
  const isBackgroundLayer = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (isFullBleed(toRect(n.getBoundingClientRect()))) return true;
      if (cs.position === 'fixed') {
        const z = parseInt(cs.zIndex, 10);
        if (Number.isNaN(z) || z >= 40) return true;
      }
      n = n.parentElement;
    }
    return false;
  };

  const fails = [], warns = [];
  const foreground = []; // {el, rect}
  let skippedBackground = 0;

  for (const el of visible) {
    const rect = toRect(el.getBoundingClientRect());
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    const hit = hitAt(cx, cy);
    if (!hit) continue;
    if (!hitsSelf(el, hit)) {
      if (isBackgroundLayer(hit)) { skippedBackground++; continue; } // intentional drawer/modal/dock
      const hr = hit.getBoundingClientRect();
      fails.push({
        type: 'occluded',
        detail: 'center point covered by another control',
        path: cssPath(el), html: snippet(el), rect,
        culprit: { path: cssPath(hit), html: snippet(hit), rect: toRect(hr) },
      });
      continue;
    }
    // 3x3 coverage sample
    let hits = 0, sampled = 0;
    for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) {
      const x = rect.x + rect.w * fx, y = rect.y + rect.h * fy;
      if (x < 0 || y < 0 || x > vw || y > vh) continue;
      sampled++;
      if (hitsSelf(el, hitAt(x, y))) hits++;
    }
    if (sampled > 0 && hits < Math.min(COVERAGE_MIN, sampled)) {
      fails.push({
        type: 'partial-coverage',
        detail: hits + '/' + sampled + ' sampled points clickable (need ' + Math.min(COVERAGE_MIN, sampled) + ')',
        path: cssPath(el), html: snippet(el), rect,
      });
      // still continue: size + overlap checks remain useful
    }
    // target size
    const minDim = Math.min(rect.w, rect.h);
    if (minDim < HARD_MIN) {
      fails.push({ type: 'touch-too-small', detail: 'min dimension ' + Math.round(minDim) + 'px < ' + HARD_MIN + 'px',
        path: cssPath(el), html: snippet(el), rect });
    } else if (minDim < MIN_TOUCH) {
      warns.push({ type: 'touch-small', detail: 'min dimension ' + Math.round(minDim) + 'px < ' + MIN_TOUCH + 'px',
        path: cssPath(el), html: snippet(el), rect });
    }
    foreground.push({ el, rect });
  }

  // pairwise overlap among foreground (topmost) interactive elements
  for (let i = 0; i < foreground.length; i++) {
    for (let j = i + 1; j < foreground.length; j++) {
      const A = foreground[i], B = foreground[j];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const inter = intersects(A.rect, B.rect);
      if (inter <= 0) continue;
      const smaller = Math.min(area(A.rect), area(B.rect));
      if (smaller > 0 && inter / smaller > OVERLAP_RATIO) {
        fails.push({
          type: 'control-overlap',
          detail: Math.round((inter / smaller) * 100) + '% of smaller target overlapped',
          path: cssPath(A.el), html: snippet(A.el), rect: A.rect,
          culprit: { path: cssPath(B.el), html: snippet(B.el), rect: B.rect },
        });
      }
    }
  }
  return { viewport: { w: vw, h: vh }, visibleInteractive: visible.length,
    foreground: foreground.length, skippedBackground, fails, warns };
})()`;

async function auditSurface(page, viewportName, surface) {
  const data = await page.evaluate(AUDIT_FN).catch((e) => ({ error: String(e) }));
  const dir = mkDir(path.join(PACK, 'audit'));
  const rec = summary.audit[viewportName] || { surfaces: {} };
  summary.audit[viewportName] = rec;
  if (data.error) {
    rec.surfaces[surface] = { error: data.error };
    log('  ❌ audit error:', data.error);
    return;
  }
  // clip shots for fails — annotated (red = culprit target, blue = occluder)
  const shots = [];
  let n = 0;
  for (const f of data.fails) {
    if (n >= 8) break; // cap artifacts per surface
    await page.evaluate(({ rects }) => {
      const mk = (r, color) => {
        const d = document.createElement('div');
        d.setAttribute('data-evidence-mark', '1');
        d.style.cssText = `position:fixed;left:${r.x - 3}px;top:${r.y - 3}px;width:${r.w + 6}px;height:${r.h + 6}px;` +
          `border:2px solid ${color};border-radius:3px;z-index:999999;pointer-events:none;`;
        document.body.appendChild(d);
      };
      mk(rects.a, '#ff3b30');
      if (rects.b) mk(rects.b, '#38bdf8');
    }, { rects: { a: f.rect, b: f.culprit ? f.culprit.rect : null } }).catch(() => {});
    const r = f.culprit ? unionRect(f.rect, f.culprit.rect) : f.rect;
    const clip = {
      x: Math.max(0, r.x - 60), y: Math.max(0, r.y - 60),
      width: Math.min(1440, r.w + 120), height: Math.min(900, r.h + 120),
    };
    const vp = await page.viewportSize();
    clip.width = Math.max(80, Math.min(clip.width, vp.width - clip.x));
    clip.height = Math.max(80, Math.min(clip.height, vp.height - clip.y));
    const file = path.join(dir, `${viewportName}-${surface}-fail${++n}-${f.type}.png`);
    await page.screenshot({ path: file, clip }).catch(() => {});
    await page.evaluate(() => {
      document.querySelectorAll('[data-evidence-mark]').forEach((d) => d.remove());
    }).catch(() => {});
    shots.push(path.relative(PACK, file));
  }
  const file = path.join(dir, `${viewportName}-${surface}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  rec.surfaces[surface] = {
    visibleInteractive: data.visibleInteractive,
    skippedBackground: data.skippedBackground,
    fails: data.fails.length, warns: data.warns.length,
    file: path.relative(PACK, file), shots,
  };
  summary.totals.auditFails += data.fails.length;
  summary.totals.auditWarns += data.warns.length;
  log('  ', data.fails.length ? '❌' : '✅', `${viewportName}/${surface}:`,
    `${data.fails.length} fails, ${data.warns.length} warns,`,
    `${data.visibleInteractive} targets (${data.skippedBackground} behind backdrop)`);
  if (data.fails.length) data.fails.slice(0, 4).forEach((f) => log('     -', f.type, f.path, '|', f.detail));
}
function unionRect(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

async function ariaSnap(page, name) {
  const dir = mkDir(path.join(PACK, 'aria'));
  try {
    const snap = await page.locator('body').ariaSnapshot({ timeout: 3000 });
    fs.writeFileSync(path.join(dir, `${name}.aria.txt`), snap);
    return `aria/${name}.aria.txt`;
  } catch {
    try {
      const text = await page.evaluate(() => document.body.innerText);
      fs.writeFileSync(path.join(dir, `${name}.innerText.txt`), text);
      return `aria/${name}.innerText.txt`;
    } catch { return null; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  const { chromium } = requirePlaywright();
  const chrome = findChrome();
  mkDir(PACK);

  const API_KEY = process.env.FIREBASE_API_KEY;
  const PROJECT = process.env.FIREBASE_PROJECT_ID;
  const PORT = process.env.PORT || '3030';
  const APP = process.env.MARKBRAIN_URL || `http://localhost:${PORT}`;
  summary.app = APP;
  if (!API_KEY) { log('FIREBASE_API_KEY not found in layered env'); process.exit(2); }
  try {
    const r = await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(String(r.status));
  } catch { log(`App not reachable at ${APP} — start it first:  bun run dev`); process.exit(2); }

  // ── auth mock (fixture) ───────────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  const UID = 'headless-capture-001';
  const ID_TOKEN = [
    b64url({ alg: 'RS256', typ: 'JWT' }),
    b64url({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: UID,
      auth_time: nowSec, iat: nowSec, exp: nowSec + 3600, email: 'headless.capture@example.com',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com', identities: { 'google.com': ['headless.capture@example.com'] } } }),
    'sig',
  ].join('.');
  const fakeUser = {
    uid: UID, displayName: 'Headless Capture', email: 'headless.capture@example.com',
    emailVerified: true, photoURL: null, phoneNumber: null, isAnonymous: false,
    providerData: [{ providerId: 'google.com', uid: UID, displayName: 'Headless Capture', email: 'headless.capture@example.com', photoURL: null }],
    apiKey: API_KEY, createdAt: String(nowSec - 86400), lastLoginAt: String(nowSec),
    stsTokenManager: { refreshToken: `headless-refresh-${nowSec}`, accessToken: ID_TOKEN, expirationTime: (nowSec + 3600) * 1000 },
  };

  const browser = await chromium.launch({
    executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(({ key, raw }) => {
    try { window.localStorage.setItem(`firebase:authUser:${key}:[DEFAULT]`, raw); } catch {}
  }, { key: API_KEY, raw: JSON.stringify(fakeUser) });
  await ctx.route(/firestore\.googleapis\.com/, () => {}); // hold — fixture seam
  await ctx.route(/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ users: [{ localId: UID, email: 'headless.capture@example.com',
      displayName: 'Headless Capture', emailVerified: true,
      providerData: [{ providerId: 'google.com', rawId: UID, email: 'headless.capture@example.com' }],
      createdAt: String((nowSec - 86400) * 1000), lastLoginAt: String(nowSec * 1000),
      idToken: ID_TOKEN, refreshToken: `headless-refresh-${nowSec}`, expiresIn: '3600' }] }),
  }));
  await ctx.route(/securetoken\.googleapis\.com/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ access_token: ID_TOKEN, id_token: ID_TOKEN, expires_in: '3600',
      refresh_token: `headless-refresh-${nowSec}`, token_type: 'Bearer', user_id: UID, project_id: PROJECT }),
  }));

  const page = await ctx.newPage();
  // J13 deliberately forces a 500 — errors during that phase are EXPECTED evidence.
  let forceFailurePhase = false;
  page.on('pageerror', (e) => {
    const s = String(e).slice(0, 300);
    (forceFailurePhase || expectedNoise.test(s) ? summary.expectedNoise : summary.pageErrors).push(s);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text().slice(0, 300);
    (forceFailurePhase || expectedNoise.test(t) ? summary.expectedNoise : summary.consoleErrors).push(t);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) {
      const s = `${r.status()} ${r.url().slice(0, 140)}`;
      (forceFailurePhase ? summary.expectedNoise : summary.httpErrors).push(s);
    }
  });

  const startUrl = `${APP}${APP.includes('?') ? '&' : '?'}fixture=1`;
  const boot = async () => {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(2500);
  };
  await boot();
  const composer = page.locator('textarea').first();
  // Robust send: bottom composer button, or hero "Start Dialogue" (an EMPTY
  // thread has no [title="Send message"] button), last resort Enter.
  const send = async () => {
    const primary = page.locator('[title="Send message"]').first();
    const hero = page.getByRole('button', { name: /Start Dialogue/ }).first();
    if (await primary.isVisible().catch(() => false)) {
      step('click', 'Send message'); await primary.click({ timeout: 8000 }); return;
    }
    if (await hero.isVisible().catch(() => false)) {
      step('click', 'Start Dialogue (hero composer)'); await hero.click({ timeout: 8000 }); return;
    }
    step('click', 'Enter fallback (no send button visible)');
    await composer.press('Enter');
  };
  const stopBtn = page.locator('[title="Stop generating"]').first();
  const bodyText = () => page.evaluate(() => document.body.innerText);

  // ── J1 boot ───────────────────────────────────────────────────────────────
  await journey(page, '01-boot', 'Boot fixture → studio renders with content', async (page) => {
    const txt = await bodyText();
    check(/Dialogue/.test(txt), 'Dialogue tab visible');
    check(/Chapter|Genesis/i.test(txt), 'fixture chapter content rendered');
    check(/fixture/i.test(txt), 'fixture project loaded');
    await shot(page, 'boot-studio');
    J.files.aria = await ariaSnap(page, '01-boot-desktop');
  });

  // ── J2 send + stream ──────────────────────────────────────────────────────
  await journey(page, '02-chat-send-stream', 'Send message → stream → telemetry meta line', async (page) => {
    await composer.fill('Reply with exactly: EVIDENCE-OK');
    step('fill', 'EVIDENCE-OK');
    await send();
    step('click', 'Send message');
    await stopBtn.waitFor({ state: 'visible', timeout: 15_000 });
    step('wait', 'Stop visible (streaming)');
    await shot(page, 'streaming');
    await waitIdle(page);
    const txt = await bodyText();
    check(/EVIDENCE-OK/.test(txt), 'reply content landed');
    check(/total tok|first chunk|·/.test(txt), 'telemetry meta line present');
    check(!/EVIDENCE-OK[\s\S]{0,200}EVIDENCE-OK$/.test(txt.slice(-400)), 'no duplicate reply');
    await shot(page, 'reply');
  });

  // ── J3 stop ───────────────────────────────────────────────────────────────
  await journey(page, '03-chat-stop', 'Stop mid-stream → interrupted badge', async (page) => {
    // flash-lite may finish before we click — retry the whole send, and click
    // Stop the instant it appears (no intervening screenshot).
    let stopped = false;
    for (let attempt = 1; attempt <= 3 && !stopped; attempt++) {
      await composer.fill(`Write a detailed 600-word essay about lighthouse engineering history. Attempt ${attempt}.`);
      await send();
      const stop = page.locator('[title="Stop generating"]').first();
      try {
        await stop.waitFor({ state: 'visible', timeout: 15_000 });
        await stop.click({ timeout: 4000 });
        stopped = true;
        step('click', `Stop generating (attempt ${attempt})`);
      } catch {
        step('miss', `stream finished before Stop could be clicked (attempt ${attempt})`);
        await waitIdle(page, 30_000).catch(() => {});
      }
    }
    if (!stopped) {
      warn('stream ended before Stop on all 3 attempts — interrupt badge untested this run');
    } else {
      await waitIdle(page, 30_000);
      const txt = await bodyText();
      check(/Interrupted|interrupted/i.test(txt), 'interrupted badge shown');
      await shot(page, 'after-stop');
    }
  });

  // ── J4 split at message ───────────────────────────────────────────────────
  await journey(page, '04-chapter-split', 'Declare split at FIRST message → chapter lands there', async (page) => {
    const splits = page.locator('[title="Split into new chapter starting at this message"]');
    const n = await splits.count();
    check(n > 0, `split affordances found (${n})`);
    // JS-activate: the audit owns occlusion detection; journeys own app logic.
    await splits.first().evaluate((el) => el.click());
    step('evaluate-click', 'split affordance on first message (bypasses overlays)');
    const form = page.getByPlaceholder(/New Chapter Title/);
    try {
      await form.waitFor({ state: 'visible', timeout: 8000 });
    } catch {
      fail('declare form did not open after activating split affordance (possible occluded handler target)');
      throw new Error('declare form missing');
    }
    await form.fill('Evidence Chapter');
    await page.getByRole('button', { name: 'Split Chapter' }).click();
    step('click', 'Split Chapter');
    await page.waitForTimeout(1200);
    const txt = await bodyText();
    check(/Evidence Chapter/.test(txt), 'new chapter title rendered');
    // placement heuristic: headers in DOM order + msg counts
    const headers = await page.evaluate(() =>
      [...document.querySelectorAll('[title="Active Chapter"], [title="Completed Chapter"]')]
        .map((el) => (el.closest('div')?.parentElement?.textContent || '').replace(/\s+/g, ' ').slice(0, 90)));
    step('observe', JSON.stringify(headers));
    const newAt = headers.findIndex((h) => /Evidence Chapter/.test(h));
    // Correctness signal (not position): "split STARTING AT this message" means
    // the clicked message joins the NEW chapter → it must carry ≥1 msg. The old
    // bug produced a 0-msg chapter at the end regardless of what was clicked.
    const newHeader = headers[newAt] || '';
    const m = newHeader.match(/(\d+) msgs?/);
    const newCount = m ? parseInt(m[1], 10) : -1;
    if (newCount === 0) {
      warn('split-lands-empty: new chapter has 0 msgs — split did not include the clicked message');
    } else {
      step('ok', `new chapter carries ${newCount} msg(s) — split honored the clicked message`);
    }
    await shot(page, 'after-split');
  });

  // ── J5 summarize ──────────────────────────────────────────────────────────
  await journey(page, '05-chapter-summarize', 'Abstract panel → Summarize → summary + key points', async (page) => {
    const panelReady = async () => {
      const txt = await bodyText();
      if (await page.getByRole('button', { name: 'Summarize with Gemini' }).first().isVisible().catch(() => false)) return 'button';
      if (/Executive Abstract/i.test(txt)) return 'summary';
      return null;
    };
    let state = await panelReady();
    for (let i = 0; i < 6 && !state; i++) {
      const abstracts = page.getByRole('button', { name: /Abstract/ });
      const n = await abstracts.count();
      if (!n) break;
      await abstracts.nth(i % n).click().catch(() => {});
      step('click', `Abstract toggle #${i % n}`);
      await page.waitForTimeout(400);
      state = await panelReady();
    }
    if (state === 'button') {
      await page.getByRole('button', { name: 'Summarize with Gemini' }).first().click();
      step('click', 'Summarize with Gemini');
      await page.getByText('Executive Abstract').first().waitFor({ state: 'visible', timeout: 30_000 });
      step('wait', 'Executive Abstract panel');
      check(true, 'summarize produced summary panel');
    } else if (state === 'summary') {
      step('observe', 'summary already present (fixture or earlier journey) — panel renders it');
      check(true, 'summary panel present');
    } else {
      fail(`abstract panel never reached (no Summarize button, no Executive Abstract; body: ${(await bodyText()).slice(0, 200)})`);
    }
    await shot(page, 'summarized');
  });

  // ── J6 threads ────────────────────────────────────────────────────────────
  await journey(page, '06-threads', 'Cmd+K switcher, new thread, send, switch back preserves content', async (page) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(700);
    const switcherVisible = await page.getByPlaceholder(/Search threads/).isVisible().catch(() => false);
    check(switcherVisible, 'Cmd+K opens switcher');
    await shot(page, 'switcher');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+n');
    await page.waitForTimeout(1200);
    step('key', 'Cmd+N new thread');
    // New thread = hero composer ("Start Dialogue") — send() handles both composers.
    await composer.fill('Hello from the evidence thread');
    step('fill', 'Hello from the evidence thread');
    await send();
    await waitIdle(page);
    check(/evidence thread/.test(await bodyText()), 'thread-two reply landed');
    await shot(page, 'thread-two');
    // switch back via sidebar row
    await page.locator('aside').getByText('Main', { exact: true }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1000);
    step('click', 'sidebar thread: Main');
    const txt = await bodyText();
    check(/EVIDENCE-OK/.test(txt), 'original thread content restored after switch-back');
    await shot(page, 'back-to-main');
  });

  // ── J7 mirror ─────────────────────────────────────────────────────────────
  await journey(page, '07-mirror', 'Tap orb → mirror shows payload/notes/chapters/raw', async (page) => {
    const orb = page.locator('[title*="tap to see what the LLM will see"]');
    await orb.click({ timeout: 5000 });
    step('click', 'saturation orb');
    await page.getByText('What the LLM will see').first().waitFor({ state: 'visible', timeout: 5000 });
    const txt = await bodyText();
    check(/Payload/i.test(txt), 'payload section');
    check(/Chapters, in send order|CHAPTERS/i.test(txt), 'chapters section');
    check(/Raw payload|RAW PAYLOAD/i.test(txt), 'raw payload section');
    await shot(page, 'mirror');
    await ariaSnap(page, '07-mirror');
    await page.keyboard.press('Escape');
  });

  // ── J8 graph ──────────────────────────────────────────────────────────────
  await journey(page, '08-spatial-graph', 'Graph view renders artifacts + edges', async (page) => {
    await page.getByText('Spatial Graph', { exact: false }).first().click();
    await page.waitForTimeout(2500);
    const txt = await bodyText();
    check(/Fixture Artifact Alpha/.test(txt), 'artifact node Alpha');
    check(/Fixture Artifact Beta/.test(txt), 'artifact node Beta');
    await shot(page, 'graph');
    await ariaSnap(page, '08-graph');
    await page.getByText('Dialogue', { exact: false }).first().click();
    await page.waitForTimeout(800);
  });

  // ── J9 export modal ───────────────────────────────────────────────────────
  await journey(page, '09-export', 'Sidebar I/O → export modal with format options', async (page) => {
    await page.getByText('Import / Export I/O').first().click({ timeout: 5000 });
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /^Export$/ }).first().click();
    step('click', 'Export');
    await page.waitForTimeout(800);
    const txt = await bodyText();
    check(/JSON/.test(txt) && /Markdown/.test(txt) && /YAML/.test(txt), 'three format options');
    check(/Download/i.test(txt), 'download affordance');
    await shot(page, 'export-modal');
    await ariaSnap(page, '09-export');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  });

  // ── J10 import modal ──────────────────────────────────────────────────────
  await journey(page, '10-import', 'Sidebar I/O → import modal (Drive + local tabs)', async (page) => {
    await page.getByRole('button', { name: /^Import$/ }).first().click();
    step('click', 'Import');
    await page.waitForTimeout(800);
    const txt = await bodyText();
    check(/Google Drive|Local Files/i.test(txt), 'import lanes visible');
    await shot(page, 'import-modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  });

  // ── J11 model picker ──────────────────────────────────────────────────────
  await journey(page, '11-model-picker', 'Model selector shows server catalog entry', async (page) => {
    const acc = page.getByText(/Inference Model/i).first();
    await acc.click({ timeout: 5000 });
    await page.waitForTimeout(600);
    const txt = await bodyText();
    check(/flash-lite|Flash Lite/i.test(txt), 'flash-lite listed');
    const hasMeta = /Window|Latency/.test(txt);
    if (!hasMeta) warn('model metadata (Window/Latency) not visible after opening picker');
    await shot(page, 'model-picker');
  });

  // ── J12 mobile ────────────────────────────────────────────────────────────
  await journey(page, '12-mobile-390', '390px: no h-scroll, composer reachable, drawer opens', async (page) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(2000);
    const geo = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth, vw: innerWidth,
      send: (() => { const b = document.querySelector('[title="Send message"]'); if (!b) return null;
        const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vh: innerHeight, vw: innerWidth }; })(),
    }));
    check(geo.scrollW <= geo.vw + 1, `no horizontal scroll (scrollW ${geo.scrollW} <= vw ${geo.vw})`);
    if (geo.send) {
      check(geo.send.x >= 0 && geo.send.y >= 0 && geo.send.x + geo.send.w <= geo.send.vw + 1 &&
        geo.send.y + geo.send.h <= geo.send.vh + 1, 'send button fully within viewport');
    } else fail('send button missing at 390px');
    await shot(page, 'mobile-chat');
    const drawer = page.locator('button[aria-label="Open sidebar drawer"]');
    if (await drawer.isVisible().catch(() => false)) {
      await drawer.click();
      await page.waitForTimeout(700);
      check(await page.locator('aside').isVisible().catch(() => false), 'drawer opens');
      await shot(page, 'mobile-drawer');
      await page.locator('div[class*="bg-black/60"]').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    } else warn('drawer trigger not visible at 390px');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(2000);
  });

  // ── J13 error + retry ─────────────────────────────────────────────────────
  await journey(page, '13-error-retry', 'Stream 500 → error banner + Retry recovers', async (page) => {
    forceFailurePhase = true;
    try {
    await page.route('**/api/chat/stream', (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: '{"error":"evidence forced failure"}' }));
    step('route', 'force 500 on /api/chat/stream');
    await composer.fill('This send should fail');
    await send();
    await page.getByText(/Generation failed|Error communicating/).first().waitFor({ state: 'visible', timeout: 30_000 });
    step('wait', 'error banner');
    await shot(page, 'error-banner');
    await page.unroute('**/api/chat/stream');
    const retry = page.getByRole('button', { name: /Retry/i }).first();
    check(await retry.isVisible().catch(() => false), 'Retry affordance present');
    await retry.click();
    step('click', 'Retry');
    await waitIdle(page);
    await page.waitForTimeout(1500);
    const txt = await bodyText();
    check(!/Generation failed/.test(txt), 'error banner cleared after retry');
    await shot(page, 'after-retry');
    } finally {
      forceFailurePhase = false;
      await page.unroute('**/api/chat/stream').catch(() => {});
    }
  });

  // ── geometry audit: viewport × surface matrix ─────────────────────────────
  log('── audit: viewport × surface geometry');
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await boot();
    const base = page.locator('textarea').first();
    await base.waitFor({ state: 'visible', timeout: 30_000 });
    await auditSurface(page, vp.name, 'chat');

    if (DESKTOP.has(vp.name)) {
      // graph
      await page.getByText('Spatial Graph', { exact: false }).first().click().catch(() => {});
      await page.waitForTimeout(2500);
      await auditSurface(page, vp.name, 'graph');
      await page.getByText('Dialogue', { exact: false }).first().click().catch(() => {});
      await page.waitForTimeout(700);
      // export modal
      try {
        await page.getByText('Import / Export I/O').first().click({ timeout: 4000 });
        await page.getByRole('button', { name: /^Export$/ }).first().click({ timeout: 4000 });
        await page.waitForTimeout(700);
        await auditSurface(page, vp.name, 'export-modal');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      } catch (e) { log('  (export surface skipped:', String(e).slice(0, 80), ')'); }
      // mirror
      try {
        await page.locator('[title*="tap to see what the LLM will see"]').first().click({ timeout: 4000 });
        await page.waitForTimeout(700);
        await auditSurface(page, vp.name, 'mirror');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      } catch (e) { log('  (mirror surface skipped:', String(e).slice(0, 80), ')'); }
    } else {
      // mobile: drawer open
      try {
        const drawer = page.locator('button[aria-label="Open sidebar drawer"]');
        if (await drawer.isVisible({ timeout: 3000 })) {
          await drawer.click();
          await page.waitForTimeout(700);
          await auditSurface(page, vp.name, 'drawer');
          await page.locator('div[class*="bg-black/60"]').first().click({ force: true }).catch(() => {});
          await page.waitForTimeout(400);
        }
      } catch (e) { log('  (drawer surface skipped:', String(e).slice(0, 80), ')'); }
    }
  }

  // ── verdict ───────────────────────────────────────────────────────────────
  summary.totals.journeyFails = summary.journeys.reduce((s, j) => s + j.failures.length, 0);
  summary.totals.journeyWarns = summary.journeys.reduce((s, j) => s + j.warns.length, 0);
  summary.consoleErrors = [...new Set(summary.consoleErrors)];
  summary.pageErrors = [...new Set(summary.pageErrors)];
  summary.httpErrors = [...new Set(summary.httpErrors)];
  summary.verdict = (summary.totals.journeyFails || summary.totals.auditFails ||
    summary.pageErrors.length || summary.consoleErrors.length) ? 'red'
    : (summary.totals.journeyWarns || summary.totals.auditWarns) ? 'amber' : 'green';

  fs.writeFileSync(path.join(PACK, 'summary.json'), JSON.stringify(summary, null, 2));
  log('\n══ EVIDENCE PACK ══');
  log('dir:     ', PACK);
  log('verdict: ', summary.verdict.toUpperCase());
  log('journeys:', summary.journeys.filter((j) => j.ok).length, '/', summary.journeys.length, 'ok ·',
    summary.totals.journeyFails, 'failures ·', summary.totals.journeyWarns, 'warnings');
  log('audit:   ', summary.totals.auditFails, 'fails ·', summary.totals.auditWarns, 'warns');
  log('errors:  ', summary.consoleErrors.length, 'console ·', summary.pageErrors.length, 'page ·', summary.httpErrors.length, 'http');
  for (const j of summary.journeys.filter((x) => !x.ok)) log('  ❌', j.id, '—', j.failures[0] || '');
  log('summary: ', path.join(PACK, 'summary.json'));

  await browser.close();
  process.exit(summary.verdict === 'red' ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });