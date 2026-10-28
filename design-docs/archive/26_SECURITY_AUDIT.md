# 26 — SECURITY AUDIT: the VPS deployment surface

**Question of record (David, 2026-10-26):** "I run the ansible deploy onto my VPS —
what am I exposing myself to? How am I being hacked?"

**Method:** four parallel read-only sweeps (auth/vault, HTTP surface, browser
client, deploy/infra) over the tree at `13e6868`. Every finding carries
file:line evidence and a severity for THIS deployment: single owner, Caddy on
80/443, Node bound 0.0.0.0:3032 behind Caddy, systemd unit, SQLite on disk.

---

## TL;DR — the three ways someone actually gets in

1. **They brute-force `/api/auth/login`.** Public, unthrottled, unlimited
   attempts, each attempt costs the server a ~100ms synchronous scrypt run.
   Single owner account = one password stands between the internet and
   everything. With no rate limit, a patient attacker tries millions of
   passwords; a bored one just CPU-exhausts the box. **HIGH — fix first.**
2. **They steal the session token from the browser.** A 30-day bearer token
   lives in `localStorage` (`markbrain:vpsSession`) and is stealable by ANY
   XSS. The XSS door is one custom markdown renderer — dependency-free,
   escape-first, decent — but it is the *only* barrier in front of 11
   `dangerouslySetInnerHTML` sinks, and everything an attacker wants sits
   behind it: the token, and the vault re-arm key that decrypts all stored
   API keys offline. **HIGH (composite).**
3. **They get the app process and escalate.** If code-exec is achieved in the
   markbrain process (dependency substitution is the standing risk — see F1),
   the blast radius is: the SQLite file (password hashes, encrypted vault,
   ALL artifact content), the webroot at `/srv/markbrain/dist` which is
   **writable by the app user and served unauthenticated to every visitor**
   (poison the JS → XSS every visitor incl. the owner), loopback access to
   Caddy's admin API on 127.0.0.1:2019 (config injection into OTHER sites on
   the same box), and no sudo/root path. **HIGH (the dist one) / MED (Caddy
   admin).**

What is NOT how you get hacked (verified clean): **no SQL injection** (every
query parameterized), **no path traversal** (tts cache keys are sha256 hex, no
user paths reach the filesystem), **no SSRF** (provider endpoints are
hardcoded, model ids catalog-allowlisted), **no prototype pollution** (no deep
merge of user JSON), **no plaintext secrets in git**, **no BYOK key ever
touches the server or the logs**, **no signup path** (owner-only provisioning),
**no unauthenticated SSE**, and cross-user data isolation is solid (user_id
bound in every query, ownership 404-checked).

---

## Findings

### HIGH

**H1. No rate limiting / lockout on the public login — plus scrypt DoS.**
`server/routes/account.ts` login (~:119–136); `verifyPassword` +
`deriveVaultKey` are `scryptSync(N=16384)` (`server/lib/accountVault.ts:87–92,
119–145`), blocking the event loop ~50–100ms per attempt; `express.json`
limit is 10MB on ALL routes (`server/app.ts:34`); server listens 0.0.0.0
(`app.ts:139`). Unlimited password guessing AND a cheap unauthenticated CPU
starvation vector on a 1-core box.
**Fix:** Caddy-level rate limit on `/api/auth/*` (or fail2ban on access log) +
async scrypt (`crypto.scrypt`) or a fixed dummy-verify on miss + body limit
≈100KB on auth routes. Track as TODO.

**H2. 30-day bearer token in localStorage.**
`src/services/workspaceSession.ts:22,84` writes `{token,...}` to
`markbrain:vpsSession`; server TTL 30d (`account.ts:22`), server stores only
sha256(token) (good). The HttpOnly cookie exists but the JS-readable token is
equally valid, so the cookie adds nothing against XSS. CSP blocks script
exfiltration over fetch but `img-src https:` is an open exfil channel
(`server/lib/csp.ts`).
**Fix (layered):** drop the localStorage copy in favor of the HttpOnly cookie
alone (bigger refactor), OR shorten TTL + rotate, AND tighten CSP
(`img-src 'self' data:`) so XSS can't phone home. Track as TODO.

