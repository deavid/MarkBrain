# 21C — Phase 3: Client Mode Isolation, AuthGate Login & Local Passphrase Vault

> **Phase:** 3 of 7
> **Goal:** Implement strict client-side isolation between **Mode 1 (`local`)** and **Mode 2 (`vps`)**, rebuild `AuthGate.tsx` with the Server Login (`email + password`) + Local Workspace selector, replace plaintext `localStorage` key storage in Local mode with a real WebCrypto `PBKDF2 + AES-GCM` Passphrase Vault (`src/data/localKeyVault.ts`) that keeps decrypted keys strictly in a JS RAM closure, and add the Owner-only **Users** tab in `ModelSettingsModal.tsx`.
> **Prerequisite:** Phase 2 committed and green.

---

## 1. Workspace Mode & Session Descriptor (`src/services/workspaceSession.ts`)

Create `src/services/workspaceSession.ts` as the single source of truth for which mode the browser is in:

```ts
export type WorkspaceMode = 'local' | 'vps';

export interface VpsSessionInfo {
  baseUrl: string;      // e.g. '' (same origin) or 'https://markbrain.unhaunter.com'
  token: string;        // Bearer token from POST /api/auth/login
  userId: number;
  email: string;
  isOwner: boolean;
  vaultUnlocked: boolean;
}
```

### Exact Storage Keys & Namespace Helpers:
- `localStorage['markbrain:workspaceMode']`: `'local' | 'vps'` (or absent before first choice at `AuthGate`).
- `localStorage['markbrain:vpsSession']`: JSON of `VpsSessionInfo`.
- **Helper `getActiveIdbName(): string`:**
  - When `mode === 'local'`: returns `'markbrain-local'`.
  - When `mode === 'vps'`: returns `'markbrain-vps:' + normalizeOrigin(session.baseUrl) + ':' + session.email.toLowerCase()`.
- **Helper `getScopedStorageKey(baseKey: string): string`:**
  - When `mode === 'local'`: returns `'markbrain:local:' + baseKey`.
  - When `mode === 'vps'`: returns `'markbrain:vps:' + normalizeOrigin(session.baseUrl) + ':' + session.email.toLowerCase() + ':' + baseKey`.
  - Apply `getScopedStorageKey` to `draftQueue.ts` (`draftQueue`) and `modelConfig.ts` (`modelConfig`) so a draft or model setting in Local Workspace never bleeds into the VPS Workspace or vice versa!

### Authenticated Fetch Helper (`apiFetch` in `src/gateway/api.ts`):
- Every `/api/*` request in `src/gateway/api.ts` prefixes `session.baseUrl` (defaulting to `''` for same-origin) and attaches:
  ```ts
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init.headers,
  }
  ```

---

## 2. Local Mode Passphrase Vault (`src/data/localKeyVault.ts` & `src/data/keySlots.ts`)

In **Mode 1 (`local`)**, API keys must **never** be written to `localStorage` in plaintext.

### 2.1 WebCrypto Vault Specification (`src/data/localKeyVault.ts`)
1. **Encrypted Envelope in `localStorage['markbrain:local:keyVault']`:**
   ```ts
   export interface EncryptedLocalVault {
     version: 1;
     saltHex: string;       // 16 random bytes
     ivHex: string;         // 12 random bytes
     ciphertextHex: string; // AES-256-GCM ciphertext + 16-byte tag of JSON { slots, chatTier }
   }
   ```
2. **Key Derivation (`deriveLocalVaultKey(passphrase, salt)`):**
   - Uses `crypto.subtle.importKey('raw', encode(passphrase), 'PBKDF2', false, ['deriveKey'])`.
   - Uses `PBKDF2` with `iterations: 600_000` (configurable via `setPbkdf2IterationsForTests(1000)` so unit tests run fast), `hash: 'SHA-256'`, deriving an `AES-GCM` 256-bit key.
