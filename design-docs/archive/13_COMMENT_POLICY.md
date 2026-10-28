# 13 — Comment Policy & Second-Pass Execution Plan

> **Why this file was rewritten from scratch.**
> My first pass cut 118 lines out of 2,445 (4.8%). That was cowardice disguised as "surgical care." Worse: in half the places I touched, I replaced one AI-flavoured paragraph with another AI-flavoured paragraph that still had em-dashes, bullet lists, and self-important architecture lectures.
>
> This document is two things in one file:
> 1. **Part I — The Hard Comment Policy** (sharper, meaner, and explicit about AI failure modes).
> 2. **Part II — The Complete Execution Spec** for the regular model: file-by-file, line-by-line instructions to delete ~900+ lines of comment sludge across the repo in one mechanical pass, plus 2 dead-code/stale-doc cleanups discovered along the way.

---

# Part I — The Comment Policy

## 0. The core diagnosis: why AI comments are uniquely bad

Human bad comments are usually **lazy** (`// increment i`).
AI bad comments are **pompous, defensive, and insecure**. An LLM has no persistent memory across sessions, so it uses comments as a scratchpad to reassure itself that it understood the prompt, obeyed the constraints, and didn't break anything. That produces seven signature tells that litter this codebase:

1. **The Tombstone ("what used to be here").**
   `/* No floating title pill any more: an 11px chip hovering over the text… */`, `(the optical-mode toggle died with Focus)`, `Previously closed: ImportModal…`, `Moved verbatim from App.tsx`.
   **Rule:** Code is not a graveyard. Never write a comment about code that does not exist in the file. If a trap remains ("do not add a fixed top bar; it breaks the 350px viewport"), state the forward constraint. Never narrate the funeral.

2. **The Architecture Lecture on a 30-line file.**
   `granularity.ts` has 253 lines, 88 of which are comments (35%) — three separate essays lecturing the reader about colour theory, OKLCH hue steps, and alpha instruments, while `src/tests/attachment-palette.test.ts` already asserts every single one of those numbers in executable code.
   **Rule:** If a test asserts an invariant, the source file gets **one line** pointing to the test (`// Invariants locked in src/tests/attachment-palette.test.ts`). Prose explanations of tested math are banned: the test cannot lie, the prose will.

3. **The Defensive Split Justification.**
   When an AI extracts a helper file (`sendQueue.ts`, `persistWorker.ts`, `sessionMachine.ts`, `snapshotLoader.ts`, `createArtifactHandlers.ts`), it leaves nervous apologies in both files: *"Moved verbatim from App.tsx — same handler names/signatures"*, *"All dependencies arrive via parameters so this is unit-testable; DomainRegistry is the composition root"*.
   **Rule:** Dependency injection is normal TypeScript. Extracting a module is normal programming. Never apologize for or explain module structure in comments.