**H3. Webroot writable by the app user.**
`/srv/markbrain/dist` owned by `markbrain` (playbook task 9) while Caddy
serves it unauthenticated to all visitors. Any app-level code exec → static
JS replacement → site-wide XSS → owner session + re-arm key theft. Defense in
depth is one `chown root:root` + read-only rsync away.
**Fix:** deploy dist as root-owned, markbrain never writes it. Track as TODO.

### MEDIUM

**M1. Caddy admin API reachable from the app process.**
`127.0.0.1:2019` accepts config injection from any local process; the
markbrain user has loopback reach. On a shared VPS this pivots into OTHER
sites. **Fix:** `admin off` (or bind to a unix socket) in the Caddyfile.

**M2. Session cookie issued without `Secure`; trust proxy never set.**
`account.ts:106` gates `Secure` on `req.secure`, which is false behind
TLS-terminating Caddy because `app.set('trust proxy')` is absent. Cookie can
be issued/flow without the Secure flag. **Fix:** `app.set('trust proxy', 1)`
+ force `Secure` in production.

**M3. No CSP for exfiltration; markdown renderer is the single XSS barrier.**
`server/lib/csp.ts`: `img-src https:` allows image-beacon exfil;
`connect-src` allows provider egress. 11 `dangerouslySetInnerHTML` sinks all
route through `src/utils/markdown.ts` — escape-first, scheme-whitelisted,
raw-HTML unsupported (good design), but no sanitization library behind it.
**Fix:** tighten img-src; consider DOMPurify as a second barrier; add a
fuzz/property test for the renderer. Track as TODO.

**M4. TTS disk cache: no size cap, no eviction.**
`server/lib/ttsCache.ts:96–104` — every distinct text writes a new `.ogg`
forever → authenticated disk-fill DoS. **Fix:** LRU cap (bytes + count).

**M5. Unbounded job concurrency + unbounded prompts.**
`server/jobs/chatJobRunner.ts:207–217` starts every job immediately (no
per-user cap on concurrent provider streams, accumulated buffers in RAM);
`/api/chat/stream` accepts client `compiledPrompt` verbatim with no length
cap (`src/prompts/prompt.ts:196–198`); summarize joins ALL messages
uncapped. 10MB bodies make it worse. **Fix:** per-user concurrent-job cap +
prompt/message size caps.

**M6. Global artifact-index queue: no cap, no per-user fairness.**
`server/jobs/serverArtifactIndexer.ts:43–58` — one user can starve the
queue (each entry costs LLM + embed calls). **Fix:** queue cap + per-user
round-robin.

**M7. Server logs readable AND clearable by any authenticated user.**
`server/routes/logs.ts:4–20` — `requireAuth` only, while admin routes are
`requireOwner`. Single-user today, but non-owner users are a real feature;
logs are an info-leak surface. **Fix:** `requireOwner`.

**M8. Login timing leaks user existence.**
Unknown email skips scrypt (~1ms) vs ~100ms for a real one
(`account.ts:128–130`). **Fix:** dummy scrypt verify on miss.

### LOW / hardening

- **L1.** `package-lock.json` deleted; VPS runs `npm install
  --legacy-peer-deps` un-pinned (playbook task 7) → non-reproducible prod
  builds + dependency-substitution risk. Generate & commit a prod lockfile
  (or `npm ci` against one); pin at deploy time.
- **L2.** Systemd unit thin: has NoNewPrivileges/PrivateTmp/
  ProtectSystem=strict; missing `RestrictAddressFamilies=AF_UNIX AF_INET
  AF_INET6`, `ProtectHome`, `CapabilityBoundingSet=`, `MemoryDenyWriteExecute`
  (tsx may need it off — test), `SystemCallFilter`. Cheap hardening.
- **L3.** Node listens 0.0.0.0 (works only because firewall/Caddy front it) —
  bind `127.0.0.1` in the env/service instead.
- **L4.** CORS reflects arbitrary Origin (`app.ts:32`). Inert today (no
  credentials header, SameSite=Strict cookie) but sloppy; allowlist or drop.
- **L5.** Sessions table never pruned; expired rows accumulate.
- **L6.** `/api/projects/:id/jobs/send` doesn't check project ownership
  before enqueueing → ghost projects/jobs in the caller's own scope
  (no cross-user leak). Add the ownership check.
