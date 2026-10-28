# 24 — OpenRouter key lanes (free/paid) + curated models

> **Status: IMPLEMENTED (2026-10-25).** Gate: lint + **511 tests / 55 files** +
> build (incl. verify-clean-dist) all green. Real E2E (§6) passed on the dev
> server (13032): friend account → gift key into `openrouter-free` (redacted
> hint only) → `POST /jobs/send` on `nvidia/nemotron-3.5-lightning:free` →
> SSE chunks → complete at ~1.2s → pair committed in SQLite (user + assistant
> turns, job row deleted, FIFO clear). The cheap-paid repeat (§6.4) is left
> for David on request. Facade lives in `server/providers/openrouter.ts` +
> `server/providers/lane.ts`; branching in `accountVault.aiForRequest` /
> `aiClientForUser`; embed/tts stay Gemini-only via `geminiAiForRequest`.
> **Prereq knowledge:** design-docs/19–23, esp. 23 §2 (draft owns send) and
> the tier law amended into 21B §3.4.

## 0. Hygiene law (David 2026-10-25)
Two gift keys exist for agent verification (AI Studio free-tier + OpenRouter
free-budget). **They are RUNTIME-ONLY: never in git, tests, docs, or logs that
get committed.** Pass them via process env at runtime or the vault API
(`PUT /api/account/keys` — ciphertext lands in the gitignored
`data/markbrain.sqlite`). All provider calls in tests are MOCKED. Real calls
only in manual E2E probes (small prompts).

## 1. Key slots: split `openrouter` → free/paid (mirror Gemini)
`KeySlotId`: `'gemini-free' | 'gemini-paid' | 'openrouter-free' | 'openrouter-paid'`
- `src/data/keySlots.ts`: KEY_SLOTS/KEY_SLOT_INFO (labels: OpenRouter Free /
  OpenRouter Paid; hints mirror the Gemini slots).
- `server/lib/accountVault.ts`: `AccountKeysPayload` gains the two slots;
  `redactKeys` emits all four. **Compat:** a legacy payload carrying
  `openrouter` reads as `openrouter-free` (read-path fallback, write path uses
  new ids).
- `server/routes/account.ts`: VALID_SLOTS = 4.
- Local vault (`localKeyVault`) types follow `KeySlotId` — no logic change.
- `ModelSettingsModal` Keys tabs render from `KEY_SLOTS` — verify rows +
  placeholder (`sk-or-…` for both) automatically update.

## 2. Tier law (same as 21B §3.4 amendment)
- `server resolveServerLaneKey`: OpenRouter branch (model id contains `/`):
  PAID tier → `openrouter-paid` (fallback `openrouter-free`, then legacy
  `openrouter`); FREE tier → `openrouter-free` (fallback paid/legacy).
- Client `resolveLaneKey` auto-order: for `provider === 'openrouter'` mirror
  the Gemini tier order (`getVaultChatTier()`).
- Explicit lane binding still wins.

## 3. Catalog: 3 curated models (server/lib/models.ts)
`ModelProvider` gains `'openrouter'`; `isProviderAvailable('openrouter') → true`
(keys are per-user now). All three serve `GENERATE_LANES` (chat, extract,
summarize, qaGen, title) — NOT embed/tts (requireModelId caps reject):

| id | tier | note |
|---|---|---|
| `nvidia/nemotron-3.5-lightning:free` | free | super fast, 1M context — the agent's burn-lane model |
| `z-ai/glm-5.3-flash` | paid (cheap) | David-curated |
| `xiaomi/mimo-v2.6-flash` | paid (cheap) | David-curated |

Entries need display metadata (name/badge/powerRating/latency/contextWindow/
description/costMultiplier 0 for free, small for the cheap pair).

## 4. Server execution: OpenRouter via a shape-compatible facade
`server/providers/openrouter.ts` (new): OpenAI-compatible
`/chat/completions` (`https://openrouter.ai/api/v1/chat/completions`,
`Authorization: Bearer`), stream=true SSE parsing → async iterable of
`{text}`, plus non-stream generate → `{text}`; abort via AbortController.
Then a tiny facade so routes/job-runner barely change:
- `aiForRequest(req, capability, modelId)` returns an object with the SAME
  call shape as `GoogleGenAI` (`models.generateContent` / `generateContentStream`
  yielding `{text}`) backed by either Gemini or OpenRouter. `embedContent` and
  TTS speechConfig stay Gemini-only (the catalog already caps those lanes).
- `chatJobRunner` consumes `{text}` chunks — unchanged.
- Banned shortcut: no env keys anywhere (vault keys only, per-request).

## 5. Tests (update the pinned ones, mock everything)
- `key-slots.test.ts`: "exactly the three slots" → four; tier order cases for
  openrouter ids (mirror tier-key-routing).
- `tier-key-routing.test.ts`: openrouter PAID/FREE/fallback + legacy
  `openrouter` payload compat.
- `server-auth-and-vault.test.ts`: redaction shape = 4 slots.
- `errors-are-final.test.ts`: text-lane catalog now 3 Gemini + 3 OpenRouter.
- `export-scrub.test.ts`: uses `openrouter-free` slot id.
- New: server `openrouter` provider SSE parsing (fetch-stubbed), facade
  branching (`/`-model → openrouter, else gemini), legacy-slot compat.

## 6. Verification plan (real E2E, no mocks)
1. Gate: `npm run lint && npm test && npm run build`.
2. Friend account on the dev server → `PUT /api/account/keys` with the gift
   OpenRouter key into `openrouter-free`.
3. `POST /api/projects/:id/jobs/send` with model
   `nvidia/nemotron-3.5-lightning:free`, tiny ask → watch SSE → complete →
   pair committed in SQLite with a real reply (same harness shape as
   /tmp/e2e-chat.cjs pattern).
4. Repeat one cheap-paid call (`z-ai/glm-5.3-flash`) only if David wants.

## 7. Runtime state snapshot (2026-10-25, when 23 closed)
- Branch `dev-vega` @ 37c52ec+a2a719c (+ tier fix 2077948, docs 13ba453,
  reconcile law commit after a2a719c). Gate green: **489 tests / 54 files**.
- Dev server: kill by pid from `ss -ltnp | grep 13032` (never `pkill -f` with a
  pattern that matches its own shell), start:
  `MARKBRAIN_OWNER_EMAIL=… MARKBRAIN_OWNER_PASSWORD=… PORT=13032 nohup npm run dev > /tmp/markbrain-dev.log 2>&1 &`
- Local DB `data/markbrain.sqlite` (gitignored): owner = David's email +
  `dev-login-2026`; his live thread holds 1 failed (VAULT_LOCKED) + 3 queued
  job rows — after reconcile they appear as drafts with exits.
- Tool quirks: `edit` tool is flaky (prefer python inline patches); Node 22
  runs `-e` with TS eval — use /tmp/*.cjs files for sqlite probes.
