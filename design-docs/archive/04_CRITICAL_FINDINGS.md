# CRITICAL FINDINGS — the cleanse capture (`04_CRITICAL_FINDINGS.md`)

> Written 2026-10-18 by Goose, at David's request: review the full app very
> critically — find what doesn't make sense, what's a husk, what's not
> connected, the odd ones out. This is a **findings ledger**, not a rewrite of
> the design docs. Verified facts are stated as facts; judgments are my opinion
> and marked as such. Motivation ground truth: `scratch/motivation.md`.
>
> Status: **FROZEN SNAPSHOT of the first review pass.** Decisions, triage, and
> anything that supersedes a finding below live in
> [`05_CLEANSE_DECISIONS.md`](05_CLEANSE_DECISIONS.md) (append-only). Don't
> grow this file — append there instead.

---

## 0. The bingo, first (the one that matters)

David asked: *if nothing makes sense, that's the bingo.* Partial bingo.

**Not** "every file is garbage." A fair amount of the machinery actually runs:
streaming works, chapters can split, artifacts can be extracted, the graph
computes hop distances, local/Firestore persistence roundtrip was verified,
mobile has no top bars in the chat feed. I don't think the right move is
gaslighting the codebase into "all fake."

**But** — and this is my honest read — **the app is solving a different
problem than the one in `scratch/motivation.md`.** Not a small drift. A
different product with a different imaginary user.

Motivation says:

> collector for my overflowing brain · auto-organizator · visualize the forest ·
> mobile capture: dump thought → close phone → check reply later · cheap,
> non-agentic, user owns context.

The app says (in its system instructions, placeholders, model copy, test
fixtures, and hardcoded strings):

> *"You are MarkBrain, a principal systems architect specializing in multi-tier
> design systems, token topologies, component state machines, and spatial
> software architectures."*
> — `server.ts` `DEFAULT_SYSTEM_INSTRUCTION`, and again (slightly shorter) in
> `03-optical-compiler`.

Evidence of the invented persona, all verified in code:

| Where | What it says |
|---|---|
| Chat input placeholder (`ChatView.tsx`) | "What architectural invariants, system specifications, or domain state machines are we designing today?" |
| New project (`ProjectGenesis.tsx`) | placeholder "Distributed Optical Engine", code name "OPT-ENG", "invariants, system goals, or substrate boundaries" |
| Hardcoded on every new project (`App.tsx`) | `boundaryRules: 'Cross-repo linking bridges high-concept architecture specs.'` |
| Model picker (`data/models.ts`) | "Architect Core", "Deep Synthesis Pro", "multi-repository synthesis and complex state machine verification" |
| Server demo artifact (`server.ts` ~649) | "Dynamic Token Boundary Spec", `color.cyan.500`, "Semantic Aliases" |
| Tests (`user-journeys.test.ts`) | "Design a fault-tolerant optical context manager", codeName `OPT-CMP` |
| Artifact import (`ImportModal`) | `type: 'architecture' \| 'token-spec' \| 'component-contract'…`, `highConcept` = "cross-project core protocol that can bridge repos" |

That is a **design-system / software-architecture workbench** for someone
talking about tokens and component contracts. Your "why" is: *yap into the
phone before the idea evaporates, then see the forest.*

So the cleanse question isn't only "which features are junk?" It's:
**are we keeping an architect's workbench, or turning this into David's brain
collector?** I'm assuming the second, because motivation.md wins over
everything else — but I want to hear you say it. See §4.

---

## 1. Severity map (my ranking)

### A. Wrong-product soul (highest — this is the cleanse)

1. **LLM persona is an architect.** Two system instructions (server default +
   compiler emit) both brand the model as "principal systems architect." Your
   collector would make it a thinking partner / note-taker / organizer, not a
   systems architect. *Opinion: this alone warps every reply you get.*
2. **Capture input is pre-loaded with the wrong prompt.** The most sacred flow
   (mobile: open → dump → leave) greets you with "what architectural
   invariants… are we designing today?" That's not a neutral placeholder; it
   steers the conversation before you type.
3. **`highConcept` / `boundaryRules` / `codeName` / `isHighConcept`** — fields
   that exist to serve the fantasy of cross-repo design systems. They occupy
   the data model, the import form, the server parser, the system instruction.
   They are not in your motivation at all.
4. **`AbstractionLevel` / `ContextDepth` vocabulary** (`full|summary|description|title|excluded`
   etc. in `types/index.ts` and `tokenCalculator.ts`) is a *second* detail-
   level taxonomy, parallel to T0–T3, living in the legacy model. One of these
   is the odd one out. *Opinion: the whole `tokenCalculator.ts` is a misnamed
   grab-bag (token colors + token estimates + export-to-JSON/Markdown/YAML +
   this dead abstraction-level extractor) and should be split or killed.*

