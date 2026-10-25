# SECURITY.md — key setup, threat model, and the Phase 4 review

> **Status:** Phase 4 of `design-docs/16` — publish hardening. This is the
> user-facing setup guide AND the §4 checklist reviewed against the code
> **as shipped** (commit `1cb72cc`, 2026-10-25). If a future change touches
> credentials, rendering, or the server's route set, re-walk §4.2/§4.3
> below and update the verdicts.

---

## 1. Bring your own keys — the 3-minute setup

MarkBrain never ships with API keys and never stores yours on a server. You
create keys in the provider consoles and paste them into
**Model Settings** (gear icon next to the model picker).

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

| Data | Server sees it? | Where it lives |
|---|---|---|
| API keys | **Never** (browser → provider direct) | Your browser (vault-encrypted if enabled) |
| Chat text, artifacts | **Never** in shell mode; in RAM only in proxy mode (dev) | IndexedDB on your device |
| Search index (Q&A, vectors) | **Never** | `markbrain-search-index` IndexedDB |
| Pairing bundle (Send to phone) | **Ciphertext only**, 10 min TTL, one-shot | RAM on the server, unreadable |
| Model usage (chat/extract/…) | Your browser → the provider you chose | Provider |

The public deployment runs in **static-shell mode**: the content routes do
not even mount (`server/lib/mode.ts`). Production fails safe — a stray
`GEMINI_API_KEY` on the box does *not* open a proxy; `MARKBRAIN_PROXY=1` is
explicit opt-in.

---

## 3. §4 checklist reviewed against the code (Phase 4)

### 4.2 Tier 1 — key storage

| Rule | Verdict | Evidence |
|---|---|---|
| Keys only in `markbrain:keys:<slot>`, never in snapshots/exports/index | **PASS** | `src/tests/export-scrub.test.ts` — all four serializers + parse round-trip seeded with keys, zero leakage |
| Provider-side key restrictions mandatory | **PASS (doc)** | §1 above; enforced at the provider, cannot be enforced by us |
| Visible warning in the keys UI | **PASS** | ModelSettingsModal keys section copy |
| Keys never logged (not even length) | **PASS** | `rg` over server/ + logger call sites: no key material; mailbox logs sizes only |
| Keys never in URLs | **PASS** | `src/tests/provider-adapters.test.ts` — asserts `x-goog-api-key` header / Bearer header and *no* `?key=` |

### 4.2 Tier 2 — vault

| Rule | Verdict | Evidence |
|---|---|---|
| AES-GCM via WebCrypto, PBKDF2 ≥ 600k | **PASS** | `src/data/keyVault.ts` |
| Passphrase never stored | **PASS** | only salt/iv/ciphertext on disk (`key-vault.test.ts` asserts plaintext absence) |
| Auto-lock wipes memory | **PASS** | 15-min idle timer, `lockVault()` clears map + derived key |
| Wrong passphrase undecryptable | **PASS** | `key-vault.test.ts` — wrong pass returns false, tampered ciphertext null |
| Refuse without WebCrypto (no fake crypto) | **PASS** | `vaultSupported()` gates enable; enable throws |
| Locked vault degrades honestly | **PASS** | `getKeySlot` reads absent when locked; lanes fall to proxy/empty state |

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
| Keys device-local, never in QR plaintext | **PASS** | `src/tests/pairing.test.ts` — ciphertext carries no plaintext, code in URL fragment |
| Fail closed on 401/403 | **PASS** | adapters return provider errors verbatim as `{error}`; no silent fallback |
| Least privilege per key | **PASS (doc)** | §1 |
| Single key-entry surface | **PASS** | ModelSettingsModal only |

**Residual risks (accepted, documented):**
- XSS → vault passphrase prompt may be spoofed by the same XSS that reads
  plaintext keys in Tier 1. The vault raises the bar; CSP + escape-first
  rendering are the real defense. No further action without a CSP report-uri
  pipeline (out of scope).
- Pairing secret lives in browser history *until pickup clears it*. A local
  attacker with history access during the 10-min window can race the pickup.
  Accepted: same physical-access class as reading localStorage.

---

## 4. Operating a public instance (the VPS shell)

1. Build (`npm run build`) and serve `dist/` + `server/` in
   **shell mode** (the production default — see `server/lib/mode.ts`).
2. Do **not** set `GEMINI_API_KEY` on the box. Do **not** set
   `MARKBRAIN_PROXY=1`. The process then holds no keys and no user content.
3. TLS at the reverse proxy (keys and content deserve HTTPS even though the
   server can't read them).
4. The mailbox is the only stateful piece: rate-limited (20 writes/IP/10
   min), size-capped (2 MiB), TTL 10 min, one-shot. Monitor
   `/api/server-logs` for `MAILBOX` lines if you care.
5. Anyone using the shell spends **their** keys against **their** providers.
   That is the whole cost model (design-docs/16 D5): it costs you nothing.
