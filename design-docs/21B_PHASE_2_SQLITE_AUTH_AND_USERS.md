# 21B — Phase 2: VPS SQLite Foundation, Auth, Account #1 & Server Key Vault

> **Phase:** 2 of 7
> **Goal:** Build the VPS SQLite database (`server/db/`), user authentication (`scrypt`), immutable Owner Account #1 (`you@example.com`), the CLI user-management tool (`npm run user`), the Owner-only `/api/admin/users` endpoints, the encrypted-at-rest + unlocked-in-RAM account key vault (`/api/account/keys` & `/api/account/settings`), and gate all `/api/*` content routes behind `requireAuth`.
> **Prerequisite:** Phase 1 committed and green.

---

## 1. Install `better-sqlite3`

Run:
```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

Add `data/` and `*.sqlite*` to `.gitignore` so no runtime SQLite database or TTS cache ever gets committed to git:
```gitignore
# VPS SQLite & runtime data
data/
*.sqlite
*.sqlite-shm
*.sqlite-wal
```

---

## 2. Create the SQLite Database Module (`server/db/index.ts`)

Create `server/db/index.ts`. It must support:
- File-backed SQLite at `process.env.MARKBRAIN_DB_PATH || path.resolve(process.cwd(), 'data', 'markbrain.sqlite')` (creating parent directory if needed).
- In-memory SQLite (`':memory:'`) via `initDb(':memory:')` so unit tests run in milliseconds with zero disk cleanup.
- `WAL` journal mode and `FOREIGN_KEYS = ON`.

### Exact Schema to Initialize in `server/db/index.ts`:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  kdf_salt BLOB NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_secrets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  model_slots_json TEXT NOT NULL DEFAULT '{}',
  chat_tier TEXT NOT NULL DEFAULT 'free',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Project',
  code_name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#e05a66',
  active_thread_id TEXT,
  granularity_law TEXT NOT NULL DEFAULT 'user-only',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS threads (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  title TEXT NOT NULL,
  title_version INTEGER NOT NULL DEFAULT 0,
  folder_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, thread_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS folders (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, folder_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS turns (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, turn_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chapters (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  start_turn_id TEXT NOT NULL,
  end_turn_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  summary TEXT,
  granularity TEXT NOT NULL DEFAULT 'full',
  order_index INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, chapter_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS artifacts (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  doc_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, artifact_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS edges (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  edge_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, edge_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_jobs (
  job_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'send',
  target_turn_id TEXT,
  ask_text TEXT NOT NULL,
  compiled_prompt TEXT NOT NULL,
  system_instruction TEXT,
  model TEXT NOT NULL,
  staged_attachments_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL,
  partial_text TEXT NOT NULL DEFAULT '',
  error_reason TEXT,
  buffered_artifacts_json TEXT NOT NULL DEFAULT '[]',
  buffered_shifts_json TEXT NOT NULL DEFAULT '[]',
  result_user_turn_id TEXT,
  result_assistant_turn_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_index_sections (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  heading TEXT NOT NULL,
  text TEXT NOT NULL,
  qa_json TEXT NOT NULL DEFAULT '[]',
  section_vec_json TEXT NOT NULL DEFAULT '[]',
  qa_vecs_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, artifact_id, section_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tts_cache (
  cache_key TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  voice TEXT NOT NULL,
  file_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL
);
```

---

## 3. Password Hashing, Vault Key Derivation & Account Vault (`server/lib/accountVault.ts`)

Create `server/lib/accountVault.ts` using only Node's built-in `node:crypto`:

### 3.1 Cryptography Laws
1. **Password Hash (`users.password_hash`):**
   - Generate a 16-byte random salt `pwSalt`.
   - Compute `hash = crypto.scryptSync(password, pwSalt, 64, { N: 16384, r: 8, p: 1 })`.
   - Format stored in `password_hash`: `scrypt$${pwSalt.toString('hex')}$${hash.toString('hex')}`.
   - Verification uses `crypto.timingSafeEqual`.
2. **Vault Encryption Key (`vaultKey`):**
   - Separate 16-byte random salt stored in `users.kdf_salt`.
   - Derived on login (`POST /api/auth/login`) or unlock (`POST /api/auth/unlock`):
     ```ts
     const vaultKey = crypto.scryptSync(password, user.kdf_salt, 32, { N: 16384, r: 8, p: 1 });
     ```
   - Stored **strictly in server RAM** in a `Map<number, Buffer>` (`unlockedVaultKeys.set(userId, vaultKey)`). **Never written to SQLite or disk.**