### B. Dead or hollow machinery (looks complete, isn't)

These are the "odd one out" / "empty husk" items. I checked *behavior*, not
just file existence.

5. **`ProvenanceTrackingDomain` (`02-provenance-tracking`) — never called.**
   Instantiated in `DomainRegistry`, exported, and then nothing in
   `App.tsx`/components/services calls `linkArtifactToChapter`,
   `recordMutation`, `getOriginsForArtifact`, or `getArtifactsBirthedByChapter`.
   Meanwhile provenance *is* stored inline on artifacts (`provenance:
   {origin_chapter_id, …}` in the chat-extract path) — a parallel, disconnected
   mechanism. The domain is theater.
6. **`RecursiveGroupingDomain` (`02-recursive-grouping`) — never called.**
   In-memory `Map` only (not persisted), `aggregateSummary` just
   `join('\n\n')`s strings — no LLM, no aggregation logic. Super-Chapters from
   `03_DOMAIN_ARCHITECTURE_RULES.md` have no UI and no consumers. Dead domain.
7. **`<link>` tags are parsed and thrown away.** Stream protocol emits
   `onLinkDetected`; `App.tsx` registers handlers for status/chunk/topic_shift/
   artifact — **not** `onLink`. The model can propose graph edges and they
   silently vanish. Graph edges today only come from manual canvas drawing
   (`SpatialGraph`) and from the hardcoded `born_from` stub on chat-extracted
   artifacts. So the "hybrid graph" (your gut answer) has only the manual half,
   and even that is a canvas widget (see C).
8. **Token ceiling is decorative.** `tokenCeiling` is threaded through App →
   compiler options, read into `const ceiling`, and then… only used to compute
   `saturationRatio` for the orb color. The compiler **never degrades content
   to fit it.** `CONTEXT_COMPILER.md` promises "Token Budget & Dynamic
   Degradation." Unimplemented.
9. **T0–T3 "pre-computation" does not exist.** Tiers are a schema, not a
   pipeline. When artifacts are born from chat, the model may supply
   abstract/summary; when created via import/UI/YAML, t0/t1/t2 are copied from
   title/description/summary fields or defaulted ("Synthesized specification.").
   Nothing derives t1/t2 from t3. The "multi-resolution pre-computed so
   assembly is cheap" decision is a shell — assembly just reads whatever strings
   happen to be there.
10. **`handleToggleChapterCompressionMode` is an empty function** whose comment
    is "Retained for component contract compatibility." `ChatView` still renders
    compression controls and chapter fold state wired to it. UI that promises
    control and does nothing. (Related: `compressionMode` accepts
    `'full'|'summary'|'drop'|'dropped'` — inconsistent spelling in the type
    itself.)
11. **Focus modes / optical modes are the known husk, still user-facing.**
    Sidebar shows "autofocus Mode", and **tapping the saturation orb silently
    cycles autofocus → manual → myopia** (`onClick={cycleOpticalMode}`). No
    popup, no explanation. Meanwhile `MOBILE_UX_SPEC.md` says the wanted seed is
    *tap orb → stats popup*, and modes are supposed to be reconceived as presets
    over the mirror "after the mirror exists." Current state: a hidden
    mode-switcher on a widget that should show stats.
12. **The mirror does not exist.** The approved "big one" (`01` §4.11,
    `MOBILE_UX_SPEC.md` §5): show the user what the LLM sees. Today you get an
    orb with a total-k number, a 5px edge strip, and token colors in the
    sidebar. `compiledContext.compiledPrompt` is built and sent, never shown.
    Principle 1 has no observable. *Opinion: without this, "user controls
    context" is a slogan.*
13. **Edge heat strip legend lies.** Title/tooltip: "Red=Detail/Focus (T3),
    Yellow=Summary (T2), Blue=Title (T0)." Implementation splits
    `activeChapterTokens` vs `olderChaptersTokens` — chapter recency, not tier
    distribution. The compiler *does* compute `nodeDistribution` (tier3Count
    etc.) and it is not fed to the strip. Cosmetic dishonesty.
14. **Per-artifact `resolution: AbstractionLevel` / `pinned_tier` are written
    and never read by the compiler.** `handleUpdateArtifactResolution` upserts
    `resolution` onto the artifact; the compiler assigns tiers from graph
    distance + `tierOverrides` (workspace-level) only. Dead control path.

### C. Odd ones out (features with no story)

