# 05 — Security & Operations

> **Status: CURRENT (2026-10-28).** This doc is the consolidated security and
> operations reference for the `dev-vega` build. **THE CODE WINS** over
> historical docs (including the archived 21B/24/25/26/27 series): where an
> archived doc disagrees with `src/` or `server/`, the code is the truth.
> Supersedes the stale bun/Firebase verification instructions from earlier
> drafts — §3 below is the only valid gate sequence.

---

## §1. Key Slots, Account-Wide Tier Law & Vault Architecture

### 1.1 The four key slots

Provider keys live in four fixed slots (`src/data/keySlots.ts:42`):

```ts
export type KeySlotId = 'gemini-free' | 'gemini-paid' | 'openrouter-free' | 'openrouter-paid';
```

The slot set is mirrored end-to-end: `KEY_SLOTS`/`KEY_SLOT_INFO` render the
Keys tabs in `ModelSettingsModal`, the server `AccountKeysPayload` and
`redactKeys` emit exactly four slots, and `server/routes/account.ts`
`VALID_SLOTS = 4`. Keys are **per-user, vault-only** — there is no env-key
fallback for provider calls anywhere in the codebase (a banned shortcut by
design). A legacy payload carrying a single `openrouter` slot is still read
as `openrouter-free` on the read path; the write path only uses the four new
ids.

### 1.2 Curated model catalog

The catalog is curated and allowlisted in `server/lib/models.ts`:

- **Gemini** text models: `gemini-3.5-flash-lite` (free burn-lane),
  `gemini-3.8-flash`, `gemini-4-argon` (paid tier), plus
  `gemini-embedding-001` for embed and one TTS model for tts.
- **OpenRouter**: `nvidia/nemotron-3.5-lightning:free` (free, ~1M context,
  the agent's burn-lane model), `z-ai/glm-5.3-flash` and
  `xiaomi/mimo-v2.6-flash` (cheap paid, David-curated). The OpenRouter entries
  serve the GENERATE lanes only (chat, extract, summarize, qaGen, title);
  embed/tts stay Gemini-only and `requireModelId` caps reject anything else.
  Provider availability is decided by `isProviderAvailable('openrouter')` →
  true; model ids are catalog-allowlisted (no free-form model ids reach a
  provider).

### 1.3 Account-Wide Tier Law

The account carries a single tier setting, `user_settings.chat_tier ∈
{free, paid}` (server default `free`, `server/lib/accountVault.ts:282–287`).
**The law: this one setting routes EVERY capability lane** — chat, extract,
summarize, title, qaGen, embed, tts — not just chat.

- Server: `resolveServerLaneKey(userId, capability, modelId)` reads
  `chat_tier` from `user_settings`, then selects the matching tier key first
  with fallback: PAID → `*-paid` first (fallback `*-free`, then legacy
  `openrouter`), FREE → `*-free` first (fallback `*-paid`/legacy). OpenRouter
  models are recognized by the `/` in the model id; everything else routes to
  Gemini slots. Explicit per-request lane binding still wins over the tier
  default when present.
- Client: `resolveLaneKey` mirrors the same tier order from
  `getVaultChatTier()` for `provider === 'openrouter'`, matching the Gemini
  ordering.
- The call sites funnel through `accountVault.aiForRequest` /
  `aiClientForUser` (`resolveServerLaneKey(user.id, capability, modelId)` at
  `accountVault.ts:344`, embed at `:358`), so no lane can accidentally grab
  the wrong tier's key.

### 1.4 Local vault (`src/data/localKeyVault.ts`)

Browser-side vault: the user's password derives a key with **PBKDF2
(600,000 iterations)**, and the key payload is stored as an **AES-GCM-256
envelope in localStorage** (ciphertext + salt + IV only — never the key).
Unlocked keys exist as **plaintext only in module-private RAM** (not
exported, not attached to any window global). Locking wipes the RAM copy;
refreshing the tab requires a password unlock again. Local mode has its own
vault lock state surfaced by the same lock UX as VPS mode (§1.6).

### 1.5 VPS vault (`server/lib/accountVault.ts`)

Server-side, per-account:

- **Password storage:** `scrypt` password hash in `users` (verify via
  constant-time compare).
- **Secrets at rest:** all BYOK provider keys are AES-256-GCM encrypted into
  `user_secrets` ciphertext inside the gitignored SQLite file
  (`data/markbrain.sqlite`). No plaintext key ever lands in the DB, logs, or
  git.
- **Vault key lifetime:** the derived 32-byte vault key lives **only in a
  server RAM Map — never on disk**. A VPS restart wipes it and every vault
  request fails with **428 VAULT_LOCKED** until the user unlocks again.
- **No proxy plaintext:** the server decrypts per-request to make the provider
  call and holds nothing long-lived; there is no server-side plaintext key
  store.

### 1.6 AUTO RE-ARM (restart-lock recovery) and MANUAL LOCK WINS

Restart-locks are reactive and confusing — the user discovers them by a failed
send. Archive 25 fixed this without weakening the manual-lock law:

- **Unlock payload:** `POST /api/auth/unlock` additionally returns
  `rearmKey` — the derived 32-byte vault key, hex. Transit is TLS-protected,
  the same trust level as the password POST that precedes it.
- **Client holds it in TAB RAM only** (`src/data/vaultReArm.ts`) — never
  localStorage, never IndexedDB. It dies with the tab: refresh → password
  unlock again.
- **Server verifier:** `users.vault_rearm_hash = SHA-256(rearmKey)`
  (`schemaSpec.ts`; write helper `REARM_HASH_SQL` at
  `accountVault.ts:164`). It is a verifier, not the key — brute-forcing it is
  the same attack surface the stored password hash already offers; nothing new
  is exposed.
- **Silent re-arm:** `POST /api/auth/unlock-key { rearmKey }` (requireAuth)
  validates the 64-hex format (`accountVault.ts:181–185`) and re-arms the
  vault with no password. On the send path, when a draft fails with
  VAULT_LOCKED and a rearm key is held, the client calls `unlock-key` once
  and retries automatically — the user never sees the failure for a
  restart-lock. One call per occurrence; never polled.
- **MANUAL LOCK WINS:** `lockVault(userId, { manual: true })` — logout of the
  last session, admin disable, password change — **clears
  `vault_rearm_hash`** (`accountVault.ts:156`), making re-arm impossible. A
  restart touches only RAM, so the hash survives and the tab silently re-arms.
  The absence of a verifier IS the epoch: no counter needed.
- **Proactive UI:** one lock signal, `src/application/vaultLockBus.ts`
  (`isVaultLocked`/`setVaultLocked`/`subscribe`). VPS state is refreshed by
  piggybacking on the existing 10s delta poll (no new poller, no new
  endpoint); local mode computes from `localKeyVault` state. When locked, the
  composer's send button renders as an **amber padlock**; clicking it (or
  pressing send) opens the inline password row above the composer instead of
  failing the draft.

