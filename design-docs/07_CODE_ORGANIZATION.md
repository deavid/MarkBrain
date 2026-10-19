# CODE ORGANIZATION, DOMAINS & SEAMS (`07_CODE_ORGANIZATION.md`)

> Written 2026-10-18 by Orion (session persona), at David's request: *"Can you
> take a look in general for this approach of DDD? go crazy."* — and then
> *"turn this into a document first, detailed, long, ranty even."*
>
> **Status: REVIEW + PROPOSAL. Not decided architecture.** Nothing in this doc
> is executed yet. `03_DOMAIN_ARCHITECTURE_RULES.md` stays in force until we
> amend it together — this doc is the case for amending it. One clearly-labeled
> analogy lives in §5; everything else is mechanics. Where I'm guessing, I say
> so.
>
> **Update 2026-10-18 (end of day):** waves 1–3 have now been executed and `03`
> was amended accordingly — see §10 at the bottom. The "nothing executed yet"
> status above was true when written, not any more.

---

## 0. Why this document exists

Three things David said, and they are the actual motivation — mechanics come
after:

1. **Six worktrees, six agents, in parallel.** `MarkBrain` + `dev-orion`,
   `dev-altair`, `dev-nova`, `dev-pulsar`, `dev-sirius`, `dev-vega` (+ `done`).
   The point of isolation is that parallel work on *parts* of the app shouldn't
   collide on the same files. David's words: *"Like microservices but.... inside
   the same service. Micro-domains. Micro-crates, micro-libs. No idea. you get
   my point."* I get the point: **module seams such that two agents working on
   different features rarely touch the same file.** That is the real
   requirement. "DDD" is one vocabulary for it; "micro-crates" is another. The
   requirement is the isolation, not the doctrine.
2. **Vibecoding with me as the judge.** *"I don't look at the code. I'm fully
   vibecoding this so I depend on you to be the judge."* So this doc has to say
   what's *actually* in the tree — with evidence — not what the docs promise.
   David's prior: *"my experience tells me that first attempt never lands it."*
   His prior about AI-assisted DDD is, I think, mostly right, and the honest
   job here is to say how much of the first attempt survived and how much is
   theater.
3. **OpenRouter is coming.** *"I'd be adding soon Openrouter, so not only
   Gemini API… This probably will need another layer in front. I guess."* His
   guess is right, and it's tangled with the organization question, because the
   place where a provider layer would land today (`server.ts`) is one of the
   worst god files in the tree.

Also on the board (from earlier in this same session, answers to my questions):
the daily-driver bar is **capture + chat + chapters on a phone**; **TTS matters**
on the phone (lower priority but he's done it manually many times — send to
phone, listen on the go); **Drive import is minor** (already moved everything
to a git folder of markdown); **mirror** ("show me what the LLM will see") is
wanted *soon* but explicitly *not* this session's work.

---

## 1. How I looked

Not a vibe review. Read the domain tree (`src/domains/` — 32 files, ~2.1k LOC),
the composition root (`DomainRegistry.tsx`, 350L), the storage port
(`persistenceService.ts`, 473L + `localBackend.ts` 119L), `server.ts` (772L),
`App.tsx` (1075L), `src/types/index.ts` (178L), the model catalogs, and the
import graph (who imports whom). Line counts and import paths below are checked
against this tree at `29d9800`. If you change the tree tomorrow, re-verify
before trusting the numbers — but the *shapes* of the arguments are robust.

---

## 2. The DDD attempt: verdict

Short version: **better than David's prior expects, and it did land — partially.
The parts that landed are real. The parts that didn't are exactly the parts
that god files eat: tests, UI discipline, and the finishing moves.**

Let me be precise, because "it never lands" flattens everything and I don't
think that's what happened here.

### 2.1 What actually landed (verified)

- **Folder-per-domain with a contract.** Each domain folder really does have
  `types.ts` + `interface.ts` + `<Name>Domain.ts` (with the honest exceptions:
  `02-provenance-tracking` and `02-recursive-grouping` have no implementation
  file — see §2.3). The interfaces are real interfaces; the classes implement
  them; constructor injection exists (e.g. compiler takes
  `(graph, artifacts, segmentation, timeline)`; recalibration takes
  `(segmentation, timeline)`).