15. **TTS / speech playback.** `/api/tts` in `server.ts` + `ChatView` voice
    dropdown (Kore/Puck/Charon…), `speechSynthesis` fallback, logs mentioning
    "Kokoro-82M" while the server calls `gemini-3.8-flash-lite-tts`. **Zero
    mentions in any design doc or in motivation.** For a mobile "dump and
    close" capture tool, read-aloud is the last thing I'd expect in v1.
    *Opinion: this is pure vibecoding. Kill unless you actually use it.*
16. **Google Drive / Docs import (`googleDriveService.ts` 489 lines +
    `ImportModal.tsx` 920 lines).** A whole second ingestion surface (Drive
    search, Docs API AST parsing, direct URL paste, AI-extract via
    `/api/extract-artifact-from-file`, YAML preview). Not in motivation's three
    modes. Huge surface area for the least-critical problem ("how do I get old
    docs in" vs "how do I capture a thought now"). *Opinion: odd one out unless
    you really do live in Google Docs — I want to know.*
17. **`SpatialGraph.tsx` (849 lines)** — zoom/pan/drag force-ish canvas with
    tentative-link UI, pins, play/pause, "sparkles." Your "forest view" in
    motivation is *"visualize the whole forest → abstract → drill in without
    losing the high-level view."* That could be a tiny indented tree (which
    `ArtifactFolderTree` already is) or something much calmer. An 849-line
    physics-y canvas feels like the photography/depth-of-field metaphor got
    built. Also: it is the **only** place to hand-author graph edges — which
    makes edge authoring a desktop-mouse activity in a mobile-first app. That
    contradicts the top requirement.
18. **Server-side twin parser + twin prompt builder.** `parseModelResponse`
    (fenced ```artifact``` + XML + topic_shift) and `buildCompiledPrompt` +
    `DEFAULT_SYSTEM_INSTRUCTION` live in `server.ts`; the client has
    `03-stream-protocol` (modern XML + legacy fenced) and `03-optical-compiler`.
    The streaming path prefers client parse (`parsed.artifactUpserts.length > 0
    ? … : data.artifacts`) but the server still parses and ships its own copy.
    The server's default system instruction **teaches the legacy fenced format**
    while the compiler teaches XML. Two brains, disagreeing, in one turn. This
    is the "not completely connected" problem in its purest form.
19. **`/api/chat` (non-streaming) is never called by the client.** Dead
    endpoint carrying the twin parser along with it.
20. **`zustand` is in `package.json` and unused.** `package.json` is still named
    `"react-example"` (known). `motion` is a dependency — worth checking whether
    it's used (I didn't see imports in the components I read).
21. **`tokenCalculator.ts` name ≠ content.** Houses `getTokenColor`,
    `estimateTokens`, `getArtifactTextAtLevel`, **and** `exportToJSON/Markdown/YAML`
    (the export feature). Export living in "tokenCalculator" is the kind of
    thing that happens when a model rewrites a file and keeps the filename.
22. **`ServerLogsModal` (264 lines) rendered from three places in `App.tsx`.**
    Dev-debugging chrome shipped as product UI. Fine as a dev seam; odd as part
    of the "soul" of a capture app.

### D. Structural rot (the architecture itself)

23. **Two data models, welded together.** This is the deepest one.
    - `src/types/index.ts` = legacy AI-Studio `Project / Chapter / ChatMessage /
      Artifact` **plus** a partial Universal Artifact overlay **plus**
      "Helper getters/aliases for transition compatibility"
      (`title?`, `description?`, `history?`, `createdAt?`, `projectId?`…).
      It even says *transition* — and the transition never finished.
    - `src/domains/01-artifact-document/types.ts` = `UniversalArtifactDocument`
      (cleaner, but different field names: `workspaceId` vs `workspace_id`,
      `createdAt: number` vs `createdAt: string`).
    - `src/domains/02-chapter-segmentation/types.ts` = `ChapterPartition`
      (yet another chapter shape: `startIndex/endIndex`, no messages).
    - `types.Chapter` has `messages: ChatMessage[]` *and* the timeline domain
      holds turns separately. Three representations of a chapter/conversation.
    **Every UI component imports the legacy `src/types` model.** `App.tsx` is
    the translator. That's why `App.tsx` is 1086 lines and full of
    `isSummarized: Boolean(c.summary)` type coercions.
24. **`App.tsx` is a god component** (1086 lines). `03_DOMAIN_ARCHITECTURE_RULES.md`
    rule 4 says UI may never contain business logic / parsing / transport.
    `App.tsx` compiles context, runs the streaming turn, handles topic_shift,
    constructs full Artifact objects inline (40+ fields, including the fantasy
    `graph.is_high_concept`), maps domain state ↔ legacy Project shape, and
    owns auth/portal/modal state. The domains do real work; the wiring layer
    undoes the architecture.
