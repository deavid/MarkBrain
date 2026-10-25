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
| `PORT` | the dev/prod port | `3000` |
| `MARKBRAIN_OWNER_EMAIL` / `MARKBRAIN_OWNER_PASSWORD` | VPS first boot: bootstrap Owner Account #1 automatically (Phase 2) | nothing — bootstrap the owner later with `npm run user -- create … --owner` |

There are **no cloud-auth variables**. Firebase, Firestore, and Google Drive
were removed (design-docs/19). API keys are never env vars: Local mode stores
them in the browser passphrase vault, Connected mode in the server's encrypted
`user_secrets` table (see SECURITY.md, Two-Mode boundary).

`.env*` is gitignored and stays that way — never put a key in `.env.example`
or any other tracked file. `npm run build` runs `scripts/verify-clean-dist.cjs`
and fails if any secret-shaped string lands in `dist/`.

## 4. Run

```bash
npm run dev                 # Node:  → http://localhost:$PORT  (PORT from .env; 3000 default)
bun run dev                 # Bun:   same command, same URL
```

One process serves the API and the UI (Vite runs as middleware, so there is no
second dev server and no proxy to configure). First screen is a gate with two
paths: **Sign in to Server** (Connected VPS Workspace — email + password against
this server) or **Use Local Workspace** (no account, this browser only). Local
mode is the intended key-free path.

To click **Sign in to Server** on your own machine, create an Owner account
first (writes the local SQLite DB under `data/`, which is gitignored):

```bash
npm run user -- create you@example.com --password <pw> --owner    # or: bun run user -- …
```

(or set `MARKBRAIN_OWNER_EMAIL` / `MARKBRAIN_OWNER_PASSWORD` and let the first
boot bootstrap it — never commit either). Everything else needs zero setup.

## 5. VPS / Self-Hosted Mode (Connected Workspace)

Two-mode architecture (design-docs/19–21): Local needs zero accounts; the
Connected workspace runs the SQLite daemon behind Caddy on your own box.

**Bootstrap Owner Account #1** (immutable — it can never be disabled):

```bash
npm run user -- create you@example.com --password <pw> --owner
# or let the server do it on first boot: set MARKBRAIN_OWNER_EMAIL +
# MARKBRAIN_OWNER_PASSWORD in the service environment (never in git).
```

**Deploy** from the developer machine with Ansible (builds locally, rsyncs,
installs systemd + Caddy, health-checks):

```bash
cp deploy/ansible/inventory.ini.example deploy/ansible/inventory.ini   # gitignored
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml \
  -e "markbrain_owner_password=..."    # first bootstrap only
```

Templates: `deploy/Caddyfile` (static from disk, `/api/*` → 127.0.0.1:3032 with
SSE passthrough), `deploy/markbrain.service` (hardened systemd unit), and the
playbook under `deploy/ansible/`. Runtime data lives in `/var/lib/markbrain/`
(SQLite + TTS Ogg cache) — never in git.

## 6. Command map

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

## 7. Verify the install

```bash
npm run lint        # tsc --noEmit — silent means clean
npm test            # vitest — 469 tests across 51 files
npm run dev         # then open the printed URL: gate or studio, no red console spam
```

Optional, the browser gates (needs the app already running in another terminal):

```bash
npm i --prefix /tmp/pw playwright-core    # one-time
node scripts/evidence.cjs                 # full journey suite + geometry audit
node scripts/cleanup-tool-test.cjs        # archive → permanent delete acceptance
```

The headless harnesses (`headless-capture.cjs`, `cleanup-tool-test.cjs`) still
carry pre-Phase-1 Firebase seeding and are **legacy** — Firebase was removed in
design-docs/19; they are not part of the verification gate (`lint + test +
build`). `scripts/evidence.cjs` runs against the Local fixture with no cloud
accounts and no keys.

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `npm error code ERESOLVE` | you dropped `--legacy-peer-deps` (see §2) |
| `Cannot find module '.../node_modules/.bin/tsx'` | `npm install` never ran |
| `npm test` refuses to start / engines warning | Node older than 22.12, or an odd major (23/25) — `nvm use 22` or `24` |
| `EADDRINUSE` on startup | another dev server owns the port; change `PORT` in `.env` |
| Blank screen, no console error | check the terminal running `npm run dev`; the Express layer logs the failure there |
| `npm ci` fails | it needs `package-lock.json`, which only exists after your first `npm install` |
| Windows | same commands; use `copy .env.example .env` and PowerShell's `$env:PORT` if you need a one-off port |
