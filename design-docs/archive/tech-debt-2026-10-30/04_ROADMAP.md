# Refactoring & Toil-Reduction Roadmap

> **STATUS: COMPLETE (2026-10-30).** All six phases executed, one commit each, gates green between every phase:
> Phase 1 `419ca79` · Phase 2 `c28ab40` · Phase 3 `ae60928` · Phase 4 `f68b320` · Phase 5 `7692f07` · Phase 6 (this commit).
> Final: tsc clean, 747/747 tests (84 files), build clean. Known accepted residuals are documented in the headers of
> `src/data/keySlots.ts`, `src/data/modelConfig.ts`, `src/data/sendReadiness.ts`, `src/application/connectivity.ts`,
> `src/data/byokFlag.ts` (test seams + runtime mode reads) and `src/data/modelConfig.ts` (pre-existing gateway cycle).

*2026-10-30 @ fe3fbdd. Concrete execution plan to eliminate split-brain toil, enforce the sufficiency law, and isolate vertical slices. No code changed yet — awaiting David's sign-off on phases and order.*

---

## Guiding Rules for Every Phase

1. **Zero behavior change per structural commit.** Refactoring commits rearrange boundaries and unify duplicate engines; they do not sneak in new product features.
2. **TDD & Equivalence Tests First.** When unifying a split-brain (e.g., dual commit engines, active/inactive threads), first write an equivalence test that runs both paths on the same input and proves where they agree or diverge, then unify.
3. **Every new or touched file must pass the Sufficiency Test:**
   - Explainable in **one simple phrase** at the top of the file.
   - **Phrase + exports + signatures** must disclose all special cases and caller obligations.
   - No hidden capture-mode branches inside business logic; seams live at the composition root.
4. **Gates after every phase:** `npx tsc --noEmit` → `npx vitest run` → `npm run build`.

---

## Phase 1 — Low-Hanging Hygiene & Dishonest Facades (Zero-Risk Warmup)

**Goal:** Eliminate literal lies in facades, dead copy-pasted code on the server, and smuggled tenants in small files. Can be done in ~1 hour with zero architectural risk.

| Step | Action | Files Touched | Toil / Debt Removed |
|---|---|---|---|
| **1.1** | Fix the dishonest front door in `00-workspace/index.ts` — replace the inline `any`-typed `IWorkspaceDomain` with `export * from './interface'`. | `src/domains/00-workspace/index.ts` | Restores real TypeScript checking on workspace calls across the app. |
| **1.2** | Delete duplicate prompt/parser implementations on the server and wire them to the shared prompt module (`src/prompts/lanes.ts` & `src/prompts/prompt.ts`). Delete 1-line `server/lib/prompt.ts` re-export shim. | `server/routes/title.ts`, `server/routes/searchIndex.ts`, `server/routes/summarize.ts`, `server/jobs/chatJobRunner.ts`, `server/lib/prompt.ts` | Kills **Split-Brain #4**: one title prompt/cleaner, one QA prompt/parser/fallback, one chapter-summarize parser. |
| **1.3** | Evict smuggled tenants from leaf files: move `exportToJSON/Markdown/YAML` out of `utils/tokenCalculator.ts` into `utils/projectExporters.ts`; move `MELLOW_DARK_PASTELS` out of `types/index.ts`; move Tailwind CSS palette out of `domains/granularity.ts` into `ui/context/`. | `src/utils/tokenCalculator.ts`, `src/types/index.ts`, `src/domains/granularity.ts` + callers | Makes `types/index.ts` and `domains/granularity.ts` pure domain contracts with zero UI styling leaks. |
| **1.4** | Replace the fake `window.dispatchEvent(new Event('focus'))` hack in `sendQueue.ts` and untyped `markbrain:sync-now` DOM event strings with a tiny, typed `syncBus.ts` (`requestSyncNow()`). | `src/application/sendQueue.ts`, `src/application/useVpsDeltaSync.ts`, `src/ui/chat/ChatView.tsx`, `src/ui/workspace/ModelSettingsModal.tsx` | Kills the hidden DOM-event coupling between sendQueue, vault unlock, and delta sync. |

---

## Phase 2 — Establish the Neutral Shared Contract (`src/shared/` or `shared/`)

**Goal:** Resolve the 25 `server → src/` imports and the 1 `src → server/` import by giving pure, environment-agnostic code an explicit home with a strict rule: **nothing in `shared/` may import browser globals, React, DOM, IndexedDB, or Node/SQLite.**

| Step | Action | What Moves into `shared/` | Toil / Debt Removed |
|---|---|---|---|
| **2.1** | Create the neutral shared contract layer for data shapes and wire contracts. | `ProjectSnapshot`, `ProjectDeltaResponse`, domain entity types (`Turn`, `ChapterPartition`, `UniversalArtifactDocument`, `ArtifactRevision`, `SemanticEdge`, `ChatThread`, `ChatAttachment`, `ChatCapabilities`, `Granularity`, `ApiCallLog`). | Neither client stores nor `server/db/projectRepo.ts` own the wire contract anymore; both import from `shared/`. |
| **2.2** | Move pure, deterministic protocol & compiler functions into `shared/`. | XML sentinel demuxer (`demuxChunk`, `demuxFullTurn` — separated from network `executeStreamingTurn`), `artifactFileName` / `slugHandle` / `uniqueFileName`, `parseSentinelBlocks`, `resolveCapabilities`, `lanes.ts` & `prompt.ts`, pure search math (`tokenizeForFts`, `cosineSimilarity`, `QueryVectorCache`). | `03-stream-protocol` stops welding the pure XML parser to the network `chatStream` call. Server imports only `shared/`, never `src/`. |