25. **Level-4 presentation layer is 3 telemetry files** (orb, strip, color fn)
    and then everything else lives in `src/components/` outside the domain
    tree. The directory rules promise `04-presentation/{canvas,telemetry,inspector,cartography}`.
    Reality: one of four subfolders, and the real UI is elsewhere. The rules
    describe a codebase that doesn't exist.
26. **Rule 3 ("100% unit testable via DI, `<DomainName>.test.ts` in every
    domain")** — there is **one** test file (`src/tests/user-journeys.test.ts`)
    and no per-domain tests. Also pending.md already notes a pre-existing vitest
    gap in `tsc`.
27. **Dependency direction is fiction in places.** Compiler (L3) is clean
    against L2/L1 interfaces — good. But `App.tsx` (presentation) constructs
    artifacts with knowledge of stream payloads, versioning, segmentation, and
    the compiler — the forbidden direction, just centralized in one file.

### E. Conceptual gaps vs. what you actually asked for

These are "not built at all" rather than "built wrong."

28. **Mode 2 (your resolved design: user-knobbed deterministic pull).**
    Nothing. No embeddings, no vector store, no full-text search, no "pull
    related stuff" knob. The compiler's graph-distance pull is not this —
    that's Mode 3-ish assembly, and it needs edges that mostly don't exist.
29. **Auto-organizer (plan → agree → execute → rollback).** Nothing in code.
    Artifacts arrive via chat tags, manual create, or import. No classify →
    propose → approve → file loop, not even a stub.
30. **Mobile capture latency story.** UI is mobile-shaped (no top bars — credit
    where due). But "send → close phone → reply waits" depends on the
    server staying up, Firestore writes, and streaming resumption — none of
    which I verified as *behaving* under "close the tab mid-stream." Worth a
    dedicated pass later, not claiming it's broken, just unproven.
31. **Export story** exists (`ExportModal` + the three functions hidden in
    `tokenCalculator.ts`) but is legacy-`Project`-shaped. Fine as a start;
    disconnected from the domain snapshot format (`markbrain-database` v1)
    that `persistenceService` treats as "the architecture." Two export shapes.

---

## 2. What I think actually holds (don't nuke these reflexively)

- **The vertical-domain skeleton** (timeline, artifact-document, versioning,
  topological-graph, chapter-segmentation, stream-protocol) is real code with
  real methods, and `App` does call into it. The *idea* of the domains is the
  healthiest part of the repo.
- **Streaming + tag stripping + topic_shift → new chapter** path works end to
  end (client demux, chapter close/open).
- **One-call discipline** is respected in the happy path: `compile` →
  `executeStreamingTurn` → done. No hidden agent loop. The recalibration
  side-channel exists as its own domain (small, 45 lines — but its call site
  status I did not fully trace; treat as "probably wired to some UI, verify").
- **Persistence discipline** (one source of truth per session, `persistenceService`
  as the only module knowing backends, local + Firestore + backup/restore
  roundtrip) is the most *recent* and most coherent layer. pending.md says it
  was verified. This is good work.
- **Mobile constraints in ChatView** — no top bar, hamburger sidebar, modal
  artifact view, capture input at the bottom. Matches `MOBILE_UX_SPEC` /
  `02_UI_REFACTOR_PLAN` teardown. I did not find a resurrected sticky header
  in the chat feed.
- **DomainRegistry's snapshot hydration** is a clean single load path.

---

## 3. Pattern I'm seeing (the diagnosis, in one paragraph)

This codebase looks like **several sessions of AI Studio vibecoding with a
fake brief** ("design systems, token topologies, spatial architectures"), then
**one honest session** (2026-10-17) that rewrote the docs to *your* actual
intent, added the domains architecture + persistence cleanup — but **the code
was only partially pulled back onto the new intent.** The docs and the product
now disagree. The domains layer is the most "new intent" part; `server.ts`
system instruction, model copy, ImportModal, SpatialGraph, TTS, and the legacy
`types/` frankenmodel are the old intent still standing. The odd ones out are
exactly the features that only make sense for the fake brief.

*That's my theory. I could be wrong — maybe you do want an architecture
workbench and motivation.md is the fantasy. You have to tell me which document
is the real you.*

---

## 4. Questions I need answered before any cleanse

1. **Which product?** Brain-collector per `motivation.md`, or architecture
   workbench per the code's soul? (I'm 90% on the first. The placeholders and
   "you are a principal systems architect" get deleted either way — I just want
   to know if anything in the architect flavor is *yours*.)