4. **JSX Landmark Signposts (`{/* Header */}`, `{/* Body */}`, `{/* Footer */}`).**
   There are **95+** of these across `src/ui/`. `{/* Search input */}` directly above `<input placeholder="Search..." />`. `{/* Close Button */}` directly above `<button aria-label="Close">`. `{/* Block 1 */}`, `{/* Block 2 */}`, `{/* Block 2.5 */}`, `{/* Block 3 */}`, `{/* Block 3.5 */}`, `{/* Block 7 */}`, `{/* Block 8 */}` in `Sidebar.tsx` (Blocks 4, 5, and 6 don't even exist anymore!).
   **Rule:** JSX tags and `aria-label`s already name the landmarks. Delete every `{/* Section Name */}` comment in JSX unless it states a non-obvious layout or event-bubbling trap. If a 1,200-line component needs `{/* Block 2.5 */}` to be navigable, extract a subcomponent; don't hang cardboard signs on `<div>`s.

5. **Interface Prop Echoes.**
   ```ts
   /** Folder rows show a description snippet. */
   description?: string;
   /** Folder rows show tags. */
   tags?: string[];
   ```
   and `// Queries`, `// Commands`, `// Subscriptions` inside a 17-line interface (`00-workspace/interface.ts`, `01-artifact-document/interface.ts`, `01-artifact-versioning/interface.ts`, `01-dialogue-timeline/interface.ts`, `02-chapter-segmentation/interface.ts`, `02-topological-graph/interface.ts`).
   **Rule:** A type signature is already documentation. Document a property or method **only** when its runtime contract is narrower or weirder than its TypeScript type (e.g., "`null` = confirmed absent; errors throw", or "`-1` = committed, unknown turn; `null` = staged").

6. **Review-Scar / Phase-Number Graffiti.**
   `(review P1 #7)`, `(review P1 #8)`, `(review P0#3)`, `Phase 1:`, `Phase 2:`, `Phase 3:`, `Phase 4:`, `(08_UNIFIED_DATA_MODEL.md D3 / D5 / D6)`.
   **Rule:** Phase numbers and review ticket IDs belong to the week the feature was built. Six weeks later, "Phase 3" means nothing. Delete every phase label and review-ticket reference from source files.

7. **Typography as Fake Authority.**
   Em-dashes (`—` appears 300+ times in comments), `── ASCII banners ──` (68 times), ALL-CAPS words (`THE`, `ONLY`, `NEVER`, `ALWAYS`, `EXACTLY`, `SOLE`), and middle-dot lists (`·`). They make a trivial statement sound like Moses coming down the mountain (`/** THE cut rule */`, `/** THE window rule */`).
   **Rule:** Write plain, dry sentences. If every comment shouts, the reader goes deaf. Reserve `NEVER` / `MUST NOT` for the ~15 places in the entire repo where a wrong edit causes silent data loss or an infinite loop.

---

## 1. The Four Things That Earn a Comment

A comment may exist in this repository **only** if it falls into one of these four buckets:

1. **Blood-Bought Traps (why the obvious code is wrong).**
   The naive edit compiles, passes typecheck, looks cleaner, and breaks production.
   *Good:* `// Strip undefined before setDoc: Firestore rejects undefined field values and silently drops the save.`
   *Good:* `// IndexedDB put() replaces the whole record; omitting name/color here wipes project metadata on first auto-save.`
   *Good:* `// ''.split('\n') is [''], which fakes a deleted empty line against real content.`

2. **Invisible External Constraints (protocol, vendor, browser, DOM geometry).**
   *Good:* `// Always prompt: 'select_account' — otherwise Google silently re-grants the cached session after sign-out.`
   *Good:* `// Absolute and out of flex flow: an in-flow h-full sibling here collapses the chat viewport to 0px.`
   *Good:* `// google.picker registers on window.google, not window.gapi.`

3. **Un-typeable Contracts (meaning of sentinel values, ordering, idempotency, error vs. absence).**
   *Good:* `// Returns null ONLY for confirmed absence. Network/auth errors MUST throw so the loader never hydrates an empty project over a real one.`
   *Good:* `// turnIndex: null = staged (removable); >= 0 = committed to that turn; -1 = committed (legacy, turn unknown).`

4. **Deliberate Absence (why code is NOT here).**
   Absence has no AST node to read. Without a comment, the next engineer adds the "missing" cache, retry, or fallback and reintroduces the bug.
   *Good:* `// Never memoize getStore(): setBackend() flips the backend at runtime.`
   *Good:* `// No fallback to 'relates_to': unknown edge kinds must survive round-trip untouched.`

**Everything else gets deleted.**

---

## 2. Hard Quantitative Rules

1. **File headers:** Optional. Maximum **5 lines** unless the file owns a concurrency/split-brain state machine (`ThreadRegistry`, `sendQueue`). Most files need **0 header lines** because the filename + exports say what the file is.
2. **Comment-to-code ratio:** No file over 50 lines may exceed **15% comment lines**. (Currently `projectStore.ts` is 53%, `ambientTelemetry.ts` is 35%, `granularity.ts` is 34%, `snapshotLoader.ts` is 30%.)
3. **Zero JSX landmark comments:** `{/* Header */}`, `{/* Footer */}`, `{/* Body */}`, `{/* Actions */}` are banned.
4. **Zero `// Queries` / `// Commands` / `// Subscriptions` dividers** in small domain interfaces.
5. **Zero section-number (`§`), phase-number (`Phase N`), or review-ticket (`review P1 #7`, `D3`, `D5`, `D6`) citations** in `src/` or `server/`. Cite a filename only if the doc is genuinely required reading, and at most once per file.

---

# Part II — Complete Execution Specification (for the regular model)

> **Instructions to the executing agent:**
> Apply every edit below across the repository. None of these change runtime behavior (except the explicit dead-export removal in §2.1, which has zero importers). After applying all batches, run:
> 1. `bunx tsc --noEmit`
> 2. `bunx vitest run`
> Do **not** commit unless David asks you to.

---

## Batch 1 — `src/domains/` (The Domain Layer)

### 1.1 `src/domains/granularity.ts` (Currently 88 comment lines / 253 total → cut to ~18 comment lines)
 Also **delete `GRANULARITY_WEIGHT`** — it has zero importers anywhere in the repo, and keeping a dead export with a comment saying "nothing reads these today; if that stays true, delete them" is peak AI timidity. Delete it now.

- **Lines 1–18 (file header):** Replace the 18-line block with:
  ```ts
  /**
   * Granularity: the four-level cumulative cut (`title ⊂ description ⊂ summary ⊂ full`).
   * Dependency-free so every domain and UI surface shares one ordering and one palette.
   * Palette math and contrast invariants are locked in `src/tests/attachment-palette.test.ts`.
   */
  ```
- **Line 21 (`/** Ascending cut order... */`):** Delete comment.
- **Line 29 (`/** UI copy for the four words... */`):** Delete comment.
- **Lines 37–48 (`GRANULARITY_WEIGHT` + its comment):** Delete both the comment and `export const GRANULARITY_WEIGHT ...` completely.
- **Lines 52–55 (`/** THE cut rule... */`):** Replace with:
  ```ts
  /** Cumulative cut: each level includes the shorter levels plus its own layer. */
  ```
- **Lines 79 (`/** Strict-ish coercion... */`):** Delete comment (signature `normalizeGranularity(value: unknown, fallback: Granularity = 'full'): Granularity` says it all).
- **Lines 86–89 (`/** Cycle through the 4 granularities... */`):** Delete comment.
- **Lines 96–110 (`/** The colour law... */`):** Delete entire block (already covered by the 4-line file header + test).
- **Lines 115–129 (field comments inside `AttachmentStatePalette`):** Keep only:
  ```ts
  export interface AttachmentStatePalette {
    state: AttachmentVisualState;
    /** Canonical hex used for the dot, rail segment, and mirror legend. */
    hex: string;
    glow: string;
    dotClass: string;
    /** Alpha tint of `hex` over the host plane — never an opaque fill. */
    rowClass: string;
    titleTextClass: string;
    subTextClass: string;
    tagClass: string;
    activeChipClass: string;
    inactiveChipClass: string;
  }
  ```
- **Lines 132–148 (`/** The two alpha instruments... */`) & Lines 152–155 (`/** Six plates... */`):** Replace both blocks with a single 4-line comment above `INACTIVE_CHIP_CLASS`:
  ```ts
  // Rows and chips composite over variable host planes (chapter cards, staged tray),
  // so plates use alpha tints of their state hue (11% row, 22% active chip) and idle
  // chips use neutral recess-1. Opaque hex plates clash with host cards.
  ```
- **Lines 161–165 (inline comments inside `unstaged`):** Delete both comments.
- **Lines 244–248 (`/** Chip class for any granularity button... */`):** Delete comment.

### 1.2 Small Domain Interfaces — Delete all `// Queries`, `// Commands`, `// Subscriptions` and restatements
In all six files below, remove every `// Queries`, `// Commands`, `// Subscriptions` comment:
- `src/domains/00-workspace/interface.ts` (lines 4, 10, 19)
- `src/domains/01-artifact-document/interface.ts` (lines 5, 8, 11, 17 — also delete line 8 JSDoc, it duplicates the implementation)
- `src/domains/01-artifact-versioning/interface.ts` (lines 4, 9, 13)
- `src/domains/01-dialogue-timeline/interface.ts` (lines 4, 10, 16)
- `src/domains/02-chapter-segmentation/interface.ts` (lines 5, 10, 25, 31 — keep only line 11 `/** Opens a chapter; seals the previous one (full → summary, manual choice kept). */`)
- `src/domains/02-topological-graph/interface.ts` (lines 4, 10, 15)

### 1.3 `src/domains/00-workspace/WorkspaceDomain.ts` & `types.ts`
- `WorkspaceDomain.ts` lines 4–11: Replace tombstones with:
  ```ts
  /** In-memory workspace registry. Populated exclusively from `loadUserProjects()`; empty is valid (triggers Project Genesis). */
  ```
- `WorkspaceDomain.ts` line 18 (`// intentionally empty — no local persistence, no default project`): Delete (already said 5 lines above).
- `00-workspace/types.ts` lines 11–16: Replace tombstone about `focalArtifactIds`/`tierOverrides`/`opticalMode` with:
  ```ts
  /** Project metadata and token ceiling. Context membership lives per-chat in `06-chat-threads`, never on the project. */
  ```

### 1.4 `src/domains/01-artifact-document/ArtifactDocumentDomain.ts` & `types.ts`
- `ArtifactDocumentDomain.ts` lines 5–9: Replace `THE artifact cut` with:
  ```ts
  /** Cumulative plain-text cut (`title ⊂ description ⊂ summary ⊂ body`). Missing layers are omitted, never synthesized. */
  ```
- `ArtifactDocumentDomain.ts` line 32 (`/** The cut as one plain-text block... */`): Delete.
- `01-artifact-document/types.ts` lines 1–17: Delete the 9-line header and the 4 JSDoc lines on `ArtifactContentLayers` (`~200 words...`, `~2000 words...`, `The source text...`). Replace with a single 2-line comment above `ArtifactContentLayers`:
  ```ts
  /** Cumulative document layers (`title` is on the parent document; `description → summary → body` are read together). */
  ```

### 1.5 `src/domains/01-dialogue-timeline/types.ts`
- Lines 1–5: Replace `(see design-docs/08_UNIFIED_DATA_MODEL.md D3)...` with:
  ```ts
  /** Provider-neutral turn telemetry. Every field here must have both a writer and a reader. */
  ```
- Line 41 (`/** Epoch ms — formatting happens at the one display site. */`): Delete.
- Line 43 (`/** Chat-thread ownership — tagged at snapshot boundaries (see 06-chat-threads). */`): Delete.

### 1.6 `src/domains/02-chapter-segmentation/selectors.ts` & `types.ts`
- `selectors.ts` lines 1–9: Replace with:
  ```ts
  /** Shared chapter-window selectors. Chapters are `[startIndex, endIndex)` windows over the turn list, never owners of embedded turns. */
  ```
- `selectors.ts` lines 14, 23, 28, 33, 38–41, 48–51, 60–63, 72–75, 89, 92–95: Delete all of these restating JSDoc blocks (`THE window rule`, `THE chapter granularity rule`, `Minimal timeline surface...`, etc.). The function names (`isChapterOngoing`, `resolveChapterGranularity`, `sliceChapterTurns`, `presentChapterCut`, `groupTurnsByChapter`) and their 3-line bodies are crystal clear. Keep only:
  - Line 18–21 on `ongoing: boolean`: `/** True when status === 'active' or this is the trailing chapter. */`
  - Line 114–115 inside `groupTurnsByChapter`: `// Synthesize a genesis window when no chapters exist so the chat surface stays usable.`
- `02-chapter-segmentation/types.ts` lines 3–25: Delete the duplicate ASCII table of the 4 granularities (already in `granularity.ts`) and the restating field comments. Keep only:
  ```ts
  /** A `[startIndex, endIndex)` window of turns in a thread. `endIndex === undefined` means ongoing through the latest turn. */
  ```

### 1.7 `src/domains/02-topological-graph/TopologicalGraphDomain.ts` & `types.ts`
- `TopologicalGraphDomain.ts` line 18 (`// Avoid duplicates`): Delete.
- `02-topological-graph/types.ts` line 16 (`/** Open vocabulary — arbitrary kinds are legal and survive storage. */`): Delete (already stated in the 4-line header right above it).

### 1.8 `src/domains/03-optical-compiler/index.ts`
- Lines 16–27 (file header): Replace 12 lines with:
  ```ts
  /**
   * Context compiler: assembles `<knowledge_substrate>` (attached artifacts at their cut)
   * and `<conversation_chapters>` (chapters at their cut, in chronological order).
   * Only explicitly attached artifacts enter the payload — no proximity or graph heuristics.
   */
  ```
- Lines 50, 56, 58, 60, 64, 79: Delete these 6 single-line restating JSDocs (`One attachment as compiled...`, `True when the attachment is staged...`, `Turn index where...`, `Turn id where...`, `One chapter as compiled...`, `How many rows...`).
- Lines 81–96 (16 lines on `attachmentBreakdown` and `chapterBreakdown`): Replace both blocks with a single 2-line comment on `attachmentBreakdown`:
  ```ts
  /** Per-artifact token estimates measured on the exact assembled XML (`Σentries === substrateTokens`). */
  ```
  and on `chapterBreakdown`:
  ```ts
  /** Per-chapter token estimates measured on the exact assembled XML (`Σentries === historyTokens`). */
  ```
- Lines 110, 134, 142, 173, 194, 226, 234: Delete all 7 restating comments (`One line of the cut...`, `Exact token estimate...`, `// 1. Attachments...`, `// 2. Chapters...`, `// Only read turns...`). Keep line 207 (`// dangling attachment (artifact deleted) — silently skipped`).

### 1.9 `src/domains/03-stream-protocol/index.ts` & `types.ts`
- `index.ts` lines 55, 72, 94, 126, 164, 199: Delete these 6 narration comments (`// 1. Parse <topic_shift...`, `// 3. Parse <artifact_upsert>...`, `// Strip tags cleanly`, etc.). Keep lines 78–79 (`abstract` legacy attribute), 112–113 (open edge vocabulary), 284 (client demux is sole parser), 338 (abort estimates).
- `types.ts` line 5 (`/** 1–2 sentences... */`): Delete.
- `types.ts` lines 38–43: Remove `(see 08_UNIFIED_DATA_MODEL.md D3)` and condense to:
  ```ts
  /** Provider-neutral wire telemetry sent on SSE `complete` (and synthesized on abort). */
  ```

### 1.10 `src/domains/06-chat-threads/ThreadRegistry.ts` & `types.ts`
- `ThreadRegistry.ts` lines 98 (`// ── Queries ──`), 122–128, 170, 278, 289, 379, 471, 478, 521, 561–562, 598: Delete section banners and 1-line restatements (`getStagedAttachments`, `stageArtifact`, `rename`, `reorderFolders`, `declareChapterInactive`).
- `ThreadRegistry.ts` lines 133–141 (`attachArtifact`): Condense to:
  ```ts
  /** Idempotent: if the artifact is already attached (staged or committed), leaves its granularity and turn anchor untouched. */
  ```
- `ThreadRegistry.ts` lines 199–202 (`toggleArtifactInChat`), 219–223 (`commitStagedAttachments`), 291–296 (`hydrate`), 346–349 (`compose`), 381–385 (`select`), 400–403 (`createThread`), 429–433 (`deleteThread`), 500–503 (`deleteFolder`), 536–539 (`applyAutoTitle`), 550–553 (`applySuggestedTitle`): Trim each of these 4–5 line blocks to a single crisp sentence stating only the non-obvious contract:
  - `toggleArtifactInChat`: `/** Not in chat → stage at Full; staged → unstage; committed → cycle granularity. */`
  - `commitStagedAttachments`: `/** Welds all staged attachments (`turnIndex === null`) to `turnIndex`/`turnId`. */`
  - `hydrate`: `/** Replaces registry state from a snapshot and returns the active thread's content for live domains. Backfills missing threads with "Main". */`
  - `compose`: `/** Flattens live (active) + cached (inactive) turns/chapters into snapshot arrays tagged with `threadId`. */`
  - `select`: `/** Flushes `live` into the outgoing thread's cache and returns the incoming thread's content (or null if unchanged). */`
  - `createThread`: `/** Creates a thread without selecting it; seeds its cache with a genesis chapter. */`
  - `deleteThread`: `/** Discards active live content if the active thread is deleted and returns the fallback thread's content (or null if no switch needed). */`
  - `deleteFolder`: `/** Deletes the folder and returns its threads to Inbox (`folderId = null`). */`
  - `applyAutoTitle`: `/** Applies an auto-generated title unless the thread is manually locked or already at a newer `titleVersion`. */`
  - `applySuggestedTitle`: `/** Explicit user sparkle action: overrides manual lock and sets `titleVersion = 2`. */`
- `06-chat-threads/types.ts`: Delete lines 22–30 (duplicates lines 35–40 right below it!), 42, 61, 63, 78, 87–89, 121, 137, 163, 194. Condense lines 35–40 to:
  ```ts
  /** `null` = staged (removable); `>= 0` = committed to that 0-based turn index; `-1` = committed (legacy, turn unknown). */
  ```

### 1.11 `src/domains/DomainRegistry.tsx`
- Delete section banners and delegation restatements at lines 59, 61, 63, 65, 67, 74, 92–93, 102–104, 121–124, 144–145, 210. (Keep lines 78–80 on empty start, 95–96 on graph not in compiler, 108 on `hydratedRef.current = false`, 198–200 on storage-first delete, 244 on fallback thread.)

---

## Batch 2 — `src/application/`, `src/services/`, `src/gateway/`, `src/utils/`, `src/data/`, `src/types/`

### 2.1 `src/application/persistWorker.ts`, `sessionMachine.ts`, `snapshotLoader.ts`, `sendQueue.ts`
- `persistWorker.ts`:
  - Delete lines 36–41 (`/** One debounced-save tick... */` — repeats the file header and the inline guards at lines 56–57), line 60's `(review P0#3 — caller-side, not snapshot-side)`, line 90 (`/** Typically the wrapped... */`), lines 94–98, line 103, lines 117–118.
- `sessionMachine.ts`:
  - Delete lines 27, 29, 38, 73–76 (duplicates line 36 + line 81), 115, 123. Keep the file header, line 36 (`null = cloud project list not resolved yet`), and lines 88–90 (Firebase auth observer firing `null` in Local mode).
- `snapshotLoader.ts`:
  - Delete lines 1–14 (file header — the file is 137 lines with 3 functions whose names and JSDoc already explain everything), line 25, lines 35–38, line 108, lines 113–118, lines 124–126. Keep lines 65–76 and 86 (the critical `load failure ≠ project absence` contract).
- `sendQueue.ts`:
  - Delete lines 28, 45, 55, 60, 62, 64, 107, 118, 123, 144, 167, 194, 292–293, 495, 595.
  - Note lines 75–82 and lines 306–309 both explain the retry-weld rule in full. Keep the JSDoc on `resolveRetryAnchorIndex` (lines 74–83) and shorten line 306–309 to:
    ```ts
    // Weld any staged attachments to the user turn this retry answers (see resolveRetryAnchorIndex).
    ```
  - Similarly, shorten lines 332–335 to:
    ```ts
    // Weld staged attachments before compile() so history and payload agree.
    ```

### 2.2 `src/services/` (`firebase.ts`, `googleDriveService.ts`, `localBackend.ts`, `persistenceService.ts`, `stores/*`)
- `firebase.ts`: Delete lines 22, 32 (`// Initialize Firebase App`), 35 (`// Initialize Auth`), 42 (`// Initialize Firestore...`), 99 (`// Test connection on boot per Firebase skill guidelines`), 112 (`// Authentication helper methods`). Keep lines 16–18 (web API key model), 38–39 (`select_account`), 121–123 (`withCode` error code preservation).
- `googleDriveService.ts`: Delete restating comments at lines 42, 48, 159–160 (duplicated at 188–189!), 205–207, 211, 216, 221, 228–232, 393–395, 438, 445, 505–507, 513, 528, 538, 555–557, 563, 565, 582, 600, 613. Keep the scope-trap comments (149–153, 164–168, 172–176, 183, 188–189), feature-flag note (247–251), `google.picker` global quirk (329–332), and 376.
- `localBackend.ts`: Delete lines 52, 67, 83–85, 101–104 (`/** Read one record... */`, `/** Upsert one record... */`, `/** Delete one record... */`, `/** Replace the entire local store... */`). Keep the file header (lines 1–16).
- `persistenceService.ts`: Delete lines 74 (`/** Save a project snapshot... */`), 141–145 (`/** List all projects... */`), 152–156 (`/** Create a new project... */`), 197–201 (`/** Delete a project... */`), 240 (`/** Parse + validate... */`), 262–269 (`/** Import a database export... */` — already documented on `ProjectStore.replaceAll`). Keep header, `getStore()` never-memoize warning, capture-mode guard explanation, undefined-strip trap, meta-replacement trap, `loadProjectSnapshot` null-vs-throw contract, and `DatabaseExport` doc.
- `stores/projectStore.ts`: Currently 53% comments (34/64 lines) and duplicates `persistenceService.ts`. Replace lines 1–12 with:
  ```ts
  /** Anticorruption port between `persistenceService` and the two storage backends (`firestoreStore`, `localStore`). */
  ```
  And condense lines 38–56 to:
  ```ts
  /**
   * Backend contract:
   * - `load`: returns `null` ONLY when confirmed absent; throws on network/auth/IDB errors so callers never hydrate empty over real data.
   * - `list`: returns `[]` when unauthenticated or unreadable (never throws).
   * - `save`: full snapshot upsert (Firestore merges; IndexedDB replaces the record).
   * - `replaceAll`: local clears + writes atomically; Firestore merges upserts without deleting remote docs absent from the export.
   */
  ```
- `stores/localStore.ts`: Replace lines 1–7 with `/** IndexedDB implementation of ProjectStore (delegates to localBackend.ts). */` and delete line 20–21 and line 41.
- `stores/firestoreStore.ts`: Trim any restating method comments; keep only the `No session ≠ project absent` and `confirmed absence` inline guards (lines 25–26, 38, 44), delete line 108.
- `stores/hydrate.ts`: Delete lines 12–18 (repeats header + code), line 52 (`/** True when the record is already canonical... */`), line 76 (`/** Backfill one turn's meta... */`), line 91 (`/** Map a turn array... */`). Condense lines 106–112 to `/** Normalizes artifacts, chapters, and turn telemetry on snapshot load. */`.

### 2.3 `src/gateway/api.ts`
- Delete all 8 ASCII section banners (`// ── /api/tts ──`, `// ── /api/extract... ──`, etc. at lines 10, 25, 61, 71, 77, 110, 125, 135, 176) — the URL string is literally on the next line in `fetch('/api/...')`!
- Delete lines 178, 192, 198–202. Keep the file header (lines 1–8), `extract` retry fields (32, 34), `chat/stream` raw response note (94–97), and `summarizeChapter` deadline warning (143–150).

### 2.4 `src/utils/`, `src/data/`, `src/types/`
- `src/utils/markdown.ts`: Delete inline step restatements at lines 29, 48, 56, 59, 65, 75, 78, 81, 114, 189, 205, 215, 221, 230, 237, 248, 284, 292. Keep the file header (lines 1–17) and `renderMarkdown` security-boundary note (311–314).
- `src/utils/tokenCalculator.ts`: Delete lines 115, 117, 125–127 (`Export to JSON`), 135, 146–148 (`Export to Markdown`), 179–181 (`Export to YAML`), 209, 217 (`// Aliases for any existing callers`).
- `src/utils/yamlArtifactParser.ts`: Delete lines 12–22 and 53–55.
- `src/utils/importDetect.ts`: Remove `Multi-import plan — Phase 2:` prefix at line 4, and delete lines 17, 50–55, 63, 71, 82 (the header at lines 4–9 already lists the 3 tiers).
- `src/utils/importRules.ts`: Remove `Multi-import plan — Phase 4:` prefix at line 3, and delete lines 46–47, 54, 60 (repeats lines 4–6).
- `src/utils/lineDiff.ts`: Remove `Phase 3:` prefix at line 1, and delete lines 21 (`// Trim identical prefix`) and 24 (`// Trim identical suffix`). Keep lines 12–13 (`''.split('\n')` trap), 39, 47.
- `src/utils/logger.ts`: At lines 30–32, delete the tombstone `(Previously closed: ImportModal, Compiler, Drive, TTS, etc. were forced into raw console.*.)` — keep `// Open tail so any module can log without widening this union first.`
- `src/data/models.ts`: Condense lines 3–13 to:
  ```ts
  /** Boot/offline fallback while `GET /api/models` is in flight. The live catalog is server-owned (`server/lib/models.ts`); do not add a second model list here. */
  ```
- `src/types/index.ts`: Delete lines 1–7, 10, 19, 22, 37, and the 12 colour-name comments on lines 41–52 (`// Mellow dark lavender/purple`, etc.). Replace with a 2-line header:
  ```ts
  /** Domain type re-exports and UI-only shapes (model picker, export tiers, chapter pastels). */
  ```

---

## Batch 3 — `src/App.tsx` & `src/ui/` (The UI Layer)

### 3.1 `src/App.tsx` (Currently 60 comment lines → cut to ~18)
- Delete all slice-pointer and landmark comments: lines 31, 68, 72, 102, 131, 134, 137, 147, 150, 153, 181, 185, 250–252 (and `08_UNIFIED_DATA_MODEL.md D6`), 266, 274–275, 304, 308, 351, 358, 361, 366, 389, 410, 462, 464, 549, 566, 601, 605, 611, 630, 643, 659, 674, 683, 710.
- At line 139, remove `(review P1 #8)`.
- Condense lines 162–175 (14-line serial queue lecture duplicating `sendQueue.ts`) to 2 lines:
  ```ts
  // Queue orchestration lives in application/sendQueue.ts; App holds only the presentation state it drives.
  ```
- Condense lines 312–315 to:
  ```ts
  // Re-published each render; sendQueue snapshots deps + getContext() when a chain starts.
  ```
- Keep lines 106–108 (model catalog fallback), 138–139 (sidebar closed on phones), 197–199, 208–212 (compiler token measurer), 301 (import session lives at App level), 383–384 (hold boot loader until cloud list resolves), 652 (single-modal rule).

### 3.2 `src/ui/chat/ChatView.tsx`, `ThreadSwitcher.tsx`, `createChapterHandlers.ts`, `useThreadSwitcher.ts`, `useThreadUi.ts`
- `ChatView.tsx`:
  - Delete prop restatements and section banners at lines 47, 52, 59, 62, 63, 65, 67, 69, 71, 73, 76, 78, 80, 82, 88, 90.
  - Delete colour-name comments at lines 97, 99–103, 670.
  - Delete state/handler labels at lines 148, 186, 192, 199, 215–216, 221, 223, 228, 236, 240, 330.
  - Delete tombstone at lines 447 (`{/* No floating title pill any more... */}`).
  - Delete JSX landmark comments at lines 451, 455, 484, 498, 570, 578 (`{/* THE TITLE... */}`), 682, 691, 743, 883, 891, 909, 924, 955, 974, 1053, 1080, 1088, 1180, 1199, 1216.
  - Keep: lines 225 (`summarizeErrorIds`), 246–250 (`turnIndex === -1` in first chapter), 263–266 (`triggerChapterSummarize` never changes cut), 283–287 (`handleSetChapterCut`), 298 (auto-scroll only on new message), 411–412 (retry affordance condition), 659 (orb clearance), 687 (two rows on 350px), 761 (compacted attachment strip), 798 & 807 (`cutIncludes` gate), 833 (missing layer = chrome), 866 (turns only at Full), 1097 (committed attachments have no delete key), 1254 (cancel pending only).
- `ThreadSwitcher.tsx`: Delete lines 59, 98, 113, 125, 167. Keep header (23–26) and lines 55–56.
- `createChapterHandlers.ts`: Delete lines 12, 68–69, 114–117. Keep the split-at-clicked-message explanation (16–19, 27–29, 35–37), background summarize on seal (56–63), empty-string erase guard (88–91), and `logger.warn` vs `logger.error` explanation (104–107).
- `useThreadSwitcher.ts`: Delete line 12 (duplicates line 16).
- `useThreadUi.ts`: Delete lines 25–28 (tombstone about `sendQueue.ts` extraction), 33, 38.

### 3.3 `src/ui/context/AttachmentControls.tsx`, `MirrorPanel.tsx`, `useContextPayload.ts`
- `AttachmentControls.tsx`:
  - Delete lines 73 (`/** The four words. Active = pressed dark well + lit indicator; inactive = brighter key. */` — **this is actually stale from pre-Vega!** Active is now an alpha tint step-up, inactive is `bg-recess-1` step-down!), line 103 (`{/* The rainbow, right on the key... */}`), lines 119–122 (`dotVerbLabel` is self-explanatory), lines 172–176 (repeats the file header), lines 201–202 (repeats line 158), line 309, lines 313–317.
- `MirrorPanel.tsx`:
  - Delete prop restatements at lines 60, 63, 67, 69, 71 and JSX landmarks at lines 165, 177, 211, 278, 300. Keep header (17–25), Escape-while-mounted guard (91–92), and lines 111–133.
- `useContextPayload.ts`:
  - Delete lines 24–30 (repeats `OpticalCompiler` header and cites `09_CHAT_ARTIFACTS_PAYLOAD.md §1c`) and lines 50–53 (repeats `ambientTelemetry.ts` header). Keep lines 18, 20, and 34–35 (`attachmentKey` memo explanation).

### 3.4 `src/ui/artifacts/` (`ArtifactDetailModal.tsx`, `ArtifactsLibraryView.tsx`, `ExportModal.tsx`, `ImportModal.tsx`, `RevisionTriageModal.tsx`, `createArtifactHandlers.ts`, `import/*`)
- `ArtifactDetailModal.tsx`: Delete JSX landmarks at lines 61, 88, 112, 121, 132, 199, 235, 239, 249, 261, 382. Keep prop docs at lines 29–42.
- `ArtifactsLibraryView.tsx`: Delete prop docs at lines 26, 28, 30, 32, 35 (all repeat `AttachmentControls.tsx` and the header right below) and JSX comments at lines 126, 165–166, 209, 245. Keep the header (lines 39–51) and line 118 (in-flow clearance).
- `ExportModal.tsx`: Delete lines 26, 71, 92, 148.
- `ImportModal.tsx`:
  - Delete state/section labels and JSX landmarks at lines 63, 78, 92, 107, 179, 202, 265, 271, 293, 305, 320, 343, 363, 373, 386, 434, 486, 513, 540, 569, 585, 648, 670, 696, 832, 842, 845, 908, 935, 990, 1003, 1016, 1050.
  - Remove `Review:` prefix at line 211 and `Phase-4` prefix at line 722.
  - Keep the Drive scope-trap comments (82–83, 116–117, 160–161), race locks (180–181, 476–478), 120s timeout reason (211–212), and input reset (261).
- `RevisionTriageModal.tsx`: Remove `Multi-import plan — Phase 3:` at line 6; delete lines 38, 66, 76, 98, 130, 150, 164, 183, 236. Keep header (lines 6–9) and line 53 (`stale edge to a deleted artifact`).
- `createArtifactHandlers.ts`:
  - Line 25–26: Delete `Moved verbatim from App.tsx...` and stale `pin/tier overrides` mention! Replace with `// Artifact CRUD, chat attachment handlers, import landing, and post-import triage.`
  - Line 110: Remove `(review P1 #7)`.
  - Lines 149–155 & 193 & 215: Remove `Phase 2` / `Phase 3` / `multi-import plan` labels while keeping the idempotency and flag-edge rules.
  - Delete lines 48, 64, 75, 99, 108. Keep lines 88–93 (attach-on-save), 110–112 (title-idempotent chat save), 134–136 & 191–192 (`{x: undefined}` Firestore trap), and 260–303 (4-step overwrite/rollback invariant).
- `import/ImportSessionList.tsx`: Delete lines 75, 94, 105, 122, 143, 203, and remove `Phase-4` prefix on line 206. Keep lines 45–46 (two-step remove auto-disarm).
- `import/useImportSession.ts`: Remove `Multi-import plan — Phase 1:` / `Phase-2` / `Phase-4` labels at lines 10, 31, 33, 44, 219; keep all the concurrency/ref/retry/Firestore comments (they are genuinely load-bearing).

### 3.5 `src/ui/graph/` & `src/ui/workspace/`
- `SpatialGraph.tsx`: Delete all 28 section/landmark comments at lines 69, 73, 77, 86, 90, 94, 97, 165, 174, 183, 187, 198, 208, 219, 240, 261, 278, 308, 331, 351, 360, 402, 412, 447, 461, 513, 571, 600, 614, 619, 633, 667, 683, 701. Keep header (15–21), `tentativeLinks` removal reason (123–125), `fitViewToNodes` trigger rule (128), open edge vocabulary notes (52, 378–379, 727), and node halo design note (591–592).
- `createGraphHandlers.ts`: Remove `(D5)` at line 11; delete line 15 (`// Node position handlers`) and lines 40–41 (repeats line 11).
- `AuthGate.tsx`: Delete lines 45, 52, 65, 183; keep line 106 (`actions chosen by error CLASS`).
- `ProjectGenesis.tsx`: Delete colour names (lines 25–30) and JSX landmarks (lines 77, 80, 82, 115, 134). Keep lines 19–20 (restore trigger must exist before Sidebar).
- `ProjectLauncher.tsx`: Delete lines 44 (`// default Unhaunter ruby`), 96, 124, 126, 145, 238, 301. Keep lines 25, 45, 290, 335.
- `ServerLogsModal.tsx`: Delete all 8 comments (lines 28, 32, 42, 70, 126, 173, 216, 255) — every single one is `// Auto-scroll` or `{/* Header Bar */}`.
- `Sidebar.tsx`:
  - Delete lines 58, 63, 66, 134, 140, 146, 151, 155, 203, 229, 340, 355, 366, 374, 448 (`Block 1`), 482 (`Block 2`), 512, 559 (`Block 2.5`), 637, 656, 672, 758, 815, 925, 975 (`Block 3`), 1004, 1061 (`Block 3.5` + tombstone about moving out of composer), 1103 (`Block 7`), 1175 (`Block 8`).
  - Keep lines 36, 51, 83, 127 (inline accordions prevent container clipping), 143, 246 (drop thread on thread → move into target's folder), 307 (touch-screen row actions), 376, 561, 1009–1011 (`available === false` meaning).
- `createWorkspaceHandlers.ts`: Delete all 3 comments (lines 14, 24, 31 — line 14 is a tombstone about `Focus`, 24 and 31 restate function names).
- `useDatabaseTransfer.tsx`: Delete lines 10–12 and 15 (lines 52–54 right below already state the exact reason the input is mounted in both places).

---

## Batch 4 — `server/`

- `server/app.ts`: Delete lines 28 (`// Global request counter...`), 46 (`// Route modules...`), 49, 57 (`// Dev vs Prod Vite Mounting`). Keep lines 1, 7, 18–19 (`__dirname` project-root trap).
- `server/lib/env.ts`: At lines 6–8, delete the parenthetical history `(this file now lives at server/lib/env.ts; before the routes/providers split...)` and write: `// Project root is two levels up from server/lib/env.ts.` Keep lines 11–17 (env precedence).
- `server/lib/log.ts`: Delete lines 1, 24, 26–29 (`// Cyan`, `// Yellow`, `// Red`, `// Green` next to ANSI codes!), 36.
- `server/lib/models.ts`: Delete lines 10, 13, 17, 30, 45, 48, 56, 64 (every single one restates a 1-line type or function right below it). Keep the file header (1–8), lines 19–20, and `resolveModelId` (69–73).
- `server/lib/tokens.ts`: Delete line 1 (`// Helper to count rough tokens` on a 4-line file!).
- `server/providers/gemini.ts`: Delete lines 4 and 14–16 (`moved from the inline closure in /api/chat/stream...`).
- `server/routes/auth.ts`, `extract.ts`, `health.ts`, `logs.ts`, `models.ts`, `summarize.ts`, `tts.ts`: Delete the top `// API: ...` banner on each route file and obvious step labels (`// Setup SSE Headers`, `// Send initial recent logs`, `// Check status`).
- `server/routes/chat.ts`: Delete lines 9, 16, 22, 62, 140, 154, 207; remove `(see 08_UNIFIED_DATA_MODEL.md D3)` at line 176. Keep lines 28, 55–57, 81 (9s watchdog), 171–176.

---

## Batch 5 — One Stale Design Doc Header (bonus hygiene caught earlier)

- `design-docs/12_PLAN_OF_RECORD.md` line 3: Currently says it *"Supersedes the colour palette, widget surface, and rail portions of 10 and 11"*. After Vega's `21f94ed` / `96272b3` commits, the row/chip surface treatment in §1 Package 1 is superseded by `11_DESIGN_LEDGER.md` V2.1 ("step, don't stroke" alpha tints). Add a 1-line note at the top of `12_PLAN_OF_RECORD.md` so no future agent reads Package 1's `ROW_WELL` opaque hexes and tries to revert Vega's alpha tints.