---

## Phase 3 — Kill Split-Brain #1: One Pure Turn-Commit Reducer

**Goal:** Never again fix a commit bug (links, artifacts, revisions, chapters, provenance, receipts) in two places.

Right now, `SendQueue.commitPair` (client) and `projectRepo.commitJobPairTransaction` (server) both implement the rules for turning a demuxed LLM reply into state transitions. And they have already drifted (Local mode drops `<link>`/`<unlink>` and link receipts!).

| Step | Action | Design | Toil / Debt Removed |
|---|---|---|---|
| **3.1** | Write a pure, deterministic **Turn Commit Planner** (`planTurnCommit(state, input) → TurnCommitPlan`) in the shared/domain layer. | Input: `{ currentArtifacts, currentChapters, currentEdges, threadTurnsCount, capabilities, askText, demuxedReply, stagedAttachments, telemetry, now }`. Output: a pure data structure `{ userTurn, assistantTurn, artifactUpserts, revisionsToRecord, chapterUpsert, edgesToUpsert, edgeIdsToDelete, tombstones, committedAttachments }`. | **100% of the business rules** (capability gating, `<link>`/`<unlink>` slug resolution via `artifactFileName`, `last-shift-wins` chapter law, artifact revision snapshotting, pastel color assignment, receipt chip construction, attachment provenance stamping) live in **one pure function** tested without SQLite or React. |
| **3.2** | Wire `server/db/projectRepo.ts` (`commitJobPairTransaction`) to call `planTurnCommit` and simply execute the returned SQL writes in a transaction. | `projectRepo.ts` shrinks by ~450 LOC and becomes what its name says: a SQL repository. | Kills **Finding #4** (business policy hidden in a file named `repo`). |
| **3.3** | Wire `src/application/sendQueue.ts` (`commitPair` & `commitRegenerate`) and `03-stream-protocol` to use `planTurnCommit`. | Local mode automatically gains `<link>`/`<unlink>` application and link receipts, matching VPS mode 1:1. | Kills **Split-Brain #1** permanently. |

---

## Phase 4 — Kill Split-Brain #2 & #3: Heal `ThreadRegistry` and Active/Inactive Threads

**Goal:** Stop duplicating every turn and chapter operation for "active" vs "inactive" threads, and break up the 789-LOC `ThreadRegistry.ts` god class.

