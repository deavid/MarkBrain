/**
 * Probe 3: raw REST (no SDK retries) to see ground-truth quota behavior.
 *   - 8 rapid calls to gemini-3.8-flash -> status/latency/retry-after headers per call
 *   - 3 rapid calls to lite (control)
 *   - then 1 call per 20s x 4 -> does a slow drip beat the quota window?
 */
import dotenv from 'dotenv';
dotenv.config();
const KEY = process.env.GEMINI_API_KEY;
const URL = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const BODY = { contents: [{ parts: [{ text: 'Reply with exactly this JSON and nothing else: {"ok":true}' }] }], generationConfig: { responseMimeType: 'application/json' } };

async function call(model, label) {
  const t0 = Date.now();
  try {
    const res = await fetch(URL(model), {
      method: 'POST',
      headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });
    const ms = Date.now() - t0;
    const ra = res.headers.get('retry-after') || res.headers.get('retry-after-ms') || '-';
    let qinfo = '';
    if (res.status === 429) {
      const b = await res.json().catch(() => ({}));
      const d = b?.error?.details || [];
      qinfo = JSON.stringify(d).slice(0, 220) || b?.error?.message?.slice(0, 120) || '';
    } else if (res.ok) {
      const b = await res.json();
      const t = b?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      qinfo = `ok tok=${b?.usageMetadata?.totalTokenCount} :: ${t.slice(0, 30)}`;
    }
    console.log(`[${label}] ${res.status} ${ms}ms retry-after=${ra} ${qinfo}`);
    return { label, model, status: res.status, ms, retryAfter: ra };
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`[${label}] FETCH-ERR ${ms}ms ${String(e).slice(0, 100)}`);
    return { label, model, status: 0, ms, error: String(e).slice(0, 100) };
  }
}

const F38 = 'gemini-3.8-flash', LITE = 'gemini-3.5-flash-lite';
console.log('--- rapid fire 3.8 x8 (raw REST) ---');
const rows = [];
for (let i = 1; i <= 8; i++) rows.push(await call(F38, `3.8 rapid #${i}`));
console.log('--- rapid fire lite x3 ---');
for (let i = 1; i <= 3; i++) rows.push(await call(LITE, `lite rapid #${i}`));
console.log('--- slow drip 3.8: 1 per 20s x4 ---');
for (let i = 1; i <= 4; i++) {
  rows.push(await call(F38, `3.8 drip #${i}`));
  if (i < 4) await new Promise(r => setTimeout(r, 20000));
}
console.log('\n' + JSON.stringify(rows, null, 1));