3. **In-Memory Closure State (RAM only):**
   ```ts
   let ramCryptoKey: CryptoKey | null = null;
   let ramSlots: Record<KeySlotId, string> = { 'gemini-free': '', 'gemini-paid': '', openrouter: '' };
   let ramChatTier: 'free' | 'paid' = 'free';
   ```
   - Notice: `ramSlots` and `ramCryptoKey` are module-private variables, **never** attached to `window`, **never** written to `localStorage` or `sessionStorage`.
   - When the browser tab closes or refreshes, `ramSlots` and `ramCryptoKey` vanish from RAM.
4. **Vault Lifecycle Functions:**
   - `hasSavedLocalVault(): boolean` → checks if `localStorage['markbrain:local:keyVault']` exists.
   - `isLocalVaultUnlocked(): boolean` → `ramCryptoKey !== null`.
   - `createOrResetLocalVault(passphrase: string): Promise<void>` → generates fresh `salt`, derives `ramCryptoKey`, encrypts empty `ramSlots`, saves envelope.
   - `unlockLocalVault(passphrase: string): Promise<boolean>` → reads envelope, derives key, decrypts into `ramSlots` + `ramChatTier`. Returns `false` on wrong passphrase (`OperationError`).
   - `lockLocalVault(): void` → zeroes `ramCryptoKey = null` and clears `ramSlots` in RAM without deleting the encrypted envelope on disk.
   - `destroyLocalVault(): void` → clears RAM and deletes `localStorage['markbrain:local:keyVault']`.

### 2.2 How `src/data/keySlots.ts` Dispatches by Workspace Mode
Update `src/data/keySlots.ts`:
- **In Mode 1 (`local`):**
  - `resolveLaneKey(capability, modelId)` reads from `localKeyVault`'s unlocked `ramSlots`.
  - If `hasSavedLocalVault() && !isLocalVaultUnlocked()`, `isLocalVaultLockedError()` signals the UI to show the passphrase unlock prompt before sending.
- **In Mode 2 (`vps`):**
  - `resolveLaneKey()` returns `null` on the client! Why? Because in Connected VPS mode, **every AI call routes through the VPS (`/api/*`)**, where the server uses the user's server-side unlocked vault (`server/lib/accountVault.ts`). The browser never needs raw key strings in Connected VPS mode.
  - Instead, `src/data/keySlots.ts` exposes `vpsKeySummary` (`{ 'gemini-free': { configured, hint }, ... }`) fetched from `GET /api/account/settings` so `ModelSettingsModal` displays which keys are configured on the VPS account.

---

## 3. Rebuild `AuthGate.tsx` (Server Login vs Local Workspace)

Update `src/ui/workspace/AuthGate.tsx` so the user has two crystal-clear entry paths:

1. **Primary Card — Sign in to Server (`data-testid="vps-login-form"`):**
   - `Email` input (`data-testid="vps-login-email"`, `type="email"`, `autoComplete="username"`).
   - `Password` input (`data-testid="vps-login-password"`, `type="password"`, `autoComplete="current-password"`).
   - Collapsible `"Server URL"` toggle (`data-testid="vps-login-url-toggle"`): defaults to `window.location.origin` (so on `markbrain.unhaunter.com` David never touches it, while a local developer can point to a remote server if desired).
   - **"Sign In"** button (`data-testid="vps-login-submit"`): calls `POST /api/auth/login`, saves `VpsSessionInfo`, sets `workspaceMode = 'vps'`, and boots into the Connected VPS Workspace.
2. **Secondary Button — Use Local Workspace (`data-testid="continue-local"`):**
   - Caption: *"Stays in this browser only. Bring your own API key."*
   - Clicking sets `workspaceMode = 'local'` and boots into the isolated Local Workspace (`markbrain-local`).

---

## 4. Update `ModelSettingsModal.tsx` (Keys Tab + Owner-Only Users Tab)

Update `src/ui/workspace/ModelSettingsModal.tsx`:

