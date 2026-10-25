# 21A — Phase 1: The Great Purge & Static Build Secret Guard

> **Phase:** 1 of 7
> **Goal:** Completely remove Firebase, Firestore, Google Drive integration, and the unauthenticated QR/Mailbox pairing relay from the codebase, dependencies, and tests; add a hard build-time verification script (`scripts/verify-clean-dist.cjs`) that fails `npm run build` if any secret-shaped string or cloud project ID ever lands in `dist/`.
> **Prerequisite:** Clean working tree on your branch.

---

## 1. Files to DELETE Outright

Delete all of the following files using `rm`:

```bash
rm -f \
  src/services/firebase.ts \
  src/services/stores/firestoreStore.ts \
  src/services/googleDriveService.ts \
  src/utils/authErrors.ts \
  server/routes/auth.ts \
  server/routes/mailbox.ts \
  src/gateway/pairing.ts \
  src/ui/workspace/usePairingTransfer.ts \
  src/tests/mailbox.test.ts \
  src/tests/pairing.test.ts \
  src/tests/save-quota.test.ts \
  firebase-applet-config.json.example \
  firebase-blueprint.json \
  firestore.rules
```

*(Note: if `firebase-applet-config.json` exists locally in the working directory, delete it as well.)*

---

## 2. Remove `firebase` from `package.json`

In `package.json`:
1. Under `"dependencies"`, delete the line:
   ```json
   "firebase": "^13.0.0",
   ```
2. Update `"build"` under `"scripts"` so every production build automatically runs the secret guard after `vite build`:
   ```json
   "build": "vite build && node scripts/verify-clean-dist.cjs",
   ```
3. Run `npm uninstall firebase` (or update lockfile) so `node_modules/firebase` is gone.

---

## 3. Create the Static Build Secret Guard (`scripts/verify-clean-dist.cjs`)

Create `scripts/verify-clean-dist.cjs` with the following exact implementation:

```js
#!/usr/bin/env node
/**
 * Build guard: scans every file in `dist/` after `vite build` and fails with
 * exit code 1 if any API key prefix, Firebase config artifact, or private key
 * marker was bundled into the client assets.
 */
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const FORBIDDEN_PATTERNS = [
  { name: 'Google API key (AIza...)', regex: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: 'OpenRouter API key (sk-or-...)', regex: /sk-or-v1-[0-9a-f]{32,}/ },
  { name: 'OpenAI-style API key (sk-proj-...)', regex: /sk-proj-[0-9A-Za-z_-]{20,}/ },
  { name: 'Firebase config env leak', regex: /VITE_FIREBASE_API_KEY|firebaseapp\.com/ },
  { name: 'Private key PEM block', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|css|html|json|map)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

if (!fs.existsSync(DIST_DIR)) {
  console.error(`[verify-clean-dist] ERROR: dist directory not found at ${DIST_DIR}`);
  process.exit(1);
}

const files = walk(DIST_DIR);
const violations = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  for (const pat of FORBIDDEN_PATTERNS) {
    const match = content.match(pat.regex);
    if (match) {
      violations.push({
        file: path.relative(DIST_DIR, file),
        rule: pat.name,
        sample: match[0].slice(0, 16) + '…',
      });
    }
  }
}

if (violations.length > 0) {
  console.error('[verify-clean-dist] FATAL: Secret or forbidden cloud identifier found in dist/:');
  for (const v of violations) {
    console.error(`  - ${v.file}: ${v.rule} (${v.sample})`);
  }
  process.exit(1);
}

console.log(`[verify-clean-dist] DIST CLEAN: scanned ${files.length} files, 0 secret patterns found.`);
```

---

## 4. Surgical Edits to Remaining Files

### 4.1 `src/types/index.ts` — Add a lightweight `WorkspaceUser` type
Since `import type { User } from 'firebase/auth'` is gone, define a clean, framework-free user type in `src/types/index.ts`:

```ts
export interface WorkspaceUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  isOwner?: boolean;
  mode?: 'local' | 'vps';
}
```

### 4.2 `src/services/persistenceService.ts`
- Remove `import { firestoreStore } from './stores/firestoreStore';`.
- Change `export type StorageBackend = 'local';` (Phase 4 will add `'vps'` when `vpsStore` is introduced).
- Update `getBackend()` to return `'local'` and `getStore()` to return `localStore`.
- Keep `withDeadline`, `SAVE_ACK_DEADLINE_MS`, `LOAD_DEADLINE_MS`, `hydrateSnapshot`, and `?capture=1` / `?fixture=1` guards intact so all loader and watchdog tests continue to work.

