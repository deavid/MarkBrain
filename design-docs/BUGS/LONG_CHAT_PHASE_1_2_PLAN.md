# Implementation & TDD Plan: Long-Chat Scalability (`31_LONG_CHAT_SCALABILITY.md`)

- **Date**: 2026-11-01
- **Authors**: David & Altair
- **Reference Design Doc**: `design-docs/31_LONG_CHAT_SCALABILITY.md`
- **Target**: Next agent (e.g. `dev-vega`) after the current bug-fix wave is squashed and merged to `main`.

> **Core Mandate from David**:
> - Breaking/wiping the database and starting clean is **100% OK** — do NOT add convoluted legacy migration shims.
> - **Losing stability or introducing bugs on a clean DB is NOT OK.**
> - Every phase below lists the exact edge cases, invariants, existing CUJs that must not regress, and RED-first TDD tests required before writing production code.

---

## Phase 1 — UI Scalability: Bottom-First Open, Chapter Folding, Turn Windowing & Token Caching

### 1.1 Cached `contentTokens` on `TurnMeta` (`shared/types/timeline.ts`, `shared/turnCommit/planTurnCommit.ts`, `src/domains/03-optical-compiler/index.ts`)
- **Problem**: `estimateChapterCutTokens` and `OpticalCompilerDomain.compile()` re-run `compileTurnContentForPrompt` and `estimateTokens` over every turn string on every render / streaming chunk.
- **Implementation**:
  1. Add `contentTokens?: number;` to `TurnMeta` in `shared/types/timeline.ts`.
  2. In `planTurnCommit` (`shared/turnCommit/planTurnCommit.ts`), compute `contentTokens = estimateTokens(compileTurnContentForPrompt(storedReply))` on the assistant turn and `contentTokens = estimateTokens(req.askText)` on the user turn, and store them in `turn.meta.contentTokens`.
  3. In `estimateChapterCutTokens` (`src/domains/03-optical-compiler/index.ts`), when `granularity === 'full'`, use each turn's `t.meta?.contentTokens` when available so computing chapter token badges (`chapterTokens[chapter.id]`) is an $O(1)$ integer sum per turn instead of regex-stripping and copying strings on every render frame.

### 1.2 Default-Fold Older `Full` Chapters + Cap Open `Full` Chapters (`src/ui/chat/ChatView.tsx`, `src/ui/chat/useThreadUi.ts`)
- **Key Insight from `ChapterSection.tsx`**:
  - Chapters whose granularity is `Title`, `Description`, or `Summary` **already mount zero `<MessageBubble>` components** (they only render 1–2 short summary boxes in `data-testid="chapter-body"`).
  - Moreover, **CUJ-16 (`16-chapter-cut`)** in `scripts/evidence.cjs` clicks `Summary` and `Description` on `[data-testid="chapter-cut"]` and asserts that `[data-testid="chapter-layer-summary"]` / `[data-testid="chapter-layer-description"]` are visible!
  - Therefore, DOM explosion only comes from chapters at **`Full` granularity** mounting all their `<MessageBubble>` turns!
- **Invariants & Rules**:
  1. **Default state when opening/switching a thread**:
     - The **last 2 chapters** (active chapter + immediately preceding chapter) always start **unfolded** (`isCollapsed = false`).
     - Earlier chapters (`cIdx < chapters.length - 2`) whose effective granularity is **`full`** start **folded** (`isCollapsed = true`), so their turns are not mounted in the DOM on initial open.
     - Earlier chapters whose granularity is `summary` or `description` keep their compact summary layers visible unless the user explicitly folds them.
  2. **Clicking a Granularity Cut Chip (`Title | Description | Summary | Full`) on a Folded Chapter**:
     - In `handleSetChapterCut` (`ChatView.tsx`), whenever the user selects a cut on a chapter, automatically unfold that chapter (`setCollapsedChapterIds(prev => ({ ...prev, [chapter.id]: false }))`) so the user (and CUJ-16!) immediately sees the layer they selected.
  3. **Cap on Simultaneously Open `Full` Chapters (`MAX_OPEN_FULL_CHAPTERS = 3`)**:
     - Track the order in which the user manually unfolds `Full`-granularity chapters.
     - Never auto-fold the **active (ongoing) chapter**.
     - If the user unfolds a `Full` chapter such that more than `MAX_OPEN_FULL_CHAPTERS` (e.g. `3`) `Full` chapters are unfolded at once, auto-fold the least-recently unfolded non-ongoing `Full` chapter.
     - **Scroll-jump prevention**: When auto-folding a chapter that sits above the current scroll position, adjust `scrollContainer.scrollTop` by the height difference (`useLayoutEffect`) so the chapter the user just clicked stays stationary under their cursor!

