/**
 * Latency attribution matrix for gemini-3.8-flash slowness.
 *
 * Hypotheses under test (from external AI analysis):
 *   A) Default thinking budget on Gemini 3.x spins a reasoning loop even for trivial prompts
 *   B) responseMimeType: 'application/json' (structured-output enforcement) adds heavy overhead
 *   C) Non-stream calls block monolithically; stream may show earlier TTFC
 *   D) The 3.8-flash tier itself is slow vs 3.1-flash-lite
 *
 * For each condition we record: wall time, TTFC (stream only), thoughtsTokenCount,
 * prompt/candidate token counts, and whether output is well-formed JSON.
 */
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config();
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('no key'); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: KEY });

const TRIVIAL = 'Reply with exactly this JSON and nothing else: {"ok":true}';
const results = [];

function summarize(resp) {
  const u = resp?.usageMetadata || {};
  return {
    thoughts: u.thoughtsTokenCount ?? null,
    prompt: u.promptTokenCount ?? null,
    candidates: u.candidatesTokenCount ?? null,
    total: u.totalTokenCount ?? null,
  };
}

async function runNonStream(label, model, config) {
  const t0 = Date.now();
  try {
    const resp = await ai.models.generateContent({ model, contents: TRIVIAL, config });
    const ms = Date.now() - t0;
    const text = resp.text || '';
    const row = { label, model, mode: 'non-stream', ms, ttfc: null, text: text.slice(0, 80), jsonOk: !!text.trim().match(/^\{.*\}$/s), ...summarize(resp) };
    results.push(row);
    console.log(`[${label}] ${ms}ms thoughts=${row.thoughts} tok=${row.total} json=${row.jsonOk} :: ${JSON.stringify(text.slice(0, 60))}`);
  } catch (e) {
    const ms = Date.now() - t0;
    results.push({ label, model, mode: 'non-stream', ms, error: String(e).slice(0, 160) });
    console.log(`[${label}] ERROR after ${ms}ms: ${String(e).slice(0, 140)}`);
  }
}

async function runStream(label, model, config) {
  const t0 = Date.now();
  let ttfc = null;
  let text = '';
  try {
    const stream = await ai.models.generateContentStream({ model, contents: TRIVIAL, config });
    let lastUsage = null;
    for await (const chunk of stream) {
      if (ttfc === null && (chunk.text || chunk.candidates?.[0]?.content?.parts?.length)) ttfc = Date.now() - t0;
      text += chunk.text || '';
      if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;
    }
    const ms = Date.now() - t0;
    const s = summarize({ usageMetadata: lastUsage });
    const row = { label, model, mode: 'stream', ms, ttfc, text: text.slice(0, 80), jsonOk: !!text.trim().match(/^\{.*\}$/s), ...s };
    results.push(row);
    console.log(`[${label}] total=${ms}ms ttfc=${ttfc}ms thoughts=${s.thoughts} tok=${s.total} json=${row.jsonOk} :: ${JSON.stringify(text.slice(0, 60))}`);
  } catch (e) {
    const ms = Date.now() - t0;
    results.push({ label, model, mode: 'stream', ms, ttfc, error: String(e).slice(0, 160) });
    console.log(`[${label}] ERROR after ${ms}ms: ${String(e).slice(0, 140)}`);
  }
}

const F38 = 'gemini-3.8-flash';
const LITE = 'gemini-3.5-flash-lite';
const JSONCFG = { responseMimeType: 'application/json', temperature: 0.2 };
const TEXTCFG = { temperature: 0.2 };

console.log('=== latency attribution matrix (trivial prompt) ===');
// A/B: thinking × json-mode on the slow model (non-stream = the failing production shape)
await runNonStream('1 base: 3.8 nonstream json thinking=default', F38, JSONCFG);
await runNonStream('2 A: 3.8 nonstream json thinkingBudget=0', F38, { ...JSONCFG, thinkingConfig: { thinkingBudget: 0 } });
await runNonStream('3 A: 3.8 nonstream json thinkingLevel=minimal', F38, { ...JSONCFG, thinkingConfig: { thinkingLevel: 'minimal' } });
await runNonStream('4 B: 3.8 nonstream TEXT thinking=default', F38, TEXTCFG);
await runNonStream('5 A+B: 3.8 nonstream TEXT thinkingBudget=0', F38, { ...TEXTCFG, thinkingConfig: { thinkingBudget: 0 } });
// C: streaming shape
await runStream('6 C: 3.8 STREAM json thinking=default', F38, JSONCFG);
await runStream('7 C+A: 3.8 STREAM json thinkingBudget=0', F38, { ...JSONCFG, thinkingConfig: { thinkingBudget: 0 } });
// D: model-tier control
await runNonStream('8 D: LITE nonstream json thinking=default', LITE, JSONCFG);
await runStream('9 D: LITE STREAM json thinking=default', LITE, JSONCFG);

fs.writeFileSync('/tmp/markbrain-latency-matrix.json', JSON.stringify(results, null, 2));
console.log('\n=== matrix done -> /tmp/markbrain-latency-matrix.json ===');
console.table(results.map(r => ({ label: r.label, ms: r.ms, ttfc: r.ttfc, thoughts: r.thoughts, tok: r.total, json: r.jsonOk })));
