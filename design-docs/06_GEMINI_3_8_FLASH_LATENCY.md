# Observed: `gemini-3.8-flash` latency collapse (~2 min / call)

**Date observed:** 2026-10-18, ~10:01–10:09 (Europe/Madrid)
**Where:** dev-nova worktree, `http://localhost:3031`, real `GEMINI_API_KEY` from `.env`
**Status:** environmental / upstream — **not caused by any branch** (see "Scope" below)

---

## What we saw

While re-testing the ImportModal fix (external review round 2), every call to
`/api/extract-artifact-from-file` hung for minutes. The endpoint's code and
payload were fine — the underlying model call was the bottleneck.

### Direct SDK probe (same key, same machine, trivial prompts)

| Model | Call shape | Result |
|---|---|---|
| `gemini-3.8-flash` | `generateContent` (non-stream, JSON mode) | **113,169 ms** (~1 min 53 s) for `Reply with JSON: {"ok":true}` |
| `gemini-3.1-flash-lite` | `generateContent` (non-stream, JSON mode) | **909 ms** |
| `gemini-3.1-flash-lite` | `generateContentStream` | **705 ms** |

Probe script (re-runnable):

```js
// node .model-probe.tmp.mjs — run from repo root so @google/genai resolves
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY /* or read .env */ });
const t0 = Date.now();
await ai.models.generateContent({
  model: 'gemini-3.8-flash',
  contents: 'Reply with JSON: {"ok":true}',
  config: { responseMimeType: 'application/json', temperature: 0.2 },
});
console.log(`${Date.now() - t0}ms`);
```

### Server log evidence (worktree port 3031)

```
[10:01:22] [API:REQ] #5  POST /api/extract-artifact-from-file
[10:03:37] [API:RES] #5  POST /api/extract-artifact-from-file -> HTTP 200 (135146ms)

[10:05:19] [API:REQ] #9  POST /api/extract-artifact-from-file   ← still pending >60s
[10:05:45] [API:REQ] #11 POST /api/extract-artifact-from-file   ← still pending
[10:06:25] [API:REQ] #12 POST /api/extract-artifact-from-file   ← curl -m 30 timed out
```

Meanwhile, in the **same time window**, chat streams on `gemini-3.1-flash-lite`
were healthy:

```
[10:03:45] [STREAM:TTFC] #6 First chunk received in 879ms (gemini-3.1-flash-lite)
[10:03:49] [STREAM:DONE] #6 Completed in 3339ms {"promptTokens":295,"candidatesTokens":735}
```

One earlier extract call eventually succeeded — after **135 seconds** — and the
response body was well-formed (flat `description`/`summary`/`content` fields).
So the API isn't erroring; it's *slow*.

## What it is NOT

- **Not a branch regression.** `main` uses the same model
  (`server.ts` → `/api/extract-artifact-from-file` → `model: 'gemini-3.8-flash'`);
  the dev-nova cleanse only changed prompt copy.
- **Not key- or quota-wide.** `gemini-3.1-flash-lite` completed in <1s on the
  same key while `gemini-3.8-flash` was hanging.
- **Not payload-size.** The probe prompt was ~10 tokens; real imports are capped
  at 24k chars and were no slower proportionally.
- Likely upstream capacity/routing for that specific model (possibly its
  non-stream + JSON-mode path). Could not confirm beyond observation.

## Impact on the product

1. **ImportModal looks broken.** Upload → "Gemini LLM analyzing document…"
   spinner spins for minutes with **no timeout and no cancel** — user has no
   signal that anything is happening. (Pre-existing on `main`.)
2. **Stacked requests.** Each retry/upload adds another hanging request to the
   Express server; they complete minutes apart, so the UI state resolves long
   after the user gave up.
3. Any future feature that calls `gemini-3.8-flash` non-stream inherits the same
   failure mode. (The old `/api/chat` non-stream path used it too — deleted in
   Phase 1, so chat is unaffected today.)

## Recommendations (when someone picks this up)

- **Client:** add a timeout + cancel to `triggerAIExtraction` (e.g. 30s
  `AbortController`), show elapsed time or a "still working / retry" affordance
  instead of an indefinite spinner.
- **Server:** consider switching `/api/extract-artifact-from-file` to
  `gemini-3.1-flash-lite` (or whichever model is currently healthy) — extraction
  is a small structured-JSON task; it doesn't need the big model. Or probe both
  at boot / fall back on slow first call.
- **Observability:** the endpoint already logs `API:REQ/API:RES` with duration —
  worth a `logger.warn` when duration exceeds some threshold (e.g. >10s) so this
  is visible in the Server Logs modal instead of only in hindsight.
- **Re-verify later:** model latency is time-dependent; re-run the probe before
  engineering around it — it may have recovered by the time this is read.

---

*Recorded from the external-review session of 2026-10-18 (dev-nova fix
verification). Related: `05_CLEANSE_DECISIONS.md` (external-review fix batch).*