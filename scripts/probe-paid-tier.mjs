/**
 * Paid-tier latency probe — STRICT BUDGET: max 8 generateContent calls.
 *   Goal: is gemini-3.8-flash's slowness free-tier deprioritization?
 *   Metric focus: wall time + TTFC (time-to-first-token), tiny prompts.
 *   Cost discipline: prompt ~8 tokens, maxOutputTokens=256 (actual ~2),
 *   thinkingBudget=0 wherever the thinking default is not the subject.
 *
 *   Key: read from /tmp/paid-gemini.key (mode 0600). NEVER committed.
 *   Budget counter is enforced in-script; aborts at CALL_BUDGET.
 */
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';

const PAID = fs.readFileSync('/tmp/paid-gemini.key', 'utf8').trim();
const ai = new GoogleGenAI({ apiKey: PAID });
const PROMPT = 'Reply with exactly the letters OK and nothing else.';
const CALL_BUDGET = 8;
let calls = 0;
const rows = [];

function budget() {
  if (calls >= CALL_BUDGET) throw new Error('call budget exhausted');
  calls++;
}

async function rawRest(label, generationConfig) {
  budget();
  const t0 = Date.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent`,
    { method: 'POST', headers: { 'x-goog-api-key': PAID, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }] }], generationConfig }) },
  );
  const ms = Date.now() - t0;
  const tier = res.headers.get('x-gemini-service-tier') || '-';
  if (!res.ok) {
    const b = await res.text();
    rows.push({ label, ms, status: res.status });
    console.log(`[${label}] HTTP ${res.status} ${ms}ms :: ${b.slice(0, 180)}`);
    return;
  }
  const b = await res.json();
  const u = b.usageMetadata || {};
  const txt = (b.candidates?.[0]?.content?.parts || []).map(p => p.text).join('');
  rows.push({ label, ms, ttfc: null, thoughts: u.thoughtsTokenCount ?? 0, out: u.candidatesTokenCount, tier });
  console.log(`[${label}] HTTP ${res.status} ${ms}ms tier=${tier} thoughts=${u.thoughtsTokenCount ?? 0} out=${u.candidatesTokenCount} :: ${JSON.stringify(txt.slice(0, 20))}`);
}

async function sdkStream(label, config) {
  budget();
  const t0 = Date.now();
  let ttfc = null, text = '', usage = null;
  const stream = await ai.models.generateContentStream({ model: 'gemini-3.8-flash', contents: PROMPT, config });
  for await (const c of stream) {
    if (ttfc === null && c.text) ttfc = Date.now() - t0;
    text += c.text || '';
    if (c.usageMetadata) usage = c.usageMetadata;
  }
  const ms = Date.now() - t0;
  rows.push({ label, ms, ttfc, thoughts: usage?.thoughtsTokenCount ?? 0, out: usage?.candidatesTokenCount });
  console.log(`[${label}] total=${ms}ms TTFC=${ttfc}ms thoughts=${usage?.thoughtsTokenCount ?? 0} out=${usage?.candidatesTokenCount} :: ${JSON.stringify(text.slice(0, 20))}`);
}

async function sdkNonStream(label, config) {
  budget();
  const t0 = Date.now();
  const r = await ai.models.generateContent({ model: 'gemini-3.8-flash', contents: PROMPT, config });
  const ms = Date.now() - t0;
  const u = r.usageMetadata || {};
  rows.push({ label, ms, ttfc: null, thoughts: u.thoughtsTokenCount ?? 0, out: u.candidatesTokenCount });
  console.log(`[${label}] ${ms}ms thoughts=${u.thoughtsTokenCount ?? 0} out=${u.candidatesTokenCount} :: ${JSON.stringify((r.text || '').slice(0, 20))}`);
}

const NO_THINK = { thinkingConfig: { thinkingBudget: 0 } };
const CAP = { maxOutputTokens: 256, temperature: 0 };

console.log('=== paid-tier probe (budget 8 calls) ===');
await rawRest('1 raw-REST nonstream default-think', { ...CAP });                                    // headers/service-tier + baseline
await sdkStream('2 STREAM think=0 TTFC#1', { ...CAP, ...NO_THINK });                                // first-token metric
await sdkStream('3 STREAM think=0 TTFC#2', { ...CAP, ...NO_THINK });                                // variance
await sdkNonStream('4 nonstream think=0', { ...CAP, ...NO_THINK });                                 // wall, no thinking
await sdkNonStream('5 nonstream default-think', { ...CAP });                                        // does thinking run? cost?
await sdkNonStream('6 nonstream JSON think=0', { ...CAP, ...NO_THINK, responseMimeType: 'application/json' }); // prod shape
// reserve 2 calls: lite control + one repeat if numbers look odd
budget();
{
  const t0 = Date.now();
  let ttfc = null, usage = null;
  const s = await ai.models.generateContentStream({ model: 'gemini-3.5-flash-lite', contents: PROMPT, config: { ...CAP, ...NO_THINK } });
  for await (const c of s) { if (ttfc === null && c.text) ttfc = Date.now() - t0; if (c.usageMetadata) usage = c.usageMetadata; }
  const ms = Date.now() - t0;
  rows.push({ label: '7 LITE STREAM think=0', ms, ttfc, thoughts: usage?.thoughtsTokenCount ?? 0, out: usage?.candidatesTokenCount });
  console.log(`[7 LITE STREAM think=0] total=${ms}ms TTFC=${ttfc}ms out=${usage?.candidatesTokenCount}`);
}

console.log(`\ncalls used: ${calls}/${CALL_BUDGET}`);
console.table(rows);
fs.writeFileSync('/tmp/paid-tier-results.json', JSON.stringify(rows, null, 2));
