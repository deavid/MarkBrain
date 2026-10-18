/**
 * Probe 2: variance measurement + realistic payload.
 *   - 6x repeat of the 3.8 baseline condition -> is the 14-49s config spread signal or noise?
 *   - 3x repeat of lite control
 *   - realistic extraction-sized payload: 3.8 default vs 3.8 thinkingBudget=0 vs lite
 */
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const TRIVIAL = 'Reply with exactly this JSON and nothing else: {"ok":true}';
const REALISTIC = `Extract structured metadata from the document below.
Return JSON: {"title": string, "code": string, "description": string, "summary": string, "tags": string[], "content": string}
Rules: description = 1-2 sentences. summary = 1-2 paragraphs. content = full markdown body.

Raw Input Document (team-notes.md):
${'## Team Offsite Planning\n\nWe need to finalize the mountain hut booking before Friday. '
  .repeat(40)}`;

const rows = [];
async function run(label, model, config, prompt, mode = 'ns') {
  const t0 = Date.now();
  try {
    let text = '', ttfc = null, usage = null;
    if (mode === 'ns') {
      const r = await ai.models.generateContent({ model, contents: prompt, config });
      text = r.text || ''; usage = r.usageMetadata;
    } else {
      const s = await ai.models.generateContentStream({ model, contents: prompt, config });
      for await (const c of s) {
        if (ttfc === null && c.text) ttfc = Date.now() - t0;
        text += c.text || '';
        if (c.usageMetadata) usage = c.usageMetadata;
      }
    }
    const ms = Date.now() - t0;
    rows.push({ label, ms, ttfc, thoughts: usage?.thoughtsTokenCount ?? null, total: usage?.totalTokenCount ?? null, n: text.length });
    console.log(`[${label}] ${ms}ms ttfc=${ttfc} thoughts=${usage?.thoughtsTokenCount ?? 'null'} total=${usage?.totalTokenCount ?? '?'} out=${text.length}ch`);
  } catch (e) {
    const ms = Date.now() - t0;
    rows.push({ label, ms, error: String(e).slice(0, 120) });
    console.log(`[${label}] ERROR ${ms}ms ${String(e).slice(0, 110)}`);
  }
}

const F38 = 'gemini-3.8-flash', LITE = 'gemini-3.1-flash-lite';
const JSONCFG = { responseMimeType: 'application/json', temperature: 0.2 };

console.log('--- variance: 3.8 baseline x6 ---');
for (let i = 1; i <= 6; i++) await run(`base#${i}`, F38, JSONCFG, TRIVIAL);
console.log('--- variance: lite control x3 ---');
for (let i = 1; i <= 3; i++) await run(`lite#${i}`, LITE, JSONCFG, TRIVIAL);
console.log('--- realistic extraction payload ---');
await run('real 3.8 default', F38, JSONCFG, REALISTIC);
await run('real 3.8 think=0', F38, { ...JSONCFG, thinkingConfig: { thinkingBudget: 0 } }, REALISTIC);
await run('real LITE', LITE, JSONCFG, REALISTIC);

const f38 = rows.filter(r => r.label.startsWith('base#') && !r.error).map(r => r.ms);
const lite = rows.filter(r => r.label.startsWith('lite#') && !r.error).map(r => r.ms);
const stat = a => ({ n: a.length, min: Math.min(...a), max: Math.max(...a), mean: Math.round(a.reduce((x, y) => x + y, 0) / a.length) });
console.log('\n3.8 baseline stats:', stat(f38));
console.log('lite stats:', stat(lite));
console.log('rows:', JSON.stringify(rows, null, 1));
