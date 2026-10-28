# Observed: `gemini-3.8-flash` latency collapse (~2 min / call) — **root cause identified**

**Date observed:** 2026-10-18, ~10:01–10:09 (Europe/Madrid)
**Date root-caused:** 2026-10-18, ~11:20–11:35 (attribution probes, same worktree)
**Where:** dev-nova worktree, `http://localhost:3031`, real `GEMINI_API_KEY` from `.env`
**Status:** environmental / upstream — **not caused by any branch** — cause is
**free-tier quota exhaustion (20 requests/day per model) + time-varying
congestion on the `gemini-3.8-flash` tier**. Details below.

---

## TL;DR — what we now know

1. `gemini-3.8-flash` on this key runs on the **free tier with a hard cap of
   20 `generateContent` requests PER DAY** per project per model
   (`quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier`, confirmed by
   the 429 body). Resets **midnight Pacific**. Today's testing spent the budget;
   the endpoint is now fail-fast 429 for ~13.5 h.
2. When the budget *is* available, `gemini-3.8-flash` latency is **wildly
   time-variable**: measured 1.3 s–2.0 s (uncongested), 14–49 s (earlier), and
   113 s / 135 s (this morning). Same trivial prompt, same key, same code.
3. The slowness is **NOT** caused by thinking, JSON mode, or non-stream — all
   three external-AI hypotheses were tested and refuted (table below).
   `gemini-3.1-flash-lite` is consistently ~1 s and has its **own, much larger**
   quota (~500/day documented) — it was never slow and never 429'd.
4. The `@google/genai` SDK **silently retries 429/5xx** (up to 4 retries,
   exponential backoff, honors `retry-after-ms`) — so quota errors can appear
   to the app as multi-second "slowness" before eventually surfacing.

---

## What we saw (original observation, 10:01–10:09)

While re-testing the ImportModal fix (external review round 2), every call to
`/api/extract-artifact-from-file` hung for minutes. The endpoint's code and
payload were fine — the underlying model call was the bottleneck.

### Direct SDK probe (same key, same machine, trivial prompts)

| Model | Call shape | Result |
|---|---|---|
| `gemini-3.8-flash` | `generateContent` (non-stream, JSON mode) | **113,169 ms** (~1 min 53 s) for `Reply with JSON: {"ok":true}` |
| `gemini-3.1-flash-lite` | `generateContent` (non-stream, JSON mode) | **909 ms** |
| `gemini-3.1-flash-lite` | `generateContentStream` | **705 ms** |

### Server log evidence (worktree port 3031)

```
[10:01:22] [API:REQ] #5  POST /api/extract-artifact-from-file
[10:03:37] [API:RES] #5  POST /api/extract-artifact-from-file -> HTTP 200 (135146ms)

[10:05:19] [API:REQ] #9  POST /api/extract-artifact-from-file   ← still pending >60s
[10:05:45] [API:REQ] #11 POST /api/extract-artifact-from-file   ← still pending
[10:06:25] [API:REQ] #12 POST /api/extract-artifact-from-file   ← curl -m 30 timed out
```

Meanwhile, in the **same time window**, chat streams on `gemini-3.1-flash-lite`
were healthy (`[STREAM:TTFC] First chunk received in 879ms`). One extract call
eventually succeeded — after **135 seconds** — with a well-formed body.

---

## Root cause — the 429 tells us exactly

Ground truth captured via raw REST (no SDK) at 11:28, once the budget was spent:

```json
{
  "error": {
    "code": 429,
    "status": "RESOURCE_EXHAUSTED",
    "message": "Quota exceeded for metric:
      generativelanguage.googleapis.com/generate_content_free_tier_requests,
      limit: 20, model: gemini-3.8-flash
      Please retry in 13h32m5.812199107s.",
    "details": [
      { "@type": "google.rpc.QuotaFailure", "violations": [{
          "quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
          "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
          "quotaDimensions": { "location": "global", "model": "gemini-3.8-flash" },
          "quotaValue": "20" }]},
      { "@type": "google.rpc.RetryInfo", "retryDelay": "48725s" }
    ]
  }
}
```

Reading of the evidence:

