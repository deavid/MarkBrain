# 16 — BYOK (Bring Your Own Keys), Multi-Model Routing & the Static Shell

> **Status:** Decisions recorded + phased plan. Not yet an execution spec — a
> later step-by-step plan (like `15_…`) is carved out of Phase N when we start
> that phase.
> **Date:** 2026-10-24.
> **Decided with David** in conversation; quotes in §1 are his words.

---

## 1. Decisions of record

| # | Decision | David's words |
|---|---|---|
| D1 | **Static shell + browser→provider direct** wherever possible. VPS serves static files; the browser calls Gemini/OpenRouter itself. | *"this one where possible. Without going too crazy but... if it's doable client side, then it's client side."* |
| D2 | **Capability slots for models** (not one global model), with a **popup config UI**. | *"Agreed, we will need some pop up config for model selection."* |
| D3 | **Key-storage security is a first-class deliverable** — best practices, persisted for review (§4). | *"this concern will need to be persisted in a doc for later review. I want best practices."* |
| D4 | **QR codes carry a pairing secret, never data.** Encrypted payloads may transit the VPS in RAM/short-TTL storage **iff David cannot decrypt them even if he wanted to**. | *"I'm happy for the data to go through my VPS if it simplifies things… as long as it is impossible for me to decrypt on the fly."* |
| D5 | **Publish target = anonymous public**, with a zero-cost-to-David constraint. Sharing a personal key with a friend is an explicit per-friend risk decision, not an app feature. | *"the tool is for me… if someone wants to use... I'm fine as long as it does not cost me money or trouble."* |
| D6 | **Ordinary user content may transit VPS RAM unencrypted** (secrets-in-content is the user's problem). Anything secret-like (pairing, vault material) must be E2E so the operator cannot read it. | *"I'm fine with user data moving through RAM unencrypted… For secrets like the QR idea, they need to be encrypted in such a way that I can't decode even if I wanted to."* |
| D7 | **Mixed providers, mixed purposes.** TTS + embeddings default to the Gemini AI Studio free quota; OpenRouter options exist for both too. Extract/summarize get per-slot model choice. **Chat is the most important slot and gets its own prominent control** — that is where reasoning power vs money is spent. | *"The idea will be mixed… the actual chat — this one is the most important and most separate — because here is where you want to have control on when you need actual reasoning power, or put actual money in there to get big brain."* |

---

## 2. Where we are today (model inventory)

Every LLM call today goes client → Express (`server/`) → Gemini SDK
(`server/providers/gemini.ts`) with one `GEMINI_API_KEY` from the server's `.env`.
There is no user-facing key anywhere. What uses what:

| Capability | Endpoint | Model today | Selectable? |
|---|---|---|---|
| Chat (streaming) | `/api/chat/stream` | `gemini-3.5-flash-lite` | Catalog (`server/lib/models.ts`) has exactly **one** entry |
| Thread titles | `/api/title-thread` | `gemini-3.5-flash-lite` | Hardcoded |
| Import extraction | `/api/extract-artifact-from-file` | `gemini-3.5-flash-lite` | Hardcoded |
| Chapter summaries | `/api/summarize-chapter` | `gemini-3.5-flash-lite` | Hardcoded |
| Q&A gen (search index) | `/api/search-index/generate-qa` | `gemini-3.5-flash-lite` | `QA_MODEL` const |
| Embeddings | `/api/search-index/embed` | `gemini-embedding-001` | `EMBED_MODEL` const |
| Read-aloud TTS | `/api/tts` | `gemini-3.8-flash-lite-tts` | Hardcoded |

**Two silent behaviours that must die before multi-model is usable:**

1. `resolveModelId()` (`server/lib/models.ts`) silently replaces unknown model
   ids with `DEFAULT_MODEL_ID`. In a multi-model world a typo'd/stale id must
   surface as a visible error or a *shown* fallback, never a quiet swap.
2. `server/routes/chat.ts` races non-lite models against a **9-second watchdog
   and failovers to `gemini-3.5-flash-lite` mid-stream without telling the
   user**. A "big brain" request that silently becomes a lite reply is worse
   than a slow reply. This becomes a visible downgrade banner, or dies.

**Reuse, don't rewrite:**
- `src/gateway/api.ts` is already a thin fetch-wrapper layer. Swapping its base
  from `/api/…` to provider endpoints (or a small provider adapter behind it) is
  the D1 pivot; call sites keep their response handling.
- `server/lib/models.ts` already carries a `provider` field and a comment naming
  OpenRouter as the intended second entry. The seam exists on purpose.
- `localStorage['markbrain:backend']` meta-key pattern (`persistenceService`)
  shows how config-vs-data separation is already done. Model config follows it.
- `src/utils/markdown.ts` is already escape-first (input HTML-escaped before
  formatting; URL schemes whitelisted to `https?|mailto|tel`; raw HTML
  deliberately unsupported). Keep that contract — it is load-bearing for §4.

**Known upstream reality (see `06_GEMINI_3_8_FLASH_LATENCY.md`):**
`gemini-3.8-flash` on the free tier is **20 `generateContent` requests/day per
project per model**, resets midnight Pacific, and has wildly variable latency
(1.3 s – 135 s observed). `gemini-3.5-flash-lite` has its own much larger quota
(~500/day) and was consistently fast. So "add 3.8-flash to the picker" is not
free: the picker must show quota/latency character per model so nobody is
surprised when "big brain" is slow or 429s. Also note `@google/genai` silently
retries 429/5xx — surfaced latency is not always what it looks like.

**OpenRouter facts (verified 2026-10-24 against openrouter.ai/docs):**
- Chat: OpenAI-compatible `POST /api/v1/chat/completions`, streams SSE fine
  from browsers. Explicitly supports client-side use with domain-allowlisted
  keys.
- **Embeddings: yes** — unified `POST /api/v1/embeddings`-style embeddings API
  with multiple providers behind it. One OpenRouter key *can* cover the search
  lane. Exact request/response shape gets a smoke test at implementation time.
- **TTS/STT: listed in the API reference** (some pieces marked alpha). Options
  exist; defaults stay on Gemini free quota per D7.

---

## 3. Target architecture

### 3.1 Capability slots (D2, D7)

One config object maps *capability → { provider, model }*. Popup UI groups
slots by how much they matter:

```
┌─ Model & Key Settings ────────────────────────────────┐
│                                                        │
│  CHAT  (the one you care about)                        │
│    [ provider ▾ ] [ model ▾ ]   ← prominent, own row  │
│                                                        │
│  WORKHORSE (per-slot choice)                           │
│    Extract     [ provider ▾ ] [ model ▾ ]              │
│    Summarize   [ provider ▾ ] [ model ▾ ]              │
│    Q&A gen     [ provider ▾ ] [ model ▾ ]              │
│    Titles      [ provider ▾ ] [ model ▾ ]              │
│                                                        │
│  INFRASTRUCTURE (defaults: Gemini free quota)          │
│    Embeddings  [ provider ▾ ] [ model ▾ ]              │
│    TTS         [ provider ▾ ] [ model ▾ ]              │
│                                                        │
│  KEYS                                                   │
│    Gemini:     [••••••••]  (never leaves this device)  │
│    OpenRouter: [••••••••]  (never leaves this device)  │
└────────────────────────────────────────────────────────┘
```

Slot names align 1:1 with today's endpoints: `chat`, `extract`, `summarize`,
`qaGen`, `title`, `embed`, `tts`. A slot's provider determines which key is
used and which request shape goes out.

**Model catalogs are fetched live** with the user's key — Gemini `ListModels`,
OpenRouter `GET /api/v1/models` — not hardcoded (so "3.8-flash exists now"
costs zero code). A small curated defaults list survives offline/boot
(replacing `FALLBACK_MODEL` in `src/data/models.ts`).

### 3.2 Provider adapters (D1)

```
src/gateway/
  api.ts            ← stays: thin fetch wrappers, call sites unchanged
  providers/
    gemini.ts       ← REST: generateContent(SSE) + embedContent + TTS
    openrouter.ts   ← OpenAI-style: chat/completions(SSE) + embeddings
    types.ts        ← ChatRequest/ChatChunk/EmbedRequest shared shapes
```

Browser→provider direct means the **keys never leave the device** and the VPS
drops out of every model path. Requirements per provider:

- **Gemini**: `generativelanguage.googleapis.com` is callable from browsers;
  the API key must be **restricted by HTTP referrer** in Google Cloud Console
  (also happens to be a §4 control).
- **OpenRouter**: built for this; keys support domain allowlisting + spend
  limits.
- Streaming: both speak SSE from the browser; `03-stream-protocol` keeps owning
  chunk parsing, only the fetch URL/headers change.
- Fallback rule: if a provider turns out to be un-callable from a browser
  (CORS), a **thin stateless pass-through proxy** may exist as an escape hatch —
  but the default and the only thing we build first is direct. "If it's doable
  client side, then it's client side."

### 3.3 What happens to the server

After the pivot, `server/` keeps exactly:
- static file hosting (the app shell),
- `GET /api/health` (ops),
- the **pairing mailbox** (§5) — the only stateful thing we own,
- optionally: a model-catalog cache (public data, no keys).

Everything else (`chat`, `title`, `extract`, `summarize`, `tts`, `search-index`)
becomes client-side calls. The server-side offline-fallback synthesis
(`server/routes/chat.ts` canned-note path) becomes a client-side "no key
configured" empty state instead.

### 3.4 One trap the search index creates

Embedding vectors are only comparable **within one embedding model**. If the
user flips the `embed` slot's model, every stored section vector in
`markbrain-search-index` is silently garbage. The index record gains the
embedding model id it was built with; a mismatch marks the artifact stale and
the existing re-index path rebuilds it. (The `contentHash` staleness machinery
already does exactly this dance — extend, don't invent.)

---

## 4. Key storage & security best practices (D3 — persisted for review)

This section is the standing security checklist. Anything that stores or
transits a key must pass it. Review before Phase 2 ships and again before
public exposure.

### 4.1 Threat model

| Threat | Reality |
|---|---|
| XSS in the app | **The threat.** Keys in `localStorage`/IndexedDB are `document`-readable; one injected script exfiltrates them. Model output is rendered as markdown — that is untrusted input. |
| Curious/compromised operator (David's own VPS) | Must not be able to read keys (it never sees them in D1) or E2E payloads (D4/D6). |
| Shared/public device | Shoulder-surfers, leftover state, browser sync leaking to other machines. |
| Malicious remote content | Import lane runs LLM extraction on files the user chose; artifacts may later contain hostile markdown from anywhere. |
| Network attacker | TLS everywhere; keys only ever go provider-ward over HTTPS, in headers, never in URLs. |

### 4.2 Phase-appropriate key storage

**Tier 1 — personal use now (accepted risk, documented):**
1. Keys in `localStorage` under a dedicated meta namespace (pattern:
   `markbrain:keys:<provider>`), **never** inside `ProjectSnapshot`, exports,
   or the search index. Exports must be scrubbed before any `exportProject`
   path runs.
2. **Provider-side restrictions are mandatory**, not optional hardening — they
   are the real wall while storage is plaintext-adjacent:
   - Gemini: restrict key by **HTTP referrer** to the deployment origin(s);
     restrict to the APIs actually used.
   - OpenRouter: **domain-allowlist** the key; set a **spend limit**; prefer a
     scoped/secondary key for the public deployment if one is ever shipped.
3. Visible warning in the keys UI: *"This key is stored in this browser. Anyone
   with script access to this page can read it."* No false promises.
4. Never log keys (or key fragments/lengths — `providers/gemini.ts` currently
   logs key *length* at init; drop that too when keys become user-supplied).
5. Never put keys in URLs/query strings (they end up in logs and history).
   Authorization headers only.

**Tier 2 — before anonymous public users (required):**
1. **Encrypted vault in IndexedDB** (pattern: OpenWebUI):
   - AES-GCM via WebCrypto; vault key derived from a user passphrase with
     PBKDF2-SHA-256 (≥ 600k iterations, OWASP 2023) or argon2id via a WASM lib
     if we accept the dependency.
   - The passphrase is never stored. Wrong passphrase = opaque ciphertext.
   - Auto-lock (inactivity timer) re-wipes the derived key from memory.
   - CryptoKeys from `crypto.subtle` are non-extractable where possible.
2. Per-device entry: the vault does not sync through any backend. Moving a key
   to another device re-types it, or rides the §5 E2E channel.
3. CSP on the static shell as defense-in-depth: `default-src 'self'`,
   explicit `connect-src` for the two provider origins, **no third-party
   scripts**, no `unsafe-eval`. A CSP that only allows the two API origins
   turns most XSS into a key-*use* incident instead of key *exfiltration*.

### 4.3 Markdown/XSS contract (load-bearing, keep as-is)

`src/utils/markdown.ts` is the security boundary for rendered content:
- Input is HTML-escaped **before** any formatting; output is injected with
  `dangerouslySetInnerHTML` and nothing else may ever join it.
- URL scheme whitelist: `https?`, `mailto`, `tel` only. No `javascript:`, no
  `data:` URLs unless a future need is threat-modelled first.
- Raw HTML is deliberately **not** supported — do not "improve" this.
- Any new render path (chat message bodies included) must use this renderer or
  an equally escape-first one. No `dangerouslySetInnerHTML` outside
  `renderMarkdown` callers.

### 4.4 Universal rules (both tiers)

- Keys are **device-local**, never part of project data, never synced to
  Firestore, never in QR payloads as plaintext (§5).
- Least privilege per key; separate keys per provider; rotate on suspicion.
- Fail closed: a provider 401/403 shows "key invalid/expired" in the UI, never
  a silent fallback to another key or a canned response that looks like model
  output.
- The model config popup is the **only** place keys are entered or shown
  (masked). No hidden env vars once D1 lands.

---

## 5. QR pairing + mobile transfer (D4, D6)

**QR codes carry a pairing secret, never data.** A QR holds ~3 KiB; one artifact
is 60–200 KiB; a project is megabytes. The data path is separate:

1. **Pairing (QR):** the desktop generates a one-time secret (≥ 128 bits
   random) and shows a QR. Preferred carrier: a URL whose **fragment** holds the
   secret (`https://app/#pair=…`) — fragments never reach any server. A short
   human-typed code is the fallback.
2. **Bundle:** the desktop encrypts an export (the project snapshot, already
   exportable via `replaceAll`) with AES-GCM; the key is derived from the
   pairing secret (HKDF). This is the one place user *data* is ciphertext
   before it leaves the device.
3. **Mailbox (VPS):** ciphertext goes to a short-TTL server slot (minutes,
   size-capped, rate-limited, one-shot). The server sees opaque bytes and a
   random id. It cannot decrypt — no key, no derivation material (D4).
4. **Pickup (phone):** the phone reads the QR (it already shares the secret),
   pulls the ciphertext, decrypts locally into its IndexedDB. Done.

Direct device-to-device (WebRTC) could skip the mailbox later; the mailbox is
the simple version David signed off on ("if it simplifies things").

**Non-secret content transit stays dumb** (D6): ordinary chat/import flows do
not get wrapped in this machinery; in D1 they don't transit the VPS at all.

**Mobile shell:** the same static app, same IndexedDB stores, installed as a
PWA. The pairing path is the only mobile-specific work.

---

## 6. Publish & risk model (D5)

- **Target:** anonymous public use is acceptable **iff it costs David nothing**
  — no server-side keys, no per-user compute, no storage bill, no legal/admin
  trouble. D1 satisfies this by construction: users spend *their* keys against
  *their* providers.
- **The VPS becomes free to run:** static files + a tiny one-shot mailbox.
  There is nothing to abuse that costs money. The mailbox gets rate limits and
  TTLs purely to stop it becoming a file drop.
- **Friend-with-shared-key:** outside the app. David pastes a key into a
  friend's device himself if he wants; the app just has a key field. No sharing
  features, no revocation flows, no accounts. Per-friend risk stays a human
  decision.
- **No user data in backend, ever** (D6/D5): nothing to leak, nothing to
  GDPR, nothing to back up.

---

## 7. Phased plan

Each phase is independently shippable and leaves the app working.

### Phase 0 — honest model config (still server-proxy, still `GEMINI_API_KEY`)
1. Add the missing Gemini entries to `server/lib/models.ts` (3.5-flash-lite,
   3.8-flash / 3.8-flash-lite, embedding/TTS models) with quota/latency
   character fields so the picker can show "20/day free tier" etc.
2. Capability slots in config + the popup UI (§3.1), wired through existing
   endpoints (server routes accept a per-slot model id; allowlist grows).
3. **Kill the silent behaviours**: `resolveModelId` fallback surfaces;
   chat watchdog failover becomes a visible downgrade banner or is removed.
4. Tests: config round-trip (pattern: `searchConfig.test.ts`), failover
   visibility, catalog fetch with fallback.

### Phase 1 — BYOK + provider adapters (D1 lands)
1. Key fields in the popup (Tier 1 storage, §4.2), Gemini + OpenRouter keys.
2. `src/gateway/providers/{gemini,openrouter,types}.ts`; flip `gateway/api.ts`
   call paths browser→provider. Stream protocol keeps owning SSE parsing.
3. Live model catalogs (Gemini `ListModels`, OpenRouter `/models`).
4. Search index: stamp records with the embed model id; mismatch = stale (§3.4).
5. Server routes shrink toward static-hosting + health (keep unused routes
   until Phase 2 if faster).
6. Tests: adapter request shapes (mocked fetch), embed-model staleness,
   "no key configured" empty states.

### Phase 2 — static shell (server stops touching content)
1. Deploy as static files + health + (later) mailbox. Delete/stop mounting the
   content-bearing routes.
2. CSP headers (§4.2 Tier 2.3).
3. Export scrub test: exports never contain key material.

### Phase 3 — vault + QR pairing + mobile
1. Tier 2 vault (AES-GCM + passphrase, auto-lock).
2. Pairing secret + encrypted bundle + TTL mailbox + phone pickup (§5).
3. PWA install + mobile pass over the composer/library (see
   `MOBILE_UX_SPEC.md`).

### Phase 4 — publish hardening
1. Security checklist (§4) full review against the shipped code.
2. Referrer-locked key setup guide for users ("make your own key, lock it to
   this origin").
3. Mailbox abuse controls + monitoring.

---

## 8. Out of scope (do not build)

- Accounts, auth, per-user anything on the server.
- Server-side storage of user data or keys — permanently (D5/D6).
- Billing/credits/proxying provider calls on David's keys. Ever.
- Key-sharing/revocation features (friend sharing stays human, D5).
- A general plugin/multi-provider framework beyond the two adapters (gemini,
  openrouter). Three of something before generalizing.
- Raw HTML in markdown "for flexibility" (§4.3).
