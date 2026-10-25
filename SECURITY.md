# SECURITY.md — key setup, threat model, and the Two-Mode boundary

> **Status:** refreshed for the Two-Mode Architecture (design-docs/19–21G,
> 2026-10-25). Firebase/Firestore/Drive/QR-mailbox are gone; the server owns
> accounts + encrypted key storage (Connected mode), the browser owns a
> passphrase vault (Local mode). If a future change touches credentials,
> rendering, or the server's route set, re-walk §4.2/§4.3 and update verdicts.

---

## 1. Bring your own keys — the 3-minute setup

MarkBrain never ships with API keys. You create keys in the provider consoles
and paste them into **Model Settings** (gear icon next to the model picker).
Where they live afterwards depends on the mode you chose at the gate:

- **Local Workspace** — your browser's PBKDF2 + AES-256-GCM passphrase vault;
  never leaves the device; calls go browser → provider direct.
- **Connected VPS Workspace** — encrypted at rest on your server
  (`user_secrets`, AES-256-GCM under a scrypt-derived key held only in server
  RAM while your session is unlocked); calls go server → provider. The browser
  never receives the raw key back (only `{configured, hint: …last4}`).

### Google AI Studio (Gemini)

1. Create a key at https://aistudio.google.com/apikey.
2. **Restrict it** (this is the real wall, not optional):
   - Google Cloud Console → APIs & Services → Credentials → your key
   - Application restrictions: **HTTP referrers**
   - Add your deployment origin (e.g. `https://markbrain.example/*`) and
     `http://localhost:*` for local dev.
   - API restrictions: Generative Language API only.
3. Free tier and paid keys are separate keys — MarkBrain has two slots
   (`Gemini Free`, `Gemini Paid`) so you can flip a lane between them in one
   click. All slots are optional; fill only what you have.
4. Quota reality (free tier): lite models are generous; `3.8-flash` is
   **~20 requests/day** with latency from 1.3s to minutes under load. The
   picker shows this per model. If a "big brain" reply gets downgraded, the
   message says so — nothing swaps silently.

### OpenRouter

1. Create a key at https://openrouter.ai/keys.
2. **Domain-allowlist** it to your deployment origin and set a **spend
   limit** — both are one form on their site.
3. Paste into the `OpenRouter` slot. Slash-shaped model ids (`openai/gpt-5`)
   route to this key automatically; Gemini model ids never do.

### Optional passphrase (the vault)

Keys live in this browser's `localStorage`. Anyone with script access to the
page can read plaintext keys — that is the honest Tier-1 posture. The
**Vault** (Model Settings → Keys) encrypts them at rest with AES-GCM under
your passphrase (PBKDF2, 600k iterations). The passphrase is never stored;
losing it means clearing the keys and pasting new ones.

**Do both layers:** referrer-locked keys *and* the vault. They fail
independently.

---

## 2. What the server sees (and does not)

### The Two-Mode boundary (design-docs/19–21)

**Mode 1 — Local Workspace:** PBKDF2 (600,000 iterations) + AES-256-GCM
passphrase vault in `localStorage`, decrypted strictly in a browser RAM
closure; direct browser-to-provider HTTPS calls; **zero data sent to the
hosting server** (projects stay in this device's IndexedDB; static assets are
served from disk by Caddy without waking the Node process).

**Mode 2 — Connected VPS Workspace:** `scrypt` password verification,
`AES-256-GCM` encryption at rest in the `user_secrets` SQLite table, the
unlocked `vaultKey` held strictly in server RAM during an active session;
every `/api/*` content route rejects unauthenticated requests with **401**;
Owner Account #1 (`id = 1`) cannot be disabled or deleted; the build-time
secret scanner (`scripts/verify-clean-dist.cjs`) fails any `dist/` that
contains key-shaped strings.

| Data | Local mode | Connected mode |
|---|---|---|
| API keys | Browser vault (PBKDF2 600k + AES-GCM), RAM-only after unlock | `user_secrets` ciphertext on the VPS; redacted `{configured, hint}` over the wire |
| Chat text, artifacts | This device's IndexedDB only | SQLite on your VPS; sync + send-and-forget jobs run there |
| Search index (Q&A, vectors) | None — lexical search only, 0 quota | `artifact_index_sections` on the VPS, indexed once per note |
| TTS audio | Browser → provider per listen | Ogg disk cache on the VPS — repeat listens cost 0 quota |
| Model usage | Browser → provider you chose | Server → provider, signed with the session owner's key |
| Unauthenticated `/api/*` | n/a (static + local only) | `401 Authentication required.` |

---

## 3. §4 checklist reviewed against the code (Phase 4)

### 4.2 Tier 1 — key storage

