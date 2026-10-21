# MarkBrain

**Show me what the LLM sees.**

*a thinking workbench for overflowing brains*

Your brain floods. Ideas, threads, half-decisions, five projects tangled into
one thought — and every tool built for "talking to an LLM" treats that flood
as either a scrolling log to lose things in, or an excuse to spawn an
expensive swarm of agents that burn your money and your afternoon. Chat
assistants bury your best insights three hundred turns deep. Wikis make you
stop thinking to go file things. Agent platforms are windows into a desktop
computer — and they cost three API calls to say hello. None of them was built
for the person with a phone in one hand and too many ideas in the other.

MarkBrain is a thinking workbench: you dump thoughts in conversation, and
everything of value crystallizes into living documents that keep the *why* —
every artifact remembers the discussion that birthed it. Topics become a graph
instead of a folder tree, so you can zoom from the whole forest down to one
leaf without losing the view. And the thing it does that nothing else does:
**it shows you what the LLM actually sees.** Same order, same contents —
summarized material appears summarized to *you* too, tokens visible per
chapter, the expensive parts lit up. You control that context directly: what's
sharp, what's blurred, what's out of frame. No hidden orchestration deciding
for you.

It is deliberately not agentic. One Enter, one API call — no tool loops, no
swarm, no model taking the wheel. That's taste, but it's also economics: this
is meant to run *cheap*, slowly if it must, more like email than like a live
demo — because it's a thinking tool, not a transaction. Mobile-first,
genuinely: open it on the street, dump the thought, close the phone, come back
to the reply. Desktop is a courtesy and that's fine. It's a personal tool,
built out of need, still figuring out exactly what it wants to be when it
grows up — and honest about that.

> **Source of truth is [`design-docs/`](design-docs/).** Start with
> `00_core_philosophy_soul.md` and `01_requirements_and_meta.md`; the
> charter/motivation/corrections live in `design-docs/scratch/`. For pending
> work, start at [`design-docs/STATUS.md`](design-docs/STATUS.md) — dated
> snapshot; when it disagrees with `design-docs/scratch/pending.md`, the
> scratch wins. This README is just the front door; details live in the docs.

## Stack

| Layer | What |
|---|---|
| Frontend | React 19 + Vite 8 + Tailwind 4, TypeScript, SPA in `src/` |
| Backend | Express backend in `server/` (`app.ts` + `routes/` for chat, summarize, title, tts, extract, logs, health, auth, models + `providers/gemini.ts` + `lib/`), behind the 10-line `server.ts` entry; mounts Vite (dev) or `dist/` (prod); owns the model catalog (`GET /api/models`) |
| Auth/DB | Firebase Auth (Google popup) + Firestore, per-user trees, rules in `firestore.rules`; or the Local branch (no account, IndexedDB) |
| Domain logic | DDD-ish micro-domains in `src/domains/` behind `DomainRegistry` — see `design-docs/03_DOMAIN_ARCHITECTURE_RULES.md` |
| Persistence | One port, two backends: Firestore (default) or local IndexedDB — `src/services/persistenceService.ts` is the only module that knows both exist. Canonical backup/restore JSON (Backup DB / Restore DB). |

## Run it

```bash
npm install
cp .env.example .env        # fill in placeholders (a populated .env may already exist locally)
bun run dev                 # → http://localhost:$PORT  (PORT from .env; code default 3000)
```

Env is layered and loads in order — real OS/runtime env → `.env` →
`.env.shared` → the canonical shared file in the parent worktree (earlier
wins); `.env.example` documents the stack and lists every key.

| Script | Does |
|---|---|
| `bun run dev` / `bun run start` | `tsx server.ts` — API + Vite middleware on one port |
| `npm run build` | `vite build` → `dist/` |
| `npm run preview` | `vite preview` — serve `dist/` |
| `npm run lint` | `tsc --noEmit` |
| `npm run test` | `vitest run` (13 files in `src/tests/`) |

Notes:

- `.env` needs at least `GEMINI_API_KEY` (server-side chat/stream/tts/extract
  endpoints) and the `FIREBASE_*` vars (injected into the client by
  `vite.config.ts`). `.env.example` lists everything.
- First screen is an auth gate with two branches: `Continue with Google`
  (cloud) and `Continue locally` (no account, this browser only). On a fresh
  account you land on Project Genesis, then the main studio. Projects are
  deletable from the project selection screen (Workspace Deck).

## Shape of the code

