# 20 — Coarse Architecture Plan (10-Mile Height, Breadth Over Depth)

> **Status:** Coarse Breadth Map (covers every subsystem touched by `19_NORTH_STAR_BLUEPRINT.md`).
> **Purpose:** See the entire board at once — what gets deleted, what gets kept, what gets transformed, and what gets added — before breaking into phased step-by-step instructions.

---

## 1. High-Level System Topology

```
                        https://markbrain.unhaunter.com
                                       │
                                       ▼
                        ┌─────────────────────────────┐
                        │        Caddy Server         │
                        │  • Serves /srv/markbrain/   │
                        │    dist/* directly from SSD │
                        │  • Proxies /api/* ──────────┼──────┐
                        └──────────────┬──────────────┘      │
                                       │                     │
              ┌────────────────────────┘                     ▼
              ▼                               ┌─────────────────────────────┐
┌─────────────────────────────┐               │   Node + SQLite Daemon      │
│  BROWSER: Mode 1 (Local)    │               │   (127.0.0.1:3032)          │
│  • No VPS login needed      │               │  • Rejects unauth `/api/*`  │
│  • IDB: `markbrain-local`   │               │  • Users + Sessions (RAM)   │
│  • Vault: Local Passphrase  │               │  • Encrypted-at-rest Keys   │
│    (PBKDF2+AES-GCM in IDB/  │               │  • Atomic SQLite Tables:    │
│     localStorage → RAM)     │               │    projects, threads, turns,│
│  • AI: Browser ──▶ Provider │               │    chapters, artifacts,     │
│  • Search: Lexical only     │               │    vectors, jobs            │
│  • Backup: Export/Import    │               │  • Background Job Runner    │
└─────────────────────────────┘               │    (Send & Forget turns,    │
                                              │     titles, chapter summs)  │
┌─────────────────────────────┐               │  • Background Embed Indexer │
│  BROWSER: Mode 2 (VPS Acct) │◄────HTTPS────►│  • ffmpeg Ogg TTS Cache     │
│  • Signed in (`email+pass`) │   `/api/*`    └──────────────┬──────────────┘
│  • IDB: `markbrain-vps:…`   │                              │
│  • Keys & Models: synced    │                              │ HTTPS
│    from VPS automatically   │                              ▼
│  • Send & Forget: submits   │               ┌─────────────────────────────┐
│    job to VPS; screen can   │               │  Gemini / OpenRouter APIs   │
│    lock immediately         │               └─────────────────────────────┘
└─────────────────────────────┘
```

---

## 2. Area-by-Area Breadth Sweep (All 10 Bases)

### Base 1 — The Great Purge (Deletions & Cleanup)
Before building the new backend, we strip out everything that belongs to the rejected cloud/pairing paradigms:
- **Firebase & Firestore removal:**
  - Remove `"firebase"` from `package.json`.
  - Delete `src/services/firebase.ts`, `src/services/stores/firestoreStore.ts`, `src/utils/authErrors.ts`, `firebase-applet-config.json*`, `firebase-blueprint.json`, `firestore.rules`, and `server/routes/auth.ts` (which only served Firebase config).
  - Delete Firestore-specific tests (`src/tests/save-quota.test.ts`, `src/tests/save-watchdog.test.ts` where tied to Firestore's infinite hang).
- **Google Drive integration removal:**
  - Delete `src/services/googleDriveService.ts`.
  - Strip the "Google Drive" tab from `src/ui/artifacts/ImportModal.tsx` (leaving local file upload / multi-file drag-and-drop / markdown & YAML paste).
- **Unauthenticated QR / Mailbox pairing removal:**
  - Delete `server/routes/mailbox.ts`, `src/gateway/pairing.ts`, `src/ui/workspace/usePairingTransfer.ts`, `src/tests/mailbox.test.ts`, and `src/tests/pairing.test.ts`.
  - Remove "Send to phone" QR buttons from Sidebar / Settings.
- **Server `.env` GEMINI_API_KEY removal from runtime routes:**
  - The VPS never uses a global server-owner `.env` API key to serve anonymous traffic. Every server-side AI call in Connected VPS mode uses the authenticated user's own unlocked key from their VPS vault.
- **Static Build Secret Guard:**
  - Add `scripts/verify-clean-dist.cjs` wired into `npm run build` so a production build fails immediately if `dist/` contains any `AIza`, `sk-or-`, or `FIREBASE` strings.

---

### Base 2 — Workspace Mode Isolation on the Client
The client has two mutually exclusive runtime modes, persisted in `localStorage['markbrain:workspaceMode']`:
1. **`mode = 'local'` (Default when not signed in):**
   - IndexedDB database name: `'markbrain-local'`.
   - Model config key: `'markbrain:local:modelConfig'`.
   - Draft queue key: `'markbrain:local:draftQueue'`.
   - Key vault key: `'markbrain:local:keyVault'`.
   - Never makes any network calls to `/api/*` (except if the user explicitly clicks "Sign in to Server").
2. **`mode = 'vps'` (When signed into a VPS account):**
   - Connection descriptor in `localStorage['markbrain:vpsSession']`: `{ baseUrl, email, userId, isOwner, token }`.
   - IndexedDB database name: `'markbrain-vps:' + encodeURIComponent(baseUrl) + ':' + encodeURIComponent(email)` (offline read cache + optimistic mirror).
   - Model config & API keys come from the VPS account (`/api/account/settings`) and sync automatically across PC and phone.
   - Switching from `local` to `vps` (signing in) or from `vps` to `local` (signing out / clicking "Switch to Local Workspace") tears down in-memory domain registries and loads only the target namespace's data. Zero data ever crosses between the two unless the user explicitly exports a JSON file and imports it.

---

### Base 3 — Authentication & User Management on the VPS
A self-contained account system backed by `better-sqlite3` (`data/markbrain.sqlite`) and Node's built-in `node:crypto`:
- **Database table `users`:**
  - `id INTEGER PRIMARY KEY`, `email TEXT UNIQUE`, `password_hash TEXT` (`scrypt`), `kdf_salt BLOB` (for deriving the user's 32-byte `vaultKey`), `vault_check BLOB` (known plaintext verifier encrypted with `vaultKey`), `is_owner INTEGER` (`1` for Account #1), `enabled INTEGER` (`1` or `0`), `created_at INTEGER`.
- **Account #1 (Owner Bootstrap):**
  - On server startup, if `users` is empty and `MARKBRAIN_OWNER_EMAIL` + `MARKBRAIN_OWNER_PASSWORD` env vars are present (set by Ansible), Account #1 is created automatically with `is_owner = 1`.
  - Account #1 cannot be disabled or deleted by any API or CLI command.
- **CLI Admin Tool (`scripts/user-admin.ts` / `npm run user -- ...`):**
  - `user create <email> --password <pw> [--owner]`
  - `user list`
  - `user enable <email>` / `user disable <email>`
  - `user passwd <email> --password <newpw>`
- **Owner-Only UI Tab in Settings:**
  - When `session.user.isOwner === true`, the Settings modal displays a **Users** tab (`GET /api/admin/users`, `POST /api/admin/users`, `PATCH /api/admin/users/:id`) to add a friend's email + initial password or toggle their `enabled` switch.
- **Login & Session Lifecycle:**
  - `POST /api/auth/login` with `{ email, password }`:
    1. Verifies `enabled === 1` and `scrypt` password hash.
    2. Derives 32-byte `vaultKey = scryptSync(password, user.kdf_salt, 32)` in **server RAM**.
    3. Creates a random 32-byte `sessionToken`, stores `{ userId, email, isOwner, createdAt, expiresAt }` in SQLite `sessions`, and attaches `vaultKey` to an **in-memory Map (`activeVaultKeys.set(userId, vaultKey)`)** — never written to disk.
    4. Returns `{ token, user: { id, email, isOwner } }` (and sets an `HttpOnly; Secure; SameSite=Strict` cookie for same-origin requests).
  - Every `/api/*` route (except `/api/health` and `/api/auth/login`) requires a valid session via `requireAuth` middleware. Disabled users or unauthenticated callers get `401 Unauthorized` immediately.

---

### Base 4 — Dual Key Vaults (Local Passphrase Vault vs VPS Account Vault)
Plaintext API keys never touch disk in either mode:
- **In Local Mode (`src/data/localKeyVault.ts`):**
  - Uses browser `window.crypto.subtle` (`PBKDF2` 600,000 iterations SHA-256 + `AES-GCM` 256-bit).
  - Encrypted envelope `{ version: 1, salt, iv, ciphertext }` is stored in `localStorage['markbrain:local:keyVault']`.
  - Decrypted `KeySlots` (`gemini-free`, `gemini-paid`, `openrouter`, plus active `chatTier`) live **strictly in a private module variable in RAM** while the tab is open.
  - If the user has saved a local vault and reloads the tab, clicking Send (or opening Keys settings) prompts a tiny inline **"Unlock Local Key Vault"** passphrase prompt once for that tab session.
- **In Connected VPS Mode (`server/lib/accountVault.ts`):**
  - The user edits their keys in the exact same `ModelSettingsModal → Keys` UI.
  - Saving keys sends `PUT /api/account/keys` over HTTPS to the VPS.
  - The VPS encrypts the JSON with the user's in-RAM `vaultKey` (`AES-256-GCM`) and writes `{ iv, auth_tag, ciphertext }` to `user_secrets` in SQLite.
  - The client in Connected VPS mode does **not** even need the raw API keys in the browser! It only receives a redacted summary (`{ 'gemini-free': { configured: true, hint: '…4f9a' }, ... }`) so the UI can show which slots are filled and let the user toggle `Free` vs `Paid` on the chat row.
  - Every device logged into that VPS account automatically sees the configured slots and uses them on the server.
  - If the VPS daemon restarts (wiping `activeVaultKeys` in server RAM while the SQLite session token is still valid), the next AI request returns `428 { code: 'VAULT_LOCKED', message: 'Server restarted — enter your password once to unlock your keys.' }`, and `POST /api/auth/unlock` re-derives `vaultKey` into server RAM without forcing a full sign-out.

---

### Base 5 — Normalized Atomic SQLite Storage & Sync
Replacing the monolithic `ProjectSnapshot` blob write with atomic entity storage on the VPS:
- **SQLite Tables (`server/db/schema.sql`):**
  - `projects (project_id, user_id, name, code_name, description, color, active_thread_id, granularity_law, revision, updated_at)`
  - `threads (thread_id, project_id, user_id, title, title_version, folder_id, created_at, updated_at, revision)`
  - `folders (folder_id, project_id, user_id, name, order_index, revision)`
  - `turns (turn_id, project_id, thread_id, user_id, seq, role, content, timestamp, meta_json, revision)`
  - `chapters (chapter_id, project_id, thread_id, user_id, start_turn_id, end_turn_id, title, description, summary, granularity, order_index, revision)`
  - `artifacts (artifact_id, project_id, user_id, title, code, type, is_high_concept, subtitle, description, summary, body, tags_json, parent_code, version_history_json, updated_at, revision)`
  - `edges (edge_id, project_id, user_id, source_id, target_id, relation, revision)`
  - `user_settings (user_id, model_slots_json, chat_tier, updated_at)`
- **Why Revision Numbers Work Cleanly:**
  - Every mutation inside a project increments `projects.revision` (an integer monotonic counter per project) and stamps the modified row with that new `revision`.
  - **Initial hydrate:** `GET /api/projects/:id` returns the assembled `ProjectSnapshot` + `revision` (and caches it in the isolated `markbrain-vps:...` IndexedDB store so boot is instant even offline).
  - **Atomic mutations from client:**
    - Creating/editing/deleting an artifact: `PUT /api/projects/:id/artifacts/:artifactId`, `DELETE /api/projects/:id/artifacts/:artifactId`.
    - Updating chapters / threads / folders / edges: dedicated atomic endpoints (and a batched `POST /api/projects/:id/mutate` transaction endpoint so any multi-entity UI action lands in one SQLite transaction).
  - **Delta pull (`GET /api/projects/:id/delta?since=<revision>`):**
    - Returns only rows with `revision > since` (plus tombstones in a small `deleted_items` log table).
    - When the phone wakes up after a background job, or while PC and phone are both open, pulling the delta merges new turns/artifacts/chapters into the client state without clobbering anything.

---

### Base 6 — "Send & Forget" Background Chat Jobs on the VPS
In Connected VPS mode, chat turns (and Regenerate Last Reply) run inside a server-owned job queue so locking the phone screen never kills a turn:
- **SQLite table `chat_jobs`:**
  - `job_id`, `user_id`, `project_id`, `thread_id`, `kind` (`'send' | 'regenerate'`), `target_turn_id`, `ask_text`, `compiled_prompt`, `system_instruction`, `model`, `staged_attachments_json`, `state` (`'queued' | 'sending' | 'completed' | 'failed' | 'stopped'`), `partial_text`, `error_reason`, `buffered_artifacts_json`, `buffered_shifts_json`, `created_at`, `updated_at`.
- **The Flow:**
  1. User hits **Send** on their phone (or PC) in Connected VPS mode.
  2. Client calls `POST /api/projects/:projectId/jobs/send` with the draft payload.
  3. Server inserts the job into `chat_jobs`, starts streaming from Gemini/OpenRouter in the Node process (independent of the HTTP response lifecycle!), and returns `{ job }` immediately.
  4. While the phone screen is still on, the client attaches to `GET /api/jobs/:jobId/stream` (SSE) to watch live tokens stream into the draft area.
  5. **User locks the phone screen:** the SSE connection closes, **but the server job does NOT abort** (only an explicit `POST /api/jobs/:jobId/stop` aborts the upstream LLM request).
  6. **When the LLM stream finishes on the server:**
     - The server parses `<artifact>` blocks and `<topic_shift>` sentinels.
     - Inside **one SQLite transaction**, the server writes the User turn + Assistant turn Pair into `turns`, upserts any extracted `artifacts`, applies any chapter `topic_shift` splits, deletes/completes the `chat_jobs` row, and bumps `projects.revision`.
     - Immediately after committing the pair, the server kicks off best-effort background tasks in Node:
       - **Thread auto-title** (if turn count hits the title threshold),
       - **Sealed-chapter auto-summarization** (for any chapter that just left the active window),
       - **Artifact semantic indexing** (if the turn extracted/updated an artifact).
  7. **When the user unlocks their phone:** on `visibilitychange → visible` (or SSE reconnect), the client calls `GET /api/projects/:projectId/delta?since=<lastRev>`, receives the completed Pair + updated chapters + active jobs, and renders the finished conversation immediately.

---

### Base 7 — VPS-Only Semantic Embeddings & Lexical-Only Local Search
- **In Mode 1 (Local Workspace):**
  - `ArtifactIndexer` is **disabled** (no background `generate-qa` or `embed` calls from the browser).
  - Draft-proximity search (`useDraftSearch`) runs in **lexical-only mode** (fast trigram/token overlap against local artifacts). Zero API calls, zero quota burned, zero indexing failure banners.
- **In Mode 2 (Connected VPS Workspace):**
  - SQLite table `artifact_index_sections (project_id, artifact_id, section_id, content_hash, heading, text, qa_json, section_vec_blob, qa_vec_blob, model, updated_at)`.
  - Whenever an artifact is saved/imported on the VPS, `ServerArtifactIndexer` enqueues the changed sections (by `content_hash`), runs `generate-qa` and `embedContent` on the server using the user's unlocked Gemini key, and writes the float32 vectors to SQLite.
  - Client search calls `POST /api/projects/:projectId/search` with `{ query }` (behind the existing client-side `QueryVectorCache` so near-duplicate queries with edit distance $\le 1$ or Dice $\ge 0.95$ don't even make a network trip). The server embeds the query once, computes cosine + lexical blend in memory against SQLite vectors, and returns the top ranked matches + index status (`indexedCount / totalCount`).

---

### Base 8 — VPS TTS Audio Re-encoding (`ogg` 22kHz Mono `q=-1`) & Disk Cache
- **In Connected VPS Mode (`POST /api/tts`):**
  - Computes `cacheKey = sha256(model + '|' + voice + '|' + cleanTtsText(text))`.
  - Checks `data/tts-cache/<cacheKey>.ogg` (and SQLite `tts_cache` metadata table for LRU/size tracking).
  - **Cache hit:** streams `data/tts-cache/<cacheKey>.ogg` with `Content-Type: audio/ogg` immediately.
  - **Cache miss:** calls Gemini TTS to obtain the raw 24kHz PCM audio, pipes it through `ffmpeg`:
    ```bash
    ffmpeg -f s16le -ar 24000 -ac 1 -i pipe:0 -ac 1 -ar 22050 -c:a libvorbis -qscale:a -1 -f ogg pipe:1
    ```
    (with automatic fallback to `libopus -b:a 16k -vbr on` if preferred, or WAV if `ffmpeg` is missing in a minimal dev environment), writes `data/tts-cache/<cacheKey>.ogg` atomically, and serves `audio/ogg` to the client.
  - Client `ttsTransport.ts` plays standard `audio/ogg` natively via HTML5 `Audio` / `AudioContext.decodeAudioData` (much faster and lighter on mobile than manual PCM float conversion, while keeping PCM decoding for Local mode direct calls).

---

### Base 9 — UI & UX Simplifications Across Both Modes
1. **Boot / AuthGate (`src/ui/workspace/AuthGate.tsx`):**
   - Replaces "Continue with Google" with two clean choices:
     - **Sign in to Server** (`Email` + `Password`, plus collapsed *"Server URL"* defaulting to current origin).
     - **Use Local Workspace** (100% in this browser, no account).
2. **Sidebar Workspace Indicator:**
   - Shows clearly whether you are in **Local Workspace** (with a "Sign in to Server" button) or **Connected: `deavidsedice@gmail.com`** (with sync status indicator + "Switch to Local / Sign out").
3. **Model Settings Modal (`src/ui/workspace/ModelSettingsModal.tsx`):**
   - **Models tab:** unchanged compact picker; writes to VPS account settings when in Connected mode, or `localStorage` in Local mode.
   - **Keys tab:**
     - In **Local mode**: shows Vault status (`Locked` / `Unlocked for this tab` / `Set up Passphrase Vault`).
     - In **Connected VPS mode**: shows keys synced to your VPS account (`Configured · …4f9a`), editable from any device, zero passphrase nagging while logged in.
   - **Users tab (visible ONLY when `user.isOwner === true` in Connected VPS mode):**
     - List of accounts on this VPS, **"+ Add User"** (`email` + `initial password`), **Enable / Disable** toggle (disabled on Account #1), and **Reset Password**.

---

### Base 10 — Deployment: Caddy + Systemd + Ansible (`markbrain.unhaunter.com`)
- **Directory `deploy/`:**
  - `deploy/Caddyfile`: serves `/srv/markbrain/dist` directly for all static assets and SPA routes; proxies `/api/*` to `127.0.0.1:3032` with `flush_interval -1` for zero-buffering SSE streams.
  - `deploy/markbrain.service`: hardened `systemd` unit running Node on port `3032`, working directory `/srv/markbrain`, data directory `/var/lib/markbrain` (holding `markbrain.sqlite` and `tts-cache/`), loading `/etc/markbrain/markbrain.env`.
  - `deploy/ansible/playbook.yml` + `inventory.ini.example`:
    - Builds `dist/` locally (and runs the secret-leak verifier),
    - Installs `nodejs`, `ffmpeg`, `sqlite3`, and `caddy` on the VPS if missing,
    - Rsyncs build artifacts + `server/` + `package.json`,
    - Runs `npm ci --omit=dev`,
    - Ensures Account #1 (`deavidsedice@gmail.com`) is seeded in SQLite,
    - Reloads `markbrain.service` and `caddy`,
    - Verifies `https://markbrain.unhaunter.com/api/health` returns `200 OK`.