2. **What do you actually use day to day?** Chat + chapters + artifact extract?
   The graph? Import from Drive? TTS? Knowing the real weekly surface would let
   us rank "kill" vs "keep" instead of guessing. If the honest answer is "I
   barely used it because it didn't fit," that's a very useful answer.
3. **Cleanse mode:** purge-in-place (delete the odd ones, keep the domain
   skeleton) vs. rebuild-on-skeleton (keep domains + persistence, re-grow UI/
   server around them)? Or something else? I have an opinion: purge-in-place,
   but with `server.ts` + `types/` treated as radioactive — the dual model and
   the twin parser are where rot concentrates.
4. **TTS:** yours or invented? (Same question for Drive import, SpatialGraph.)
5. **For the doc:** do you want this file to grow into a kill-list with
   decisions as we go, or stay as a snapshot and get replaced by a cleanse plan?

---

## 5. Unit tests — suspicious audit (2026-10-18)

Only one file exists: `src/tests/user-journeys.test.ts` — **13 tests, all passing
(127ms)**. Architecture rule 3 demands `<DomainName>.test.ts` per domain;
none exist. Passing is not the same as proving anything. I went through every
journey asking: *would this fail if the feature broke?*

### 6.1 Scoreboard

| Journey | Tests | Verdict | Why |
|---|---|---|---|
| 1 — Timeline append/update | 2 | **Keep (shallow)** | Real domain, real subscribe. But it's testing a data structure: append stores the string you gave it. |
| 2 — Stream demux & extraction | 1 | **Keep — best test in the file** | Real parser behavior: tags stripped from prose, artifact + topic_shift extracted. Only test I'd defend in a fight. |
| 3 — "Stream interruption & partial preservation" | 1 | **Misnamed edge case** | Aborts the controller *before* `executeStreamingTurn` is called. There is no partial text in the test. It only proves "abort-before-fetch returns a stub with nonzero token estimates." The journey name is false advertising. |
| 4 — Chapter boundary declare | 1 | **Keep** | Real: seals old chapter `endIndex`, slices don't overlap. One of the two genuinely load-bearing tests. |
| 5 — "Snapshot persistence & roundtrip" | 1 | **TAUTOLOGY** | Builds a `ProjectSnapshot` **object literal**, passes its arrays to domain constructors, asserts the constructors stored them. Never calls `saveProjectSnapshot` / `loadProjectSnapshot` / `parseDatabaseExport`. It imports the *type* `ProjectSnapshot` and tests nothing in `persistenceService`. The real roundtrip test is `scripts/roundtrip-test.cjs` (Playwright), not this. |
| 6 — "Guaranteed Genesis chapter fallback" | 1 | **TAUTOLOGY (worst kind)** | Comment says *"The exact fallback logic implemented in App.tsx"* — then **reimplements that logic inside the test** and asserts the test's own copy works. Never imports `App.tsx`. If App's fallback is deleted or changes, this stays green. |
| 7 — "Pre-flight auth gating & route evaluation" | 3 | **TAUTOLOGY** | Defines `evaluateAppRoute(...)` **inside the test file**. No such function exists in production; the routing is inlined in `App.tsx`'s render. Tests a private fantasy. |
| 8 — Workspace project load | 1 | **Keep (shallow)** | Real method (`loadUserProjects`). Only covers empty→one project. |
| 9 — "Zero-chat hero composer transition" | 2 | **TAUTOLOGY** | Defines `computeComposerMode` inside the test, mutates a fake `chapters` array. Never imports App/ChatView. Whether the UI actually does this is untested. |

**Count: 5 real (4 shallow, 1 good, 1 solid), 1 misnamed, 7 tautologies.**
More than half the suite would survive the deletion of the features it claims
to cover. That's vibecoding theater — green checkmarks as decoration.

### 6.2 Contamination

Fixtures speak the fake product: *"Design a fault-tolerant optical context
manager"*, *"Hello architect"*, codeName `OPT-CMP`, *"Distributed Optical
Compiler"*. The tests are infected with the wrong-soul problem from §0. Not a
test bug per se, but it tells you these were generated from the same fantasy.

Also: the tests **spam the logger to stdout** (`logger.action` on every
`appendTurn`) — noisy, and a symptom of the instrumentation bug in §6.

### 6.3 What's actually missing (keep/drop/missing proposal)

**Drop or replace:**
- Journey 5 (tautology) → replace with real `persistenceService` tests:
  `parseDatabaseExport` (valid / wrong format / missing projectId),
  serialize→parse roundtrip, and (if mockable) backend dispatch. The
  Playwright script stays as E2E; this is the unit-level contract.