1. **Tabs in header:**
   - `Models` (`data-testid="settings-tab-models"`)
   - `Keys` (`data-testid="settings-tab-keys"`)
   - `Users` (`data-testid="settings-tab-users"`) — **rendered ONLY when in Connected VPS mode AND `currentUser.isOwner === true`**.
2. **Keys Tab in Mode 1 (`local`):**
   - **State A (No vault yet):** Shows *"Set a passphrase to encrypt your API keys on this device"* + passphrase input + *"Create Vault"* button.
   - **State B (Vault exists on disk, currently locked after page reload):** Shows *"Your local key vault is locked"* + passphrase input (`data-testid="local-vault-passphrase"`) + *"Unlock"* button (`data-testid="local-vault-unlock"`) + *"Reset vault"* link.
   - **State C (Vault unlocked in RAM):** Shows the three key slots (`Gemini Free`, `Gemini Paid`, `OpenRouter`), `Free | Paid` chat toggle, and a *"Lock now"* button. Every edit immediately re-encrypts the envelope in `localStorage`.
3. **Keys Tab in Mode 2 (`vps`):**
   - If `vaultUnlocked === false` (server rebooted while session token remained valid): shows a single password input (`data-testid="vps-vault-unlock-password"`) calling `POST /api/auth/unlock`.
   - When unlocked: shows the three key slots with their server status (`Configured (…a1b2)` or `Not set`). Pasting a key and clicking Save calls `PUT /api/account/keys`. Clicking Clear calls `PUT /api/account/keys` with `apiKey: null`. Toggling `Free | Paid` calls `PUT /api/account/settings`.
   - Note at top: *"Synced across all devices signed into `<email>`. Encrypted at rest on the server."*
4. **Users Tab (Owner Account #1 Only):**
   - Fetches `GET /api/admin/users` when the tab opens.
   - Renders each user row: `email`, badge (`Owner` for `#1`, `Enabled` / `Disabled` for others), **Enable / Disable** button (hidden/disabled for Account #1 so the owner can never lock themselves out), and **Reset Password** inline action.
   - Top form: `Email` + `Initial password` + **"Add User"** button (`data-testid="admin-add-user-submit"`) calling `POST /api/admin/users`.

---

## 5. Sidebar Mode Switcher & Re-Lock Prompt

In `src/ui/workspace/Sidebar.tsx`:
- In the top user/account menu:
  - When in **Mode 1 (`local`)**: shows `"Local Workspace"` and an action **"Sign in to Server…"** (which returns to `AuthGate` or opens the login modal).
  - When in **Mode 2 (`vps`)**: shows signed-in `email` (`you@example.com`), a **"Switch to Local Workspace"** action, and **"Sign Out"**.

---

## 6. Phase 3 Unit & Integration Tests

Create `src/tests/local-vault-and-isolation.test.ts` verifying:
1. **Zero plaintext on disk:** Saving a key (`AIzaSySecretKey12345678901234567890`) in Local mode writes `markbrain:local:keyVault` where the raw string does **not** appear anywhere in `localStorage`.
2. **RAM-only lifetime:** Calling `lockLocalVault()` (simulating tab close/reload) makes `resolveLaneKey()` return `null` while keeping the encrypted vault intact in `localStorage`; calling `unlockLocalVault(wrongPass)` returns `false`; calling `unlockLocalVault(rightPass)` restores `resolveLaneKey()` to the original key.
3. **Namespace isolation:** Drafts and model settings written in `local` mode (`markbrain:local:*`) are completely invisible when switched to `vps` mode (`markbrain:vps:*`), and vice versa.
4. **Routing separation:** In `vps` mode, `gateway/api.ts` always calls `/api/*` with `Authorization: Bearer <token>` and never invokes browser-direct `direct.ts`; in `local` mode, `gateway/api.ts` uses the unlocked RAM key via `direct.ts`.

---

## 7. Phase 3 Verification Gate

```bash
npm run lint
npm test
npm run build
```

Commit Phase 3:
```bash
git add -A
git commit -m "Phase 3: workspace mode isolation, WebCrypto local passphrase vault, VPS login gate, and Owner users UI"
```
