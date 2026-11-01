# Findings — ranked by so-what (Deep Review)

*2026-10-30 @ fe3fbdd. Second-pass deep review. Read-only audit: no code changed. Decisions are David's.*

---

## Executive Diagnosis: Why Toil Exists Here

The first pass asked: *"Which files fail the one-phrase test, and which cross-boundary imports look ugly?"*

The deeper question is: **Why did almost every recent bug and multi-hour toil session happen in the exact same 6 files?**
- Why did links work in unit tests, break in VPS, and not exist in Local mode?
- Why did chapter summaries turn into `=== SUBTITLE ===` soup on the server?
- Why did AI-created artifacts fail to attach until fixed in three separate places?
- Why did unlocking the vault take seconds to clear the padlock?
- Why does every small UI feature require editing a 2,341-line component?

Because the codebase has **Five Split-Brain Bugs Generators** — places where **one domain invariant is implemented twice (or three times) across different layers**. Whenever you change a law, you have to remember to update all copies by hand. When you miss one, a silent bug ships.

---

## Part 0 — The Five Split-Brain Toil Generators (The Real Enemy)

### 1. The Dual Commit Engine: `src/application/sendQueue.ts` vs `server/db/projectRepo.ts` 🚩🚩🚩🚩

When an LLM reply finishes, turning the raw stream into durable state (user turn + assistant turn + attachment provenance + `<artifact_upsert>` + revision snapshot + `<topic_shift>` chapter boundary + `<link>`/`<unlink>` edges + receipts) is implemented **twice from scratch**:

1. **Client (Local mode):** `SendQueue.commitPair` + `commitRegenerate` + `applyBufferedArtifacts` + `applyBufferedShifts` in `src/application/sendQueue.ts` (lines 769–1387).
2. **Server (VPS mode):** `commitJobPairTransaction` in `server/db/projectRepo.ts` (lines 885–1380).

**Verified live drift between the two engines right now (`fe3fbdd`):**
- **Graph links & unlinks:** `projectRepo.ts` parses/consumes `<link>` and `<unlink>`, resolves slugs via `artifactFileName`, writes/deletes edges, and attaches `extractedLinks` receipts to the turn. **`sendQueue.ts` (`commitPair`) and `03-stream-protocol/index.ts` (`executeStreamingTurn`) drop `parsed.links` and `parsed.unlinks` on the floor.** In Local mode, graph links and link receipts do not work at all.
- **Artifact colors:** Client `applyBufferedArtifacts` assigns `getMellowPastelColor(code)`. Server `commitJobPairTransaction` hardcodes `'#e05a66'` for every chat-extracted artifact.
- **Updating an existing artifact:** Client `applyBufferedArtifacts` checks `deps.artifacts.getArtifact(code)`, records the old state as a revision, and updates in place. Server `commitJobPairTransaction` creates a brand-new `doc` object with `createdAt: now2` and overwrites without preserving existing tags/color/createdAt.

**So-what:** Every time the LLM sentinel protocol or commit rules evolve, you pay double the implementation toil and double the bug surface.

---

### 2. The Split-Brain Active/Inactive Thread Architecture (`ThreadRegistry` vs Live Domains) 🚩🚩🚩🚩

The active thread's turns and chapters live in `DialogueTimelineDomain` and `ChapterSegmentationDomain`. Every *inactive* thread's turns and chapters live in a private `Map<string, ThreadContent>` inside `ThreadRegistry.ts` (`06-chat-threads`).

Because of this split:
- **Every domain operation on turns or chapters is written twice:**
  - `segmentation.declareChapter(...)` vs `threadRegistry.declareChapterInactive(threadId, ...)`
  - `segmentation.upsertChapterAtBoundary(...)` vs `threadRegistry.upsertChapterAtBoundaryInactive(threadId, ...)`
  - `timeline.addTurn(...)` vs `threadRegistry.appendInactiveTurn(threadId, ...)`
  - `timeline.updateTurn(...)` vs `threadRegistry.updateInactiveTurn(threadId, ...)`
