# 19 — North Star Blueprint: The Two-Mode Architecture (Public Local Workspace + Personal VPS Service)

> **Status:** Adopted Architecture & North Star Law.
> **Date:** 2026-10-25.
> **Decided by:** David & Vega in the architectural deep dive.
> **Supersedes:** All Firebase / Firestore / Google Cloud assumptions across earlier docs (`01`, `08`, `15`, `16`), the browser-side embedding daemon for unauthenticated users, the QR mailbox pairing relay (`server/routes/mailbox.ts`, `src/gateway/pairing.ts`), and the plaintext `localStorage` key storage model.

---

## 1. The Soul of This Decision: What Are We Actually Optimizing For?

Software rots when it tries to optimize for five contradictory masters at once. Before today, MarkBrain was caught in an impossible knot:

1. **It is David's personal daily thinking tool** — used across a desktop PC and an Android phone on the go, where convenience, instant device sync, "send a message and lock the phone screen in your pocket" (*Send-and-Forget*), shared API keys across devices, durable backups, and background semantic indexing matter enormously.
2. **It is also a public, open-source (Apache-2) project hosted live at `https://markbrain.unhaunter.com`** — so friends can check it out, strangers can try the online demo, and developers can clone and run it locally with zero friction.
3. **David refuses to be a commercial SaaS operator or a charity ATM for the internet:**
   - **Zero money handling, zero surprise bills:** The public site must be 100% free as in beer, and no stranger may ever burn a cent of David's API quota or trigger metered cloud charges.
   - **Zero legal / GDPR / PII / secret liability for strangers:** David does not want other people's notes, chats, PII, or API keys stored on his server disk. Dealing with strangers' data retention and privacy laws is a trap.
   - **Zero Google Cloud / Firebase lock-in and menu labyrinths:** Firebase's 20,000 free writes/day cliff already broke day-to-day usage on a single user, and Google Cloud's serverless suite has no hard billing firewall against runaway loops or attackers. A flat-rate VPS that simply "goes slower when overloaded and never bills extra" is a physics firewall for the wallet.

### The Core Realization: Stop Treating "David" and "Random Stranger on the Internet" as the Same User

The knot untangles the instant we accept defeat on **one** variable we never actually cared about:
> **We do NOT provide free cloud sync, mobile background execution, or server-side indexing to anonymous strangers on the public website.** Seamlessly syncing a stranger's phone and laptop for free is the job of a VC-funded commercial SaaS, not a personal open-source project.

Once we draw that line, MarkBrain cleanly separates into **Two Isolated Modes** served from the exact same deployment on `https://markbrain.unhaunter.com`:

1. **Mode 1 — Local Workspace (The Public / Desktop-First Static App):**
   - For strangers trying the live site, and for anyone running without a backend account.
   - **Assume desktop browser.** (Phone works, but has no background send-and-forget or cross-device sync without a VPS account — end of story.)
   - **Naively, brutally simple.** 100% of data lives in browser IndexedDB (`markbrain-local`). Backup is 1-click Export / Import JSON.
   - **Zero bytes touch the VPS backend.** The server refuses all `/api/*` data and LLM routes without a valid VPS account session (`401 Unauthorized`).
   - **AI calls go straight from the user's browser (`fetch`) to Gemini / OpenRouter** using the user's own API keys.
   - **API keys never sit in plaintext on disk:** if saved across reloads, they are encrypted in `localStorage` with a user passphrase (PBKDF2 + AES-GCM) and unlocked strictly into a JS RAM closure for the active tab session.
   - **Search is fast local lexical/keyword search.** No browser-side background embedding daemon, no 429 indexing storms in the browser.