### 1.3 Within-Chapter UI Turn Windowing (`src/ui/chat/ChapterSection.tsx`)
- **Problem**: Even a single unfolded `Full` chapter can contain `100–300` turns (up to the `128k` token hard cap). Mounting 300 `<MessageBubble>` trees in one chapter slows down initial open and mobile scrolling.
- **Invariants & Rules**:
  1. Define `CHAPTER_TURN_WINDOW_STEP = 40` (export constant so unit tests can exercise it).
  2. Inside `ChapterSection.tsx`, keep local state `visibleTurnCount` initialized to `CHAPTER_TURN_WINDOW_STEP` (`40`), resetting when `chapter.id` changes.
  3. When `turns.length > visibleTurnCount`:
     - Compute `hiddenCount = turns.length - visibleTurnCount` and `startOffset = hiddenCount`.
     - Render a button at the top of the chapter's messages container (`data-testid="chapter-load-earlier-turns"`):
       `"Show earlier messages in this chapter (${Math.min(CHAPTER_TURN_WINDOW_STEP, hiddenCount)} of ${hiddenCount} earlier)"` (or `"Show all ${hiddenCount} earlier messages"`).
     - Render only `turns.slice(startOffset)`.
  4. **CRITICAL INVARIANT — `globalTurnIndex`**:
     When mapping over `turns.slice(startOffset)`:
     ```tsx
     const globalTurnIndex = chapter.startIndex + startOffset + idx;
     ```
     **Never** use `chapter.startIndex + idx` without `startOffset`! Every attachment provenance lookup, manual chapter split (`Declare Chapter Split at this Message`), and turn index depends on `globalTurnIndex` being the true thread-wide index.

### 1.4 Bottom-First Synchronous Scroll on Thread Open (`src/ui/chat/ChatView.tsx`)
- **Problem**: Opening a thread currently uses `useEffect` + `messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })`, which runs *after* paint and fails to re-anchor when switching between threads (`isFirstMount` was a single ref that never reset on `threadId` change!).
- **Fix**:
  1. Key initial scroll anchoring off `activeThreadId` (or reset `isFirstMount` whenever `threadId` changes).
  2. Use `useLayoutEffect` on the scroll container (`scrollContainer.scrollTop = scrollContainer.scrollHeight`) when opening/switching threads so the very first painted frame is already at the bottom — **zero visible top-to-bottom scrolling**.
  3. Only use `scrollIntoView({ behavior: 'smooth' })` when a new turn is appended while the user is actively on the same thread.

### 1.5 Phase 1 TDD Tests & CUJ Gates
- **New test file `src/tests/long-chat-ui-windowing.test.tsx` (write RED first)**:
  1. A `ChapterSection` with `100` turns at `Full` granularity renders only the last `40` `<MessageBubble>` items initially, shows `data-testid="chapter-load-earlier-turns"`, and passes `globalTurnIndex = chapter.startIndex + 60` to the first rendered bubble and `chapter.startIndex + 99` to the last.
  2. In a thread with 5 `Full`-granularity chapters, initial open folds chapters `0, 1, 2` and keeps chapters `3, 4` (last two) unfolded.
  3. Clicking a cut chip on a folded chapter unfolds it so `data-testid="chapter-layer-summary"` is rendered.
  4. `planTurnCommit` stamps `meta.contentTokens` on both `userTurn` and `assistantTurn`, and `estimateChapterCutTokens` uses the cached numbers.