| Rule | Verdict | Evidence |
|---|---|---|
| Keys only in `markbrain:keys:<slot>`, never in snapshots/exports/index | **PASS** | `src/tests/export-scrub.test.ts` — all four serializers + parse round-trip seeded with keys, zero leakage |
| Provider-side key restrictions mandatory | **PASS (doc)** | §1 above; enforced at the provider, cannot be enforced by us |
| Visible warning in the keys UI | **PASS** | ModelSettingsModal keys section copy |
| Keys never logged (not even length) | **PASS** | `rg` over server/ + logger call sites: no key material anywhere in logs (QR mailbox removed in Phase 1) |
| Keys never in URLs | **PASS** | `src/tests/provider-adapters.test.ts` — asserts `x-goog-api-key` header / Bearer header and *no* `?key=` |

### 4.2 Tier 2 — vault

| Rule | Verdict | Evidence |
|---|---|---|
| AES-GCM via WebCrypto, PBKDF2 ≥ 600k | **PASS** | `src/data/localKeyVault.ts` |
| Passphrase never stored | **PASS** | only salt/iv/ciphertext in `markbrain:local:keyVault` — `src/tests/local-vault-and-isolation.test.ts` asserts the raw key never appears in localStorage |
| RAM-only lifetime | **PASS** | tab close/refresh zeroes slots + CryptoKey; `lockLocalVault()` keeps the envelope, wipes RAM (same test file) |
| Wrong passphrase undecryptable | **PASS** | `unlockLocalVault(wrong)` returns false, RAM untouched (same test file) |
| Locked vault degrades honestly | **PASS** | `resolveLaneKey` returns null while locked — `isLocalVaultLockedError()` prompts for the passphrase |

### 4.3 Markdown/XSS contract

| Rule | Verdict | Evidence |
|---|---|---|
| Escape-first rendering, `dangerouslySetInnerHTML` only via `renderMarkdown` | **PASS** | `src/utils/markdown.ts` + `src/tests/markdown.test.ts` |
| URL scheme whitelist `https?|mailto|tel` | **PASS** | `sanitizeUrl` |
| Raw HTML deliberately unsupported | **PASS** | renderer docs + tests |
| CSP defense-in-depth | **PASS** | `src/tests/shell-mode.test.ts` — prod `script-src 'self'`, verified live on a running server |

### 4.4 Universal

| Rule | Verdict | Evidence |
|---|---|---|
| Unauthenticated `/api/*` fails closed with 401 | **PASS** | `src/tests/server-auth-and-vault.test.ts` — chat/settings/admin all 401 without a session; owner #1 immutable |
| Fail closed on 401/403 | **PASS** | adapters return provider errors verbatim as `{error}`; no silent fallback |
| Least privilege per key | **PASS (doc)** | §1 |
| Single key-entry surface | **PASS** | ModelSettingsModal only |

**Residual risks (accepted, documented):**
- XSS → vault passphrase prompt may be spoofed by the same XSS that reads
  plaintext keys in Tier 1. The vault raises the bar; CSP + escape-first
  rendering are the real defense. No further action without a CSP report-uri
  pipeline (out of scope).
- Connected-mode sessions last 30 days in an HttpOnly; SameSite=Strict
  cookie. A stolen cookie is a stolen session until the user logs out or the
  owner disables the account (which deletes every session row immediately).
  Accepted: standard bearer-session risk, mitigated by HTTPS + owner admin.

---

## 4. Operating a public instance (Connected VPS)

Deploy with `deploy/ansible/playbook.yml` (see INSTALL.md §5). The laws:

1. **No `GEMINI_API_KEY` on the box.** Every AI call resolves the
   authenticated user's own vault key per request (`resolveServerLaneKey`);
   a locked vault answers `428 VAULT_LOCKED`, never a fallback key.
2. **Owner Account #1 is immutable** (`id = 1` cannot be disabled — enforced
   in `setUserEnabled`, the admin route, and `npm run user -- disable`).
   Create friend accounts with `npm run user -- create` or the Users tab.
3. **TLS at Caddy** — sessions, keys, and content all deserve HTTPS. The
   Caddyfile proxies only `/api/*` to the daemon; static assets are served
   from disk so Local-mode visitors never wake Node.
4. **Secrets stay out of git:** `/etc/markbrain/markbrain.env` is 0640
   root:markbrain, `deploy/ansible/inventory.ini` is gitignored, and
   `npm run build` fails if a key-shaped string reaches `dist/`.
5. **Runtime data** (`/var/lib/markbrain/`: SQLite + TTS Ogg cache) is the
   only stateful piece — back that directory up; it is encrypted-at-rest for
   key material (`user_secrets`) and plain for your own notes, as SQLite is.