| Step | Action | Design | Toil / Debt Removed |
|---|---|---|---|
| **4.1** | Make `DialogueTimelineDomain` and `ChapterSegmentationDomain` **thread-aware** (keyed by `threadId` internally, with default active thread for convenience) OR have `ThreadRegistry` hold a per-thread domain instance (`Map<threadId, { timeline, segmentation }>`). | Instead of `if (isActiveThread) segmentation.upsertChapterAtBoundary(...) else threadRegistry.upsertChapterAtBoundaryInactive(...)`, callers simply call `segmentationFor(threadId).upsertChapterAtBoundary(...)`. | Deletes `appendInactiveTurn`, `updateInactiveTurn`, `declareChapterInactive`, `upsertChapterAtBoundaryInactive`, `mergeInactiveChapters`, and the error-prone memory swap on `selectThread`. Kills **Split-Brain #2**. |
| **4.2** | Split `ThreadRegistry.ts` (789 LOC) into single-phrase vertical modules behind `06-chat-threads/index.ts`. | 1) `ThreadFolderStore.ts` (threads + folders CRUD & ordering), 2) `ThreadAttachmentLedger.ts` (staging, committing, and the single `reconcileProvenance` law — killing **Split-Brain #3**), 3) `ThreadTitleState.ts` (`applyAutoTitle`, `forceAutoTitle`, `titlePipelineStep`). | Turns the #1 churn file in `domains/` into 3 small, single-phrase files whose signatures tell the whole truth. |
| **4.3** | Move cross-domain artifact deletion out of `src/ui/artifacts/purgeArtifact.ts` into a domain/application command (`purgeArtifactEverywhere`). | Each domain exposes a clean `onArtifactDeleted(artifactId)` contract. | Fixes the `purgeArtifact.ts` sufficiency leak in `src/ui/`. |

---

## Phase 5 — Deconstruct the UI Monsters (`ChatView`, `App`, `Sidebar`, `ModelSettingsModal`)

**Goal:** Bring every file over the ~700-LOC cliff down into isolated, single-phrase components so adding a feature never means editing a 2,341-line file.

| Step | Target | Extraction Plan (Each new file = 1 simple phrase) | Result |
|---|---|---|---|
| **5.1** | **`ChatView.tsx` (2,341 LOC → ~450 LOC layout shell)** | Extract by vertical responsibility:<br>1. `ChatHeader.tsx` — thread title inline rename, auto-title button, archive banner, capabilities popover.<br>2. `ChapterSection.tsx` — chapter header bar, granularity chips, ⋯ menu, steering prompt form, collapsible description/summary layers.<br>3. `MessageBubble.tsx` — single turn bubble, markdown/raw toggle, copy, inline "Split Chapter" form.<br>4. `TurnReceiptsRow.tsx` — created artifacts, linked attachments, chapter shifts, graph links/unlinks chips, VPS raw-payload button.<br>5. `useMessageTts.ts` — per-message device cache scan, download-on-click-1, play-on-click-2 orchestration.<br>6. `DraftQueueTray.tsx` — pending/sending/failed/stopped draft cards, elapsed phase chip, per-draft vault unlock row.<br>7. `ChatComposer.tsx` — auto-growing textarea, Enter-key contract, staged attachment tray, send/stop/padlock button, `VaultUnlockModal.tsx`. | `ChatView.tsx` becomes a clean 400-LOC coordinator. Touching TTS, receipts, drafts, chapters, or vault unlock only touches its own 100–250 LOC file. |
| **5.2** | **`App.tsx` (1,315 LOC → ~400 LOC)** | 1. Extract the 200-line **Draft-Proximity Search Testbed** state/timers/caches into a dedicated hook `useDraftProximitySearch.ts` (in `domains/search/` or `application/`).<br>2. Extract token & title projection memos (`tokensByArtifact`, `chapterTokens`, `artifactTitles`, `artifactSubtitles`) into `useContextPayload.ts`. | `App.tsx` stops recalculating search vectors and token maps inline on every `tick`. |
| **5.3** | **`Sidebar.tsx` (1,506 LOC)** & **`ModelSettingsModal.tsx` (1,091 LOC)** | In `Sidebar.tsx`: extract `SidebarPreferencesPanel.tsx` (render mode, font scale, enter-send, voice picker) and `SidebarThreadTree.tsx` (folders & threads drag/drop list).<br>In `ModelSettingsModal.tsx`: split into tab components: `ModelSlotsTab.tsx`, `KeyVaultTab.tsx`, `AccountAdminTab.tsx`. | Each modal tab and sidebar section has one job and one reason to change. |

---

## Phase 6 — Evict Dev/Capture Seams to the Composition Root & Fix Layering

**Goal:** Make every file in `src/data/`, `src/services/`, `src/gateway/`, and `src/application/` pass the **Sufficiency Test** with zero hidden `if (isCaptureMode())` branches or upward imports.

| Step | Action | Files Touched | Toil / Debt Removed |
|---|---|---|---|
| **6.1** | Move capture-mode / fixture-mode behavior to the **composition root** (adapter injection at boot), removing inline `if (isCaptureMode())` checks from `sendReadiness.ts`, `persistWorker.ts`, `serverMutationQueue.ts`, and `gateway/api.ts`. Move `headlessFixture.ts` out of `src/data/`. | `persistenceService.ts`, `gateway/api.ts`, `sendReadiness.ts`, `persistWorker.ts`, `serverMutationQueue.ts` | Production modules no longer contain hidden bypasses; in capture mode, a no-op persistence backend and fixture gateway adapter are injected at startup. |
| **6.2** | Fix the upward dependency inversions in `src/data/`, `src/services/`, and `src/gateway/`, plus `server/lib/accountVault.ts`. | - Inject or invert `callLogStore` recording so `gateway/providers/*` are pure translators.<br>- Invert `vpsSync.ts → serverMutationQueue.ts`.<br>- Split `server/lib/accountVault.ts` (385 LOC) into pure crypto vault (`vaultCrypto.ts`) vs provider client routing (`laneClientFactory.ts`).<br>- Remove the lazy `require('../routes/account')` cycle in `serverArtifactIndexer.ts` by moving `readSettings` into `server/db/` or `server/lib/users.ts`. | Clean, strictly downward dependency graph from top to bottom on both client and server. |

---

## Recommended Starting Order (Highest ROI First)

If you want the maximum reduction in day-to-day toil per hour spent:

1. **Phase 1** (Warmup hygiene — 1 hr): Instant cleanup of duplicate server prompts/parsers, `00-workspace` facade, and the fake `'focus'` event hack.
2. **Phase 2 + Phase 3** (Shared contract + Single Turn-Commit Reducer): Kills the biggest source of real functional bugs (the `sendQueue.ts` vs `projectRepo.ts` split-brain, which currently leaves Local mode without working graph links) and cuts `projectRepo.ts` by a third.
3. **Phase 5.1 + 5.2** (Deconstruct `ChatView.tsx` & `App.tsx`): Stops every UI change from being a 2,341-line surgery.
4. **Phase 4** (Heal `ThreadRegistry` active/inactive split-brain): Makes multi-thread operations trivial.
5. **Phase 6** (Composition-root seams & layer inversions): Final polish for strict sufficiency compliance.