- **The dependency levels hold inside `domains/`.** This is the part I'd have
  bet against, and it's true: `03-*` imports from `01-*`/`02-*` only;
  `02-*` imports from `01-*`; I found **zero** upward imports among domains.
  Also zero imports from `types/`, `services/`, or `components/` into domain
  implementations (only `utils/logger`, which is fine — logging is
  infrastructure every layer may use). That's a clean core.
- **The domain classes are small and boring.** 40–150L each, in-memory `Map`s
  or arrays, event subscriptions, no framework coupling. `ArtifactDocumentDomain`
  (124L) is a good example: get/list/getTierContent/upsert/merge. This is the
  right size for "micro-libs." No enterprise ceremony, no `AbstractFactory`
  cosplay. Whoever wrote this (an earlier AI) got the *shape* right.
- **Phase 3 of the cleanse did unify the Artifact model.** `Artifact =
  UniversalArtifactDocument` (re-export), domain model is source of truth,
  hydration at the persistence boundary. One of the four type families actually
  collapsed. Credit where due.

### 2.2 Scorecard against `03`'s own rules

`03` says rules 1–5 are non-negotiable. Reality:

| Rule | Verdict | Evidence |
|---|---|---|
| 1. No horizontal tiers / no god utils | **Mostly held in `domains/`, violated at app level.** | `src/utils/` exists and is fat: `tokenCalculator.ts` 415L, `markdown.ts` 316L, `yamlArtifactParser.ts` 174L. `src/services/` is a generic bucket. Fine as *infrastructure*, but the rule's letter doesn't allow it. |
| 2. Strict levels, no cycles | **Held inside `domains/`.** | Verified import graph (§2.1). Caveat: `DomainRegistry.tsx` itself imports `services/` + `firebase` — see §3.3. |
| 3. Tests next to every domain | **Dead letter.** | Zero `*.test.ts` in `src/domains/`. Tests live in `src/tests/` (4 files) and cover parser/markdown/compiler/storage-sanitize/journeys — *not* the domain classes. |
| 4. No god component; UI dispatches only | **Violated, badly.** | `App.tsx` is 1075L and calls `fetch('/api/chat/cancel')` (L205) and `fetch('/api/summarize-chapter')` (L594) directly. `ChatView.tsx` fetches `/api/tts`; `ImportModal.tsx` fetches `/api/extract-artifact-from-file`; `ServerLogsModal.tsx` fetches `/api/server-logs`. ~9 raw `fetch` sites across components. |
| 5. Event-driven ingestion; parser never mutates UI/DB | **Mostly held.** | `stream-protocol` parses and emits via callbacks; App wires the handlers. It does `fetch('/api/chat/stream')` itself — transport inside a "domain", which is a layering smudge, but it doesn't mutate UI or storage. |
| 6. Single data model (UAD) | **Half-done.** | Artifact unified. But see §4: three shapes of "a message" survive, two of them literally both named `Turn`. |

So: the skeleton is real, the enforcement never happened. That's not "the first
attempt didn't land" — it's **"the first attempt landed the imports and gave up
at the boundaries."** Which is, to be fair, where every first attempt gives up,
because the boundaries are where the god files live and god files are
uncomfortable to touch.

### 2.3 The lies in the tree

Things the docs assert that the code does not honor. Not malicious — drift:

- **`02-provenance-tracking` and `02-recursive-grouping` are dead.** Instantiated
  in `DomainRegistry`, exposed via context, **never consumed anywhere** in
  `src/` (verified: no `provenance.` / `grouping.` usage outside their folders
  and the registry). `04_CRITICAL_FINDINGS` already flagged this. Still there.