- **Every caller must branch on `isActiveThread`:** `sendQueue.ts` has helper methods (`turnsOf`, `chaptersOf`, `appendTurnToThread`, `updateTurnInThread`, `applyBufferedShifts`) that check `if (this.isActiveThread(deps, threadId))` and call completely different APIs.
- **Delta sync (`useVpsDeltaSync.ts`) must manually route:** lines 80–103 split incoming chapters into `own` vs `others` and call `segmentation.loadChapters` for the active thread and `threadRegistry.mergeInactiveChapters` for inactive threads. (Live bug 2026-10-25: forgetting this rendered every thread's "Genesis Chapter" on top of the active thread.)
- **Switching threads (`selectThread` in `DomainRegistry.tsx`) is a manual memory swap:** flush `timeline.getTurns()` into `ThreadRegistry`, pull the incoming array out, call `timeline.loadTurns()`, while `hydratedRef` must be carefully muted or `persistWorker` fires a spurious save.

**So-what:** `ThreadRegistry.ts` is a 789-LOC god class with 45 methods because it is simultaneously: (a) thread metadata CRUD, (b) folder CRUD, (c) attachment staging & provenance engine, (d) title state machine, and (e) a shadow clone of `DialogueTimelineDomain` and `ChapterSegmentationDomain` for inactive threads.

---

### 3. Triple Provenance Welding (`sendQueue` vs `ThreadRegistry.hydrate` vs `useVpsDeltaSync`) 🚩🚩🚩

MarkBrain has a strict law: *staged attachments (`turnIndex === null`) become committed attachments (`turnIndex = N, turnId = ...`) on the user turn when sent; AI-extracted artifacts become committed attachments on the assistant reply.*

Where does that law live? **In four different places:**
1. `SendQueue.commitPair` (for Local mode sends)
2. `projectRepo.commitJobPairTransaction` (stamps `turnIndex` and `turnId` onto turn JSON on the server)
3. `ThreadRegistry.hydrate` (lines 320–395: 75 lines of archaeological reconstruction scanning `turn.meta.attachments` and `turn.extractedArtifacts` to weld provenance when loading a snapshot)
4. `useVpsDeltaSync.ts` (`weldProvenance`, lines 135–175: another 40-line loop scanning delta turns to weld provenance into `ThreadRegistry` after a 10s poll)

**So-what:** If attachment provenance changes by one field, four files across `domains/`, `application/`, and `server/db/` must be edited in lockstep.

---

### 4. Duplicate AI Chore Prompts & Parsers (`routes/*` vs `chatJobRunner` vs `prompts/lanes`) 🚩🚩🚩

The codebase has a file explicitly created to prevent prompt drift (`src/prompts/lanes.ts`, whose header comment literally reads: *"One source of truth: a prompt that drifts between proxy mode and direct mode would make the two paths answer differently"*). Yet on the server:

- **Thread Titling exists twice:**
  - `server/jobs/chatJobRunner.ts` (`runTitleChore`) calls `buildTitlePrompt` + `cleanupTitle` from `src/prompts/lanes.ts`.
  - `server/routes/title.ts` (`/api/title-thread`) ignores `lanes.ts` and has its **own inline prompt string** and its **own inline regex cleanup** (lines 38–78). (Notice the subtle prompt text drift on line 21 of `lanes.ts` vs line 35 of `routes/title.ts`!)
- **Q&A Extraction exists twice:**
  - `server/jobs/serverArtifactIndexer.ts` imports `buildQaPrompt`, `parseQaPairs`, `fallbackQaPairs` from `src/prompts/lanes.ts`.
  - `server/routes/searchIndex.ts` defines its **own copy-pasted `buildQaPrompt`, `parseQaPairs`, and `fallbackQaPairs`** (lines 108–190).
- **Chapter Summarization exists twice:**
  - `server/routes/summarize.ts` and `server/jobs/chatJobRunner.ts` (`runChapterSummaries`) both run the 12s deadline race, flight recorder wrapping, `parseSentinelBlocks(raw)`, and legacy regex fallback (`DESCRIPTION: ... SUMMARY: ...`).

**So-what:** Fixing a parser bug (like the `=== SUBTITLE ===` sentinel soup bug) in the route leaves it broken in the background job runner, or vice versa.

---

### 5. Dual SSE Wire-Protocol Parsers (`03-stream-protocol` vs `sendQueue.readVpsSse`) 🚩🚩

Streaming a chat turn over SSE is parsed in two places with two slightly different state machines:
1. `StreamProtocolDomain.executeStreamingTurn` (`src/domains/03-stream-protocol/index.ts`, lines 290–365) — reads `status`, `chunk`, `complete`, `error` frames and demuxes on the fly.
2. `SendQueue.readVpsSse` (`src/application/sendQueue.ts`, lines 985–1070) — its own `ReadableStream` reader, `\n\n` frame splitter, `event:`/`data:` regex parser, handling `snapshot`, `status`, `chunk`, `complete`, `error`, `stopped`.

**So-what:** `03-stream-protocol` claims to be the stream protocol domain, yet it cannot parse a VPS job stream, and its pure XML sentinel demuxer (`demuxChunk`/`demuxFullTurn`) is welded to the network `chatStream` call in the same class.

---

## Part 1 — Gamed Contracts (Phrase Passes, Sufficiency Fails)

*The sufficiency law: **The phrase + exports + signatures must be enough for a stranger to drive all connecting code — all special cases, all special behavior, all caller obligations. Anything hidden below the signature = FAIL, gamed.***

| file | what phrase + signatures let you believe | the hidden behavior / obligation you could NOT know | so-what |
|---|---|---|---|
| `data/sendReadiness.ts` | "It decides whether sending a message is possible right now." | In capture mode it returns `{ ok: true }` unconditionally (line 89). Also depends on a module-singleton `serverKeySnapshot` that is only fresh if someone else polled `/api/account/settings` or dispatched a custom `window` event (`markbrain:sync-now`). | A security/UX gate with a hidden always-yes backdoor AND a hidden caller obligation to fire DOM events to refresh it. That is why the padlock bug happened. |
| `application/persistWorker.ts` | "It saves the whole project in the background on a schedule." | 1) Silently no-ops if `isCaptureMode() && !isSlowSaveSeam()` (line 79). 2) Silently no-ops if `hydratedRef.current === false` — callers who mutate domains during sync/hydration must remember to manually toggle `hydratedRef.current = false` in a `try/finally` or they trigger a race save. | Saving depends on hidden global flags and a shared mutable boolean ref passed between `DomainRegistry`, `snapshotLoader`, `persistWorker`, and `useVpsDeltaSync`. |
| `application/serverMutationQueue.ts` | "It holds changes made while offline so they can be sent later." | In capture mode `queueServerMutation` silently returns on line 66 without queuing. | Silent drop inside the queue primitive. |
| `gateway/api.ts` | "It is the app's single door to the server and the AI providers." | 1) Embeds a 120-line fake SSE generator (`fixtureChatStream`) gated on `isCaptureMode()`. 2) Silently routes between browser-direct providers and `/api/*` server endpoints based on `getWorkspaceMode()`. | Callers cannot tell from any signature whether a call goes to the server, directly to Google/OpenRouter from the browser, or to an in-memory test fixture. |
| `services/persistenceService.ts` | "It saves and loads the project through whichever backend is active." | Exports `isFixtureMode`, `isCaptureMode`, `isSlowSaveSeam` (URL/env inspection) and bundles `HEADLESS_FIXTURE` into production code. | The storage facade doubles as the global test-harness mode switchboard. |
| `ui/artifacts/purgeArtifact.ts` | "It removes an artifact everywhere it is mentioned." | Hand-enumerates 5 places a reference can hide (`artifacts`, `versioning`, `graph`, `threadRegistry`, `workspace`, `serverMutationQueue`). | A `ui/` file performing cross-domain referential integrity surgery by hand. Add a 6th reference holder and deletion silently rots. |
| `ui/graph/createGraphHandlers.ts` | "It applies map edits — node positions, new links." | Stores node `(x, y)` coordinates by rewriting the entire `Artifact` document (`upsertArtifact({ ...art, graph: { x, y } })`), not via `TopologicalGraphDomain`. | The graph domain doesn't own node coordinates; the artifact document does. Moving a node on the canvas mutates the artifact domain. |
| `domains/00-workspace/index.ts` | "It re-exports the workspace domain." | Defines a **second, inline `IWorkspaceDomain` interface** with `any` types and missing `removeProject()`, shadowing the real `interface.ts`. | Consumers importing the facade get `any` instead of the real contract. |
| `domains/06-chat-threads/ThreadRegistry.ts` | "It keeps chat threads and their attachments." | Holds the split-brain inactive turn/chapter cache; mutating active threads through its `Inactive` methods silently returns `null`; mutating inactive threads through live domains corrupts the active chat. | Callers must know the split-brain invariant by heart; the type system does not protect you from calling the wrong domain for a `threadId`. |
| `domains/DomainRegistry.tsx` | "It provides the domain instances to React components." | 1) `compiler` `useMemo` omits `graph` from its dependency array (line 103). 2) Rebuilds `timeline`, `artifacts`, `segmentation` on `activeProjectId` change while keeping `versioning`, `graph`, `threadRegistry` as eternal singletons across project switches. 3) Runs auth, delta sync, and outbox replay as side effects of mounting context. | Half the domains are recreated per project, half are mutated in place; `useDomains()` returns a 27-field object that re-renders every consumer on any auth/sync state change. |
| `data/localKeyVault.ts`, `data/byokFlag.ts`, `application/connectivity.ts` | "Encrypted local vault" / "BYOK flag" / "Online status". | All export `...ForTests` mutators (`setPbkdf2IterationsForTests`, `setByokEnabledForTests`, `setOnlineForTests`) in the production module interface. | Test backdoors shipped on the public facade of security and connectivity primitives. |