### 4.3 `src/application/sessionMachine.ts` and `src/domains/DomainRegistry.tsx`
- Replace `import type { User } from 'firebase/auth'` with `import type { WorkspaceUser } from '../types'`.
- In `DomainRegistry.tsx`, remove imports from `../services/firebase`.
- Until Phase 3 wires the VPS login calls into `sessionMachine.ts`, wire `signIn`, `logOut`, and `subscribeToAuth` to default to the `LOCAL_USER` (`{ uid: 'local', email: 'local@markbrain.local', displayName: 'Local Workspace', photoURL: null, mode: 'local' }`).

### 4.4 `src/ui/workspace/AuthGate.tsx`
- Remove imports of `classifyAuthError` and `isFirebaseConfigured`.
- Remove the Google SVG button and Firebase console links (`console.firebase.google.com`, `console.cloud.google.com`).
- Leave the clean gate with **"Continue Locally"** (Phase 3 will add the **"Sign in to Server"** email + password form right above it).

### 4.5 `src/ui/artifacts/ImportModal.tsx`
- Remove all imports from `../../services/googleDriveService` and `firebase/auth`.
- Remove the `'drive'` tab and all Drive state (`user`, `accessToken`, `scopeStatus`, `selectedDriveFile`, `directDocUrl`, `handleDriveSignIn`, `handleOpenPicker`, etc.).
- Default `activeTab` to `'upload'` (Local File Upload / Multi-File Session / Paste YAML), which is now the sole, clean import flow.

### 4.6 `src/ui/workspace/Sidebar.tsx` and `src/App.tsx`
- In `App.tsx`:
  - Remove `import { usePairingTransfer } from './ui/workspace/usePairingTransfer'`.
  - Remove `pairing = usePairingTransfer(...)`, `onSendToPhone`, and `pairing.modal` rendering.
- In `Sidebar.tsx`:
  - Remove `onSendToPhone` from `SidebarProps` and remove the `data-testid="send-to-phone"` button in the Database section (making the Export Backup and Import Backup buttons a clean 2-column grid).

### 4.7 `server/app.ts` and `server/lib/csp.ts`
- In `server/app.ts`:
  - Remove `import { registerAuthRoutes } from './routes/auth';` and `registerAuthRoutes(app);`.
  - Remove `import { registerMailboxRoutes } from './routes/mailbox';` and `registerMailboxRoutes(app);`.
- In `server/lib/csp.ts`:
  - Remove `https://*.googleapis.com` / `https://*.firebaseio.com` / `https://apis.google.com` allowances that existed only for Firebase Auth / Google Picker, keeping `https://generativelanguage.googleapis.com` and `https://openrouter.ai`.
- In `src/gateway/api.ts`:
  - Remove `export function authConfig()`.

### 4.8 Update `.env.example`
Remove all `FIREBASE_*`, `VITE_FIREBASE_*`, `FIRESTORE_*`, `GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_PICKER_API_KEY` variables from `.env.example`.

---

## 5. Update Affected Tests

1. **`src/tests/shell-mode.test.ts`:**
   - Remove assertions referencing `/api/mailbox` or `/api/auth/config`.
2. **`src/tests/loader-error-vs-absent.test.ts` and `src/tests/save-watchdog.test.ts`:**
   - Ensure they mock the `ProjectStore` port (`localStore` / `persistenceService`) rather than importing `firebase/firestore` or `firestoreStore` directly.

---

## 6. Phase 1 Verification Gate (Must Pass 100% Before Commit)

Run these exact commands and verify every single one succeeds:

```bash
# 1. Verify zero references to Firebase or Google Drive remain in source:
! rg -i "firebase|firestore|googleDriveService|usePairingTransfer" src/ server/ package.json

# 2. Typecheck:
npm run lint

# 3. Full test suite:
npm test

# 4. Production build + dist secret scanner:
npm run build
```

Commit Phase 1:
```bash
git add -A
git commit -m "Phase 1: purge Firebase, Firestore, Google Drive, and QR mailbox; add dist secret guard"
```