- **CUJ Gates**: Run `MARKBRAIN_JOURNEYS=04,16,23 MARKBRAIN_SKIP_AUDIT=1` on `scripts/evidence.cjs` and verify all three chapter journeys pass 100%.

---

## Phase 2 — Chapter Size Caps (`64k` Soft Cap, `128k` Hard Cap + Grace) & AI "Auto-Split Chapter"

### 2.1 Pure Chapter Token Cap Evaluator (`src/domains/02-chapter-segmentation/chapterCap.ts`)
- **Constants**:
  - `CHAPTER_SOFT_CAP_TOKENS = 64_000`
  - `CHAPTER_HARD_CAP_TOKENS = 128_000`
  - `CHAPTER_HARD_CAP_GRACE_TURNS = 2` (number of user turns allowed *after* the chapter first crosses `128,000` tokens)
- **Pure Evaluator `evaluateChapterTokenCap(turns: Turn[])`**:
  Walk `turns` in order, accumulating each turn's token count (`t.meta?.contentTokens ?? estimateTokens(t.content)`):
  - Record the index `crossedHardCapAtTurnIdx` where cumulative tokens first `>= CHAPTER_HARD_CAP_TOKENS` (`128,000`).
  - Count how many `user` turns occur *after* `crossedHardCapAtTurnIdx` (`graceUserTurnsUsed`).
  - Return:
    ```ts
    export interface ChapterCapStatus {
      totalTokens: number;
      status: 'ok' | 'soft-cap' | 'grace' | 'hard-blocked';
      /** Remaining sends allowed after crossing 128k (2 -> 1 -> 0). */
      graceSendsRemaining: number;
    }
    ```
    - If `totalTokens < 64_000`: `status: 'ok'`, `graceSendsRemaining: 2`.
    - If `64_000 <= totalTokens < 128_000`: `status: 'soft-cap'`, `graceSendsRemaining: 2`.
    - If `totalTokens >= 128_000` and `graceUserTurnsUsed < 2`: `status: 'grace'`, `graceSendsRemaining: 2 - graceUserTurnsUsed`.
    - If `totalTokens >= 128_000` and `graceUserTurnsUsed >= 2`: `status: 'hard-blocked'`, `graceSendsRemaining: 0`.
  - **Why this is rock-solid**: It is a 100% pure function of the chapter's turns. No extra database columns or fragile mutable counters that reset on reload.

### 2.2 Composer & Chapter Banner Integration (`src/ui/chat/ChatView.tsx`, `src/ui/chat/ChatComposer.tsx`)
1. **When `status === 'soft-cap'` (`>= 64k` tokens)**:
   - Show an emerging banner above the composer (and in the active chapter header) with `data-testid="chapter-soft-cap-banner"`:
     - Copy: `"This chapter is getting long (68.4k / 128k tok). Split it into two chapters so it stays easy to work with."`
     - Actions: **`Auto-Split Chapter`** button (`data-testid="auto-split-chapter-btn"`) + **`Split manually`** hint.
2. **When `status === 'grace'` (`>= 128k` tokens, 1–2 grace sends left)**:
   - Banner upgrades to amber warning (`data-testid="chapter-grace-banner"`):
     - Copy: `"This chapter passed 128k tokens — ${graceSendsRemaining} message${graceSendsRemaining === 1 ? '' : 's'} left before you must split the chapter."`
     - Action: **`Auto-Split Chapter`** button.