```
server.ts                 # 10L entry (`tsx server.ts`) → server/
server/                   # Express: /api/chat{,/stream,/cancel}, /api/summarize-chapter,
                          # /api/title-thread, /api/tts, /api/extract-artifact-from-file,
                          # /api/models (server-owned catalog), /api/health,
                          # /api/server-logs{,/stream,/clear}, /api/auth/config
server/routes/            # one file per endpoint group (chat, summarize, title, tts,
                          # extract, logs, health, auth, models)
server/providers/         # gemini.ts — provider adapter (OpenRouter lands beside it)
server/lib/               # env, log, tokens, prompt, models
src/App.tsx               # composition root (~650L): loader → AuthGate → Genesis → studio
src/ui/                   # feature slices: chat, artifacts, graph, workspace, context, cleanup
                          # (Sidebar, ChatView, SpatialGraph, modals, gate… live here)
src/application/          # orchestration: sendQueue, persistWorker, sessionMachine, snapshotLoader
src/gateway/api.ts        # the only module in src/ allowed to call fetch('/api/…')
src/domains/              # micro-domains behind DomainRegistry: workspace, artifact
                          # document/versioning, dialogue timeline, chapter segmentation,
                          # topological graph, chapter recalibration, optical compiler,
                          # stream protocol, chat-threads
src/services/             # firebase, Google Drive import, localBackend, persistenceService
src/services/stores/      # ProjectStore port: projectStore.ts + firestoreStore, localStore, hydrate
src/data/models.ts        # FALLBACK_MODEL — one constant while GET /api/models is in flight
scripts/                  # evidence pack + headless capture/acceptance runners (see below)
design-docs/              # the actual spec — see index in SCRATCH.md
```

## Headless access & screenshots

Agents (or you) can run the app fully unattended — auth mocked at the
network/storage layer, Firestore held so nothing real is touched:

```bash
npm i --prefix /tmp/pw playwright-core    # one-time
node scripts/evidence.cjs                 # ★ full evidence pack: journey suite + geometry audit
node scripts/headless-capture.cjs         # → chat/graph/mobile PNGs (fixture mode, offline)
node scripts/headless-capture.cjs --real  # real-data mode: live auth + live Firestore reads, writes no-op
node scripts/roundtrip-test.cjs           # acceptance: export → fresh browser → import → same UI
node scripts/delete-test.cjs              # acceptance: project deletion + confirmation flow
node scripts/cleanup-tool-test.cjs        # acceptance: archive → permanent delete (the deletion law, design-docs/14)
```

Mechanics, gotchas, selector map, and caveats: **[`design-docs/AGENT_RUNBOOK.md`](design-docs/AGENT_RUNBOOK.md)**.
One rule to remember: capture/test runs are strictly **serial** — one
Chromium at a time (parallel runs OOM-killed the agent; see runbook).

### Testing methodology

Three layers, cheapest gate first:

1. **`bunx tsc --noEmit`** — type gate.
2. **`bunx vitest run`** (`src/tests/`) — unit/journey logic: domain behavior,
   selectors, persistence codecs, stream telemetry contracts.
3. **`node scripts/evidence.cjs`** — *browser evidence pack* for anything the
   first two can't see: a deterministic 13-journey Playwright suite (send/
   stream/stop, split, summarize, threads, mirror, graph, export/import, model
   picker, mobile, forced-error retry) plus a geometry/occlusion audit across
   4 viewports (min phone 350 → desktop). It writes
   `evidence/<timestamp>/` — `summary.json` (failures first), checkpoint
   screenshots, annotated failure clips, step logs — for **LLM or human
   screening** instead of manual browsing. No image comparison, no LLM inside
   the runner. Pack format, screener contract, and current known findings:
   **[`design-docs/EVIDENCE_PACK.md`](design-docs/EVIDENCE_PACK.md)**.

Journeys activate handlers via JS clicks and let the audit own hit-testing, so
"the flow works" and "the target is clickable" are judged independently.
Evidence packs are gitignored (`evidence/`); only the harness and its contract
are committed.

## Design docs map

| Doc | What |
|---|---|
| `00_core_philosophy_soul.md` | what this is trying to be |
| `01_requirements_and_meta.md` | requirements + the motivation section |
| `02_UI_REFACTOR_PLAN.md` | UI layers (incl. zero-footprint telemetry) |
| `03_DOMAIN_ARCHITECTURE_RULES.md` | domain & layer rules — amended 2026-10-18 to match the refactor (ui slices, gateway, server/, tests in `src/tests/`) |
| `04_CRITICAL_FINDINGS.md` | full-app critical review, 2026-10-18 (frozen snapshot) |
| `05_CLEANSE_DECISIONS.md` | cleanse decisions ledger (append-only) |
| `06_GEMINI_3_8_FLASH_LATENCY.md` | latency probe notes |
| `07_CODE_ORGANIZATION.md` | DDD/seams review + micro-domain proposal → executed (see its §10) |
| `08_UNIFIED_DATA_MODEL.md` | type-collapse decision register + execution record |
| `SYSTEM_ARCHITECTURE.md` | moving parts and how they meet |
| `CONTEXT_COMPILER.md` | tiering/context-budget model (implementation choice, not doctrine) |
| `STREAM_PROTOCOL.md` | chat streaming protocol |
| `MOBILE_UX_SPEC.md` | mobile constraints & shipped chrome |
| `AGENT_RUNBOOK.md` | run/mock/screenshot rig for agents |
| `EVIDENCE_PACK.md` | browser testing methodology — evidence packs: journey suite + geometry audit + LLM screener contract |
| `STATUS.md` | pending work + project context snapshot (dated; `scratch/pending.md` is the live log) |
| `scratch/` | charter, ground-truth motivation, corrections, pending list |