2. **Mode 2 — Connected VPS Workspace (David + Invited Friends + Self-Hosters):**
   - Activated by signing into an account on the VPS (`email + password`, e.g. `you@example.com` against `markbrain.unhaunter.com/api`).
   - **Zero public registration.** Account #1 (`is_owner = 1`, David) is seeded at install/deploy time and cannot be disabled or deleted. Friends only get an account if David creates one (via CLI or the owner-only Users tab in Settings) and can be enabled/disabled at any time.
   - **Strict data isolation:** Connected mode uses a completely separate local IndexedDB cache namespace (`markbrain-vps:<host>:<email>`) so local demo data and VPS account data never mix or cross-contaminate.
   - **Enter config & keys ONCE on PC, use everywhere on Phone:** API keys and model slot choices belong to the VPS account. On the VPS SQLite disk, API keys sit **encrypted at rest** (derived from the user's password) so a cold disk/backup theft exposes zero plaintext keys. While the user has an active login session, the keys are unlocked in VPS RAM — so logging in on the phone immediately has all keys, models, projects, notes, and chats ready with **zero re-typing on a phone keyboard**.
   - **Atomic SQLite persistence (no more monolithic project-blob clobbering):** The VPS stores projects, artifacts, threads, turns (pairs), chapters, and embeddings as atomic rows in SQLite rather than overwriting one giant JSON document.
   - **Send-and-Forget on Mobile:** When logged into the VPS, sending a chat message submits the job to the VPS (`POST /api/jobs/chat`). If the user locks their phone screen 1 second later and puts it in their pocket, the VPS finishes streaming from the LLM, extracts artifacts, titles the thread, auto-summarizes any sealed chapter, and commits the completed pair straight to SQLite. When the phone wakes up, the finished pair is waiting.
   - **VPS-Only Background Semantic Indexing:** When notes/artifacts are created or edited in Connected VPS mode, the **VPS** runs the QA-generation and embedding pipeline in a single controlled server queue and stores the vectors in SQLite. Both PC and phone share one index — cutting embedding quota in half and eliminating browser tab indexing failures.
   - **VPS-Side TTS Audio Re-encoding & Caching:** Read-Aloud TTS requests in Connected mode run on the VPS, get re-encoded via `ffmpeg` to ultra-compact **mono 22kHz Ogg Vorbis (`-qscale:a -1`) / Opus**, cached on disk by content hash, and streamed to the phone in a fraction of the bandwidth without ever burning TTS quota twice for the same text.

---

## 2. The Master Comparison Table

| Dimension | Mode 1: **Local Workspace** (Public Default) | Mode 2: **Connected VPS Workspace** (Owner & Invited Accounts) |
| :--- | :--- | :--- |
| **Target User** | Strangers on `markbrain.unhaunter.com`, casual evaluators, solo desktop users | David (`Account #1`), invited friends with a ticket/account, self-hosters |
| **Target Device** | Desktop browser (mobile works best-effort, no background execution) | Seamless Desktop PC + Android Phone on the go |
| **Data Storage** | Browser IndexedDB (`markbrain-local`) + manual Export/Import file | VPS SQLite (atomic tables) + isolated local IndexedDB mirror (`markbrain-vps:<host>:<email>`) |
| **Server Cost / Risk to David** | **$0.00 forever.** Static files served by Caddy; `/api/*` returns `401` | Flat-rate VPS already owned by David; worst case under load = CPU slows down |
| **GDPR / Stranger PII** | **0 bytes** ever touch David's server | Only David and personal friends he explicitly creates accounts for |
| **Firebase / Google Cloud** | **100% Removed** | **100% Removed** |
| **Where AI Calls Run** | Browser ──HTTPS──▶ Gemini / OpenRouter directly | Client ──HTTPS──▶ VPS (`/api`) ──HTTPS──▶ Gemini / OpenRouter |
| **Send & Lock Phone Screen** | Not supported (browser tab sleep aborts stream into Stopped Draft) | **Supported (Send-and-Forget):** VPS finishes turn, chapters, titles, and commits pair while phone sleeps |
| **Where API Keys Live** | Encrypted in `localStorage` with passphrase (PBKDF2 + AES-GCM); decrypted only in browser RAM closure | Encrypted at rest in VPS SQLite; unlocked in VPS session RAM upon login; **synced automatically across PC & Phone** |
| **Model Slot Settings** | Device-local (`localStorage`) | Synced per-account on VPS (change model on PC → active on Phone) |
| **Search & Embeddings** | Instant local lexical/keyword search only (zero embedding calls) | Full semantic + lexical search; **VPS runs background QA + embedding indexer once** for all devices |
| **Read-Aloud (TTS)** | Direct browser call (if key configured), uncached | **VPS-cached & re-encoded** (`ogg/opus`, 22kHz mono, `q=-1`) for tiny mobile transfers and zero repeat quota |

---

## 3. Core Architectural Decisions & Why We Took Them

### D1. Kill Firebase, Firestore, and Google Drive Integration Completely
- **Decision:** Remove the `firebase` npm package, `src/services/firebase.ts`, `src/services/stores/firestoreStore.ts`, `src/services/googleDriveService.ts`, `firebase-applet-config.json*`, `firestore.rules`, and all `VITE_FIREBASE_*` environment variables.
- **Why:**
  1. Firestore's 20,000 writes/day free tier was exhausted by a single user because whole-snapshot saves rewrote everything on every turn.
  2. Google Cloud / Firebase serverless offerings have no hard spending kill-switch and bury configuration across dozens of console menus.
  3. Shipping a cloud project ID and Firebase API key in the public static bundle exposes David's personal cloud project to strangers.
  4. In the era where we can own a clean 300-line SQLite + Express daemon on a flat-rate VPS deployed via Ansible + Caddy, Firebase adds negative value.

### D2. Kill the Unauthenticated QR / Mailbox Pairing Relay
- **Decision:** Remove `server/routes/mailbox.ts`, `src/gateway/pairing.ts`, and `src/ui/workspace/usePairingTransfer.ts`.
- **Why:** Any unauthenticated endpoint on the VPS that accepts and holds blobs in RAM/disk is an abuse surface for strangers, and David doesn't need QR device pairing when his PC and phone simply log into his VPS account (`you@example.com`). Strangers on Local mode have Export/Import file.

### D3. Strict Workspace Namespace Isolation (`local` vs `vps:<host>:<email>`)
- **Decision:** Local Workspace and Connected VPS Workspace never share an IndexedDB database or `localStorage` state.
  - Local Workspace uses IndexedDB `markbrain-local`.
  - Connected VPS Workspace uses IndexedDB `markbrain-vps:<normalizedHost>:<email>`.
- **Why:** Switching between "Continue Locally" and "Signed in as `you@example.com`" must never merge, overwrite, or leak local scratch projects into the VPS account or vice versa. Signing out of the VPS cleanly returns to the gate without leaving plaintext keys behind.

### D4. Accounts & Authentication: Zero Public Signup, Immutable Owner Account #1
- **Decision:**
  - The VPS has a `users` table in SQLite (`id`, `email`, `password_hash`, `kdf_salt`, `encrypted_vault_key`, `is_owner`, `enabled`, `created_at`).
  - **Account #1 (`id = 1`, `is_owner = 1`)** is created at install/bootstrap time (via CLI or Ansible env vars `MARKBRAIN_OWNER_EMAIL` + `MARKBRAIN_OWNER_PASSWORD`) and **cannot be disabled or deleted**.
  - There is **no public registration endpoint**.
  - The owner (Account #1) can create, enable, disable, or reset passwords for friend accounts via:
    1. A CLI tool on the VPS (`npm run user -- create <email>`, `enable`, `disable`, `passwd`, `list`), and
    2. An **Owner-only "Users" tab** inside the Settings modal when logged in as `is_owner = 1`.
  - Authentication uses `Authorization: Bearer <session_token>` (stored in `localStorage` under the VPS session meta-key) **plus** an optional `HttpOnly; Secure; SameSite=Strict` cookie when served on the same origin (`markbrain.unhaunter.com`). Using Bearer tokens guarantees zero CORS headaches even if someone runs the frontend on a different port or domain during development.

### D5. API Key Security: Zero Plaintext on Cold Disk, Zero Friction on Phone
- **Decision:**
  - **Rule 0:** Plaintext API keys (`AIza...`, `sk-or-...`) **never** touch cold disk — neither in browser `localStorage` nor in the VPS SQLite file.
  - **In Mode 1 (Local Workspace):**
    - To save API keys across reloads, the user sets a local Vault Passphrase once.
    - Browser derives an AES-256-GCM key via WebCrypto `PBKDF2` (600,000 iterations, SHA-256) + random 16-byte salt, and stores `{ salt, iv, ciphertext }` in `localStorage['markbrain:localVault']`.
    - When the user opens the app in Local mode and wants to use AI, they unlock the vault once with their passphrase; decrypted keys live **strictly inside a module-private JS RAM closure** for that tab session. Closing the tab wipes RAM.
  - **In Mode 2 (Connected VPS Workspace):**
    - When the user logs in with `{ email, password }`, the VPS verifies the password (`scrypt` / `argon2`) and derives the user's 32-byte `vaultKey` from `(password, user.kdf_salt)` **in server RAM** for that active session.
    - The user's API keys are stored in the `user_secrets` SQLite table encrypted with `AES-256-GCM(vaultKey, plaintextKeysJson)`.
    - If someone steals the cold VPS disk or SQLite backup file, the API keys are mathematically unreadable ciphertext.
    - While the user's login session is active in VPS RAM, the VPS already holds the unlocked `vaultKey` in memory — so when David enters his API keys on his PC once, his phone automatically uses them on every request (including Send-and-Forget with the phone screen off) with **zero extra passphrase prompts and zero key pasting on the phone**.
    - *(Reboot recovery on VPS:)* If the VPS process restarts while a token is still valid, the next `/api/*` call requiring a key returns `428 Precondition Required ({ code: 'VAULT_LOCKED_AFTER_REBOOT' })` and the client prompts for the account password once to re-warm the session key in server RAM.

### D6. Atomic Item Storage on the VPS (Killing the Monolithic Blob Clobber)
- **Decision:** Replace whole-project JSON snapshot writes with normalized SQLite tables on the VPS (`projects`, `threads`, `folders`, `turns`, `chapters`, `artifacts`, `edges`, `drafts`, `search_index`, `tts_cache`) where every entity has its own primary key and `updated_at` / `revision`.
- **Why:** If the phone triggers a "Send & Forget" chat turn on the VPS while the PC browser tab is open on the desk, saving a monolithic project blob from the PC would overwrite and erase the turn the VPS just completed for the phone! With atomic item endpoints and incremental sync (`GET /api/projects/:id/changes?since=<rev>`), the phone's background turn commits two rows to `turns` (the user/assistant Pair) and increments the project revision; the PC receives the delta cleanly.

### D7. Chat Remains Strictly Pairs — Extended with VPS "Send & Forget"
- **Decision:** Keep the Chat-is-Pairs law (`design-docs/18_CHAT_PAIRS_AND_QUEUE.md`) as the unbreakable contract in both modes:
  - An ask never enters `turns` until its reply completes.
  - In **Local mode**, `SendQueue` runs in the browser; if the tab closes mid-stream, the draft recovers as `stopped` on reload.
  - In **Connected VPS mode**, `SendQueue` dispatches the queued draft to the VPS (`POST /api/projects/:projectId/jobs/send`). The VPS owns the in-flight execution in memory + SQLite `jobs` table:
    - If the client stays open, it streams SSE progress live from `/api/jobs/:jobId/stream`.
    - If the user **locks their phone screen and walks away**, the SSE socket drops, **but the VPS job keeps running to completion**: it finishes the LLM stream, applies buffered `<artifact>` blocks and `<topic_shift>` markers, commits the User+Assistant Pair atomically to SQLite `turns`, triggers thread titling and sealed-chapter auto-summarization on the server, and marks the job `completed`.
    - When the phone screen wakes up (or when the PC tab polls/streams updates), the completed pair is synced down from SQLite and the draft disappears from the queue.
    - If the LLM call fails on the VPS, the job is marked `failed` with the real error reason and partial text on the draft — never polluting `turns`.

### D8. Embeddings & Semantic Search Index Move 100% to the VPS
- **Decision:**
  - Delete browser-side background embedding indexing for Local mode. In Local mode, search uses fast client-side lexical/keyword matching (`draftSearchEngine` lexical pass).
  - In Connected VPS mode, whenever an artifact is created, updated, or deleted in SQLite, the VPS's single background `ServerArtifactIndexer` queues the section diff, calls Gemini `generate-qa` and `batchEmbedContents` using the user's unlocked Gemini key, and writes the vectors into SQLite (`artifact_vectors`).
  - Draft-proximity semantic search in Connected mode calls `POST /api/projects/:projectId/search` (with client-side `QueryVectorCache` edit-distance $\le 1$ / Dice $\ge 0.95$ debounce so typing +1 char still reuses results without hitting the server/API).

### D9. VPS TTS Audio Re-encoding (`ogg` / `opus` 22kHz Mono) & Disk Cache
- **Decision:**
  - In Connected VPS mode, `POST /api/tts` hashes `(model, voice, normalizedText)`.
  - On cache hit: serves the cached `.ogg` file immediately from disk (`data/tts-cache/<sha256>.ogg`) with `Content-Type: audio/ogg` — **0 LLM quota used, instant playback**.
  - On cache miss: calls Gemini TTS, pipes the raw PCM/WAV through `ffmpeg` (`-ac 1 -ar 22050 -c:a libvorbis -qscale:a -1` or `libopus -b:a 16k`) into a tiny `.ogg` file (~10–15x smaller than WAV), stores it in `data/tts-cache/`, and returns it.

### D10. Deployment Target: `markbrain.unhaunter.com` via Caddy + Ansible + Build Secret Guard
- **Decision:**
  - Forget GitHub Pages. Both the static frontend (`dist/`) and the `/api/*` reverse proxy live on David's VPS under `https://markbrain.unhaunter.com`, served by **Caddy** and deployed from the dev machine via an **Ansible playbook** (`deploy/ansible/`).
  - Because Caddy serves `dist/` directly from disk and only forwards `/api/*` to the Node process on `127.0.0.1:3032`, anonymous visitors hitting the static app never even touch the Node backend beyond `GET /api/auth/session` (or nothing at all until they click Sign In).
  - **Hard Build Secret Guard:** `npm run build` runs a post-build verification script (`scripts/verify-clean-dist.cjs`) that scans `dist/` for any `AIza`, `sk-or-`, Firebase project IDs, or `.env` leaks and fails the build hard if anything secret-shaped is ever bundled into the static files.

---

## 4. Document Map for This Blueprint

This architecture is documented in `design-docs/` across three levels of zoom so any engineer or AI agent can execute it mechanically without losing the plot:

1. **North Star Blueprint (This file):**
   - `design-docs/19_NORTH_STAR_BLUEPRINT.md` — Why we are doing this, the two-mode philosophy, and the 10 core architectural decisions.
2. **Coarse Plan (10-Mile Height, Breadth First):**
   - `design-docs/20_COARSE_ARCHITECTURE_PLAN.md` — Every subsystem touched across deletions, storage, auth, vault, sync, send-and-forget, server indexing, TTS caching, and Caddy/Ansible deployment, on one map before slicing into phases.
3. **Fine Plans — Plan of Record (IQ-70 Step-by-Step Execution Specs):**
   - `design-docs/21_POR_INDEX.md` — Master index of the 7 execution phases, dependencies, invariants, and verification gates.
   - `design-docs/21A_PHASE_1_GREAT_PURGE.md` — Ripping out Firebase, Firestore, Google Drive, and the unauthenticated QR mailbox; adding the `dist/` secret-leak build guard.
   - `design-docs/21B_PHASE_2_SQLITE_AUTH_AND_USERS.md` — VPS SQLite schema, password hashing, Owner Account #1 bootstrap, CLI + Owner UI user management, session auth, and server RAM key vault.
   - `design-docs/21C_PHASE_3_LOCAL_VAULT_AND_MODE_ISOLATION.md` — Client mode switch (`Local Workspace` vs `Connected VPS Workspace`), isolated IndexedDB namespaces, AuthGate login UI, and the Local WebCrypto Passphrase Vault.
   - `design-docs/21D_PHASE_4_ATOMIC_SYNC_AND_SETTINGS.md` — Normalized SQLite project/thread/turn/chapter/artifact endpoints, delta sync (`revision`), and cross-device syncing of API keys + model slots.
   - `design-docs/21E_PHASE_5_SEND_AND_FORGET_JOBS.md` — Server-side chat job runner (`POST /api/projects/:id/jobs/send`), SSE attach/reconnect, server-side pair commit, thread titling, and sealed-chapter auto-summarization while the phone screen is off.
   - `design-docs/21F_PHASE_6_VPS_EMBEDDINGS_AND_TTS_CACHE.md` — Moving semantic indexing + search to the VPS SQLite queue (with lexical-only search in Local mode) and adding `ffmpeg` Ogg (`q=-1`, 22kHz mono) TTS caching.
   - `design-docs/21G_PHASE_7_CADDY_ANSIBLE_DEPLOY.md` — Production Caddyfile for `markbrain.unhaunter.com`, systemd service unit, and Ansible playbook for one-command deploy from the dev machine.