| Fact | Source | Implication |
|---|---|---|
| `quotaValue: 20`, `...PerDay...PerModel-FreeTier` | 429 body | **20 requests/day** for `gemini-3.8-flash` — one import = 5 % of the daily budget |
| `retryDelay: 48725s` (~13 h 32 m) | 429 body | RPD resets midnight Pacific (confirmed by [official rate-limits doc](https://ai.google.dev/gemini-api/docs/rate-limits)) |
| 429 returned in **~150 ms**, even 1 req/20 s apart | raw-REST drip probe | Not RPM — it's a hard daily wall; pacing doesn't help |
| lite: 200 OK throughout (~1.0–1.8 s) | raw-REST control | Quotas are **per model**; lite has a separate budget |
| Uncongested 3.8-flash answers in **1.3–2.0 s** | variance probe `base#1/#2` | 3.8-flash itself is fast when available — the multi-minute times are contention/queueing windows, not generation cost |
| ListModels works while generate 429s | raw REST | Only `generateContent` counts against the budget |

**Why this morning looked like "2 minutes to answer anything":** every
extraction call spends one of the 20 daily requests; during busy/contended
windows the surviving requests queue upstream for 1–2 minutes before
answering; once the budget is gone the SDK's hidden retries turn 429s into
several extra seconds before the error finally surfaces (or a lucky retry
lands). Chat never felt it because it runs on `gemini-3.1-flash-lite`.

## Attribution experiments — external-AI hypothesis verdicts

An external AI suggested: (A) default thinking budgets cause a reasoning-loop
deadlock under JSON constraints, (B) `responseMimeType: 'application/json'`
schema enforcement is the overhead, (C) non-stream blocks monolithically while
stream bypasses it, (D) the 3.8 tier is just slower than lite. Forget its
prescriptions — the ideas are testable. We tested them
(`scripts/probe-latency-matrix.mjs`, trivial prompt `{"ok":true}`):

| # | Condition | Result | Verdict |
|---|---|---|---|
| 1 | 3.8 · non-stream · JSON · thinking=default | 14,453 ms, `thoughts=108` tok | baseline; thinking **does** run by default |
| 2 | 3.8 · non-stream · JSON · `thinkingBudget=0` | 26,256 ms, 0 thought tok | **A-refuted**: killing thinking made it *worse* |
| 3 | 3.8 · thinkingLevel=minimal | HTTP 400 | level unsupported on this model |
| 4 | 3.8 · non-stream · **text** · thinking=default | 38,960 ms | **B-refuted**: plain text is not faster |
| 5 | 3.8 · non-stream · text · `thinkingBudget=0` | 23,096 ms | A+B combined: still slow |
| 6 | 3.8 · **stream** · JSON · default | TTFC 33,774 ms ≈ total | **C-refuted**: delay is *before* first byte |
| 7 | 3.8 · stream · JSON · `thinkingBudget=0` | TTFC 49,340 ms | C-refuted again |
| 8 | **lite** · non-stream · JSON | 1,347 ms | D-confirmed: tier is the dominant factor |
| 9 | **lite** · stream · JSON | TTFC 813 ms | lite is fast in every shape |

Follow-up variance probe (same trivial prompt, repeats):

- 3.8-flash: **1,357 ms** and **2,026 ms** when it got through (with
  `thoughts=84/93` — thinking costs nothing measurable), then hard 429s.
  → The 14–49 s spread between matrix conditions is **noise on a congested
  tier**, not config signal. No config knob fixes it.
- lite ×3: 1,081 / 1,083 / 1,255 ms — stable control.

### SDK detail worth knowing

`@google/genai` v2.4.0 (Speakeasy client) defaults:

```js
retry_codes: ["408", "409", "429", "5XX"],     // 429 is retried silently
strategy: "attempt-count-backoff", maxRetries: 4,
backoff: { initialInterval: 500, maxInterval: 8000, exponent: 2 },
// honors server "retry-after-ms" / "retry-after" headers between attempts
```

So quota errors can masquerade as latency. Not the main cause of the 113 s
call (that exceeded the ~8 s backoff budget — it was a genuinely slow
generation), but it blurs the picture and should inform client timeouts.

## Credential provenance — the key is free-tier (2026-10-18, confirmed)

The project had assumed a paid API. It is not. Evidence:

- `GEMINI_API_KEY` is an `AIza…` (39-char) **AI Studio / Maker console** key.
- `FIREBASE_PROJECT_ID=gen-lang-client-0408097994` — `gen-lang-client-*` is the
  **auto-created Cloud project** format from AI Studio, which ships **without a
  billing account**. (The Firestore DB id `ai-studio-markbrainarchite-…` matches.)
- The 429 consumes `generate_content_free_tier_requests` /
  `GenerateRequestsPerDayPerProjectPerModel-FreeTier` — a billed project would
  be metered under `generate_content_requests` with Tier 1 limits.
- The same key + project is in **all five** worktrees' `.env` — there is no
  second, paid credential anywhere in the repo setup.

Common confusion (worth knowing): **Gemini Advanced / Google One AI / an AI
Studio subscription does NOT put the API project on the paid tier.** Paid tier
means linking a billing account in
[Cloud Console → Billing](https://console.cloud.google.com/billing/projectassociation?project=gen-lang-client-0408097994)
(`gen-lang-client-0408097994`), after which the API moves to Tier 1
(pay-per-token, far higher RPM/RPD). Verify with that page: "No billing account
linked" ⇒ free tier confirmed.

**Unifying hypothesis for the slow windows:** free tier also implies
deprioritized inference (the 429 carried `X-Gemini-Service-Tier: standard`;
Google sells a separate "priority" tier). If billing is attached and the slow
windows disappear, the 1 s-vs-135 s swing was free-tier queueing under load —
decisive test: re-run `scripts/probe-latency-variance.mjs` with a billed key.

## What it is NOT (corrections to the first draft of this doc)

- ~~**Not key- or quota-wide.**~~ **Wrong — it is quota.** The first draft
  reasoned "lite is fast on the same key ⇒ not quota". Reality: quotas are
  **per model**; only the `gemini-3.8-flash` budget (20/day) was exhausted.
  Corrected 2026-10-18 with the 429 `QuotaFailure` evidence above.
- **Not a branch regression.** Still true: `main` calls the same model from the
  same endpoint; the cleanse only changed prompt copy.
- **Not payload-size.** Still true: a ~10-token prompt hit the same wall.
- **Not thinking / JSON-mode / non-stream.** Newly tested and refuted (table).

## Impact on the product

1. **ImportModal looks broken.** Upload → "Gemini LLM analyzing document…"
   spinner for minutes with no timeout/cancel (partially addressed in the
   latest fix batch via extraction timeout — verify), then possibly a raw
   failure once the 20/day budget is gone.
2. **Quota blindness.** The app has no 429-specific handling: no "daily quota
   exhausted, try again after midnight PT" message, no request budgeting. Each
   import burns 5 % of the daily `gemini-3.8-flash` allowance; a user importing
   5 files in one sitting can lock extraction until midnight Pacific.
3. **Stacked requests** complete minutes apart; UI state resolves long after
   the user gave up.

## Recommendations

- **Switch `/api/extract-artifact-from-file` to `gemini-3.1-flash-lite`.**
  Extraction is a small structured-JSON task; lite is ~1 s (vs 1 s–2 min),
  and its free-tier budget is ~500/day (vs 20/day). Biggest single win; this
  is no longer a maybe — the quota math alone settles it.
- **Surface 429s** from the extract path: parse `QuotaFailure` /
  `RetryInfo.retryDelay` and show "extraction quota spent — resets ~midnight
  PT" instead of a generic failure. Cheap and honest.
- **Client timeout + cancel** (`AbortController` ~30 s) on `triggerAIExtraction`
  regardless of model — protects against future slow windows.
- **Warn on slow calls** (server `logger.warn` when an upstream call exceeds
  ~10 s) so this is visible in the Server Logs modal, not only in hindsight.
- If anything must stay on a big model: treat the 20/day budget as an explicit
  product resource (count it, show it), or move the project to a paid tier.

## Paid-key comparison probe (2026-10-18, 11:40 — `scripts/probe-paid-tier.mjs`)

Temporary paid-tier key provided for testing (kept in `/tmp`, **never
committed — rotate after use**). Strict budget: **8 calls**, tiny prompt
(`Reply with exactly the letters OK`, 10 input tokens), `maxOutputTokens: 256`,
actual output 1–3 tokens. All 8 calls stayed in the 0.8–2.9 s band:

| # | Shape | Wall | TTFC | thoughts tok | notes |
|---|---|---|---|---|---|
| 1 | 3.8 raw-REST nonstream, thinking=default | 2,466 ms | — | 99 | header `X-Gemini-Service-Tier: standard` |
| 2 | 3.8 stream, `thinkingBudget=0` | 1,975 ms | **1,967 ms** | 84 ← leak | |
| 3 | 3.8 stream, `thinkingBudget=0` | 1,511 ms | **1,508 ms** | 0 | |
| 4 | 3.8 nonstream, `thinkingBudget=0` | 1,043 ms | — | 0 | fastest shape |
| 5 | 3.8 nonstream, thinking=default | 2,515 ms | — | 92 | thinking ≈ +1 s |
| 6 | 3.8 nonstream, JSON, `thinkingBudget=0` | 2,941 ms | — | **241** ← leak | prod extract shape |
| 7 | lite stream, `thinkingBudget=0` | 839 ms | **836 ms** | 0 | control |
| 8 | 3.8 raw-REST, JSON, `thinkingBudget=0` | 1,079 ms | — | 0 | same shape as #6 |

Cost: ~80 input + ~550 thought/output tokens total → **well under $0.01**.

### Findings

1. **First-token latency on a healthy 3.8-flash: 1.5–2.0 s** (stream TTFC),
   shortest reply (`OK`, 1 token) total 1.0–2.9 s. Compare free-key morning:
   TTFC 33–49 s, totals 113 s / 135 s. Lite TTFC ~0.84 s everywhere.
2. **Separate quota bucket confirmed:** the paid key ran while the free key is
   hard-429'd until midnight. (Strictly, this proves a *different project
   quota*; billing-page is authoritative for "paid".)
3. **`thinkingBudget: 0` is not a reliable guarantee** on `gemini-3.8-flash`:
   2 of 4 think=0 calls still reported 84 / 241 thought tokens (JSON mode the
   worst). Verified via fetch-intercept that the SDK sends the field correctly
   (`thinkingConfig:{"thinkingBudget":0}` on the wire) — the leak is
   server-side nondeterminism. Cost impact is minor (thoughts are output-priced
   but tiny here); latency impact ≈ +1 s when it thinks.
4. **Scientific caveat — time-of-day confound:** the free key was *already*
   fast (1.3–2.0 s) at 11:22 before its quota died. So "paid is fast at 11:40"
   alone does not prove free-tier deprioritization; the tier may simply have
   cleared up at ~11:22. The **decisive experiment** is a same-minute A/B
   (below), impossible today because the free key is out of quota.

### Decisive follow-up (after free quota resets ~09:00 Madrid 2026-10-19)

Fire **paired** calls in the same minute — free key + paid key, identical tiny
prompt, `probe-latency-variance.mjs` shape — ideally during the historic slow
window (~10:00, when the 113 s / 135 s measurements happened):

- free slow / paid fast **in the same minute** ⇒ free-tier deprioritization proven.
- both fast ⇒ earlier slowness was tier-agnostic time-of-day congestion.
- both slow ⇒ upstream capacity issue regardless of tier.

## How to re-test (quota resets midnight Pacific ≈ 2026-10-19 09:00 Europe/Madrid)

Three committed probes (run from repo root so `@google/genai` and `.env` resolve):

```bash
node scripts/probe-latency-matrix.mjs   # 9-condition hypothesis matrix
node scripts/probe-latency-variance.mjs # repeats + realistic payload + stats
node scripts/probe-quota-raw.mjs        # raw REST: 429 headers/body, drip vs burst
```

After reset, the interesting open question is **not** *whether* the model is
slow (config is ruled out) but *when the slow windows happen*:

- Budget: 20 calls/day on 3.8-flash. Spend them deliberately: e.g. 2 calls/hour
  across the day (`probe-latency-variance.mjs` trivial mode) and record
  wall-times → a latency-vs-time-of-day curve. That distinguishes "always
  ~2 s with occasional congestion" from "systematically slow at peak hours".
- One call each to `gemini-3.7-flash` / `gemini-3.6-flash` / `gemini-3.5-flash`
  (independent 20/day budgets) to see if the congestion is specific to 3.8 or
  shared across the flash tier.
- Keep raw-REST (`probe-quota-raw.mjs`) as the ground-truth instrument — it
  bypasses SDK retries and shows `retry-after` / `RetryInfo` directly.

---

*Recorded from the external-review session of 2026-10-18 (dev-nova fix
verification → latency attribution). Related: `05_CLEANSE_DECISIONS.md`
(external-review fix batch). First draft of this file wrongly ruled out quota;
corrected the same day with 429 `QuotaFailure` ground truth.*