**Accepted deltas (deliberate):** an XSS in a tab holding a rearm key can
re-arm the vault — but a live session token already grants full proxy access
while unlocked, so the marginal exposure is only the locked window. Holding
the password in the browser was rejected (worse than holding the derived
key); client-side scrypt from an exposed salt was rejected (same end state,
more code); epoch counters were rejected (verifier absence suffices).

---

## §2. Security Posture & Audit Status

Source of record: archive/26_SECURITY_AUDIT.md (four read-only sweeps over
the VPS surface: auth/vault, HTTP surface, browser client, deploy/infra),
plus the fix pass recorded in archive/27 §7. **Current posture: hardened &
verified.**

### 2.1 Verified clean / fixed

- **No SQL injection:** every query is parameterized throughout the server.
- **Secret scanner in the build:** `scripts/verify-clean-dist.cjs` runs inside
  `npm run build` — the shipped `dist/` is scanned before it can be served,
  so no plaintext secret can slip into the webroot.
- **Login brute-force + DoS fixed (26-H1):** fixed-window **login rate
  limiting** in `server/routes/account.ts` (10 failures per IP per 5 minutes,
  with cleanup), plus a **dummy-scrypt timing equalization** on miss so failed
  attempts cost the same ~scrypt work as successes — no cheap unauthenticated
  CPU-starvation or user-enumeration timing signal.
- **Sessions:** sliding **30-day sessions**; long-lived but revocable
  (logout-of-last-session, admin disable).
- **Webroot hardening:** `/srv/markbrain/dist` is **root-owned** — the app
  process cannot rewrite the served frontend (poison-the-JS vector closed).
- **Network posture:** Node binds **127.0.0.1** behind Caddy (80/443 TLS);
  Caddy admin API disabled-adjacent per the 27 fix pass.
- **XSS barrier:** the dependency-free markdown renderer is
  **escape-first** (`markdown.ts`) and is the single gate in front of the
  `dangerouslySetInnerHTML` sinks — no raw HTML path bypasses it.
- **No plaintext secrets in git:** keys are runtime-only/vault-only (gift keys
  never committed — the 24 §0 hygiene law).
- **Cross-user isolation:** `user_id` bound in every query, ownership
  404-checked; no unauthenticated SSE; no signup path (owner-only
  provisioning); no path traversal (tts cache keys are sha256 hex — ffmpeg
  remuxes PCM to mono 22,050 Hz Ogg Vorbis `-qscale:a -1`, no user paths
  reach the filesystem); no SSRF (provider endpoints hardcoded); no
  prototype pollution (no deep merge of user JSON).

