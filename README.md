# MarkBrain

**Optical Context Substrate & Dialogue Architecture** — a mobile-first studio
for designing design systems: one project holds a chaptered dialogue, an
artifact graph, and a token-budgeted context compiler, so you always control
*what the LLM gets to see* (the actual pillar — see
[`design-docs/scratch/motivation.md`](design-docs/scratch/motivation.md)).

> **Source of truth is [`design-docs/`](design-docs/).** Start with
> `00_core_philosophy_soul.md` and `01_requirements_and_meta.md`; the
> collaboration charter/state lives in `design-docs/scratch/`. This README is
> just the front door.

## Stack

| Layer | What |
|---|---|
| Frontend | React 19 + Vite 8 + Tailwind 4, TypeScript, SPA in `src/` |
| Backend | Single `server.ts` — Express, mounts Vite (dev) or `dist/` (prod), proxies Gemini (`@google/genai`) |
| Auth/DB | Firebase Auth (Google popup) + Firestore, per-user trees, rules in `firestore.rules`; or the Local branch (no account, IndexedDB) |
| Domain logic | DDD-ish modules in `src/domains/` behind `DomainRegistry` — see `design-docs/03_DOMAIN_ARCHITECTURE_RULES.md` |
| Persistence | One port, two backends: Firestore (default) or local IndexedDB — `src/services/persistenceService.ts` is the only module that knows both exist. Canonical backup/restore JSON (Backup DB / Restore DB). |

## Run it

```bash
npm install
cp .env.example .env        # fill in secrets (a populated .env may already exist locally)
bun run dev                # → http://localhost:$PORT  (PORT from .env, default 3030)
```

| Script | Does |
|---|---|
| `bun run dev` / `start` | `tsx server.ts` — API + Vite middleware on one port |
| `npm run build` | `vite build` → `dist/` |
| `npm run preview` | serve `dist/` |
| `npm run lint` | `tsc --noEmit` |
| `npm run test` | `vitest run` (`src/tests/user-journeys.test.ts`) |

Notes:

- `.env` needs at least `GEMINI_API_KEY` (server-side chat/stream/tts/extract
  endpoints) and the `FIREBASE_*` vars (injected into the client by
  `vite.config.ts`). `.env.example` lists everything.
- Known state: `vitest` is declared but may be absent from `node_modules`
  (stale install) — both `lint` and `test` need a full `npm install` first.
- First screen is an auth gate with two branches: `Continue with Google`
  (cloud) and `Continue locally` (no account, this browser only). On a fresh
  account you land on Project Genesis, then the main studio. Projects are
  deletable from the project selection screen (Workspace Deck).

## Shape of the code

```
server.ts                 # Express: /api/chat{,/stream,/cancel}, /api/summarize-chapter,
                          # /api/tts, /api/extract-artifact-from-file, /api/health,
                          # /api/server-logs{,/stream,/clear}, /api/auth/config
src/App.tsx               # screen flow: loader → AuthGate → Genesis → studio
src/components/           # Sidebar, ChatView, SpatialGraph, modals, gate…
src/domains/              # workspace, timeline, artifacts, chapters, graph,
                          # compiler, stream protocol… (+ DomainRegistry)
src/services/             # firebase, persistenceService (the storage port), Google Drive/Docs import
src/data/models.ts        # AVAILABLE_MODELS (the old initialData.ts demo seeds are gone)
design-docs/              # the actual spec — see index in SCRATCH.md
```

## Headless access & screenshots

Agents (or you) can run the app fully unattended — auth mocked at the
network/storage layer, Firestore held so nothing real is touched:

```bash
npm i --prefix /tmp/pw playwright-core    # one-time
node scripts/headless-capture.cjs         # → chat/graph/mobile PNGs (fixture mode, offline)
node scripts/headless-capture.cjs --real  # real-data mode: live auth + live Firestore reads, writes no-op
node scripts/roundtrip-test.cjs           # acceptance: export → fresh browser → import → same UI
node scripts/delete-test.cjs              # acceptance: project deletion + confirmation flow
```

Mechanics, gotchas, selector map, and caveats: **[`design-docs/AGENT_RUNBOOK.md`](design-docs/AGENT_RUNBOOK.md)**.
One rule to remember: capture/test runs are strictly **serial** — one
Chromium at a time (parallel runs OOM-killed the agent; see runbook).

## Design docs map

| Doc | What |
|---|---|
| `00_core_philosophy_soul.md` | what this is trying to be |
| `01_requirements_and_meta.md` | requirements + the motivation section |
| `02_UI_REFACTOR_PLAN.md` | UI layers (incl. zero-footprint telemetry) |
| `03_DOMAIN_ARCHITECTURE_RULES.md` | domain module rules |
| `SYSTEM_ARCHITECTURE.md` | moving parts and how they meet |
| `CONTEXT_COMPILER.md` | tiering/context-budget model (implementation choice, not doctrine) |
| `STREAM_PROTOCOL.md` | chat streaming protocol |
| `MOBILE_UX_SPEC.md` | mobile constraints & shipped chrome |
| `AGENT_RUNBOOK.md` | run/mock/screenshot rig for agents |
| `scratch/` | charter, ground-truth motivation, corrections, pending list |