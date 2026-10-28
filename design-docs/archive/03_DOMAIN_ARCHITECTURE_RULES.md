# DOMAIN-DRIVEN ARCHITECTURAL GOVERNANCE & INVARIANTS (`03_DOMAIN_ARCHITECTURE_RULES.md`)

> **Amended 2026-10-18** to match the codebase after the refactor waves of this
> day (execution log: `07_CODE_ORGANIZATION.md` §10). What changed here and why:
> §2's tree now shows the *real* layout — `src/ui/` feature slices as the
> presentation layer (replacing the never-built `04-presentation/` tree),
> plus `src/application/`, `src/gateway/`, `src/services/stores/`, and
> `server/` — the two dead domains (`02-provenance-tracking`,
> `02-recursive-grouping`) are removed, `06-chat-threads` (which exists but was
> undocumented) is added, and the test rule was corrected to where tests
> actually live (`src/tests/`). Rule 4's status improved (App.tsx is now a
> ~600L composition root); rule 7 is new (fetch discipline + the client/server
> line). The amendments exist because `07` showed the old wording was drift,
> not doctrine.

## 1. Directives for AI Agents

Rules 1–5 and 7 are **decided architecture** (the codebase is built on them) — treat
them as non-negotiable. Rule 6 is a **current decision**, stated more weakly on
purpose: it may be revisited. (Rule 7 added 2026-10-18 — see the amendment note above.)

1. **NO HORIZONTAL TIERS / NO MVC:** Code is organized strictly by **Vertical Business Domains** located in `src/domains/<domain-name>/`. Placing code in generic "controllers", "models", or monolithic "utils" is strictly prohibited.
2. **STRICT HIERARCHICAL DEPENDENCIES:** Dependencies flow strictly downward according to the Level Hierarchy defined in Section 3. Level $N$ may NEVER import from Level $\ge N$. Circular dependencies will fail compilation.
3. **100% UNIT TESTABLE VIA DEPENDENCY INJECTION:** Every domain must export a TypeScript interface (`I<DomainName>Domain`). Domains must accept dependencies via constructor or factory parameters so they can be tested in isolation using lightweight in-memory mocks without DOM or network access. **Where tests live:** all tests are in `src/tests/`, never next to the domain — the old §3 item-4 requirement of a per-domain `<DomainName>.test.ts` is **superseded** (it was 0% observed; amended 2026-10-18). We fund behavior tests at the `application/`/`gateway/` level instead.
4. **NO GOD COMPONENTS:** `App.tsx` and UI views may NEVER contain business logic, parsing regexes, graph calculations, or direct API transport calls. UI components are projections that dispatch commands to domain interfaces. **Status 2026-10-18: improved** — `App.tsx` is down to a ~600L composition root (608L at `97fc87a`, wiring only) after the `src/ui/` slice extraction, and API transport now goes through `src/gateway/api.ts` (rule 7). The prohibition itself stands unchanged.
5. **EVENT-DRIVEN INGESTION:** The LLM stream protocol parser may NEVER mutate UI state or database persistence directly. It emits typed domain events (`onProseChunk`, `onTopicShiftDetected`, `onArtifactUpsertDetected`, `onLinkDetected`).
6. **SINGLE DATA MODEL (UNIVERSAL ARTIFACT) — current decision:** The legacy `Project` vs `WorkspaceState` division is abolished *for now*; persistent thought units conform to the Universal Artifact Schema with pre-computed tiers (T0–T3). Honest note: David has said the Universal Artifact is *a simplification we arrived at, possibly right, possibly wrong* — if that decision is reversed, this rule changes with it. Don't treat it as sacred; do treat it as in-force.
7. **TRANSPORT & SERVER BOUNDARY (added 2026-10-18):** Two short lines that must not blur:
   - **Fetch discipline:** `src/gateway/api.ts` is the *only* module in `src/` that may call `fetch('/api/…')`. UI and application code import gateway functions — never raw fetches with API paths, never hardcoded endpoint strings.
   - **The client/server line:** `src/` never imports from `server/`, and `server/` never imports from `src/`. The two sides talk over HTTP only; anything shared must be an explicit, boring shared module — no implicit cross-boundary imports, no re-declared twin types.

---

## 2. Directory Layout & Bounded Contexts

Every domain lives in its own isolated folder under `src/domains/`. The layers
around them (as amended 2026-10-18 — this is the tree that actually exists):