### 2.2 OPEN drawer items (archive/27 §7)

- **H2 (the one HIGH still open):** HttpOnly cookie-only sessions vs the
  current `localStorage` Bearer token copy. A 30-day bearer token in
  localStorage is stealable by any XSS; moving to HttpOnly cookies removes
  the JS-readable credential. Decision pending.
- **L1:** production lockfile — `package-lock.prod.json` + `npm ci` in
  deploy, so dependency substitution cannot drift on the VPS.
- **LOW nits (logged for the next sweep):** Content-Length bypass on body
  limits, the unbounded `loginFailures` map growth, and a disabled-account
  timing difference on login.

### 2.3 Accepted risks (documented, not fixed by choice)

- `rearmKey` held in tab RAM (§1.6 — marginal exposure limited to the locked
  window).
- **Vault strength == password strength:** the envelope is only as strong as
  the human-chosen password that unlocks it.
- **Single-operator trust:** one owner account; the threat model assumes the
  operator is not the attacker.

---

## §3. Verification Gates & Evidence Pack

**NORMATIVE. This section REPLACES all stale bun/Firebase verification
instructions from earlier drafts.** The gates, in order:

### Gate 1 — Types
```
npx tsc --noEmit
```

### Gate 2 — Unit/integration tests
```
npx vitest run
```
Node environment, `vi.stubGlobal` for fetch-shaped stubs. **ZERO real
provider/network calls — everything is mocked.** Scale as of **2026-10-28:
~77 test files / ~679 tests**, all green on `dev-vega`.

### Gate 3 — Build (with secret scan)
```
npm run build
```
Runs `vite build` **+ `verify-clean-dist.cjs`** (the dist secret scanner,
§2.1) **+ `build-sw.mjs`** (service worker). A build is not green until the
scan passes.

### Gate 4 — Live evidence pack
```
PORT=13032 npx tsx server.ts
PORT=13032 MARKBRAIN_EVIDENCE_DIR=/tmp/ev node scripts/evidence.cjs
```
~2 minutes; exercises **20 journeys + a 4-viewport geometry audit
(350 / 390 / 768 / 1440)** and writes the evidence pack to
`MARKBRAIN_EVIDENCE_DIR`.

**Playwright law:** Playwright lives in the container image via `NODE_PATH`.
**NEVER** `npm i --prefix /tmp/pw` (or any ad-hoc local install) — a fresh
Chromium download can OOM the box.

**Capture law:** capture runs **strictly serial, one Chromium** (OOM law —
never parallel browsers).

**Targeted runs:** `MARKBRAIN_JOURNEYS=16,19 MARKBRAIN_SKIP_AUDIT=1` —
journey selection is **prefix match**, so `16` matches `16` and
`16-something`; skipping the geometry audit keeps a targeted run fast.

**Known-failure flag:** `?slowsave=1` on the page URL forces the **red
critical-error banner**, for asserting the banner UX deterministically.

**Two-speed testing discipline:**
- **Fast lane:** `npx tsc --noEmit` + `npx vitest run` — the loop you run
  constantly while coding (seconds-to-minutes, fully mocked).
- **Real lane:** `npm run test:e2e` (vitest e2e config) against the real
  server — run before handing off, after the fast lane is green.

---

## §4. Deployment & Operator CLI

Full detail lives in **`deploy/RUNBOOK.md`** and
**`deploy/ansible/playbook.yml`**; the pipeline shape:

1. **Local build + secret guard** (`npm run build`, Gate 3 — includes the
   dist scanner).
2. **rsync** the artifact to the VPS.
3. **`npm ci`** on the box (L1 lockfile discipline, §2.2).
4. **Owner Account #1 seeding** via `scripts/user-admin.ts` from the
   playbook with **`no_log`** (credentials never echo into the ansible log).
5. **Hardened systemd unit** for the Node process.
6. **Caddy** in front (80/443 TLS; Node bound to 127.0.0.1).
7. **Health check** to confirm the deploy took.

### Operator CLI

- **User administration:** `npm run user -- create|list|enable|disable|passwd`
  (`scripts/user-admin.ts`). **Owner Account #1 cannot be disabled or
  deleted** — enforced in the CLI, so the box can never lock its own operator
  out.
- **Plaintext backup / restore:**
  `npm run export-plaintext` / `npm run import-plaintext`
  (`scripts/plaintext-cli.ts`). These are **local-only CLI tools over the
  SQLite file — there is NO HTTP endpoint** for plaintext export, so vault
  contents cannot leave the box over the network.