- **`04-presentation/` is a fiction.** `03` §2 draws a beautiful tree:
  `canvas/`, `telemetry/`, `inspector/`, `cartography/`. Reality: only
  `telemetry/` exists (4 files). The real UI is `src/components/` (12 files,
  ~5k LOC) — the biggest part of the app, living entirely outside the domain
  map. `SaturationOrb` / `EdgeHeatStrip` / `MirrorPanel` / `ambientTelemetry`
  are imported straight from `App.tsx` — the one place where components and
  domains share a folder, and it's a leaky accident of history, not a plan.
- **The per-domain test rule has never been followed once.** If a rule is
  written in the "non-negotiable" section and is 0% observed, it's not a rule,
  it's a wish. Either fund it or delete it. (My lean: delete it — see §8.)

### 2.4 The one domain-rule that *is* violated by the core

`03` rule 3 says every domain exports `I<DomainName>Domain` and takes
dependencies via constructor. Mostly true — **except `WorkspaceDomain`, whose
interface takes `loadUserProjects(cloudProjects: any[])`.** A domain boundary
that accepts `any[]` isn't a boundary; it's a suggestion. The `any`s then flow
from `persistenceService.ProjectSnapshot` (`turns: any[]; chapters: any[];
artifacts: any[]; edges: any[]`) straight through the registry into
`timeline.loadTurns(snap.turns || [])`. TypeScript smiles and looks away,
because `any` is legal everywhere. This is how "type-safe domain architecture"
becomes an untyped pipeline with typed ends.

---

## 3. The suspicion: Firebase vs Local has no proper anticorruption layer

David: *"there is some suspicion that the Firebase Vs Local IndexedDB don't
have a proper anticorruption layer."*

Verdict: **the suspicion is half right, and the half that's wrong is
interesting.**

### 3.1 What's right