- **L7.** Local vault passphrase minimum 4 chars, no client lockout →
  envelope offline-brute-forceable if localStorage is stolen. Raise the floor.
- **L8.** scrypt cost N=16384,r=8 is below current OWASP interactive guidance
  (N≥2^17 or so for 2025). Bump at next password change (store params in the
  hash string when you do).
- **L9.** `src/` synced to prod is unnecessary surface; health endpoint leaks
  `logsCount`; extract route echoes up to 10MB of request content back.
- **L10.** Client-supplied strings (chat-cancel reason, titles) land in the
  server log buffer verbatim — safe as JSON, stored XSS if a future log
  viewer renders HTML. Keep the log panel text-only forever.

### Accepted risks (documented, not fixed by choice)

- **reArmKey = the raw derived vault key**, delivered to the tab at
  login/unlock (`account.ts:135,170`), verifier persisted in the DB until
  manual lock/password change (`accountVault.ts:167–196`), tab-RAM-only
  client-side (never localStorage — `src/data/vaultReArm.ts`). Tab compromise
  ⇒ offline decryption of stored keys. Accepted: equals the threat XSS
  already grants; revisit if CSP hardening lands.
- **Vault strength == password strength** (kdf_salt is stored in the clear by
  design). Accepted and documented in accountVault.ts.
- **Single-user trust model**: the markbrain user can always read/modify its
  own DB; user-admin CLI is SSH-only. Fine.

---

## Blast radius: "app process fully compromised" ⇒

- read/write the SQLite DB (hashes, GCM-encrypted vault — offline-crackable
  only via the owner password, artifacts in plaintext),
- **rewrite the served frontend** (until F-H3 is fixed),
- pivot to Caddy admin 2019 and any other localhost services on the box,
- NO sudo, NO root, NO /etc/markbrain/secrets (root-only 0700), no cloud
  credentials (keys live in the GCM vault; app only ever holds plaintext keys
  of unlocked sessions in RAM).

## Verification (Orion, 2026-10-26) — Vega's no-brainer set `6f389bb`

Independently reviewed line-by-line and re-gated in dev-orion (merged;
tsc clean, 549/549, build + secret guard clean, server boots). Verdict:
**the work is correct and matches the claims.** Specifically checked: limiter
counts failures only and throttles the correct password too (tested); dummy
scrypt verify fires on unknown email; session pruning runs in issueSession;
jobs/send 404s BEFORE body validation; logs are requireOwner on all three
routes; playbook chowns app_dir to root (rsync runs via sudo as root, so no
--chown needed); tsx only needs read — fine; TTS LRU evicts by
last_accessed_at (updated on hit) and runs after every store. The
"deliberately not taken" list is sound: admin off genuinely breaks Caddy's
ExecReload; MemoryDenyWriteExecute genuinely breaks V8 JIT.

Residual nits found during review (all LOW, logged for the next sweep):
- The 64KB cap reads the Content-Length header; chunked requests without the
  header skip the check (express.json 10MB still bounds them).
- `loginFailures` map entries are never evicted — unbounded growth (bytes are
  tiny; a restart clears). A size cap would be tidy.
- Disabled accounts skip verifyPassword without the dummy verify, so the
  "account exists but disabled" timing still differs from unknown-email.

Remaining from the priority list (NOT yet done):
- H2 cookie-only sessions (localStorage token removal) — decision needed.
- L1 prod lockfile — David decision pending (Vega proposal stands).

## Priority order for fixes (status after 6f389bb)

1. ~~H1 rate-limit login~~ DONE (+ 64KB auth body cap).
2. ~~H3 root-owned webroot~~ DONE.
3. M1 Caddy admin off — REJECTED with reason (breaks ExecReload).
4. ~~M2 trust proxy + Secure cookie~~ DONE (L3 bind too).
5. H2 cookie-only sessions — OPEN, decision needed; M3 img-src REJECTED
   (breaks https: images).
6. M4 DONE (LRU); M5/M6 REJECTED (feature caps, single-user).
7. L1 prod lockfile — pending David decision; L5/L6/L7 done; rest as sweep-up.
