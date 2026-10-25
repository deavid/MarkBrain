# 21 — Plan of Record (PoR) Index: The 7 Execution Phases

> **Status:** Master Execution Index.
> **Audience:** Any engineer or AI agent executing this migration. Follow the phases in strict numerical order (`Phase 1` → `Phase 7`).
> **Golden Rule:** Every single phase ends with `npm run lint && npm test && npm run build` passing 100% green and a clean git commit on the agent's own branch. Never start Phase $N+1$ while Phase $N$ has failing tests or type errors.

---

## 1. Standing Rules for the Executing Agent

Before touching a single file, internalize these hard project laws:

1. **Git Discipline:**
   - Commit locally after completing each phase (`git add -A && git commit -m "..."`).
   - **NEVER push to any remote.**
   - **NEVER touch any other git branch or worktree.**
   - **NEVER commit `.env` files, API keys, or SQLite `.sqlite` database files.**
2. **No External Network Calls in Tests:**
   - Unit and integration tests must **never** call Google, OpenRouter, or any external network host. Always mock `fetch` or use local test servers.
3. **"So What?" Copy Rule:**
   - Every user-visible string must state plain facts. No marketing fluff, no AI jargon ("shell mode", "proxy mode", "lanes degrade honestly", "big-brain"), no quota promises.
4. **Chat is Pairs (`design-docs/18_CHAT_PAIRS_AND_QUEUE.md`):**
   - An unpaired ask is a **Draft**, never a **Turn**. Turns are only ever written in completed `(user, assistant)` pairs (or explicit user *Store as-is* / *Regenerate Last Reply* replacement).
5. **Errors are Final (`server/lib/models.ts`):**
   - Never silently downgrade a requested model to a fallback model, and never invent model IDs. Valid text models are `gemini-3.5-flash-lite`, `gemini-3.8-flash`, and `gemini-4-argon` (plus OpenRouter models when using an OpenRouter key).

---

## 2. The 7 Phases at a Glance

| Phase | Document | Title | What It Achieves | New Dependencies |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | `design-docs/21A_PHASE_1_GREAT_PURGE.md` | **The Great Purge & Static Build Guard** | Rips out Firebase, Firestore, Google Drive, and the QR Mailbox relay. Makes Local IndexedDB the sole temporary store so the app compiles cleanly with zero Google Cloud SDKs. Adds `scripts/verify-clean-dist.cjs` to block secret leaks in `dist/`. | *Removes* `firebase` |
| **Phase 2** | `design-docs/21B_PHASE_2_SQLITE_AUTH_AND_USERS.md` | **VPS SQLite Foundation, Auth, Account #1 & Server Key Vault** | Adds `better-sqlite3`, creates the full SQLite schema, implements `scrypt` password hashing + server-RAM `vaultKey` derivation, seeds immutable Owner Account #1 (`deavidsedice@gmail.com`), builds the `npm run user` CLI, mounts `/api/auth/*`, `/api/admin/users`, and `/api/account/keys` + `/api/account/settings`, and gates all `/api/*` content routes behind `requireAuth`. | *Adds* `better-sqlite3`, `@types/better-sqlite3` |
| **Phase 3** | `design-docs/21C_PHASE_3_LOCAL_VAULT_AND_MODE_ISOLATION.md` | **Client Mode Isolation, AuthGate Login & Local Passphrase Vault** | Splits client storage into two strictly isolated namespaces (`local` vs `vps:<host>:<email>`). Rebuilds `AuthGate.tsx` with `Sign in to Server` (`email + password`) vs `Use Local Workspace`. Replaces plaintext `keySlots.ts` in Local mode with WebCrypto `PBKDF2 + AES-GCM` Passphrase Vault (`localKeyVault.ts`) that keeps decrypted keys strictly in RAM. Adds the Owner-only **Users** tab in `ModelSettingsModal.tsx`. | None (uses browser WebCrypto) |
| **Phase 4** | `design-docs/21D_PHASE_4_ATOMIC_SYNC_AND_SETTINGS.md` | **Normalized Atomic SQLite Storage, Delta Sync & Cross-Device Settings** | Implements atomic SQLite CRUD + revision delta sync (`/api/projects`, `/api/projects/:id`, `/api/projects/:id/mutate`, `/api/projects/:id/delta?since=<rev>`) and `vpsStore.ts` (backed by the isolated `markbrain-vps:...` IndexedDB mirror). Syncs model slots and API key status automatically between PC and phone. | None |
| **Phase 5** | `design-docs/21E_PHASE_5_SEND_AND_FORGET_JOBS.md` | **VPS "Send & Forget" Background Chat Jobs** | Builds the server-side `ChatJobRunner` (`POST /api/projects/:id/jobs/send`, `GET /api/jobs/:jobId/stream`, `POST /api/jobs/:jobId/stop`). When the user hits Send on their phone in Connected VPS mode and locks the screen, the VPS finishes the LLM stream, extracts artifacts, splits chapters, commits the Pair to SQLite, titles the thread, and auto-summarizes sealed chapters in the background. | None |
| **Phase 6** | `design-docs/21F_PHASE_6_VPS_EMBEDDINGS_AND_TTS_CACHE.md` | **VPS-Only Semantic Indexing & `ffmpeg` Ogg TTS Cache** | Disables browser-side embedding indexing in Local mode (Local mode uses fast lexical search only). Moves `ArtifactIndexer` + vector storage + semantic search (`POST /api/projects/:id/search`) onto the VPS SQLite daemon. Upgrades `POST /api/tts` on the VPS to re-encode audio via `ffmpeg` to 22kHz mono Ogg Vorbis (`-qscale:a -1`) and cache it on disk (`data/tts-cache/`). | System `ffmpeg` (with WAV fallback in dev/tests) |
| **Phase 7** | `design-docs/21G_PHASE_7_CADDY_ANSIBLE_DEPLOY.md` | **Production Deployment: Caddy + Systemd + Ansible (`markbrain.unhaunter.com`)** | Writes `deploy/Caddyfile`, `deploy/markbrain.service`, `deploy/ansible/playbook.yml`, and `deploy/ansible/inventory.ini.example` so David can deploy updates from his dev machine to `markbrain.unhaunter.com` with a single `ansible-playbook` command. Updates `INSTALL.md`, `README.md`, and `SECURITY.md`. | None |

