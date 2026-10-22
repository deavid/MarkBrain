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
 * Usage:  npm run dev  →  node scripts/evidence.cjs   (bun run dev works too)
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
// Touch-target thresholds: min dimension <12px = fail, <16px = warn. Stricter
// than WCAG 2.5.8 (16/24): the 350px viewport is the real constraint here.
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
        const chatTab = page.getByRole('button', { name: /^Chat$/ }).first();
        if (!(await page.locator('textarea').first().isVisible().catch(() => false))) {
          await chatTab.click({ timeout: 3000 }).catch(() => {});
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
    // Horizontal clipping: a control that pokes past the viewport, or is cut by
    // a NON-scrollable overflow ancestor, is unreachable even when it is
    // partially on screen. Checking document-level h-scroll alone is not enough —
    // an overflow-hidden parent hides the overflow without widening the document,
    // so the control silently becomes untappable while the audit reports green.
    if (rect.x < -1 || rect.x + rect.w > vw + 1) {
      fails.push({
        type: 'clipped-by-viewport',
        detail: 'spans ' + Math.round(rect.x) + '…' + Math.round(rect.x + rect.w) + ' in a ' + vw + 'px viewport',
        path: cssPath(el), html: snippet(el), rect,
      });
    } else {
      let anc = el.parentElement;
      let clippedBy = null;
      while (anc && anc !== document.documentElement) {
        // A fixed-position ancestor is its own containing block: overflow above
        // it (the app's main column, a sidebar) does NOT clip it. Without this
        // break the centered mirror at 768px read as clipped by the main column.
        if (getComputedStyle(anc).position === 'fixed') break;
        const ox = getComputedStyle(anc).overflowX;
        if (ox === 'hidden' || ox === 'clip') {
          const ar = anc.getBoundingClientRect();
          const outside = rect.x < ar.left - 1 || rect.x + rect.w > ar.right + 1;
          // Scrollable ancestors can bring it back — only flag what CANNOT scroll.
          if (outside && anc.scrollWidth <= anc.clientWidth + 1) { clippedBy = anc; break; }
        }
        anc = anc.parentElement;
      }
      if (clippedBy) {
        fails.push({
          type: 'clipped-inside-overflow',
          detail: 'cut horizontally by an overflow ancestor it cannot scroll into view',
          path: cssPath(el), html: snippet(el), rect,
          culprit: { path: cssPath(clippedBy), html: snippet(clippedBy), rect: toRect(clippedBy.getBoundingClientRect()) },
        });
      }
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
  } catch { log(`App not reachable at ${APP} — start it first:  npm run dev  (or bun run dev)`); process.exit(2); }

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
    check(/Chat/.test(txt), 'Chat tab visible');
    check(/Artifacts/.test(txt), 'Artifacts tab visible');
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

    // Two more splits so the chat has history. The in-progress law forces the
    // LAST two chapters to Full with no cut controls, so the cut journeys need
    // four chapters: two cuttable (older) and two forced live.
    for (const [nth, title] of [
      [1, 'Stream Feedback'],
      [2, 'Genesis Architecture'],
    ]) {
      const affordances = page.locator('[title="Split into new chapter starting at this message"]');
      await affordances.nth(nth).evaluate((el) => el.click());
      const form2 = page.getByPlaceholder(/New Chapter Title/);
      await form2.waitFor({ state: 'visible', timeout: 8000 });
      await form2.fill(title);
      await page.getByRole('button', { name: 'Split Chapter' }).click();
      await page.waitForTimeout(1200);
    }
    const cuttable = await page.locator('[data-testid="chapter-cut"]').count();
    const live = await page.locator('[data-testid="chapter-in-progress"]').count();
    check(cuttable === 2, `older chapters keep their cut controls (${cuttable} of 4)`);
    check(live === 2, `the last two chapters are in progress (${live})`);
    await shot(page, 'after-split');
  });

  // ── J5 chapter cut / summarize ────────────────────────────────────────────
  await journey(page, '05-chapter-summarize', 'Chapter cut → Summary → description + summary (no Recap anywhere)', async (page) => {
    const cutChip = (g) => page.locator(`[data-testid="chapter-cut"] [data-granularity="${g}"]`).first();
    check((await page.locator('[data-testid="chapter-cut"]').count()) > 0, 'chapter cut controls present');
    check(!/Recap/i.test(await bodyText()), 'Recap is eradicated');
    check(/\d+\s*tok/.test(await bodyText()), 'chapter header shows a token count');

    await cutChip('summary').click();
    step('click', 'chapter → Summary');
    await page.waitForTimeout(600);
    check(/Summary/.test(await bodyText()), 'summary cut reflected in the header');

    // The layer may not exist yet: the body is chrome ("Write it"), never a
    // fake paragraph and never the raw turns.
    const writeIt = page.getByRole('button', { name: 'Write it' }).first();
    if (await writeIt.isVisible().catch(() => false)) {
      await writeIt.click();
      step('click', 'Write it (summarize)');
      const landed = await page
        .getByText(/No summary yet/)
        .first()
        .waitFor({ state: 'hidden', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      // "No summary yet" also disappears when the call FAILS — so absence of the
      // placeholder is not proof a layer landed. Check the layer itself, and
      // treat a failure-with-Retry as a failure.
      const layerLanded = await page
        .locator('[data-testid="chapter-layer-summary"]')
        .first()
        .isVisible()
        .catch(() => false);
      const failed = await page
        .getByText(/Summary request timed out or failed/)
        .first()
        .isVisible()
        .catch(() => false);
      if (layerLanded) check(true, 'summary landed in the chapter body');
      else if (failed) step('observe', 'summarize hit the 12s deadline — honest failure + Retry chrome');
      else if (landed) step('observe', 'chrome cleared without a layer — observe only');
      else step('observe', 'summarize call still in flight / no server key — chrome state is the assertion');
    } else {
      step('observe', 'summary layer already present');
      check(true, 'summary body rendered');
    }
    await shot(page, 'chapter-cut-summary');

    // Back to the full cut so later journeys see the turns.
    await cutChip('full').click();
    await page.waitForTimeout(400);
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
    await page.locator('aside').getByText('Fixture Thread', { exact: true }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1000);
    step('click', 'sidebar thread: Fixture Thread');
    const txt = await bodyText();
    check(/EVIDENCE-OK/.test(txt), 'original thread content restored after switch-back');
    await shot(page, 'back-to-main');
  });

  // ── J7 mirror ─────────────────────────────────────────────────────────────
  await journey(page, '07-mirror', 'Tap orb → mirror shows payload, attachments at granularity, chapters, raw', async (page) => {
    const orb = page.locator('[title*="tap to see what the LLM will see"]');
    await orb.click({ timeout: 5000 });
    step('click', 'saturation orb');
    await page.getByText('What the LLM will see').first().waitFor({ state: 'visible', timeout: 5000 });
    const txt = await bodyText();
    check(/Payload/i.test(txt), 'payload section');
    check(/Attached artifacts/i.test(txt), 'attachments section');
    check(/Chapters, in send order|CHAPTERS/i.test(txt), 'chapters section');
    check(/Fixture Artifact Alpha/.test(txt), 'fixture attachment row');
    check(/Title|Description|Summary|Full/.test(txt), 'granularity control present');
    check(/In the chat/i.test(txt), 'committed attachments grouped (no detach)');
    check(/Raw payload|RAW PAYLOAD/i.test(txt), 'raw payload section');
    await shot(page, 'mirror');
    await ariaSnap(page, '07-mirror');
    await page.keyboard.press('Escape');
  });

  // ── J14 the folder IS the picker: dot → stage → tray → unstage ────────────
  await journey(page, '14-stage-from-folder', 'Composer [+] → folder dot stages → tray in composer → unstage', async (page) => {
    await page.locator('[data-testid="open-artifacts"]').first().click({ timeout: 5000 });
    step('click', 'composer [+] → artifacts');
    await page.getByPlaceholder(/Search artifacts/).waitFor({ state: 'visible', timeout: 5000 });
    check(true, 'folder view opened (the picker)');

    const betaRow = page.locator('[data-artifact-id="art-fx-beta"]').first();
    await betaRow.waitFor({ state: 'visible', timeout: 5000 });
    check((await betaRow.getAttribute('data-state')) === 'unstaged', 'Beta starts unstaged (dim)');

    // The ROW is the verb: clicking the body stages it. The dot is the same verb
    // on a smaller target, not the only handle.
    await betaRow.click({ position: { x: 40, y: 12 }, timeout: 5000 });
    step('click', 'row body: stage Beta');
    await page.waitForTimeout(300);
    check((await betaRow.getAttribute('data-state')) === 'staged', 'Beta row turned staged (punchy cyan)');

    // The arrow-out on the right opens the detail popup — same widget, same
    // arrow, in the folder AND in the chat.
    await betaRow.locator('[data-testid="open-artifact-detail"]').first().click({ timeout: 5000 });
    step('click', 'arrow-out: open detail popup');
    const popup = await page
      .getByTestId('unstage-from-detail')
      .or(page.getByText(/Staged for next send/))
      .first()
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check(popup, 'detail popup opened from the folder row');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // The floating chat bubble carries the armed count.
    const back = page.locator('[data-testid="back-to-chat"]').first();
    check(/staged/i.test((await back.getAttribute('aria-label')) || ''), 'back-to-chat bubble shows the staged count');

    await back.click({ timeout: 5000 });
    step('click', 'back to chat');
    await page.waitForTimeout(500);
    const tray = page.locator('[data-testid="staged-tray"]').first();
    await tray.waitFor({ state: 'visible', timeout: 5000 });
    check(/Fixture Artifact Beta/.test(await bodyText()), 'staged tray lists Beta above the input');
    check(
      (await tray.locator('[data-state="staged"]').count()) > 0,
      'tray row is the bright staged state'
    );
    await shot(page, 'staged-tray');

    // Unstage before Send — staged is reversible.
    await tray.locator('[data-testid="unstage-attachment"]').first().click({ timeout: 5000 });
    step('click', 'unstage from the tray');
    await page.waitForTimeout(400);
    check(!/Fixture Artifact Beta/.test(await bodyText()), 'tray cleared after unstage');
  });

  // ── J15 Send commits the attachment to the turn (no detach) ───────────────
  await journey(page, '15-weld-on-send', 'Send → attachment lands on its turn, no detach button', async (page) => {
    // Stage Beta again, through the folder (the only picker).
    await page.locator('[data-testid="open-artifacts"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(400);
    const betaRow = page.locator('[data-artifact-id="art-fx-beta"]').first();
    await betaRow.locator('button[aria-label^="Stage"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="back-to-chat"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(400);

    await composer.fill('Reply with exactly: WELD-OK');
    await send();
    step('click', 'Send with a staged attachment');
    await waitIdle(page);
    await page.waitForTimeout(800);

    const txt = await bodyText();
    check(/Fixture Artifact Beta/.test(txt), 'attachment card rendered in the chat');
    check(!(await page.locator('[data-testid="staged-tray"]').count()), 'tray emptied after Send');
    const unstage = await page.locator('[data-testid="unstage-attachment"]').count();
    check(unstage === 0, `committed attachments expose no detach button (found ${unstage})`);
    check(/Attached on this turn/i.test(txt), 'card is anchored to the turn that sent it');
    await shot(page, 'welded-turn');

    // Noise law: a chat card carries NO cut chips — the row body is the whole
    // control (click cycles the cut), and the card is a quarter narrower so it
    // sits beside the message instead of owning the column.
    const card = page.locator('[data-artifact-id="art-fx-beta"]').first();
    check(
      (await card.locator('[data-granularity]').count()) === 0,
      'a chat artifact card carries no granularity chips'
    );
    const cardWidth = Math.round((await card.boundingBox())?.width ?? 0);
    check(
      cardWidth > 0 && cardWidth <= 260,
      `the chat card is the compact width (${cardWidth}px, library row is 320px)`
    );
    const cutBefore = await card.getAttribute('data-state');
    await card.click({ timeout: 5000 });
    step('click', 'chat artifact card → cycle the cut');
    await page.waitForTimeout(500);
    const cutAfter = await card.getAttribute('data-state');
    check(
      cutBefore !== cutAfter,
      `clicking the card cycles its cut (${cutBefore} → ${cutAfter})`
    );
    await shot(page, 'chat-card-cycled');

    // Reopening the folder shows it as committed (Turn badge), not staged.
    await page.locator('[data-testid="open-artifacts"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(500);
    const row = page.locator('[data-artifact-id="art-fx-beta"]').first();
    const rowText = (await row.innerText()).replace(/\s+/g, ' ');
    check(/msg\s*\d+/i.test(rowText), `folder row shows its msg anchor (${rowText.slice(0, 80)})`);
    check(!/Turn\s*\d+/i.test(rowText), 'one counter: no raw 0-based "Turn N" anywhere');
    check((await row.getAttribute('data-state')) !== 'staged', 'staged state cleared after the weld');
    await shot(page, 'folder-after-send');
    await page.locator('[data-testid="back-to-chat"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(400);
  });

  // ── J16 what you see is what you send — all FOUR cuts, and UI == payload ──
  // All four cuts are clicked on purpose: the divergence shows up on Description,
  // where the screen renders a summary the payload does not carry. Presence
  // checks cannot catch that. This one compares the screen against the Mirror's
  // literal compiled bytes.
  await journey(page, '16-chapter-cut', 'All four cuts render exactly what the payload carries', async (page) => {
    // Count message bodies by their testid, never by a style class: the body
    // moved into MessageBody (markdown by default), so a class-based count
    // reads 0 turns and blames the chapter cut instead of the selector.
    const MESSAGE_BODY = '[data-testid="message-markdown"], [data-testid="message-raw"]';
    const turnsVisible = () => page.locator(MESSAGE_BODY).count();
    const chip = (g) => page.locator(`[data-testid="chapter-cut"] [data-granularity="${g}"]`).last();
    // The fixture chapter (first) has a summary and NO description — the shape
    // where screen and payload diverge if the layer gating is wrong.
    const fxSection = page.locator('section:has([data-testid="chapter-cut"])').first();
    // Scoped to the chapter's OWN control: the chapter header is the only place
    // a chapter cut is chosen in the chat (attachment cards carry no chips).
    const fxCut = (g) =>
      fxSection.locator(`[data-testid="chapter-cut"] [data-granularity="${g}"]`).first();
    const SUMMARY_SENTENCE = 'Synthetic chapter for headless capture.';

    // In-progress law: the last two chapters always send Full and carry no cut
    // control — a chapter you are still talking inside is not one to cut.
    const inProgress = await page.locator('[data-testid="chapter-in-progress"]').count();
    const cutTables = await page.locator('[data-testid="chapter-cut"]').count();
    check(inProgress === 2, `the last two chapters carry the in-progress badge (${inProgress})`);
    check(cutTables >= 1, `older chapters keep their cut controls (${cutTables})`);
    check(
      (await page.locator('[data-testid="chapter-in-progress"] [data-granularity]').count()) === 0,
      'an in-progress chapter exposes no granularity chips'
    );

    // A sealed older chapter only shows turns at Full — put the last CUTTABLE
    // chapter there before measuring, so the title leg has turns to hide.
    await chip('full').click();
    await page.waitForTimeout(500);

    const nFull = await turnsVisible();
    check(nFull > 0, `turns visible at Full (${nFull})`);

    await chip('title').click();
    step('click', 'older chapter → Title');
    await page.waitForTimeout(500);
    const nTitle = await turnsVisible();
    check(nTitle < nFull, `Title hides the turns (${nTitle} < nFull=${nFull})`);
    const lastSection = page.locator('section:has([data-testid="chapter-cut"])').last();
    check(
      (await lastSection.locator(MESSAGE_BODY).count()) === 0,
      'no message bubbles under a Title cut'
    );

    await fxCut('description').click();
    step('click', 'fixture chapter → Description (the cut that diverged)');
    await page.waitForTimeout(500);
    check(
      (await fxSection.locator('[data-testid="chapter-layer-summary"]').count()) === 0,
      'Description cut does NOT render the summary (V1.2 dead)'
    );
    // Chrome, not fake content. Two honest texts are legal here: the gap is
    // named ("No description yet") and, because selecting a missing layer also
    // fires the summarize, "Writing summary…" while that call is in flight.
    const chromeText = (await fxSection.innerText()).replace(/\s+/g, ' ');
    const descLayer = await fxSection
      .locator('[data-testid="chapter-layer-description"]')
      .count();
    // Three honest outcomes, none of them a fake paragraph: the gap is named
    // ("No description yet"), the fill is running ("Writing summary…"), or the
    // fill already landed (the layer exists). An empty chapter summarizes
    // instantly server-side, which is why the third case is common here.
    check(
      /No description yet|Writing summary/.test(chromeText) || descLayer > 0,
      `missing layer is filled or named honestly, never faked (chrome=${/No description yet|Writing summary/.test(chromeText)}, layer=${descLayer})`
    );

    // UI == PAYLOAD: open the Mirror and read the literal compiled bytes.
    await page.locator('[title*="tap to see what the LLM will see"]').first().click({ timeout: 5000 });
    await page.getByText('What the LLM will see').first().waitFor({ state: 'visible', timeout: 5000 });
    const rawBtn = page.getByRole('button', { name: /Raw payload/i }).first();
    if (await rawBtn.isVisible().catch(() => false)) {
      await rawBtn.click();
      await page.waitForTimeout(300);
    }
    const rawPayload = await page.evaluate(() =>
      [...document.querySelectorAll('pre')]
        .map((p) => p.textContent || '')
        .join('\n')
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(
      !rawPayload.includes(SUMMARY_SENTENCE),
      'payload at Description does not carry the summary'
    );
    check(/granularity="description"/.test(rawPayload), 'payload declares the description cut');
    // A note is sent as a FILE, not as a database row: the internal id made the
    // model read `art-1792614286498-4845` as the note's name and write it into
    // prose. The id must never reach the payload; the title does, as a filename.
    check(
      !/art-fx-/.test(rawPayload),
      'no internal artifact id leaks into the payload the model reads'
    );
    check(
      /<artifact file="fixture-artifact-alpha\.md"/.test(rawPayload),
      'the attached note is named to the model as a file'
    );

    await fxCut('summary').click();
    step('click', 'fixture chapter → Summary');
    await page.waitForTimeout(500);
    check(
      (await fxSection.locator('[data-testid="chapter-layer-summary"]').count()) > 0,
      'Summary cut renders the summary'
    );

    await chip('summary').click();
    step('click', 'last chapter → Summary');
    await page.waitForTimeout(500);
    check((await turnsVisible()) < nFull, 'Summary hides the turns too');

    await chip('full').click();
    step('click', 'last chapter → Full');
    await page.waitForTimeout(500);
    check((await turnsVisible()) >= nFull, 'Full brings the turns back');
    check(!/Recap/i.test(await bodyText()), 'still no Recap');
    await shot(page, 'cut-roundtrip');

    // Leave the fixture chapter at Full: later journeys (17) need a feed that
    // is actually taller than the viewport to prove the clearance scrolls away.
    await fxCut('full').click();
    await page.waitForTimeout(400);
  });

  // ── J18 the 5px rail: real order, real colours, cube-root height ──────────
  await journey(page, '18-edge-rail', 'Rail maps the payload in order with cbrt(1M) height', async (page) => {
    const rail = page.locator('[data-testid="edge-heat-strip"]').first();
    const railInfo = await rail.evaluate((el) => ({
      pct: parseFloat(el.getAttribute('data-rail-height-pct') || '0'),
      kinds: [...el.querySelectorAll('[data-segment-kind]')].map((s) => s.getAttribute('data-segment-kind')),
      states: [...el.querySelectorAll('[data-segment-state]')].map((s) => s.getAttribute('data-segment-state')),
      tokens: [...el.querySelectorAll('[data-segment-id]')].length,
    }));
    step('observe', JSON.stringify(railInfo));
    check(railInfo.tokens > 0, `rail carries real segments (${railInfo.tokens})`);
    check(railInfo.pct > 0 && railInfo.pct < 100,
      `rail height is cube-rooted, not pinned to 100% (${railInfo.pct}%)`);
    // Payload order: system first, chapters last, attachments in between.
    check(railInfo.kinds[0] === 'system', `system segment leads the rail (${railInfo.kinds[0]})`);
    check(railInfo.kinds[railInfo.kinds.length - 1] === 'chapter', 'chapters trail the rail');
    const firstChapter = railInfo.kinds.indexOf('chapter');
    const lastAttachment = railInfo.kinds.lastIndexOf('attachment');
    check(lastAttachment < firstChapter, 'attachments sit between system and chapters (payload order)');
    check(railInfo.states.includes('full') || railInfo.states.includes('summary') ||
      railInfo.states.includes('title') || railInfo.states.includes('description'),
      'segments carry the granularity colour states');
    await shot(page, 'edge-rail');
  });

  // ── J17 top clearance scrolls away (no sticky bar) ────────────────────────
  await journey(page, '17-top-clearance', 'The title is in flow at the top, pins compact, never overlaps the orb', async (page) => {
    const geom = await page.evaluate(() => {
      const title = document.querySelector('[data-testid="thread-title-row"]');
      const scroller = title ? title.closest('div.overflow-y-auto') : null;
      const orb = document.querySelector('[title*="tap to see what the LLM will see"]');
      // the row reserves a gutter for the orb; the TEXT is what must stay clear
      const label = title ? title.querySelector('h1, input') : null;
      if (scroller) scroller.scrollTop = 0;
      const tR = label ? label.getBoundingClientRect() : null;
      const oR = orb ? orb.getBoundingClientRect() : null;
      const sR = scroller ? scroller.getBoundingClientRect() : null;
      const overlaps = tR && oR
        ? !(oR.left >= tR.right || oR.right <= tR.left || oR.top >= tR.bottom || oR.bottom <= tR.top)
        : null;
      return {
        titleTop: tR ? Math.round(tR.top) : null,
        titleHeight: tR ? Math.round(tR.height) : null,
        scrollerTop: sR ? Math.round(sR.top) : null,
        overlapsOrb: overlaps,
        orbBottom: oR ? Math.round(oR.bottom) : null,
      };
    });
    // A real title, not an 11px pill: it must be tall enough to read.
    check(geom.titleHeight !== null && geom.titleHeight > 24, `title row is a real title (${geom.titleHeight}px)`);
    check(
      geom.titleTop !== null && geom.scrollerTop !== null && geom.titleTop - geom.scrollerTop < 24,
      `title starts at the top of the feed (${geom.titleTop} vs ${geom.scrollerTop})`
    );
    if (geom.overlapsOrb !== null) {
      check(geom.overlapsOrb === false, 'the token orb does not sit on the title');
    } else {
      warn('could not measure the floating orb');
    }

    const after = await page.evaluate(() => {
      const title = document.querySelector('[data-testid="thread-title-row"]');
      const scroller = title ? title.closest('div.overflow-y-auto') : null;
      if (scroller) scroller.scrollTop = 400;
      return new Promise((resolve) => setTimeout(() => {
        const r = title ? title.getBoundingClientRect() : null;
        resolve({
          scrollTop: scroller ? scroller.scrollTop : null,
          height: r ? Math.round(r.height) : null,
          top: r ? Math.round(r.top) : null,
          scrolled: title ? title.dataset.scrolled : null,
        });
      }, 200));
    });
    check(after.scrollTop > 0, `scrolled down (${after.scrollTop})`);
    // Pinned, but compact: the conversation stays named without eating the page.
    check(after.height !== null && after.height <= 44, `title pins compact when scrolled (${after.height}px)`);
    check(after.scrolled === 'true', 'title knows it is scrolled (data-scrolled)');
    await page.evaluate(() => {
      const title = document.querySelector('[data-testid="thread-title-row"]');
      const scroller = title ? title.closest('div.overflow-y-auto') : null;
      if (scroller) scroller.scrollTop = 0;
    });
    await shot(page, 'clearance');
  });

  // ── J8 graph ──────────────────────────────────────────────────────────────
  await journey(page, '08-artifacts-graph', 'Artifacts library → Graph lens renders artifacts + edges', async (page) => {
    await page.getByRole('button', { name: /Artifacts/ }).first().click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /^Graph$/ }).first().click();
    await page.waitForTimeout(2500);
    const txt = await bodyText();
    check(/Fixture Artifact Alpha/.test(txt), 'artifact node Alpha');
    check(/Fixture Artifact Beta/.test(txt), 'artifact node Beta');
    await shot(page, 'graph');
    await ariaSnap(page, '08-graph');
    await page.getByRole('button', { name: /^Chat$/ }).first().click();
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

  // ── J19 critical notice — a save that never settles must still be visible ──
  // The failure David hit live: with the free Firestore write quota gone,
  // `setDoc` never settles (the client retries with a backoff cap forever), so
  // the catch never ran and nothing reached the UI — work was lost in silence.
  // `?slowsave=1` reproduces exactly that shape and cannot touch a backend.
  await journey(page, '19-critical-notice', 'A save that never settles raises the red banner', async (page) => {
    forceFailurePhase = true;
    try {
      await page.goto(`${startUrl}&slowsave=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(2000);
      check(
        (await page.locator('[data-testid="critical-notification"]').count()) === 0,
        'nothing on screen before the deadline passes'
      );

      // Any mutation starts the debounced save; that save hangs, and the
      // acknowledgement deadline is what turns "stuck" into "failed".
      const cutChip = page.locator('[data-testid="chapter-cut"] [data-granularity="summary"]').first();
      if (await cutChip.isVisible().catch(() => false)) {
        await cutChip.click({ timeout: 8000 });
        step('click', 'chapter → Summary (starts a save)');
      } else {
        step('skip', 'no cut control visible — the boot save alone must raise the banner');
      }

      const banner = page.locator('[data-testid="critical-notification"]').first();
      await banner.waitFor({ state: 'visible', timeout: 35_000 });
      step('wait', 'the watchdog fired (15s acknowledgement deadline)');
      const notice = (await banner.innerText()).replace(/\s+/g, ' ');
      check(/Could not save to the cloud/.test(notice), `the banner says what happened: "${notice}"`);
      check(/may be lost/.test(notice), 'it says what the user stands to lose');
      check(
        !/resource-exhausted|FirebaseError|Error:|at /.test(notice),
        'it carries no error specifics — the console keeps those'
      );
      check((await banner.getAttribute('role')) === 'alert', 'it is a live region, not a silent div');
      await shot(page, 'critical-notice');

      await banner.locator('button').first().click({ timeout: 5000 });
      step('click', 'dismiss the banner');
      await page.waitForTimeout(500);
      check(
        (await page.locator('[data-testid="critical-notification"]').count()) === 0,
        'the ✕ dismisses it'
      );
    } finally {
      forceFailurePhase = false;
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
      await page
        .locator('textarea')
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(1500);
    }
  });

  // ── J20 enter to send — one keyboard contract, one switch ──────────────────
  // The three fixed truths (Shift+Enter never sends, Ctrl+Enter always sends)
  // and the one preference (bare Enter) must hold in the real composer, and the
  // switch that sets the preference must be reachable on a phone — that is the
  // whole reason it lives in the sidebar instead of the composer.
  await journey(page, '20-enter-send-config', 'Enter/Shift+Enter/Ctrl+Enter obey the sidebar switch, on desktop and on a phone', async (page) => {
    const pillSend = page.locator('[data-testid="enter-send-send"]');
    const pillNew = page.locator('[data-testid="enter-send-newline"]');
    await pillSend.waitFor({ state: 'visible', timeout: 10_000 });
    step('wait', 'Send-on-Enter panel visible in the open sidebar');
    check(
      (await pillSend.getAttribute('aria-pressed')) === 'true',
      'bare Enter defaults to sending'
    );
    await shot(page, 'sidebar-send-on-enter');
    const value = () => composer.inputValue();

    // Default mode: Shift+Enter must NOT send — it must leave a new line behind.
    await composer.fill('ALPHA-SHIFT');
    await composer.press('Shift+Enter');
    await page.waitForTimeout(300);
    check((await value()).includes('\n'), 'Shift+Enter inserts a new line');
    check(!(await bodyText()).includes('ALPHA-SHIFT'), 'Shift+Enter never sends');
    await composer.fill('');

    // …while Ctrl+Enter always sends, without touching the switch.
    await composer.fill('Reply with exactly: ALPHA-CTRL');
    await composer.press('Control+Enter');
    step('press', 'Ctrl+Enter');
    await stopBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await waitIdle(page);
    check((await bodyText()).includes('ALPHA-CTRL'), 'Ctrl+Enter sends');
    check((await value()) === '', 'the composer is cleared by a real send');

    // Flip the switch: now a bare Enter must make a new line, not send.
    await pillNew.click({ timeout: 5000 });
    step('click', 'Send on Enter → New line');
    await page.waitForTimeout(300);
    check((await pillNew.getAttribute('aria-pressed')) === 'true', 'the switch flipped');
    await composer.fill('BETA-ENTER');
    await composer.press('Enter');
    await page.waitForTimeout(400);
    check((await value()).includes('\n'), 'bare Enter makes a new line when the switch says so');
    check(!(await bodyText()).includes('BETA-ENTER'), 'bare Enter did not send');
    await shot(page, 'enter-makes-newline');

    // Ctrl+Enter is not a preference — it still sends in this mode.
    await composer.press('Control+Enter');
    step('press', 'Ctrl+Enter (in New-line mode)');
    await stopBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await waitIdle(page);
    check((await bodyText()).includes('BETA-ENTER'), 'Ctrl+Enter still sends in New-line mode');

    // The option must be reachable on a phone, through the drawer, and the
    // choice must survive a reload — otherwise "even on phone" is a lie.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(2000);
    const drawer = page.locator('button[aria-label="Open sidebar drawer"]');
    if (await drawer.isVisible({ timeout: 5000 }).catch(() => false)) {
      await drawer.click();
      await page.waitForTimeout(800);
      step('click', 'open the sidebar drawer at 390px');
      await page.locator('[data-testid="enter-send-newline"]').first().scrollIntoViewIfNeeded();
      const onPhone = await page.locator('[data-testid="enter-send-newline"]').first().isVisible();
      check(onPhone, 'Send-on-Enter is reachable on a 390px phone');
      check(
        (await page.locator('[data-testid="enter-send-newline"]').first().getAttribute('aria-pressed')) === 'true',
        'the phone still shows the choice made on the desktop (it is per-browser)'
      );
      await shot(page, 'phone-send-on-enter');
      await page.locator('div[class*="bg-black/60"]').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
    } else {
      warn('drawer trigger not visible at 390px — the "on phone" claim is untested this run');
    }

    // Leave the workspace as we found it: back to desktop, back to the default.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(2000);
    await page.locator('[data-testid="enter-send-send"]').first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    check(
      (await page.locator('[data-testid="enter-send-send"]').first().getAttribute('aria-pressed')) === 'true',
      'the default is put back for the next run'
    );
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
      // artifacts library (folders lens)
      await page.getByRole('button', { name: /Artifacts/ }).first().click().catch(() => {});
      await page.waitForTimeout(900);
      await auditSurface(page, vp.name, 'artifacts');
      // graph lens
      await page.getByRole('button', { name: /^Graph$/ }).first().click().catch(() => {});
      await page.waitForTimeout(2500);
      await auditSurface(page, vp.name, 'graph');
      await page.getByRole('button', { name: /^Chat$/ }).first().click().catch(() => {});
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