---

## Part 2 — Ranked Systemic Findings

### 1. The God-File Reactivity & State Web (`DomainRegistry` → `App` → `ChatView`) 🚩🚩🚩

Look at how state flows from the domains to the screen:
1. `DomainRegistry.tsx` (398 LOC) instantiates 10 domains + runs `useSessionMachine`, `useVpsDeltaSync`, `attachPersistWorker`, and `initVpsSync`, exposing a **27-field context value**.
2. `App.tsx` (1,315 LOC) subscribes to **all 7 mutable domains** with `() => triggerReRender()`, which increments a single counter: `const [tick, setTick] = useState(0)`.
3. Every single domain emission — a streaming chunk, a token count update, a background delta poll, a folder rename — increments `tick`, re-evaluates `App.tsx` top-to-bottom (including 180 lines of Draft-Proximity Search Testbed state and timers), and passes **~45 props** down into `ChatView.tsx`.
4. `ChatView.tsx` (2,341 LOC) receives those ~45 props and combines them with **33 local `useState`/`useRef`/`useSyncExternalStore` hooks** and **11 `useEffect`s** across 12 distinct UI responsibilities (hero empty state, chapter header strip + ⋯ menu + steering form, inline chapter split form, message bubble feed, receipts row, per-message TTS download/cache/playback orchestration, draft queue cards, per-draft vault unlock form, staged attachment tray, composer textarea with auto-grow, composer vault padlock modal, and proximity badge).