3. **When `status === 'hard-blocked'` (`>= 128k` tokens, 0 grace sends left)**:
   - Sending new messages in the composer is **blocked** (`sendBlocked = true`, reason `'chapter-cap-exceeded'`).
   - Banner (`data-testid="chapter-hard-cap-banner"`):
     - Copy: `"Chapter limit reached (128k tokens). Split this chapter to continue the conversation."`
     - Action: Prominent **`Auto-Split Chapter`** button.
   - **CRITICAL INVARIANT**: Even when `status === 'hard-blocked'`, **Regenerate last reply**, **Manual Chapter Split** (`Declare Chapter Split` on any message), **Auto-Split Chapter**, and **attachment controls** MUST remain 100% enabled so the user can always resolve the block!

### 2.3 AI "Auto-Split Chapter" Workflow (`src/prompts/lanes.ts`, `src/gateway/`, `server/routes/`)
- **What happens when the user clicks `Auto-Split Chapter` on a chapter**:
  1. Format the chapter's turns with 1-based user-pair / turn numbers (`#0 .. #(N-1)` relative to the chapter, showing only valid `user` turn boundaries as split candidates, and truncating any single huge turn to its first/last ~600 chars so the split prompt itself is always compact and fast!).
  2. Ask the model (`title` or `summarize` lane model) to return JSON (or sentinel tags):
     - `splitTurnOffset`: the turn offset within the chapter (must be a `user` turn near the middle where the topic/sub-topic shifted).
     - `previousChapter`: `{ title, subtitle, description, summary }` for the first half (`0 .. splitTurnOffset - 1`).
     - `currentChapter`: `{ title, subtitle, description }` for the second half (`splitTurnOffset .. end`).
  3. **Defensive Validation / Clamping (Never Trust Raw LLM Indices)**:
     - Ensure `splitTurnOffset` is an integer strictly inside `[2, chapterTurns.length - 2]`.
     - If the LLM returned an assistant turn index or an out-of-bounds number, snap it to the nearest valid `user` turn index near the middle of the chapter (`Math.floor(chapterTurns.length / 2)`).
     - Compute `globalSplitIndex = chapter.startIndex + validSplitOffset`.
  4. **Apply via Existing Domain Methods**:
     - Update the existing chapter's metadata (`title`, `subtitle`, `description`, `summary`) with `previousChapter`.
     - Call `onDeclareChapter` / `segmentation.declareNewChapter(currentChapter.title, globalSplitIndex, { subtitle: currentChapter.subtitle, description: currentChapter.description })`.
     - Because the new active chapter now contains only the second half of the turns, `evaluateChapterTokenCap` immediately drops below the cap and unblocks the composer!

### 2.4 Phase 2 TDD Tests
- **New test file `src/tests/chapter-token-cap.test.ts` (write RED first)**:
  1. `evaluateChapterTokenCap` transitions accurately across `'ok'` (`< 64k`), `'soft-cap'` (`64k..128k`), `'grace'` (`>= 128k` with 0 or 1 user turn after crossing), and `'hard-blocked'` (`>= 128k` with 2 user turns after crossing).
  2. `resolveAutoSplitBoundary` clamps out-of-bounds or assistant-turn LLM outputs to a valid interior `user` turn index and never produces an empty first or second chapter.
  3. End-to-end handler test: running Auto-Split on a `135k`-token chapter splits it into two chapters (`~65k` + `~70k`), stamps both titles/summaries, and immediately changes the active chapter's `evaluateChapterTokenCap` status from `'hard-blocked'` back to `'soft-cap'` / `'ok'`.

---

## Appendix A — Pre-Implementation Review & Refinements (`dev-vega`, 2026-11-01)

Before starting implementation, `dev-vega` audited all Phase 1 and Phase 2 touchpoints against the live codebase and locked in the following 6 refinements with David:

