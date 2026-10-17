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
npm run dev                      # app: http://localhost:${PORT:-3030}  (check if already up first)
npm i --prefix /tmp/pw playwright-core   # one-time capture dependency
node scripts/headless-capture.cjs        # → chat/graph/mobile PNGs in $TMPDIR/markbrain-shots
```

Screenshots of the **loader/auth-gate** states need no mock at all — plain
`google-chrome --headless --screenshot` works (see §5).

---

## 1. Running the app

- **Command:** `npm run dev` (= `tsx server.ts`). There is no separate Vite
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

Gotchas, each learned the hard way:

- `apiKey` inside the JSON **must equal** the client config key (the
  `FIREBASE_API_KEY` from `.env`) — hydration silently discards mismatches.
- `stsTokenManager.expirationTime` = **far-future ms epoch**. If it looks
  expired, Auth tries to refresh with the garbage refresh token before the
  auth observer ever fires, and you stall on the loader.
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
node scripts/headless-capture.cjs
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