**So-what:**
- There is no component isolation in the chat screen. A change to the vault unlock popup, TTS button state, chapter steering form, or receipt chips edits the same 2,341-line function scope.
- `tick`-driven full-tree re-rendering means `App.tsx` is a manual change-detection loop fighting React instead of letting slices subscribe to the narrow state they care about.

### 2. No Neutral `shared/` Layer Between Client (`src/`) and Server (`server/`) 🚩🚩🚩

`02_SYSTEM_ARCHITECTURE.md` §2 states as law: *"`src/` never imports `server/` and vice versa."*
In reality:
- **`server/` has 25 imports from `src/`**, reaching into `src/domains/*/types`, `src/domains/03-optical-compiler/index`, `src/domains/03-stream-protocol`, `src/domains/search/*`, `src/services/stores/projectStore`, `src/services/searchIndexStore`, `src/prompts/*`, and `src/utils/*`.
- **`src/application/useVpsDeltaSync.ts` imports `ProjectDeltaResponse` from `../../server/db/projectRepo`.**

Sharing pure types, the sentinel demuxer, filename slugifiers, and prompt builders between client and server is **good architecture** (DRY across Local and VPS modes). What is broken is that **they live inside client folders (`src/services/stores`, `src/domains`) instead of a neutral `shared/` contract package/directory**, and nobody knows what is safe for the server to import vs what pulls in browser state.

