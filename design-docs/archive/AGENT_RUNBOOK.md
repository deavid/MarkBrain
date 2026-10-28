# AGENT RUNBOOK — run, access, and mock MarkBrain (headless, zero interaction)

> **Who this is for:** AI agents (current and future) who need to start the
> app, get past the auth gate, and capture screenshots **without a human at the
> keyboard**.
>
> Written 2026-10-17 from a live goose session where every mechanism below was
> verified against the running code — not guessed. Where something is
> version-sensitive it says so; re-verify those bits before trusting them.

## TL;DR

```bash
bun run dev                     # app: http://localhost:${PORT:-3030}  (check if already up first)
npm i --prefix /tmp/pw playwright-core   # one-time capture dependency
node scripts/headless-capture.cjs        # → chat/graph/mobile PNGs in $TMPDIR/markbrain-shots
```

Screenshots of the **loader/auth-gate** states need no mock at all — plain
`google-chrome --headless --screenshot` works (see §6). For driving the UI
headlessly, the selector map lives in §7.

---

## 1. Running the app

- **Command:** `bun run dev` (= `tsx server.ts`). There is no separate Vite
  process — `server.ts` mounts Vite as Express middleware in dev mode and
  serves `dist/` when `NODE_ENV=production`.
- **Port:** from `.env` (`PORT`). Before starting anything,
  check whether it's already up (`curl http://localhost:3030/api/health`) —
  long-lived dev servers are normal here.