3. **Encrypting / Decrypting `KeySlots` in `user_secrets`:**
   - Shape of plaintext JSON inside the vault:
     ```ts
     export interface AccountKeysPayload {
       'gemini-free'?: string;
       'gemini-paid'?: string;
       openrouter?: string;
     }
     ```
   - Encrypt: `AES-256-GCM` with a fresh 12-byte random `iv` on every save, storing `{ iv, auth_tag, ciphertext }` in `user_secrets`.
   - Decrypt: requires `unlockedVaultKeys.get(userId)`.
   - If the server rebooted since the user logged in, `unlockedVaultKeys.get(userId)` is `undefined`. Any attempt to read/write keys or run an AI call returns HTTP `428 Precondition Required`:
     ```json
     {
       "error": "Server session keys are locked after a server restart. Enter your password to unlock.",
       "code": "VAULT_LOCKED"
     }
     ```
4. **Resolving a Lane Key on the Server (`resolveServerLaneKey(userId, capability, modelId)`):**
   - Reads the user's decrypted `AccountKeysPayload` + `user_settings.chat_tier`.
   - If `modelId` is an OpenRouter model (contains `/` or provider `'openrouter'`), uses `keys.openrouter`.
   - Otherwise, for `capability === 'chat'` when `chat_tier === 'paid'` (or if `gemini-free` is empty and `gemini-paid` is set), uses `keys['gemini-paid']`; otherwise uses `keys['gemini-free']`.
   - If no key is configured for that provider, throws a clear error: `"No API key configured for <provider>. Open Model Settings → Keys to add one."`

---

## 4. User Management & Immutable Owner Account #1 (`server/lib/users.ts`)

Create `server/lib/users.ts`:

1. **`ensureOwnerBootstrap()`:**
   - Called on server boot.
   - Reads `process.env.MARKBRAIN_OWNER_EMAIL` and `process.env.MARKBRAIN_OWNER_PASSWORD`.
   - If the `users` table has `0` rows and both env vars are non-empty, creates Account #1 (`id = 1`, `is_owner = 1`, `enabled = 1`).
2. **`createUser(email, password, { isOwner = false })`:**
   - Normalizes `email = email.trim().toLowerCase()`.
   - Validates `email.includes('@')` and `password.length >= 8`.
   - If `users` table is completely empty, forces `isOwner = true` so the very first user created on a fresh install is always the owner (`id = 1`).
3. **`setUserEnabled(targetUserId, enabled)`:**
   - Looks up target user.
   - **Hard Law:** If `target.id === 1` or `target.is_owner === 1` and `enabled === false`, throws `Error('The owner account cannot be disabled.')`.
   - If disabling (`enabled === false`), also deletes all rows in `sessions` for `targetUserId` and removes `targetUserId` from `unlockedVaultKeys` in RAM so they are cut off immediately.
4. **`changeUserPassword(userId, newPassword, oldPassword?)`:**
   - If the user has existing `user_secrets` and `unlockedVaultKeys.has(userId)` (or `oldPassword` is provided to decrypt `user_secrets`), re-encrypts `user_secrets` under the new `kdf_salt` + `newPassword` so their saved API keys are preserved across a password change.

---

## 5. CLI Admin Tool (`scripts/user-admin.ts`)

Create `scripts/user-admin.ts` and wire `"user": "tsx scripts/user-admin.ts"` in `package.json`:

Supported commands:
```bash
npm run user -- create <email> --password <password> [--owner]
npm run user -- list
npm run user -- enable <email>
npm run user -- disable <email>
npm run user -- passwd <email> --password <newPassword>
```

---

## 6. Auth, Admin & Account Routes (`server/routes/account.ts`)

Create `server/routes/account.ts` with `requireAuth` and `requireOwner` middlewares:

### 6.1 Session Extraction (`requireAuth`)
- Checks `Authorization: Bearer <token>` header first, then `Cookie: mb_session=<token>`.
- Hashes `<token>` with `sha256` and looks up `sessions` joined with `users` where `sessions.expires_at > Date.now()` and `users.enabled = 1`.
- If missing/expired/disabled → returns `401 { error: 'Authentication required.' }`.
- Attaches `req.user = { id, email, isOwner: Boolean(row.is_owner), vaultUnlocked: isVaultUnlocked(row.id) }`.

### 6.2 Endpoints
1. **`POST /api/auth/login`** (public):
   - Body: `{ email, password }`.
   - Verifies credentials and `enabled === 1`.
   - Unlocks `vaultKey` into server RAM (`unlockedVaultKeys`).
   - Issues a 32-byte random hex `token` (30-day TTL), sets `HttpOnly; SameSite=Strict` cookie `mb_session`, and returns:
     ```json
     {
       "token": "...",
       "user": { "id": 1, "email": "you@example.com", "isOwner": true, "vaultUnlocked": true }
     }
     ```
2. **`POST /api/auth/logout`** (`requireAuth`):
   - Deletes the current session token from `sessions`.
   - If the user has no other active sessions, wipes `unlockedVaultKeys.delete(userId)`.
