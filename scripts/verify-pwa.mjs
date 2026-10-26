// One-off PWA verification: install SW online → go offline → reload → app renders.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:13040';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const external = [];
page.on('request', (r) => {
  if (!r.url().startsWith(BASE)) external.push(r.url());
});

await page.goto(BASE, { waitUntil: 'networkidle' });
const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return reg.active ? reg.active.state : 'none';
});
console.log('service worker state:', swState);

const cacheNames = await page.evaluate(async () => (await caches.keys()));
console.log('caches:', cacheNames);
const cacheEntries = await page.evaluate(async () => {
  const keys = await caches.keys();
  const all = [];
  for (const k of keys) {
    for (const r of await (await caches.open(k)).keys()) all.push(new URL(r.url).pathname);
  }
  return all;
});
console.log('cache entries after first load:', cacheEntries.length, JSON.stringify(cacheEntries.slice(0, 30)));

console.log('external requests during online load:', JSON.stringify(external));

// --- airplane mode ---
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);
const offline = await page.evaluate(() => ({
  title: document.title,
  rootChildren: document.getElementById('root')?.children.length ?? 0,
  hasText: document.body.innerText.length,
  fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
}));
console.log('OFFLINE reload:', JSON.stringify(offline, null, 1));

await page.screenshot({ path: 'screenshots/pwa-offline.png' });
await browser.close();
console.log('done');