```
src/
├── domains/                      # the bounded contexts (levels in §4)
│   ├── 00-workspace/             # Level 0: Project container & disk sync
│   ├── 01-dialogue-timeline/     # Level 1: Conversational turns (active buffer)
│   ├── 01-artifact-document/     # Level 1: Multi-resolution living specs (T0-T3)
│   ├── 01-artifact-versioning/   # Level 1: Append-only revision history & diffs
│   ├── 02-chapter-segmentation/  # Level 2: Boundary ops (KISS toolkit), chapter slicing/merging
│   ├── 02-topological-graph/     # Level 2: Semantic edge matrix & BFS pathing
│   ├── 03-stream-protocol/       # Level 3: 1-Turn transport & XML chunk demuxer
│   ├── 03-chapter-recalibration/ # Level 3: Side-channel summary steering (Flash)
│   ├── 03-optical-compiler/      # Level 3: Context prompt compiler & telemetry (codename: optical)
│   ├── 06-chat-threads/          # Threads, folders, archive — multi-thread chats
│   │                             #   (deps: 01-dialogue-timeline + 02-chapter-segmentation only;
│   │                             #   number sits outside the 0–4 level scheme)
│   └── DomainRegistry.tsx        # composition root / DI container (307L)
├── ui/                           # PRESENTATION LAYER — replaces the old 04-presentation/ tree
│   ├── chat/                     # ChatView, ThreadSwitcher, chapter & title handlers
│   ├── artifacts/                # detail modal, folder tree, import/export/revision modals
│   ├── graph/                    # SpatialGraph
│   ├── workspace/                # AuthGate, BootSplash, Genesis, Launcher, Sidebar, ServerLogs modal
│   └── context/                  # MirrorPanel, EdgeHeatStrip, SaturationOrb, ambientTelemetry
├── application/                  # orchestration with injected deps: sendQueue, persistWorker,
│                                 #   sessionMachine, snapshotLoader
├── gateway/                      # api.ts — the only module allowed to call fetch('/api/…') (rule 7)
├── services/                     # integrations: firebase, googleDriveService, persistenceService
│   └── stores/                   # ProjectStore port: projectStore.ts (typed snapshot),
│                                 #   firestoreStore.ts, localStore.ts, hydrate.ts
├── data/                         # headless fixture + legacy AVAILABLE_MODELS (being replaced by GET /api/models)
├── tests/                        # ALL tests live here (see rule 3)
└── types/                        # app-wide shared types (see 07 §4 — the type swamp)
server/                           # Express backend — no imports across the src/ line (rule 7)
├── app.ts                        # app + route mounting
├── routes/                       # chat, summarize, title, tts, extract, logs, health, auth, models
├── providers/                    # gemini.ts (OpenRouter adapter lands beside it)
└── lib/                          # env, log, tokens, prompt, models (server-owned catalog)
server.ts                         # 10L entry — `tsx server.ts` → loads env, calls startServer()
```

Removed from the previous version of this tree (all verified dead or fictional
on 2026-10-18): `02-provenance-tracking` and `02-recursive-grouping`
(instantiated but never consumed anywhere — culled), and `04-presentation/`
with its `canvas/` / `inspector/` / `cartography/` subtrees, which never
existed; the real presentation layer is `src/ui/`, and `04-presentation/telemetry/`
moved to `src/ui/context/`.

---

## 3. Standard Domain Interface Contract

Every domain folder must contain the first three items. Tests are separate
(amended 2026-10-18 — the old rule implied a test file per domain folder):
1. `types.ts`: Domain-specific entities and payload interfaces.
2. `interface.ts`: The public contract (`I<DomainName>Domain`) declaring Queries, Commands, and Events.
3. `<DomainName>Domain.ts`: The deterministic implementation.
4. Tests with mocks for all dependencies, in `src/tests/` (not a per-domain `<DomainName>.test.ts` — that item is superseded; see rule 3, amended 2026-10-18).

---

## 4. The 5 Dependency Levels (Strict Downward Flow)

```
Level 4 (Surfaces)     -> src/ui/* feature slices: chat, artifacts, graph, workspace, context
                                │         (replaces the deleted 04-presentation/; see §2)
Level 3 (Coordination) -> 03-optical-compiler, 03-stream-protocol, 03-chapter-recalibration
                                │
Level 2 (Structure)    -> 02-chapter-segmentation, 02-topological-graph
                                │
   (06-chat-threads: imports 01-dialogue-timeline and 02-chapter-segmentation
    only, so by rule 2 it must sit *above* Level 2 — treat it as coordination
    over structure; its `06-` number sits outside the 0–4 level scheme; see §2)
                                │
Level 1 (Primitives)   -> 01-dialogue-timeline, 01-artifact-document, 01-artifact-versioning
                                │
Level 0 (Envelope)     -> 00-workspace
```

*RULE:* A domain in Level 2 may import from Level 1 or 0. It may NEVER import from Level 3 or 4.