### A.1 Phase 1.1: Fast-Path Token Math Inside `OpticalCompilerDomain.compile()` (Not Only `estimateChapterCutTokens`)
- **Finding**:
  - `chapterTokens[chapter.id]` in `src/application/useProjectProjections.ts` does not call `estimateChapterCutTokens`; it reads `compiledContext.telemetry.chapterBreakdown` directly from `compiler.compile()` (called in `src/ui/context/useContextPayload.ts` on every state `tick`).
  - Inside `OpticalCompilerDomain.compile()`, every chapter currently builds `chapterXml(chap, granularity, turns)` and runs `estimateTokens(xml)` over the full XML string, and then runs `compileTurnContentForPrompt` + `estimateTokens` a second time when building `turns` (`nativeTurnsRaw`) for the last 2 chapters.
- **Refinement**:
  1. In `planTurnCommit` (`shared/turnCommit/planTurnCommit.ts`), stamp `meta.contentTokens = estimateTokens(compileTurnContentForPrompt(storedReply))` on the assistant turn and `meta.contentTokens = estimateTokens(req.askText)` on the user turn.
  2. Provide a shared helper `turnPromptTokens(t: Turn): number` that returns `t.meta?.contentTokens` when present (a finite non-negative number) and otherwise computes `estimateTokens(t.role === 'assistant' ? compileTurnContentForPrompt(t.content) : t.content)` (and optionally caches it on `t.meta` in-memory for legacy/fixture turns that lacked `meta.contentTokens`).
  3. Use `turnPromptTokens(t)` in:
     - `estimateChapterCutTokens(chap, granularity, turns)` when `granularity === 'full'` (summing wrapper overhead + per-turn cached tokens in $O(1)$ per turn instead of regex-stripping and string-joining all turns).
     - `OpticalCompilerDomain.compile()` for both `chapterBreakdown` token estimation and `nativeTurnsTokens` (`turns.reduce`), so `useContextPayload` never re-runs `estimateTokens` over huge historical turn strings on every `tick`.

### A.2 Phase 1.2 & 1.3: Avoid Full-Thread IndexedDB + SHA-256 Scan in `useMessageTts`
- **Finding**:
  - `src/ui/chat/useMessageTts.ts` currently loops over **every turn of every chapter** (`for (const grp of chapters) for (const t of grp.turns)`), computing a SHA-256 `ttsDeviceKey` and awaiting `hasCachedTts` in IndexedDB sequentially for every turn whenever the thread or chapter list changes.
  - On a 1,000+ turn thread, this causes thousands of sequential `SubtleCrypto.digest` + IndexedDB reads on initial thread open, even when older chapters are folded and expanded chapters are windowed to 40 turns.
- **Refinement**:
  - Pass only the **visible/mounted turns** (unfolded chapters, sliced to their active UI turn window) into `useMessageTts` (or filter inside `useMessageTts`), so the device TTS cache scan is strictly bounded by the mounted DOM window (at most `MAX_OPEN_FULL_CHAPTERS * CHAPTER_TURN_WINDOW_STEP` turns on initial open).
  - When a user unfolds a chapter or clicks `Show earlier messages in this chapter`, `useMessageTts` will naturally scan the newly visible turns.

### A.3 Phase 1.2 & 1.4: Explicit `threadId` Prop on `ChatView` + Deterministic Default-Fold Rule
- **Finding**:
  - `ChatViewProps` did not receive `activeThreadId` directly from `App.tsx`, and a newly synthesized Genesis chapter has `chapter.threadId === undefined`.
  - Without an explicit `threadId` prop, `ChatView` cannot reliably detect thread switches to reset `collapsedChapterIds`, `openFullOrder`, and synchronous bottom-scroll anchoring.
