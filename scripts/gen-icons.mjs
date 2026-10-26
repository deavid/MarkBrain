// One-off: render public/favicon.svg to PWA icon PNGs (192 + 512).
// Uses the image-pinned playwright-core from the agent-box image (see env memory).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svgPath = path.join(root, 'public', 'favicon.svg');
const svg = `file://${svgPath}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
for (const size of [192, 512]) {
  await page.goto(svg);
  const el = page.locator('svg');
  await el.evaluate((node, s) => {
    node.setAttribute('width', String(s));
    node.setAttribute('height', String(s));
  }, size);
  await el.screenshot({
    path: path.join(root, 'public', `icon-${size}.png`),
    omitBackground: false,
  });
  console.log(`icon-${size}.png done`);
}
await browser.close();