### 3. `server/db/projectRepo.ts` Mixes SQL Storage with Domain Commit Policy 🚩🚩

At 1,502 LOC, `projectRepo.ts` contains two completely different worlds:
- **World A (Storage Repository, ~950 LOC):** SQLite row upserts, snapshot assembly, hash-diffing, tombstones, delta queries, revision history rows.
- **World B (Chat Turn Commit Policy, ~550 LOC):** `commitJobPairTransaction` — regex parsing `<link>` tags, slugifying filenames via `artifactFileName`, capability gating (`caps.writeArtifacts`, `caps.autoChapter`, `caps.graphLinks`), deciding how topic shifts retitles vs splits chapters, stamping attachment provenance onto turn metadata.

**So-what:** World B is domain business logic (and duplicate of `sendQueue.ts`), buried inside the SQLite adapter.

### 4. Layering Inversions & Hidden Event Buses (`src/data`, `src/services`, `src/gateway`) 🚩🚩

The non-domain client directories (`data/`, `services/`, `gateway/`, `application/`) have no clear hierarchy:
- `src/data/` is supposed to be leaf data/config, yet 5 of its 9 files import upward from `services/workspaceSession`, `services/persistenceService`, or `gateway/api`.
- `src/services/vpsSync.ts` imports upward from `src/application/serverMutationQueue.ts`.
- `src/gateway/providers/{gemini,openrouter}.ts` and `direct.ts` import upward from `src/services/callLogStore.ts`.
- **Hidden `window` event buses:** Instead of explicit reactive stores or callbacks, cross-layer coordination uses untyped DOM events:
  - `window.dispatchEvent(new Event('markbrain:sync-now'))` (fired in `ChatView.tsx`, `ModelSettingsModal.tsx`; listened to in `useVpsDeltaSync.ts`)
  - `window.dispatchEvent(new Event('focus'))` (fired in `sendQueue.ts` lines 906, 956, 1039 as a hack to trick `useVpsDeltaSync` into polling!)
  - `OUTBOX_CHANGED_EVENT` in `offlineOutbox.ts`

**So-what:** Firing fake `window` `'focus'` events from `sendQueue.ts` to trigger a server delta pull is the textbook definition of a hidden coupling that violates the sufficiency test.

### 5. `src/domains/` Root Junk Drawer & Missing Facades 🚩

Inside `src/domains/`:
- The numbered domains `00` through `02` are small, clean, and well-isolated (80–240 LOC each).
- Except `00-workspace/index.ts`, which has a broken copy-pasted `IWorkspaceDomain` interface using `any`.
- `03-optical-compiler` (454 LOC) and `03-stream-protocol` (396 LOC) put their entire implementation directly in `index.ts` and mix pure functions (slugifying, XML demuxing) with stateful/network orchestration.
- Loose files at `src/domains/` root (`DomainRegistry.tsx`, `granularity.ts`, `plaintextTree.ts`, `callLogTypes.ts`, `search/`) have a combined fan-in of **180**. `granularity.ts` mixes core domain vocabulary with Tailwind CSS strings (`bg-emerald-500/15 text-emerald-300...`).

---

## Part 3 — What Is Genuinely Strong (Do Not Touch)

1. **The Core Domain Models (`01-artifact-document`, `01-artifact-versioning`, `01-dialogue-timeline`, `02-chapter-segmentation`, `02-topological-graph`)** are 80–240 LOC each, single-phrase, fast, and pure.
2. **`src/utils/` (15 of 17 files)** are exemplary leaf utilities (`markdown.ts`, `tarGz.ts`, `lineDiff.ts`, `sectionChunker.ts`, `sentinelParser.ts`). Only `tokenCalculator.ts` has a smuggled tenant (project export).
3. **`plaintextTree.ts` and `server/db/schemaSpec.ts`** have rock-solid, self-contained contracts.
4. **Small extracted UI/preference modules** (`sendOnEnter.ts`, `chatRenderMode.ts`, `uiFontScale.ts`, `ttsTransport.ts`, `ambientTelemetry.ts`, `AttachmentControls.tsx`) prove the exact pattern that works in this repo.
5. **The 706-test Vitest suite + hermetic evidence harness** provide a high-confidence safety net for structural refactoring.