3. **`GET /api/auth/session`** (`requireAuth`):
   - Returns `{ user: req.user }`.
4. **`POST /api/auth/unlock`** (`requireAuth`):
   - Body: `{ password }`.
   - Verifies password against `users.password_hash`, derives `vaultKey` into server RAM, returns `{ ok: true, vaultUnlocked: true }`.
5. **`GET /api/account/settings`** (`requireAuth`):
   - Returns:
     ```json
     {
       "modelSlots": { "chat": "gemini-3.5-flash-lite", ... },
       "chatTier": "free",
       "vaultUnlocked": true,
       "keys": {
         "gemini-free": { "configured": true, "hint": "…a1b2" },
         "gemini-paid": { "configured": false, "hint": null },
         "openrouter": { "configured": true, "hint": "…9f0e" }
       }
     }
     ```
   - **Notice:** The raw API key strings are **never** returned to the browser! Only `{ configured, hint }` (last 4 chars).
6. **`PUT /api/account/settings`** (`requireAuth`):
   - Body: `{ modelSlots?, chatTier? }`. Upserts `user_settings`.
7. **`PUT /api/account/keys`** (`requireAuth`):
   - Body: `{ slot: 'gemini-free' | 'gemini-paid' | 'openrouter', apiKey: string | null }`.
   - Requires `vaultUnlocked` (returns `428` if locked).
   - Decrypts current `AccountKeysPayload` (or starts from `{}`), sets or deletes `slot`, re-encrypts with a fresh `iv`, writes to `user_secrets`, and returns the updated redacted `keys` summary.
8. **Owner-Only Admin Endpoints (`requireAuth` + `requireOwner`):**
   - `GET /api/admin/users` → lists all users (`id, email, isOwner, enabled, createdAt`).
   - `POST /api/admin/users` → body `{ email, password }` → creates friend account.
   - `PATCH /api/admin/users/:id` → body `{ enabled?: boolean, password?: string }` → enables/disables or resets password (refuses disabling `id === 1` / `isOwner` with `400`).

---

## 7. Gate All Server AI & Log Routes Behind `requireAuth` + User's Unlocked Vault Key

Update `server/app.ts` and the server routes (`chat.ts`, `summarize.ts`, `title.ts`, `extract.ts`, `searchIndex.ts`, `tts.ts`, `logs.ts`):
1. Remove `server/lib/mode.ts` (`SHELL_MODE_ERROR` / `proxy` vs `shell` split is replaced by a single law: **unauthenticated requests get `401 Unauthorized`; authenticated requests use the authenticated user's own unlocked vault key**).
2. Add a small CORS middleware in `server/app.ts` that allows `Authorization` and `Content-Type` headers so custom server URLs work cleanly alongside same-origin Caddy requests.
3. Update `server/providers/gemini.ts` and introduce `server/providers/openrouter.ts` (or reuse `src/gateway/providers/` adapters on the server) so every route creates its client per-request using `resolveServerLaneKey(req.user.id, capability, targetModel)` instead of reading `process.env.GEMINI_API_KEY`.
   - If `isVaultUnlocked(req.user.id)` is `false`, return `428 { error: 'Vault locked after server restart — enter your password to unlock.', code: 'VAULT_LOCKED' }`.

---

## 8. Phase 2 Unit & Integration Tests (`src/tests/server-auth-and-vault.test.ts`)

Write a comprehensive test file `src/tests/server-auth-and-vault.test.ts` covering:
1. Bootstrapping Account #1 (`you@example.com`) and verifying `is_owner = 1`.
2. Attempting to disable Account #1 via `setUserEnabled` or `PATCH /api/admin/users/1` fails with a clear error.
3. Unauthenticated calls to `/api/chat/stream`, `/api/account/settings`, `/api/admin/users` return `401`.
4. Logging in returns a session token and unlocks the server RAM vault.
5. Saving API keys via `PUT /api/account/keys` stores ciphertext in SQLite (`user_secrets.ciphertext` does NOT contain the raw `AIza...` string) and `GET /api/account/settings` returns only `{ configured: true, hint: '…' }`.
6. Simulating a server restart (`clearUnlockedVaultKeysForTests()`) causes AI/key routes to return `428 VAULT_LOCKED`, and `POST /api/auth/unlock` with the user's password restores access and decrypts the saved keys from SQLite.
7. Non-owner user calling `/api/admin/users` receives `403 Forbidden`.
8. Owner disabling a friend account immediately invalidates the friend's active session token (`401` on next request).

---

## 9. Phase 2 Verification Gate

```bash
npm run lint
npm test
npm run build
```

Commit Phase 2:
```bash
git add -A
git commit -m "Phase 2: SQLite schema, scrypt auth, immutable Owner #1, CLI user admin, and server RAM/disk key vault"
```