- Journey 6 (tautology) → either extract the Genesis fallback from `App.tsx`
  into a named function and test *that*, or delete the test. A test of a copy
  is worse than no test.
- Journey 7 (tautology) → same: extract `evaluateAppRoute` for real or delete.
- Journey 9 (tautology) → same pattern. If `hero-centered` vs `timeline-feed`
  is real UI state, it should live in one place and be tested there.
- Journey 3 → rename honestly ("abort before dispatch returns stub") and add a
  real mid-stream abort test **with mocked fetch**, asserting partial text is
  preserved. The name promises what it doesn't check.

**Keep:**
- Journey 2 (parser), Journey 4 (chapter seal), Journey 1/8 as smoke — but
  don't let them pretend to be coverage.

**Missing — my priority order:**
1. **`persistenceService`** — the newest, most load-bearing, most recently
   bug-prone layer (pending.md: meta-merge bug, envelope-unwrapping bug).
   Untested at unit level today.
2. **Parser edge cases** (extend Journey 2): legacy fenced format that
   `DEFAULT_SYSTEM_INSTRUCTION` *still teaches*; `<artifact_upsert>` alias;
   `<link>` (currently parsed-and-dropped); malformed/incomplete XML
   (the streaming requirement in `STREAM_PROTOCOL.md` §3); multiple artifacts
   in one turn; missing `<abstract>`/`<summary>` fallbacks.
3. **Optical compiler:** tier assignment per distance, `myopia` clamp,
   ancestor backbone bump, `tierOverrides` honored, **what happens when
   `tokenCeiling` is exceeded (today: nothing — test would fail, which is
   useful)**, empty-arena behavior.
4. **`splitChapter` / `shiftBoundary` / `closeChapter`** — these implement the
   KISS boundary toolkit (`MOBILE_UX_SPEC` §6) and have **zero** tests.
   `splitChapter` even `throw`s on missing id — untested. `shiftBoundary` and
   `updateSummary` **silently no-op** on missing id — no log, no test.
5. **Versioning** (`recordRevision` / `rollback`) — user-facing "history
   intact" claim, untested.
6. **Error paths that users hit:** abort mid-stream, HTTP 500 from
   `/api/chat/stream`, `/api/summarize-chapter` failure (see §6.4 — this one
   has a real bug).
7. **If kept at all:** recalibration, provenance, grouping. Currently dead
   (§B5–6) — no tests, no callers. Testing dead code is malpractice; decide
   keep/kill first.

*Opinion: I would rather have 6 honest tests than 13 where 7 are lying. The
tautologies are actively harmful — they make `bun run test` a comfort ritual.*

---

## 6. Instrumentation & hidden failure branches (2026-10-18)

David's standard (2026-10-18): happy path logs map to **human actions**, max
~1 event per user action per second; **WARN/ERROR on every branch that isn't
supposed to happen**; hunt hidden branches that can fail and aren't handled.
I'm treating that as the target contract. Current state is not that.

### 7.1 The logging contract that exists today (and its problems)

`src/utils/logger.ts` — levels `info | warn | error | action`, 200-entry
in-memory ring, `console.*` sink. `server.ts` has a **separate** `logServer`
ring + SSE fan-out to `ServerLogsModal`. Plus raw `console.*` in 8+ files.

Three problems, in order of damage:

**(a) Rate violation — the one you predicted.** `Timeline.updateTurn` logs
`logger.action('Timeline', 'Updated turn …')` **on every call**. `App.tsx`'s
`onChunk` callback calls `updateTurn` **per SSE chunk**. One user "Send"
therefore produces: 1 ChatView action + 1 Timeline append (user turn) + 1
Timeline append (assistant placeholder) + **N Timeline "User Action: Updated
turn" logs** (N = chunk count, easily 100–500) + finalize update + status
toggles. The log is not a trace of what *you* did; it's a trace of the token
stream. Exactly the flood you said to prevent.

**(b) Taxonomy is wrong.** `logger.action` is documented as "User Action:" but
is used for domain internals (`appendTurn`, `updateTurn`, `declareNewChapter`)
that fire as a *consequence* of a user action — or of the model. Sidebar
clicks being `action` is right. `Updated turn` per chunk is not. Today the
level cannot answer "what did the human do?"

**(c) The logger excludes the code that needs it.** `LogCategory` is a closed
union of 12 names: App, ChatView, Sidebar, DomainRegistry, Timeline,
Segmentation, Stream, Persistence, Auth, AuthGate, ProjectGenesis,
ErrorBoundary. **Missing:** ImportModal, ExportModal, ProjectLauncher,
SpatialGraph, ArtifactDetailModal, Compiler, Versioning, Graph, Workspace,
Recalibration, Drive, YamlParser, TTS, ServerLogs… Those files mostly cannot
log via `logger` without a type error — which is *why* they use raw
`console.error/warn`. The enum designed for "centralized production logging"
already chased half the codebase into the unstructured sink. Also:
`03-stream-protocol` has category `'Stream'` available and still uses
`console.warn` for SSE parse errors.

