# Install & run without Bun (Node.js)

MarkBrain is a plain Node.js app. Bun appears all over this repo's docs because
it is the runner the maintainer uses — it is **never a requirement**: there is
no `Bun.*` API, no `bun:` import and no `bun test` anywhere in `src/`, `server/`
or `scripts/`, and `bun run dev` is literally `tsx server.ts`. Swap the runner
and nothing else changes.

Everything below is for a fresh clone on Node.

## 1. Prerequisites

| | |
|---|---|
| **Node.js 22.12+** (22 LTS or 24 LTS) | `vitest@5` declares `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` — that is the binding floor, and it is why Node 20/21 and odd majors 23/25 are out. `vite@8` is milder (`^20.19.0 \|\| >=22.12.0`), and `vite.config.ts` also needs `import.meta.dirname` (20.11+). |
| **npm 10+** | ships with Node |
| Chromium (optional) | only for the headless scripts (`scripts/*.cjs`) |
| Everything else | no Bun, no Google Cloud account, no Docker |

Written and run against Node 22.19.0 / npm 11.11.0.

## 2. Install

```bash
npm install --legacy-peer-deps
```

**The flag is required.** npm's strict peer resolution stops with `ERESOLVE`
because the root devDependency `esbuild@^0.25` collides with the
`esbuild@^0.27 || ^0.28` that `vite@8` declares as an optional peer. Bun resolves
this silently; npm refuses. `--force` also works but is a blunter instrument.

Notes:

- npm writes `package-lock.json`. It is not tracked in this repo, so it will show
  up as a new untracked file; keep it if you want reproducible installs
  (`npm ci`), or ignore it. **Do not delete `bun.lock`** — that is the lockfile
  the maintainer's workflow is pinned to, and npm simply ignores it.
- The known real fix, if you'd rather drop the flag: raise the root `esbuild`
  devDependency to `^0.28` (or remove it, if nothing imports it) so the range
  stops fighting `vite@8`.
- Nothing is compiled up front. Dev and start run TypeScript directly through
  `tsx`, so there is no build step between you and the app.
- `npm audit` reports advisories in transitive dependencies (4 high at the time
  of writing). Bun does not audit, so this information is npm-only — it is not a
  difference between the two installs.

## 3. Configure (optional — all of it)

```bash
cp .env.example .env        # then fill in whatever you have
```

Env is layered, earliest wins: real OS/runtime env → `.env` → `.env.shared` →
`../MarkBrain/.env.markbrain-main.shared`. Missing files are skipped silently, so
you can start with an empty `.env` or none at all.

| Key | Turns on | If you skip it |
|---|---|---|
| `GEMINI_API_KEY` (AI Studio) | chat + streaming, chapter summaries, thread titles, document→artifact extraction, Gemini TTS | the server still runs: canned "Offline demo" chat reply, no titles, heuristic import extraction, browser speech synthesis for TTS |
| `FIREBASE_API_KEY` | the cloud branch: Google sign-in + per-user Firestore trees | **nothing breaks** — an empty key boots straight into Local mode (IndexedDB, this browser only), the gate hides the Google button, and a WARN in the console says so |
| `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIRESTORE_DB_ID` | the cloud branch only | ignored in Local mode |
| `PORT` | the dev/prod port | `3000` |
| `GOOGLE_PICKER_API_KEY` | the Drive/Docs import tab (shelved; also needs `VITE_GOOGLE_PICKER_ENABLED=true`) | paste-a-link import still works |

`.env*` is gitignored and stays that way — never put a key in `.env.example`,
`firebase-applet-config.json` or any other tracked file.

## 4. Run

```bash
npm run dev                 # → http://localhost:$PORT  (PORT from .env; 3000 default)
```

One process serves the API and the UI (Vite runs as middleware, so there is no
second dev server and no proxy to configure). First screen is a gate: *Continue
with Google* (only rendered when `FIREBASE_API_KEY` is set) or *Continue locally*
(no account, this browser only). Local mode is the intended key-free path.

## 5. Command map

| Bun (docs/scripts) | Node equivalent |
|---|---|
| `bun install` | `npm install --legacy-peer-deps` |
| `bun run dev` | `npm run dev` |
| `bun run start` | `npm start` |
| `bun run build` | `npm run build` → `dist/` |
| `bun run preview` | `npm run preview` — serves `dist/` |
| `bunx tsc --noEmit` | `npm run lint` (or `npx tsc --noEmit`) |
| `bunx vitest run` | `npm test` (or `npx vitest run`) |
| `node scripts/evidence.cjs` | identical — the scripts are plain Node CommonJS |
| `npm i --prefix /tmp/pw playwright-core` | identical |

## 6. Verify the install

```bash
npm run lint        # tsc --noEmit — silent means clean
npm test            # vitest — expect 151 passing across 18 files
npm run dev         # then open the printed URL: gate or studio, no red console spam
```

Optional, the browser gates (needs the app already running in another terminal):

```bash
npm i --prefix /tmp/pw playwright-core    # one-time
node scripts/evidence.cjs                 # full journey suite + geometry audit
node scripts/cleanup-tool-test.cjs        # archive → permanent delete acceptance
```

The headless scripts read `FIREBASE_API_KEY` from the layered env (they seed a
fake signed-in user whose key must match the vite-injected one) and hold
Firestore requests, so nothing real is touched — but they do need a key present.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `npm error code ERESOLVE` | you dropped `--legacy-peer-deps` (see §2) |
| `Cannot find module '.../node_modules/.bin/tsx'` | `npm install` never ran |
| `npm test` refuses to start / engines warning | Node older than 22.12, or an odd major (23/25) — `nvm use 22` or `24` |
| `EADDRINUSE` on startup | another dev server owns the port; change `PORT` in `.env` |
| Console `WARN ... FIREBASE_API_KEY is empty` | expected in Local mode, not an error |
| Blank screen, no console error | check the terminal running `npm run dev`; the Express layer logs the failure there |
| `npm ci` fails | it needs `package-lock.json`, which only exists after your first `npm install` |
| Windows | same commands; use `copy .env.example .env` and PowerShell's `$env:PORT` if you need a one-off port |
