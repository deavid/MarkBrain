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

## Phase 3 — Storage & Sync: Incremental Turn Store & Chunked Tail-First Hydration

*(Execute ONLY after Phase 1 and Phase 2 are green and verified.)*

### 3.1 SQLite Composite Index & Paginated Turns Endpoint (`server/db/schemaSpec.ts`, `server/db/projectRepo.ts`, `server/routes/projects.ts`)
1. Add composite index on `turns(user_id, project_id, thread_id, seq)` in `server/db/schemaSpec.ts`.
2. Add paginated turn-fetching endpoint `GET /api/projects/:id/turns?threadId=...&beforeSeq=...&limit=200` (returning turns ordered tail-first or by `seq` range) so the client can hydrate large threads in bounded JSON chunks (`<= 200` turns per response) instead of parsing a single multi-megabyte JSON payload.
3. Keep `GET /api/projects/:id/delta?since=rev` for ongoing incremental delta sync.

### 3.2 Incremental Turn Storage in Local `IndexedDB` (`src/services/persistenceService.ts`)
1. Separate `turns` out of the monolithic `projects` blob in IndexedDB into an indexed `turns` object store (keyed by `[projectId, id]` with index on `[projectId, threadId, seq]`), OR store turns in per-chapter/per-thread buckets so appending a turn writes only the affected thread/turn bucket instead of serializing the entire project on every message.
2. **TDD & Regression Gates for Phase 3**:
   - Must pass `src/tests/cuj-gap-sync.test.ts`, `src/tests/vps-user-journeys.test.ts`, `src/tests/plaintext-roundtrip.test.ts`, and all 27 journeys of `scripts/evidence.cjs`.