---

## 3. Dependency Graph Between Phases

```
Phase 1 (Purge Firebase/Drive/Mailbox + Build Guard)
   │
   ▼
Phase 2 (SQLite + Auth + Users CLI + Server Vault + requireAuth)
   │
   ▼
Phase 3 (Client Mode Isolation + Login UI + Local WebCrypto Vault + Owner Users Tab)
   │
   ▼
Phase 4 (Atomic SQLite Project/Turn/Artifact Sync + Cross-Device Settings)
   │
   ├──▶ Phase 5 (VPS Send-and-Forget Chat Job Runner + Background Title/Summary)
   │
   └──▶ Phase 6 (VPS Semantic Indexer/Search + ffmpeg Ogg TTS Disk Cache)
           │
           ▼
        Phase 7 (Caddy + Systemd + Ansible Deployment for markbrain.unhaunter.com)
```

---

## 4. How to Verify Completion of the Entire Blueprint

When all 7 phases are complete, the following checklist must be 100% true:

1. `rg "firebase|firestore|googleDriveService" src/ server/ package.json` returns **0 matches**.
2. `npm run build` compiles cleanly and `scripts/verify-clean-dist.cjs` prints `DIST CLEAN: 0 secret patterns found`.
3. `npm test` runs all unit + integration suites (including the new SQLite auth, vault, atomic sync, send-and-forget job, server search, and TTS cache tests) with **0 failures**.
4. **Mode 1 (Local Workspace) check:**
   - Unauthenticated user opens the app → enters Local Workspace (`markbrain-local` IndexedDB).
   - No `/api/*` calls are required to use the app.
   - Setting an API key requires a local Vault Passphrase; `localStorage` contains only AES-GCM ciphertext (`markbrain:local:keyVault`), never plaintext `AIza` or `sk-or-`.
   - Search runs lexically with 0 embedding API calls.
5. **Mode 2 (Connected VPS Workspace) check:**
   - Calling any `/api/*` data or LLM route without a token returns `401 Unauthorized`.
   - Logging in as Account #1 (`deavidsedice@gmail.com`) switches the app to the isolated `markbrain-vps:...` namespace.
   - Saving API keys or changing model slots on one client immediately reflects on any second client logged into the same account, while `data/markbrain.sqlite` on disk stores only AES-GCM ciphertext in `user_secrets`.
   - Submitting a chat turn (`POST /api/projects/:id/jobs/send`) and immediately disconnecting the client SSE stream still completes the turn on the server, writes the `(user, assistant)` Pair atomically to SQLite `turns`, triggers thread titling and sealed-chapter summarization, and delivers the finished Pair when the client reconnects (`GET /api/projects/:id/delta`).
   - Creating/editing an artifact indexes its sections on the VPS into SQLite vectors; `POST /api/projects/:id/search` returns ranked semantic + lexical results.
   - Calling `POST /api/tts` twice with the same text + voice hits Gemini only on the first call and serves cached `audio/ogg` (`22050 Hz, mono, q=-1`) from disk on the second call.