**Proposed contract** (opinion, for discussion):

| Level | Rule |
|---|---|
| `action` | **Exactly once per user gesture** (tap send, tap artifact, toggle X, confirm Y). Never from domain internals. Never from stream chunks. |
| `info` | Lifecycle that is not a user gesture (boot, snapshot load, project switch, **turn finalized**). At most ~1 per user action. |
| `warn` | Recovered unexpected: fallbacks, silent no-ops, parse-tolerance, degraded mode. **Every fallback is a warn by definition.** |
| `error` | User-visible failure, data-loss risk, or contract violation. Include enough to diagnose (ids, status codes). |

Stream updates should be **debounced** (e.g. log `info` once at "writing
started", once at "turn completed" with totals) — not per chunk. Domain
constructors logging `info` on every instantiation is also noisy in tests;
fine in app boot.

### 7.2 Silent degradations (recovered, barely announced)

These are the "hidden branches" — they *can* fail and the code *does* handle
them, but with zero structured log and/or spun as a positive:

| Fallback | Where | What the user learns |
|---|---|---|
| Model watchdog: non-lite model >9s → **auto-failover to flash-lite** | `server.ts` stream | SSE status "Optimizing latency: routed to Gemini 3.1 Flash Lite…" — spun as optimization. It's a degradation. Should be `warn`. |
| TTS server fail → Web Speech API | `ChatView` | `console.warn` mentions "Kokoro-82M" (wrong name — server uses Gemini TTS). No user signal. |
| Drive query `mimeType` 400 → simple query | `googleDriveService` | `console.warn` only. |
| Docs export: native markdown → Docs AST → `text/plain` (3-deep fallback) | `googleDriveService` | `console.warn` x2, silent quality drop. |
| YAML frontmatter parse fail → plain markdown | `yamlArtifactParser` | `console.warn`, artifact likely born with empty-ish tiers. |
| `getBackend()` localStorage throw → default `firestore` | `persistenceService` | `catch { /* storage unavailable */ }` — **no log at all**. |
| Legacy `topic_shift` JSON parse error | `stream-protocol` + `server.ts` | `catch { // ignore }` — **no log**. |
| SSE `JSON.parse` chunk error | `stream-protocol` | `console.warn`, stream continues (good), unstructured. |
| `/api/chat/cancel` fetch fail | `App.tsx` | `.catch(() => {})` — **swallowed completely**. |
| `updateSummary` / `shiftBoundary` on unknown chapter id | `ChapterSegmentation` | **silent return**. Caller can't tell it didn't apply. |

*Your rule says these should be WARN at minimum. I agree — a fallback that
doesn't warn is how you debug ghosts six months later.*

### 7.3 What isn't instrumented at all

- **`03-optical-compiler`** — the most important function in the product
  (`compile`) has **zero** logs. No record of focal ids, tier distribution,
  token totals, ceiling breach. This is the thing Principle 1 is about.
- **`02-topological-graph`** — add/remove/load edges, no logs.
- **`01-artifact-versioning`** — recordRevision/rollback, no logs.
- **`02-provenance-tracking` / `02-recursive-grouping` / `03-chapter-recalibration`**
  — dead or barely wired; nothing to instrument until keep/kill is decided.
- **`App.tsx` handleSendMessage** happy path: no `info` at "turn started /
  completed / N artifacts extracted / topic_shift applied". The interesting
  outcome of the core action is unlogged; the boring per-chunk updates are.
  Inverted.
- **`ImportModal` / `googleDriveService` / `firebase`** — raw console only.
- **`server.ts`** uses `logServer` (good, has a ring + SSE) but the client
  logger and the server logger are **not joined**. `ServerLogsModal` shows
  server only. You cannot see one trace across the request.

### 7.4 Hidden branches that can fail and are not taken care of

Facts, with locations:

1. **`handleSummarizeChapter` uses the wrong chapter.** `App.tsx` ~606:
   takes `chapterId` as parameter, but always pulls turns from
   `segmentation.getActiveChapter()` and posts *those*. If the user
   summarizes a non-active chapter, they get the active chapter's summary
   applied to the target id. Real bug, unlogged, untested.
2. **Same function: no `res.ok` check.** `data.summary` from an error JSON →
   `updateSummary(chapterId, undefined)`. Failure is invisible (catch logs
   `console.error` only).
3. **`WorkspaceDomain.importWorkspaceJson`** — `JSON.parse(jsonStr)` with
   **no try**. Currently uncalled (only declared in the interface) — a
   landmine for whoever wires it next.
4. **`CompiledOpticalPayload` is sent with no ceiling check.** If compiled
   prompt exceeds `tokenCeiling`, nothing warns — server just gets a fat
   prompt. The "dynamic degradation" path doesn't exist (§B8), and its
   absence is also unlogged.
5. **`onArtifact` upsert path in `App.tsx`** — code is a slug of the title;
   collisions likely (`getArtifact(code) || getArtifact(u.id)`). No log when
   an upsert hits the "existing" branch vs "new" branch, and no log if the
   artifact domain rejects the shape.
6. **`StreamProtocolDomain` per-chunk parse `catch`** — continues silently
   (with `console.warn`). If the model emits broken tags, artifacts vanish
   and the only trace is an unstructured warn. Should be `warn` with the
   offending snippet (truncated).
7. **`shiftBoundary` / `updateSummary` / `closeChapter`** — unknown id =
   silent no-op (above). Callers (and users) can believe a boundary moved
   when it didn't.
8. **`splitChapter` throws** on missing id — do any UI callers catch it?
   `App.tsx`'s declare/split handlers do not appear to wrap it. Unhandled
   throw in an event handler = React error boundary or silent console.
9. **Abort path** (`App.tsx` catch) uses `console.error` for the non-abort
   branch and `logger` is not used — while the abort branch is fine
   functionally. Asymmetric.
10. **Firebase/Drive init failures** (`firebase.ts`, `googleDriveService.ts`)
    log via `console.error/warn` and then… continue, often with null user.
    AuthGate handles some of it; import flows may just show an empty Drive
    list with a generic error string.

### 7.5 Instrumentation proposal (opinion)

1. **Kill per-chunk `action` logs.** `updateTurn` should not log at `action`.
   At most: `info` "turn updated (streaming)" debounced, or log only on
   `isStreaming: false` finalize.
2. **One `action` per gesture** — ChatView send already does this (good).
   Keep that pattern; strip `action` from domain methods.
3. **Warn on every fallback** listed in §6.2, with the branch name in the
   message so they're greppable (`fallback:model-watchdog-to-lite`,
   `fallback:tts-web-speech`, `noop:chapter-not-found`, …).