- **Refinement**:
  1. Pass `threadId={activeThreadId}` from `App.tsx` to `ChatView` (`threadId?: string` on `ChatViewProps`, falling back to `chapters[0]?.chapter.threadId ?? project.id` when omitted in standalone unit tests).
  2. When `threadId` changes (or on first mount with non-empty turns):
     - Reset per-thread UI state (`collapsedChapterIds`, `openFullOrder`, `declaringMessageId`, etc.).
     - Run a `useLayoutEffect` on the scroll container (`feedRef.current.scrollTop = feedRef.current.scrollHeight`) so the very first painted frame on thread open/switch is already anchored at the bottom (`scrollIntoView({ behavior: 'smooth' })` is only used when `totalMessagesCount` increases on the *same* `threadId`).
  3. **Default-fold resolution**:
     - For chapter at index `cIdx` with effective granularity `entry.granularity`:
       - Default collapsed state is `defaultCollapsed = cIdx < chapters.length - 2 && entry.granularity === 'full'`.
       - Effective `isCollapsed = collapsedChapterIds[chapter.id] ?? defaultCollapsed`.
     - This guarantees that:
       - The last 2 chapters (`cIdx >= chapters.length - 2`) always start unfolded.
       - Older chapters (`cIdx < chapters.length - 2`) at `full` granularity start folded (`isCollapsed = true`).
       - Older chapters at `summary`, `description`, or `title` start unfolded (`isCollapsed = false`), preserving CUJ-16 (`16-chapter-cut`) and keeping compact summary layers visible.
       - When a new chapter is declared and an older `Full` chapter slides to `cIdx < chapters.length - 2`, it automatically folds unless the user explicitly unfolded it.
  4. **Cap on Simultaneously Open `Full` Chapters (`MAX_OPEN_FULL_CHAPTERS = 3`)**:
     - Count currently unfolded chapters whose effective granularity is `'full'`.
     - When the user manually unfolds a `'full'` chapter (or switches a chapter's cut to `'full'`), record its `chapter.id` at the tail of `openFullOrder`.
     - If the total number of unfolded `'full'` chapters exceeds `MAX_OPEN_FULL_CHAPTERS` (`3`), pick the oldest non-ongoing `'full'` chapter (earliest in `openFullOrder`, or earliest by `chapterIndex` among unfolded non-ongoing `'full'` chapters not yet in `openFullOrder`) and set `collapsedChapterIds[evictedId] = true`.
     - Measure scroll compensation in `useLayoutEffect` when an above-viewport chapter is auto-folded so the clicked chapter does not jump away from the user's pointer.

### A.4 Phase 2.3: Use `segmentation.splitChapter()` + `updateLevels()` in Auto-Split
- **Finding**:
  - Calling `segmentation.declareNewChapter()` directly (as originally phrased in §2.3 step 4) always appends to the end of the chapter list and only updates `endIndex` on chapters with `status === 'active'`.
  - In contrast, `segmentation.splitChapter(chapterId, globalSplitIndex, newTitle, subtitle, description)` (used by `handleDeclareChapter` in `src/ui/chat/createChapterHandlers.ts`) properly:
    - Materializes the Genesis chapter first if `segmentation.listChapters().length === 0`.
    - Sets `target.endIndex = globalSplitIndex` and `target.status = 'completed'`.
    - Splices the new second-half chapter right after `targetIdx` with `startIndex = globalSplitIndex`, `endIndex = newEnd`, and `status = 'active'` (when splitting the tail chapter).
    - Emits `chapterSplit` (which integrates cleanly with `useAutoSummarizeSealedChapters` and persistence).
- **Refinement**:
  - In `handleAutoSplitChapter(chapterId?: string)` (defaulting to the active/last chapter):
    1. Materialize Genesis if `segmentation.listChapters().length === 0`.
    2. Resolve the target chapter (`chapterId` or active/last chapter) and slice its turns.
    3. Call the Auto-Split gateway / lane to obtain `{ splitTurnOffset, previousChapter, currentChapter }`, then validate/clamp `splitTurnOffset` via `resolveAutoSplitBoundary(chapterTurns, rawSplitTurnOffset)` so it is guaranteed to be a valid interior turn index (`user` turn preferred, strictly inside `[1, chapterTurns.length - 1]`, or `[2, chapterTurns.length - 2]` when `>= 4` turns).
    4. Compute `globalSplitIndex = target.startIndex + validSplitOffset`.
    5. Call `segmentation.splitChapter(target.id, globalSplitIndex, currentChapter.title, currentChapter.subtitle, currentChapter.description)`.
    6. Call `segmentation.updateLevels(target.id, { subtitle: previousChapter.subtitle, description: previousChapter.description, summary: previousChapter.summary })` and update `target.title = previousChapter.title` (via a clean `updateLevels` extension `title?: string` on `ChapterSegmentationDomain.updateLevels` so the first half also gets its focused topic title!).

### A.5 Phase 2.3: Sentinel-Based Auto-Split Prompt, Direct Mode Support & Hermetic Capture Fixture
- **Finding**:
  - All LLM extraction/summarization lanes in MarkBrain (`buildExtractPrompt`, `buildSummarizePrompt`, `buildQaPrompt`) use plain-text `=== SENTINEL ===` headers parsed by `parseSentinelBlocks` (`shared/utils/sentinelParser.ts`), never raw JSON (which breaks when models add markdown fences or unescaped quotes in multi-paragraph summaries).
  - Furthermore, the app supports both Server Proxy mode (`server/routes/summarize.ts`) and Local Direct mode (`src/gateway/directMode.ts`), and `scripts/evidence.cjs` enforces the **HARD HERMETIC RULE** (`isCaptureMode()` in `src/gateway/api.ts` must never hit external providers).
- **Refinement**:
  1. **Shared Prompt & Parser (`shared/prompts/prompt.ts` & re-exported in `src/prompts/lanes.ts`)**:
     - `buildAutoSplitChapterPrompt({ title, messages })`:
       - Formats each turn as `[Turn #0 | user] ...`, `[Turn #1 | assistant] ...`, truncating any individual turn longer than `1,200` chars to its first `600` + last `600` chars so a `128k`-token chapter compiles into a fast, bounded prompt.
       - Lists the valid candidate `user` turn offsets (`#2, #4, ...`) near the middle of the chapter.
       - Asks the model to respond with sentinel blocks:
         - `=== SPLIT_TURN ===` (integer turn offset `#k` where the second half begins)
         - `=== FIRST_TITLE ===`, `=== FIRST_SUBTITLE ===`, `=== FIRST_DESCRIPTION ===`, `=== FIRST_SUMMARY ===`
         - `=== SECOND_TITLE ===`, `=== SECOND_SUBTITLE ===`, `=== SECOND_DESCRIPTION ===`
     - `parseAutoSplitChapterResponse(raw, turns, fallbackTitle)` + `resolveAutoSplitBoundary(turns, rawOffset)`:
       - Parses the sentinel blocks (with regex/JSON fallback if a model ever emits JSON).
       - Clamps `splitTurnOffset` to the nearest valid interior `user` turn (falling back to the midpoint `user` turn near `Math.floor(turns.length / 2)`).
  2. **Three Execution Paths (`src/gateway/api.ts`, `src/gateway/directMode.ts`, `server/routes/summarize.ts`)**:
     - **Capture / Fixture mode (`isCaptureMode()`)**: Deterministically computes the midpoint user turn via `resolveAutoSplitBoundary(messages, Math.floor(messages.length / 2))` and returns deterministic titles, subtitles, descriptions, and summary — 100% hermetic, zero network calls.
     - **Direct mode (`shouldCallProviderDirect()`)**: Runs `buildAutoSplitChapterPrompt` against the `summarize` slot model in `directMode.ts` and parses with `parseAutoSplitChapterResponse`.
     - **Server Proxy mode (`POST /api/auto-split-chapter` in `server/routes/summarize.ts`)**: Records the call in the flight recorder (`recordCallStart` / `recordCallEnd`), runs with the 15s deadline, and returns `{ splitTurnOffset, previousChapter, currentChapter }`.

### A.6 Scope Gate
- Execute **Phase 1** and **Phase 2** first (strictly RED-first TDD for every requirement, followed by `npx tsc --noEmit`, `npx vitest run`, `npm run build`, and the targeted CUJ evidence gates).
- Stop after Phase 1 + 2 for David's verification before touching Phase 3.

---

## Phase 3 — Storage & Sync: Incremental Turn Store & Chunked Tail-First Hydration

*(Execute ONLY after Phase 1 and Phase 2 are green and verified.)*
*(Execute ONLY after Phase 1 and Phase 2 are green and verified.)*

### 3.1 SQLite Composite Index & Paginated Turns Endpoint (`server/db/schemaSpec.ts`, `server/db/projectRepo.ts`, `server/routes/projects.ts`)
1. Add composite index on `turns(user_id, project_id, thread_id, seq)` in `server/db/schemaSpec.ts`.
2. Add paginated turn-fetching endpoint `GET /api/projects/:id/turns?threadId=...&beforeSeq=...&limit=200` (returning turns ordered tail-first or by `seq` range) so the client can hydrate large threads in bounded JSON chunks (`<= 200` turns per response) instead of parsing a single multi-megabyte JSON payload.
3. Keep `GET /api/projects/:id/delta?since=rev` for ongoing incremental delta sync.

### 3.2 Incremental Turn Storage in Local `IndexedDB` (`src/services/persistenceService.ts`)
1. Separate `turns` out of the monolithic `projects` blob in IndexedDB into an indexed `turns` object store (keyed by `[projectId, id]` with index on `[projectId, threadId, seq]`), OR store turns in per-chapter/per-thread buckets so appending a turn writes only the affected thread/turn bucket instead of serializing the entire project on every message.
2. **TDD & Regression Gates for Phase 3**:
   - Must pass `src/tests/cuj-gap-sync.test.ts`, `src/tests/vps-user-journeys.test.ts`, `src/tests/plaintext-roundtrip.test.ts`, and all 27 journeys of `scripts/evidence.cjs`.

---

## Phase 3 — COMPLETION STATUS (dev-vega, 2026-11-01, commit `d85afd0`)

**Phase 3 is COMPLETE and green.**

- §3.1 done: composite index `turns(user_id, project_id, thread_id, seq)` declared in the schema spec (annealed on boot); `GET /api/projects/:id/turns` with `threadId` / `beforeSeq` / `limit` (1..500, default 200), TAIL-FIRST, envelope law respected; the `?delta?since=rev` endpoint untouched.
- §3.2 done: the IndexedDB `projects` blob no longer carries turns — a dedicated indexed `turns` store (`[projectId, id]` keyPath, `byProject` + `byProjectThread` `[projectId, threadId, seq]` indexes) holds one record per turn. The v1→v2 upgrade lifts every legacy blob's embedded turns into records atomically inside the upgrade transaction. `localPutProject` writes ONLY new/changed turn records (session-side signature diff in `src/services/turnRecords.ts`), so appending a message no longer serializes the whole project history; deletions sweep the `byProject` index; reads reassemble blob + records, keeping export/import, the plaintext roundtrip and the VPS mirror on the canonical snapshot shape.
- Gates: RED-first `src/tests/long-chat-phase3-storage.test.ts` (15 tests: real in-memory SQLite + HTTP for the endpoint/index, pure record core for the IDB logic); `tsc` clean; vitest 120 files / 988 tests; build green; **full evidence pack 27/27 journeys ok** (0 console/page/http errors; verdict AMBER only from the known J23 "needs 04,23" merge note — green in its targeted gate).

### Open item for David (Phase 3-b — NOT started; needs his design input per the design law)
- The client still loads the FULL project snapshot on open (`vpsStore.load` / local load reassemble everything). The paginated endpoint exists but nothing consumes it yet. Wiring tail-first client hydration means deciding how a PARTIALLY hydrated mirror interacts with the full-mirror contract, the offline replica, and outbox replay — a sync-model decision, so it waits for David rather than being designed unilaterally.
