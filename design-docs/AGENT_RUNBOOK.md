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
`google-chrome --headless --screenshot` works (see §5).

---

## 1. Running the app

- **Command:** `bun run dev` (= `tsx server.ts`). There is no separate Vite
  process — `server.ts` mounts Vite as Express middleware in dev mode and
  serves `dist/` when `NODE_ENV=production`.
- **Port:** from `.env` (`PORT`, currently `3030`). Before starting anything,
  check whether it's already up (`curl http://localhost:3030/api/health`) —
  long-lived dev servers are normal here.
- **Env:** `.env` is gitignored and must exist (copy `.env.example`). The
  Firebase vars are injected client-side by `vite.config.ts` `define`, reading
  `process.env` — so the server process must see them (it does: `dotenv.config()`
  runs before Vite's config resolves).
- **HMR:** enabled by default; `DISABLE_HMR=true` disables watching (AI Studio
  artifact — don't set it unless you want a frozen bundle).

## 2. Why agents get stuck: the auth gate

`src/App.tsx` renders, in order:

1. `!authInitialized` → "Connecting to MarkBrain Substrate…" loader
2. `!currentUser` → `AuthGate` — button label is **"Continue with Google"**,
   wired to `signInWithPopup` (a human + a real Google account + a popup)
3. zero projects → `ProjectGenesis` (create-new-project screen)
4. otherwise → main app (sidebar + chat/graph)

There is **no guest mode, no demo mode, no env bypass**. Headless, the
auth observer resolves with `null` and you sit at the gate forever. That's
what the mock below defeats — entirely at the network/storage layer, **no repo
code changes**.

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
node scripts/headless-capture.cjs --real    # real-data mode (§3.5, needs .env token)
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
  `localStorage` keys and body text as a debug breadcrumb.
- The `.cjs` extension is load-bearing: `package.json` has `"type": "module"`.

### 3.5 Real-data mode (`--real`) — David's own data, read-only

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

### 3.6 Local branch + database backup/restore

Two gate branches: **Continue with Google** (Firestore) / **Continue locally**
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
# A: Continue locally → create → Backup DB (schema-validated JSON)
# B: fresh context → Continue locally → Restore → same UI
```

## 5. Screenshots without any mock (loader / gate states)

```bash
google-chrome --headless=new --disable-gpu --no-sandbox \
  --window-size=1440,900 --virtual-time-budget=8000 \
  --screenshot=/tmp/gate.png http://localhost:3030/
```

Caveat: `--virtual-time-budget` races network timing — you may catch the
loader rather than the gate. For anything deterministic, use the script (it
*waits* for a screen to identify itself).

## 6. Re-verify before trusting, when…

- **Firebase major version bump** → storage key format, `accounts:lookup`
  response shape, persistence backend could all have moved. Symptom of a wrong
  guess: you're back at the gate with a 400 in console.
- **Auth flow edits in `App.tsx`** → the render-order branches and the
  "Continue with Google" selector.
- **A Vite HMR error overlay** covering the UI after someone (me) briefly
  committed broken JSX: it can linger — hard reload or restart the dev server;
  don't debug the app under it.

## 7. What this mock does NOT do

- No Gemini traffic: `/api/chat`, `/api/chat/stream` (SSE), `/api/tts`, etc.
  are never called — exercising them spends real API quota and needs a real
  session flow. Not covered, not attempted.
- No Google Drive/Docs import flows (`googleDriveService.ts` — popup OAuth).
- No Firestore CRUD (held, per §3.3).
- It is a **viewer rig**, not a test rig. Functional testing lives in
  `src/tests/user-journeys.test.ts` (vitest).