4. **Error on user-visible failure** (summarize fail, send fail, import fail)
   through `logger.error`, not `console.error`. User-facing text stays in the
   UI; the log is for us.
5. **Unify or explicitly split sinks.** Either: client logger forwards
   `error`/`warn` to the server ring so `ServerLogsModal` shows one trace; or
   accept two sinks and say so in the runbook. Today it's neither.
6. **Fix `LogCategory`** — make it `string` (or a documented prefix
   convention) so new files can log without a type edit. A closed enum that
   excludes ImportModal/Compiler/Versioning is why those files are mute.
7. **Instrument `compile()`** — one `info` per send: focal ids, node
   distribution, total tokens, ceiling, overflow boolean. That's 1 event per
   human action, and it's the *useful* one.
8. **Happy-path trace for the core action** (send message):
   `action: send` → `info: compile` → `info: stream started` →
   `info: stream done` (tokens, ms, artifacts count, topic_shift?) →
   `info: turn finalized`. Five events. Human-action-shaped.

---

## 7. Proposed next moves (opinion, not decided)

- Kill or quarantine: TTS, `/api/chat`, `zustand`, unused abstraction-level
  extractor, `ProvenanceTrackingDomain`/`RecursiveGroupingDomain` *or* actually
  wire them (currently they only cost trust).
- Fix the lie at the top: system instruction + placeholders + model copy must
  speak *your* product. Cheap, high leverage.
- Decide the data-model fight (`types/index.ts` vs domains) before building the
  mirror — the mirror is a projection of the payload; it can't land on a
  schizoid model.
- Then, and only then, the mirror (your "big one"), because everything else in
  context-control is unverifiable without it.
- **Tests (§5):** delete or rewrite the 7 tautologies first — they're worse
  than gaps. Then add persistenceService + parser-edge + compiler + boundary
  toolkit tests, in that order.
- **Instrumentation (§6):** stop the per-chunk `action` flood (it violates
  your 1-per-human-action rule by 100x); warn on every fallback in §6.2;
  instrument `compile()`; fix `LogCategory` so the mute files can log.

---

*(Corrections to any fact above are welcome and expected — I will amend, not
defend. Opinions in here are mine and changeable.)*