There *is* a single module that knows both backends — `persistenceService.ts`
says so in its own header comment ("the SINGLE module that knows more than one
storage backend exists") and that policy is real: nothing else in `src/`
touches Firestore or IDB. That's the right *instinct*, and the canonical export
format (`markbrain-database` v1) is the right instinct too — *"this format IS
the architecture"* is one of the better lines in this codebase. A single
interchange shape is what makes Backup/Restore work across backends.

But a policy comment is not an anticorruption layer. What's missing:

1. **No port.** There is no `ProjectStore` interface that both backends
   implement. Instead, every CRUD function does its own
   `if (getBackend() === 'local') { ... } else { ... }` — the dispatch is
   copy-pasted across `saveProjectSnapshot`, `loadSnapshotRaw`,
   `listUserProjects`, `createCloudProject`, `deleteProject`, `importDatabase`.
   Six switch statements standing in for one abstraction. Adding a third
   backend (OPFS, a server-side store, a "sync to that git folder of markdown"
   driver — which, given his workflow, is *not* hypothetical) means touching
   every function again. That's the opposite of an ACL.
2. **The boundary is untyped.** `ProjectSnapshot.turns: any[]` etc. The
   storage layer doesn't speak domain types at all; it speaks blobs. Then
   `hydrateArtifact()` (80L in the same file) tries to reconstruct
   `UniversalArtifactDocument` from legacy flat records. So the *modeling*
   work leaks into the *persistence* file, because the persistence file is the
   only place both worlds meet. An ACL exists precisely to stop that kind of
   leakage; this one hosts the leak.
3. **It's a kitchen sink.** One 473L file contains: backend dispatch, the
   capture/fixture read-only guards, the `markbrain:backend` meta-key, **auth
   identity resolution** (`auth.currentUser` sprinkled through every call),
   legacy hydration/migration, and the export/import format. Six
   responsibilities. When something goes wrong at the seam — and the worst bug
   of recent days (`setDoc` rejecting `undefined`, silent save death, imported
   artifacts vanishing on reload) *was* at this seam — you debug it in the file
   that owns everything.
4. **Firestore specifics leak upward.** `handleFirestoreError` /
   `OperationType` are Firestore concepts, imported and called in the shared
   service; error semantics differ per branch (local throws, Firestore
   sometimes returns `null`, sometimes swallows into `[]`). A caller can't
   reason about failure uniformly.

### 3.2 What "proper" would look like (small, boring)

Not a hexagonal-architecture poster. Four moves:

- One interface: `ProjectStore { load(id); list(); save(id, snap); create(meta);
  delete(id); replaceAll(snaps) }` (export/import can sit on top or in the
  interface, as you prefer).
- Two implementations: `firestoreStore.ts`, `localStore.ts`. The `if
  (getBackend())` switch runs **once**, at boot, where the store is chosen.
- Typed snapshot: `ProjectSnapshot` carries domain types (`Turn[]`,
  `ChapterPartition[]`, `UniversalArtifactDocument[]`, `SemanticEdge[]`) or,
  if we keep a storage-mapping layer, the mapper lives beside each store —
  *not* in the shared file.
- Hydration/legacy-backfill becomes its own `migrate.ts` or sits at the
  persistence boundary of each store. It is a *data migration* concern; it
  doesn't belong to "which backend are we on."

### 3.3 Related seam smell: the registry is doing four jobs

`DomainRegistry.tsx` is (a) the DI container, (b) an application-service layer
(debounced save orchestration, snapshot hydration dispatch), (c) an auth/session
state machine (including the `LOCAL_USER` pseudo-user hack that keeps App
backend-agnostic — a genuinely clever move, but it lives in a React component),
and (d) the backend switcher (`setBackend` on sign-in/sign-out). Four jobs, one
350L file, **and every new domain must register here.** For the six-agent goal
this file is a collision magnet second only to `App.tsx`. When we split things,
this splits into *wiring* (keep) and *application services* (move).

---

## 4. The type swamp: three shapes of "a message"

Phase 3 collapsed Artifact. It did **not** collapse the rest. Verified today:

| Concept | Shape A | Shape B | Shape C |
|---|---|---|---|
| "a message" | `types/index.ts` `Turn` — `role: 'user'\|'assistant'`, `timestamp: number`, `raw_payload?` | `types/index.ts` `ChatMessage` — `role: 'user'\|'assistant'\|'system'`, `timestamp: string`, `chapterId`, `extractedArtifacts?` | `domains/01-dialogue-timeline/types.ts` `Turn` — `role` includes `'system'`, `timestamp: number`, `meta?` |
| "a chapter" | `types/index.ts` `Chapter` — 20+ fields, `messages: ChatMessage[]`, `compressionMode?` | `domains/02-chapter-segmentation/types.ts` `ChapterPartition` — 11 fields, no messages |
| "an edge" | `types/index.ts` `GraphEdge` — `source?/target?/sourceNodeId?/targetNodeId?`, `strength?`, `isCrossProject?` | `domains/02-topological-graph/types.ts` `SemanticEdge` — `sourceId/targetId/kind/weight?` |

**Two different types named `Turn` in two files that are both "the truth".**
And the app keeps them in sync by hand: `App.tsx` maps
`turns.map((t) => ({...}))` into `ChatMessage[]` at **three separate call
sites** (L306, L384, L599). `stream-protocol` takes `messages?: any[]` and
`chapterSummaries?: any[]` — the transport is untyped in the middle. And
`types/index.ts` even duplicates `TierReason` explicitly "to mirror the optical
compiler domain so components can import across the domain layer" — a type that
exists *purely* to dodge a layering rule.

This is the swamp where parallel agents drown. Two agents, each "just adding a
field to the message type", will both touch `types/index.ts` *and* one domain
`types.ts` *and* the mapping sites in `App.tsx`, and both will be "right"
against half the code. The fix is not more discipline; it's **one name per
concept, one home, and mappers in one known place** (or zero mappers, if we
collapse to one model — that's a bigger call, see §8).

`04_CRITICAL_FINDINGS` called this "dual data model (`types/index.ts`
frankenmodel vs `domains/*/types.ts`)". Phase 3b fixed the Artifact corner. The
swamp remains, ~80% of it.

---

## 5. The god files, and why they are *the* six-agent problem

> *One analogy, clearly labeled, skip if you don't need it:* god files are the
> shared kitchen in a co-working space. Six cooks can each own a station, but if
> there's one stove everyone must use, every meal is a queue and every spilled
> pot is everyone's problem. The fix isn't "cook more carefully" — it's more
> stoves. (That's the whole analogy. The rest is stoves.)

The hot files today:

| File | Size | Why everyone touches it |
|---|---|---|
| `src/App.tsx` | 1075L | Every feature wires itself here: handlers, fetch calls, compile→stream→parse→upsert orchestration, modal state |
| `server.ts` | 772L | Every API feature adds a route: chat/stream, cancel, summarize-chapter, tts, extract, logs, auth config, health — plus the prompt builder, system instruction, model watchdog |
| `src/domains/DomainRegistry.tsx` | 350L | Every domain registration + save path + session |
| `src/types/index.ts` | 178L | Every type change (and see §4) |

Everything else in the tree is already fairly well-partitioned — components are
per-feature, domains are per-domain, services are per-integration. **The
isolation problem is concentrated in four files.** This is good news: "micro-
domains everywhere" is a rewrite; "split four files and enforce the seams" is a
week of careful surgery. The bones are mostly there. The skull is the problem.

Corollary, and I want to be blunt about it: **reorganizing folders without
splitting these four buys nothing for parallel work.** If we do the prettiest
bounded-context map in the world and leave `App.tsx` at 1075L, agent 3 and
agent 4 still collide on line 600. Conversely, split the four and even a
mediocre folder map becomes workable. Order matters (§7).

---

## 6. The provider layer (OpenRouter)

David: *"I'd be adding soon Openrouter… This probably will need another layer in
front. I guess."* Correct guess.

### 6.1 What's there today

- `server.ts` hardcodes `@google/genai`, one `GoogleGenAI` instance, and a
  **hardcoded `validModels = ['gemini-3.5-flash-lite']`** inside the stream
  route (comment: *"OpenRouter models get appended here later"*).
- The **client has its own model list** — `src/data/models.ts`
  (`AVAILABLE_MODELS`, currently one model, with its own comment: *"Additional
  providers (OpenRouter…) get added here over time"*). Two lists. Both with
  matching TODO comments. That's the twin-parser disease in miniature: the
  server validates models, the client renders models, and nothing keeps them
  honest. When OpenRouter lands with 5 rotating free models, these lists will
  diverge within a day.
- `buildCompiledPrompt()` on the server is a *fallback* reimplementation of the
  client compiler ("if `compiledPrompt` is missing, assemble one from parts").
  A second, dumber twin of the most sacred code we have (the context compiler —
  the pillar's engine). If we ever keep it, it needs a test; my lean is to
  delete it once the client always sends the compiled prompt (it's the one-turn
  contract anyway: client compiles, server executes).
- Model fallback logic (the 9s watchdog → Flash Lite failover) lives inline in
  the stream route. With two providers this becomes routing policy — it wants
  to be a named thing, not an `if` in a 260L handler.

### 6.2 What I'd want (small and boring)

- `server/providers/`: one tiny interface —
  `streamChat({model, system, prompt}) → async iterable of chunks` plus
  optional `tts()` and `extract()` if we want them provider-shaped later.
  `gemini.ts` wraps what exists; `openrouter.ts` is plain OpenAI-compatible SSE
  fetch. **No framework.** One function per provider, one router that maps
  `model` → provider (prefix-based: `gemini/…`, `openrouter/…`, or a lookup
  table — pick whichever is dumber at implementation time).
- **The server owns the model catalog**: `/api/models` returns what's actually
  configured (keys present, provider reachable). Client *renders* it. `src/data/models.ts`
  stops being a source of truth and becomes a UI-hint table (badges, blurbs) or
  dies. One list, one truth, and "which models can this deployment actually
  use" becomes answerable by asking the server.
- Client side: **one API client module** (`src/gateway/` or
  `src/services/api.ts` — name it when we cut it) through which all ~9 `fetch`
  sites go. That's not bureaucracy; it's the seam where stream protocol,
  TTS, extraction, logs and cancel stop being scattered strings. Two agents
  adding endpoints then touch `server/routes/…` and their own feature folder —
  not each other's components.

Free-model routing (the OpenRouter-rotating-free-models dream from
`motivation.md`) *fits here* and nowhere else — retry/route policy lives beside
the provider adapters. But that's a later experiment; don't design it now. The
layer just has to not be in the way.

---

## 7. Proposed seams (the actual proposal)

Target shape. Names are proposals; the **splitting logic** is the point.

```
src/
  ui/
    chat/         ChatView, chapters UI, summarize UI
    artifacts/    ArtifactDetailModal, ArtifactFolderTree, Import/Export modals
    graph/        SpatialGraph
    workspace/    ProjectGenesis, ProjectLauncher, Sidebar, AuthGate, ServerLogs?
    context/      MirrorPanel, SaturationOrb, EdgeHeatStrip, ambientTelemetry
  application/    use-case orchestration: persist-worker, hydration dispatch,
                  session state machine (what DomainRegistry does today)
  domains/        current modules, minus dead ones (§2.3)
  gateway/        api client + stream-protocol (transport; provider-agnostic)
  persistence/    ProjectStore port + firestoreStore + localStore + migrate
  types/          thin re-exports; ideally near-empty
server/
  routes/         chat, tts, extract, logs, models, auth, health
  providers/      gemini.ts, openrouter.ts, router.ts
  (shared/        ONLY if a type must be literally shared client/server)
```

The dependency rule, restated so it survives contact:

- `ui → application → domains → (nothing below)`
- `gateway` and `persistence` are infrastructure: used *by* application,
  never the reverse. `domains` never imports them.
- `server/` never imports `src/` (and vice versa except over HTTP). If a type
  must cross that line, it lives in `shared/` and both sides import it — no
  re-declaring (no more `TierReason` twins).
- Each folder exposes a public `index.ts`; **nothing else is importable from
  outside**. Enforce with a ~20-line check script in CI/lint (or
  `eslint-plugin-boundaries` if we want the hammer). Without enforcement this
  rots in a month — that's not cynicism, it's §2.

**Ownership map for six agents** (the deliverable David actually asked for).
One lane per agent = `ui/<feature>` + the paired `server/routes/*` + the
feature's domain folder. Shared files shrink to: `application/` wiring events,
`gateway` contract changes, and `types/` — ideally one-line touches. Roughly:

| Lane | Owns |
|---|---|
| chat/stream | `ui/chat`, `gateway/stream-protocol`, `server/routes/chat` |
| artifacts | `ui/artifacts`, `domains/01-artifact-*` |
| graph | `ui/graph`, `domains/02-topological-graph` |
| workspace/session | `ui/workspace`, `application/session`, `persistence/` |
| context/mirror | `ui/context`, `domains/03-optical-compiler` |
| provider/model | `server/providers`, `server/routes/models`, model catalog |

Two lanes can still conflict (e.g. chat + artifacts both touch the send
handler), but the blast radius is *agreed folders*, not "whoever reaches
`App.tsx` first." And when a change must cross lanes, the doc says so up front
and we serialize those — same as any other team.

---

## 8. Order of work, and where I'm unsure

### 8.1 Proposed order (small → large risk, high → leverage)

1. **Split `server.ts` into `routes/`** — safest split, pure mechanical move,
   and it unblocks the OpenRouter provider cleanly. Also gives the API-client
   work a natural landing zone.
2. **API client module + server-owned model catalog** — kills fetch scatter and
   the twin model lists. `src/data/models.ts` demoted to UI hints or deleted.
3. **`ProjectStore` port** (§3.2) — mechanical, testable, fixes the ACL
   properly. Typed snapshot, migrate moves out.
4. **Split `App.tsx` along the `ui/*` seams** — the big one. Do it *after* 1–3
   so the orphans (fetch calls, storage calls) have somewhere to go. Expect
   this to be staged (extract one feature at a time), not a big bang.
5. **Split `DomainRegistry`** into wiring + `application/`.
6. **Cull dead domains** (provenance, grouping) and fix `03` to match reality
   (drop the fake `04-presentation` tree, drop or fund the per-domain test
   rule). Cheap; do it whenever we touch the registry.
7. **OpenRouter adapter** — once 1–2 exist, this is a small diff.

What I'm **not** proposing: npm workspaces / real micro-packages / build
splitting. For a solo-plus-agents app that's ceremony; folder seams + an
enforcement script get us the isolation. Convert folders to packages later if
ever — it's mechanical once the seams hold.

### 8.2 Genuinely unsure (David's call, or we decide at the keyboard)

- **How many `ui/` slices.** chat / artifacts / context / graph are clear to
  me. workspace-vs-graph is fuzzy (is the sidebar cartography or workspace?).
  Maybe 4 is enough and ServerLogs lands wherever it fits.
- **Message-type collapse depth.** Do we finish the Phase-3 job and have *one*
  message type (domain `Turn` everywhere, `ChatMessage` dies, mappers die)? Or
  do we keep a thin UI projection type and centralize the mapping? The first is
  purer and kills the swamp; the second is less churn. My lean: **one type** —
  the swamp is already proven dangerous (three sites by hand!), and we control
  the only consumer. But it touches persistence-compat (old snapshots), so it
  needs a moment, not a mood.
- **Does `server/` share code with `src/` at all?** Strictly: no, communicate
  over HTTP with `shared/` types. But the stream-protocol demux lives client-
  side and the prompt compiler too — maybe some of that wants to be
  `shared/` for tests. Not sure. Smallest rule first: *no implicit imports
  across the line*; if a shared module is needed, make it explicit and boring.
- **Per-domain tests:** fund them or delete the rule? I lean delete —
  tests-of-behavior at the `application/` and `gateway/` level are worth more
  to us than ceremony next to each 80L class. But that's a taste call.
- **Universal Artifact stays?** `03` rule 6 is explicitly reversible. If it
  ever flips, the type collapse (§4) and the snapshot shape change with it.
  Fine — that's why the port (§3.2) should be typed-but-thin.

### 8.3 Anti-slop note

This doc has one labeled analogy (§5) and a lot of mechanics, which is the
right ratio for a *code-organization* doc. It deliberately does **not** invent
new pillars: the requirement (parallel-agent isolation), the product bar
(mobile capture + chat + chapters), and the pillar (context control) all come
from David. Everything else here is "current thinking, revisable" — including
my folder names. If any of this reads as commandment, downgrade it in place:
none of it is decided until David says so.

---

## 9. Relation to other docs

- `03_DOMAIN_ARCHITECTURE_RULES.md` — **in force, but wants amendments** after
  this review (rules 3 and the `04-presentation` layout; possibly rule 1's
  letter about `utils/`). Do that as a separate pass; don't self-edit the
  "non-negotiable" doc silently.
- `04_CRITICAL_FINDINGS.md` — this doc agrees with its §type-swamp and dead-
  domain findings and extends them with the seams/ownership angle. 04 is a
  frozen snapshot; this is the follow-up *proposal*.
- `05_CLEANSE_DECISIONS.md` — Phase 3 (data model) is the precedent: *decide
  in a ledger, execute in commits.* If David approves this direction, the
  execution log goes in `05` (or a `08_` ledger if we want it append-only per
  workstream).
- `scratch/pending.md` — the live "what's next" state; this session's entry
  points here.

---

*Written in one sitting against the tree at `29d9800`. Rant level: intentional.
Confidence level: high on the evidence (file sizes, import graph, type shapes —
all checked), medium on the proposed seams (they're mine, not tested by six
agents yet), low on nothing — where I didn't know, I said so.*

---

## 10. Execution status (2026-10-18)

Appended the same day. **Waves 1–3 of the §8.1 order executed on `dev-orion`**
(7 commits, oldest first — line counts are as of each commit):

| Commit | What it did | § ref |
|---|---|---|
| `809b9f7` | **Server split** — 836L `server.ts` monolith → 10L entry (`server.ts`) + `server/{app.ts, routes/* (chat, summarize, title, tts, extract, logs, health, auth, models), providers/gemini.ts, lib/{env,log,tokens,prompt,models}}`. New `GET /api/models`. | §5, §6.2, §8.1-1 |
| `a2ab03b` | **ProjectStore port + typed snapshot + dead-domain cull** — `persistenceService` is now a thin facade over `src/services/stores/` (`projectStore.ts` port: load/list/save/create/delete/replaceAll; `firestoreStore.ts`, `localStore.ts`, `hydrate.ts`); `ProjectSnapshot` arrays typed (`Turn[]`, `ChapterPartition[]`, `UniversalArtifactDocument[]`, `SemanticEdge[]`, `ChatThread[]`, `ThreadFolder[]`); `02-provenance-tracking` and `02-recursive-grouping` deleted. | §3.1–3.2, §2.3, §8.1-3/6 |
| `0b44f59` | **Send-queue extraction** — serial multi-thread send queue → `src/application/sendQueue.ts` (565L), first member of the new `application/` layer. | §7, §8.1-5 |
| `553980d` | **Gateway** — all `src/` `/api` fetch sites routed through `src/gateway/api.ts` (one module, the only legal `fetch('/api/…')` site). | §6.2, §7 |
| `eabab0e` | **Server-owned model catalog** — `server/lib/models.ts` + `GET /api/models`; the allowlist and the catalog cannot diverge anymore. | §6.1–6.2, §8.1-2 |
| `e686e62` | **DomainRegistry split** — 444L → 307L; application services moved out, public API unchanged. | §3.3, §8.1-5 |
| `97fc87a` | **UI feature slices** — `App.tsx` → 608L composition root; `src/components/` gone; the `04-presentation/` fiction gone; presentation lives in `src/ui/{chat,artifacts,graph,workspace,context}/` (telemetry relocated to `ui/context/`). | §2.3, §5, §7, §8.1-4 |

### 8.1 status: done / in progress / not started

| # | Order item | Status |
|---|---|---|
| 1 | Split `server.ts` into `routes/` | **Done** — `809b9f7` |
| 2 | API client module + server-owned model catalog | **Done** (`553980d`, `eabab0e`); **client wiring in progress** — `src/data/models.ts` still holds `AVAILABLE_MODELS` while the move to fetching `/api/models` runs in parallel. Intended end state: the server catalog is the single source of truth; `src/data/models.ts` demotes to UI hints or dies. |
| 3 | `ProjectStore` port + typed snapshot | **Done** — `a2ab03b` |
| 4 | Split `App.tsx` along the `ui/*` seams | **Done** — `97fc87a` (landed staged, as predicted) |
| 5 | Split `DomainRegistry` into wiring + `application/` | **Done** — `e686e62`, `0b44f59` |
| 6 | Cull dead domains + fix `03` | **Done** — cull in `a2ab03b`; `03` amended same day (see its dated note) |
| 7 | OpenRouter adapter | **Not started** — pending David; `server/providers/` now exists with `gemini.ts`, so the landing zone is ready |

### What remains

- **Type-swamp collapse** (§4, open question §8.2 — one message type or a
  projection?): **not started**, still David's call. The typed snapshot moved
  the persistence side; `Turn` vs `ChatMessage` mapping sites remain.
- **OpenRouter provider adapter** (§6): **not started**, pending David.
- **Client `/api/models` wiring** (§6.2): **in progress** (parallel agent).
- §8.2 questions resolved in passing: `ui/` slice count settled at five
  (`chat`, `artifacts`, `graph`, `workspace`, `context`); the per-domain test
  rule was resolved by rewriting `03` rule 3 / §3 item 4 to match practice
  (tests live in `src/tests/`). Still open: message-type collapse depth,
  whether `server/` and `src/` ever share a `shared/` module, Universal
  Artifact reversibility.

*Status note written against the tree at `97fc87a` plus the parallel
`/api/models` wiring still uncommitted; re-verify sizes if you read this after
that lands.*