- **Env:** `.env` is gitignored and must exist (copy `.env.example`). The
  Firebase vars are injected client-side by `vite.config.ts` `define`, reading
  `process.env` — so the server process must see them (it does: `dotenv.config()`
  runs before Vite's config resolves).
- **HMR:** enabled by default; `DISABLE_HMR=true` disables watching (AI Studio
  artifact — don't set it unless you want a frozen bundle). **No watching means
  no cache invalidation:** a running server keeps serving the transform it read
  first, so a probe can pass or fail against code you already changed. Restart
  the server (or bust the URL) after editing UI files, and never trust a probe
  result taken against a server older than your last edit.

## 2. Why agents get stuck: the auth gate

`src/App.tsx` renders, in order:

1. `!authInitialized` → "Connecting to MarkBrain Substrate…" loader
2. `!currentUser` → `AuthGate` — **two branches**:
   - **"Continue with Google"** → `signInWithPopup` (a human + a real Google
     account + a popup) — Firebase/Firestore backend
   - **"Use local storage instead"** → no account, no network auth; IndexedDB backend
     (the Local branch, §5). Headless this one is a single click.
3. signed in but project list unresolved (`cloudProjectsCount === null`) →
   boot loader "Loading cloud projects…" (never flash Genesis to a returning user)
4. zero projects → `ProjectGenesis` (create-new-project screen; also hosts
   "Restore from a database backup instead" — a fresh browser has no Sidebar)
5. otherwise → main app (sidebar + chat/graph)

Pre-Local-branch history said "there is no guest mode" — that's obsolete.
Headless with no mock at all you land on the Gate; from there **Continue
locally** is the zero-ceremony path. The mock below exists for screenshotting
the *cloud* flows without a human popup — entirely at the network/storage
layer, **no repo code changes**.

## 3. The mock — three intercepts

Implemented in `scripts/headless-capture.cjs`; the theory:

### 3.1 Seed Firebase auth persistence (init script)

Before any app script runs, write into `localStorage`:

```
key:   firebase:authUser:<FIREBASE_API_KEY>:[DEFAULT]
value: JSON User object (uid, email, providerData, apiKey, stsTokenManager, …)
```

Gotchas, each learned the hard way (ground truth read out of `@firebase/auth`
dist — `getAuth` → `PersistenceUserManager.create`):

- **Storage shape depends on which persistence you're writing.** `getAuth()`
  initializes with `[indexedDBLocalPersistence, browserLocalPersistence,
  browserSessionPersistence]` — **IndexedDB wins** when available. The IndexedDB
  record is the envelope `{fbase_key: 'firebase:authUser:…', value: userObject}`
  (DB `firebaseLocalStorageDb`, store `firebaseLocalStorage`, keyPath
  `fbase_key`). `browserLocalPersistence` stores the **bare user object** as
  JSON. On boot, `create()` scans *every* persistence and **migrates** a
  parseable bare user object from localStorage into IndexedDB. So seeding
  localStorage = write `JSON.stringify(userObject)` (bare). Seeding the envelope
  into localStorage makes `UserImpl._fromJSON` throw (no top-level `uid`) and
  the SDK silently **evicts** the key — signed out, zero network, no error.
- `apiKey` inside the JSON **must equal** the client config key (the
  `FIREBASE_API_KEY` from `.env`) — hydration silently discards mismatches.
- `stsTokenManager.expirationTime` = **far-future ms epoch**. If it looks
  expired, Auth tries to refresh with the garbage refresh token before the
  auth observer ever fires, and you stall on the loader.
- Don't "helpfully" mutate the record (`accessToken = ''` etc.) — any
  hand-edited shape can trip the same silent eviction. Seed what the SDK's own
  persistence layer wrote.
- Seeding alone is **not enough** (next section).

### 3.2 Fulfill `accounts:lookup` (the part that bit us)

Auth verifies the persisted user via
`POST https://identitytoolkit.googleapis.com/v1/accounts:lookup`. With a fake
access token this returns **400 → the SDK clears the session → back at the
gate** (with an unexplained `Failed to load resource: 400` in console).

So: route that URL and fulfill `200` with
`{ users: [{ localId, email, displayName, emailVerified, providerData, idToken, refreshToken, expiresIn }] }`
— shape in the script. Also route `securetoken.googleapis.com` (token refresh)
as a belt-and-braces fallback; far-future expiration should mean it never
fires.

### 3.3 HOLD Firestore (belt-and-braces — data comes from the fixture now)

Route `firestore.googleapis.com` and just… don't respond. Project data under
`?fixture=1` arrives via the fixture seam (§3.4) without touching the SDK, so
the hold is defense-in-depth: `testConnection` and any stray write can't
escape. Effects:

- `listUserProjects()` (`persistenceService.ts`) stays pending →
  `cloudProjectsCount` stays `null` → note `null === 0` is **false**, so the
  `ProjectGenesis` branch doesn't trigger → main app renders with the local
  default workspace (`proj-unhaunter`) + demo data from `src/data/initialData.ts`.
- The old permanent **"Syncing…"** badge is gone (sync chrome extirpated
  2026-10-17); a Firestore offline warning in console from the held request is
  expected, harmless.

### 3.4 The fixture seam (data layer)

`src/data/headlessFixture.ts` — ONE typed `ProjectSnapshot` (same shape
Firestore holds), loaded only when `?fixture=1` is present **and** the build
is dev (`import.meta.env.DEV`, tree-shaken in prod). `listUserProjects` and
`loadProjectSnapshot` return it; `saveProjectSnapshot` no-ops (`isCaptureMode`
covers `?fixture` and `?capture`). It replaced the old three-layer seed chain
(localStorage registry → static `INITIAL_PROJECTS` → cloud overlay), which was
extirpated in the "Storage IS Firebase" refactor (scratch/pending.md).
- **Zero cloud reads/writes.** The fixture seam serves data before the SDK;
  the hold ensures nothing real can be touched either.

(If instead Firestore *resolves* with `[]`, you land on `ProjectGenesis` —
also a capturable screen. And note `Create & Launch Workspace` calls `setDoc`,
so genesis *creation* hangs under this hold: the mock supports **viewing**, not
cloud CRUD.)

## 4. Capture script

```bash
node scripts/headless-capture.cjs           # fixture mode (default, offline)
node scripts/headless-capture.cjs --real    # real-data mode (§4.1, needs .env token)
```

- **Dependency:** `playwright-core` (bootstrap: `npm i --prefix /tmp/pw playwright-core`,
  or add it as a devDependency). It does **not** download browsers; it reuses
  one: `$CHROME_BIN`, newest `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`,
  or system Chrome/Chromium.
- **Outputs:** `$MARKBRAIN_SHOTS` (default `$TMPDIR/markbrain-shots`):
  `01-chat-view.png` (1440×900), `02-spatial-graph.png`, `03-mobile.png` (390×844).
- **Overrides:** `MARKBRAIN_URL`, `MARKBRAIN_SHOTS`, `CHROME_BIN`.
- **Runtime:** ~15s including settle-wait. It also logs console errors,
  failed responses, and how many Firestore requests it held — read those lines
  before trusting a run. If it exits on `screen: unknown`, it dumps
  `localStorage` keys, IndexedDB auth records (`fbase_key`/uid), and body text
  as a debug breadcrumb — plus a `__mb_seeded` marker the init script leaves in
  `localStorage`, so you can tell "seed never ran" from "SDK evicted the key".
- The `.cjs` extension is load-bearing: `package.json` has `"type": "module"`.

### 4.1 Real-data mode (`--real`) — David's own data, read-only

```bash
node scripts/headless-capture.cjs --real     # or MARKBRAIN_CAPTURE_MODE=real
```

- **Requires** `HEADLESS_AUTH_USER_B64` in `.env` (gitignored) — the verbatim
  storage record harvested from David's own signed-in localhost session (the
  `{fbase_key, value}` envelope; base64). `HEADLESS_REFRESH_TOKEN` is kept as a
  cross-check canary. No Google cookies are ever stored or sent.
- **How it authenticates:** the envelope is unwrapped and `value` (the bare user
  object) is seeded into localStorage **with zero field mutation** — the SDK's
  own migration path hydrates it into IndexedDB, then verifies it live via
  `accounts:lookup` (seen: `→ 200 identitytoolkit.googleapis.com/v1/accounts:lookup`).
  If the captured accessToken has expired by run time, the SDK does a genuine
  `securetoken.googleapis.com` refresh on its own; if still valid the session
  just boots. No intercepts — auth and Firestore WebChannel hit Google live.
- **Why it can't write:** navigates to `/?capture=1`, which flips
  `isCaptureMode()` in `persistenceService.ts` — every `saveProjectSnapshot`
  is a no-op **before** it reaches the SDK. Reads are real (David's
  `users/{uid}/projects/**` via `isOwner` rules); writes die in app code.
- **What you see:** the real project list and real project snapshots (turns,
  artifacts, graph) instead of `Fixture Substrate`. Verified 2026-10-18 00:18 —
  `screen: main`, Unhaunter + real artifacts in the screenshots.
- **Trust boundary:** the refresh token is owner-scope R/W on David's own
  Firestore subtree only — no Firebase console, no admin APIs. The sharp edge
  David acknowledged: the same token can call self-service Identity Toolkit
  endpoints (e.g. `accounts:delete`). `.env` stays gitignored; never log it.
- Fixture mode (default) remains the safe path: zero cloud traffic.
- **Capture runs are strictly SERIAL — one Chromium at a time.** Parallel runs
  stacked 40+ Chromiums and systemd-oomd killed the whole agent scope
  (2026-10-18 00:01). Always `browser.close()` in `finally`; never batch.

## 5. Local branch + database backup/restore

Two gate branches: **Continue with Google** (Firestore) / **Use local storage instead**
(IndexedDB, no account). Only `persistenceService.ts` knows both exist —
`getBackend()` reads meta-key `markbrain:backend`, dispatches the four CRUD
functions; `localBackend.ts` is its private adapter. Everything else (App,
Sidebar, Genesis) sees a `currentUser` and stays agnostic.

- **Backup / Restore** (Sidebar → Import/Export I/O → Backup DB / Restore DB;
  Genesis → "Restore from a database backup instead"): canonical
  `markbrain-database` v1 JSON — export format IS the architecture, works on
  either backend, restore into a different backend than it was exported from.
  Local restore = full replace (one IDB transaction); Firestore restore =
  upsert (never deletes remote docs missing from the file).
- **Round-trip acceptance test** (serial, one Chromium, exit 0/1):

```bash
node scripts/roundtrip-test.cjs
# A: Use local storage instead → create → Backup DB (schema-validated JSON)
# B: fresh context → Use local storage instead → Restore → same UI
```

Also `node scripts/delete-test.cjs` — project deletion acceptance (create →
Deck → trash → named confirmation modal → delete → Genesis → IDB empty).
Both scripts are serial single-Chromium, exit 0/1.

## 6. Screenshots without any mock (loader / gate states)

```bash
google-chrome --headless=new --disable-gpu --no-sandbox \
  --window-size=1440,900 --virtual-time-budget=8000 \
  --screenshot=/tmp/gate.png http://localhost:3030/
```

Caveat: `--virtual-time-budget` races network timing — you may catch the
loader rather than the gate. For anything deterministic, use the script (it
*waits* for a screen to identify itself).

## 7. Navigating the app headlessly — selectors that work

**Two-speed test gate (2026-10-25):** `npm run lint && npm test` is the fast
everyday gate (515 tests, ~2.5s). The real-server E2E journeys run explicitly:
`npm run test:e2e` (`src/tests/e2e/`, ~3s) — real app on a real socket, fake
LLM at the fetch boundary, zero external calls. Run the E2E lane whenever a
change touches send/queue/server lifecycle/reconcile, and always in the full
verification pack.

The acceptance scripts (`scripts/roundtrip-test.cjs`, `scripts/delete-test.cjs`)
encode this, but the map matters when you write new interactions:

**Screens & paths**
- Gate: `getByRole('button', { name: 'Use local storage instead' })` — **role selector,
  not `getByText`**: the explanatory copy contains the same words and Playwright
  strict mode will refuse the click (learned the hard way).
- Gate (cloud): `getByText('Continue with Google')` — needs a real popup; the
  fixture mock fulfills `accounts:lookup` so this boots without a human.
- Genesis form: `getByPlaceholder('e.g. Distributed Optical Engine')` (name),
  `getByPlaceholder('e.g. OPT-ENG')` (code), submit
  `getByRole('button', { name: /Create & Launch Workspace/ })`.
- Workspace Deck (project selection): sidebar **"Active Project"** accordion
  (collapsed by default) → **"Create / Switch in Deck"** button.
- I/O accordion (Backup DB / Restore DB): sidebar **"Import / Export I/O"**
  (collapsed by default) → `getByText('Backup DB')` / `getByText('Restore DB')`.
- Delete flow: per-row `[aria-label*="Delete project"]` (it `stopPropagation`s —
  the whole row is a click target for "open chat") → confirmation modal
  `Delete “{name}”?` → `getByRole('button', { name: /Delete permanently/ })`.
- Fresh browser with zero projects: there is **no Sidebar on Genesis** — the
  restore trigger lives on the Genesis screen itself ("Restore from a database
  backup instead") and feeds a hidden `input[type=file][accept*="json"]`
  (`locator.setInputFiles(...)` works on hidden inputs).
- Backup download: `Promise.all([page.waitForEvent('download'), click])` —
  context needs `acceptDownloads: true`.

**Gotchas**
- Sidebar accordions default **collapsed** except Cloud/Artifacts/Optical —
  open before clicking anything inside.
- Import/restore ends in `window.location.reload()` — wait for content after,
  not for a route change.
- `page.on('dialog')` — import failures `alert()`; dismiss and fail the run.
- Identifier smart quotes: the delete modal uses `“{name}”` (U+201C/201D) in
  its `getByText` match — copy exactly.
- All test scripts are `.cjs` (`"type": "module"` in package.json) and resolve
  `playwright-core` from `/tmp/pw/node_modules` — bootstrap once per machine.
- **One Chromium at a time** (OOM law, §4.1). Never parallelize capture or
  test runs.

## 8. Re-verify before trusting, when…

- **Firebase major version bump** → storage key format, `accounts:lookup`
  response shape, persistence backend could all have moved. Symptom of a wrong
  guess: you're back at the gate with a 400 in console.
- **Auth flow edits in `App.tsx`** → the render-order branches and the
  "Continue with Google" selector.
- **A Vite HMR error overlay** covering the UI after someone (me) briefly
  committed broken JSX: it can linger — hard reload or restart the dev server;
  don't debug the app under it.

## 9. What the rig does and does NOT do

- No Gemini traffic: `/api/chat`, `/api/chat/stream` (SSE), `/api/tts`, etc.
  are never called — exercising them spends real API quota and needs a real
  session flow. Not covered, not attempted.
- No Google Drive/Docs import flows (`googleDriveService.ts` — popup OAuth).
- Fixture mode holds all Firestore (§3.3). Real-data mode (`--real`) does live
  reads with writes no-op'd at the app layer (`?capture=1`). Local branch does
  real IndexedDB CRUD in the browser profile — throwaway contexts only.
- Screenshot capture is a **viewer rig**; the *functional* acceptance rigs are
  `scripts/roundtrip-test.cjs` (export/import round-trip) and
  `scripts/delete-test.cjs` (deletion + confirmation) — both Local-branch,
  both serial. The pre-existing `src/tests/user-journeys.test.ts` (vitest) is
  declared but blocked on a stale `node_modules` install and has never run.
- The Firestore side of every feature (Local branch included) is David's to
  click — the agent verifies the local backend; that split is deliberate.