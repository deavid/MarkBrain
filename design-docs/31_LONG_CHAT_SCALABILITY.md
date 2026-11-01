# 31 — Long-Chat & Million-Turn Scalability: Failure Modes, Requirements, and Decisions

- **Date**: 2026-11-01
- **Authors**: David & Altair (implemented on `dev-vega`)
- **Status**: **SHIPPED (Phases 1, 2 & 3 complete — 2026-11-01)** · Execution log in `archive/LONG_CHAT_PHASE_1_2_PLAN.md`. Future horizon items (clientstorage meter, cold-boot chunked hydration, working-set archiving) recorded in §4 below.

---

## 1. Motivation & Core Observation

Almost every AI chat application today (Goose, AI Studio, LibreChat, standard web chat UIs) degrades badly or outright breaks once a conversation grows very long. Common symptoms across those tools include:
- Opening a long chat takes 5–15 seconds while messages stream into the DOM from top to bottom and the viewport visibly scrolls all the way down to the latest message.
- The browser tab becomes sluggish or runs out of memory over thousands of rendered markdown messages.
- Network transfers, JSON parsing, and local storage writes choke on huge monolithic payloads.

**Why MarkBrain is better positioned than normal chat apps**:
MarkBrain already organizes conversations into **Chapters**. Chapters are meant to be substantial thematic units, and they give us natural boundaries for UI folding, token budgeting, and data loading — *provided* we keep our layers cleanly separated and don't confuse UI rendering with LLM prompt compilation or mirror storage.

---

## 2. Architectural Invariants (Do Not Mix Layers)

Before listing failure modes and solutions, three hard boundaries must be respected:

1. **What the UI mounts in the DOM vs. what the Compiler sends to the LLM are completely separate**:
   - Collapsing a chapter in the UI, or hiding earlier messages inside an expanded chapter so the DOM stays fast, **never** changes what `OpticalCompilerDomain` sends to the LLM.
   - What gets sent to the LLM is governed strictly by the chapter rules:
     - The **last 2 chapters** (active chapter + immediately preceding chapter) cannot be compacted and are always sent as real native `user` / `assistant` API turns in full.
     - **Older chapters** (`chapters.slice(0, -2)`) are compiled into `<conversation_chapters>` at whatever granularity the user chose (`Title`, `Description`, `Summary`, **or `Full`** — if an older chapter is set to `Full`, all of its turns are sent in full inside `<conversation_chapters>`).
2. **Full Mirror Architecture (Current Contract)**:
   - Currently, the backend holds everything and the frontend is a **full mirror** of the project.
   - Therefore, network/sync optimizations must work *within* the full-mirror model (diff/delta updates, chunked/paginated transfers so we never `JSON.parse()` a single 100 MiB blob at once, and tail-first hydration order).
   - *Drawer note for the future*: Eventually we may introduce an "Archived (VPS / backup only)" state for ancient data so phones don't have to mirror everything forever, but that is out of scope for now and parked in the drawer.
3. **No Silent Truncation by the Compiler**:
   - The compiler must never silently drop turns behind the user's back when a chapter gets large. Instead, we enforce explicit **Soft (`64k`) and Hard (`128k`) token caps** on chapters so the user knows the limit and splits the chapter cleanly.

---

## 3. Failure Modes & Decisions by Layer

### 3.1 UI & DOM Layer: The "Top-to-Bottom Scroll Disease" & DOM Explosion

#### Problems
1. **Top-to-bottom mount + scroll delay**:
   When opening a long chat, mounting turns chronologically from `turn 0` to `turn N` and then scrolling to the bottom forces the browser to build, parse markdown for, and layout thousands of historical messages before showing the one thing the user cares about: **the bottom of the chat (the recent conversation)**.
2. **Too many chapters open at once**:
   If dozens of chapters are expanded in the feed simultaneously, the DOM accumulates thousands of heavy `<MessageBubble>` trees.
3. **Single huge chapter in the DOM**:
   Since a single chapter can grow up to the `128k` token hard cap, even 1 expanded chapter can contain hundreds of turns — too much to mount in the DOM all at once on a phone.

#### Decisions & Requirements
1. **Bottom-First Rendering on Open**:
   - When opening a chat, the user must land at the **bottom of the conversation immediately** (the recent messages first, top part last — zero watching the screen scroll for 10 seconds).
2. **Older Chapters Start Collapsed**:
   - Only the **active/recent chapter** (at most the last 1–2 chapters) starts expanded when opening a chat; all earlier chapters render **collapsed** as lightweight header bars.
3. **Constraint on Simultaneously Open Chapters**:
   - Enforce a small cap on how many chapters can be open in the UI at the same time (e.g. max 2–3 open chapters; opening another auto-collapses the oldest open one).
4. **UI-Only Turn Windowing Inside a Large Expanded Chapter**:
   - Even inside an expanded chapter, the UI shouldn't mount 128k tokens of DOM nodes at once. Mount the most recent window of turns at the bottom of that chapter first, and let the user load/expand earlier turns upward on demand (purely a UI view window — has zero effect on the compiler).

---

### 3.2 Chapter Size Limits: `64k` Soft Cap, `128k` Hard Cap, and AI Auto-Split

#### Problems
- If a user leaves `Cut chapters` off or stays on one subject for a very long time, a single chapter can grow unbounded, eventually exceeding model context windows and making both UI and compilation unwieldy.

#### Decisions & Requirements
1. **Soft Cap at `64k` tokens**:
   - When the active chapter crosses **`64k` tokens**, surface a clear visual indicator and an emerging **"Auto-Split Chapter"** action (alongside manual split).
2. **Hard Cap at `128k` tokens (with 1–2 turn grace)**:
   - Once the active chapter reaches **`128k` tokens**, allow a small grace of **1–2 turns** so the current exchange can finish, and once exceeded, **block sending new messages** until the chapter is split.
   - Make the block reason explicit in the composer so the user knows why sending is paused and can split the chapter (manually or via Auto-Split) to continue.
3. **AI-Assisted "Auto-Split Chapter" Feature**:
   - When triggered (especially once past the `64k` soft cap), send the chapter's turns with their turn numbers (`#1 .. #N`) to the LLM and ask it to identify:
     - The best turn number where the topic/sub-topic shifted (cutting the large chapter roughly in half at a natural seam).
     - The title (and summary/description) for the **previous topic** (first half).
     - The title (and subtitle/description) for the **current topic** (second half).
   - Apply the split at that turn boundary so the conversation can continue smoothly.

---

### 3.3 Network Transfer & Sync Layer: Deltas & Chunked Tail-First Downloads

#### Problems
1. **Monolithic JSON payload on full load**:
   Even though the frontend is a full mirror, downloading or parsing a single `100 MiB` JSON payload in one HTTP response freezes `JSON.parse()`, spikes memory, and blocks initial load.
2. **Wrong arrival order on initial load**:
   Waiting for Turn #1 from 6 months ago to download before showing the latest 20 turns of the active chat makes the user wait on historical data they aren't looking at.

#### Decisions & Requirements
1. **Diff / Delta for Ongoing Updates**:
   - Updates after initial load must only transfer the delta (the parts that changed), never re-pushing the whole project.
2. **Chunked / Multi-Batch Full Download (Bounded Parse Size)**:
   - A full project download must be broken into multiple smaller JSON chunks/pages so the client never parses a massive JSON payload all at once.
3. **Tail-First Arrival Order**:
   - Fetch project metadata, artifacts, chapter headers, and the **bottom (most recent) turns first**, so the active chat renders its recent conversation right away while older turns/chapters finish syncing into the local mirror in the background.

---

### 3.4 Storage & Backend Layer (`SQLite` & Local `IndexedDB`)

#### Problems
1. **Local `IndexedDB` rewriting the entire project blob on every turn**:
   Storing the entire project (including the flat array of all turns) as a single IndexedDB value means every single new turn serializes and overwrites the whole project history to disk.
2. **Backend `SQLite` full-project turn scan (`assembleProject`)**:
   Selecting every turn row of a project in one query (`SELECT * FROM turns WHERE project_id = ? ORDER BY seq ASC`) scales poorly when a project reaches tens or hundreds of thousands of turns.
3. **Repeated token re-estimation**:
   Re-running `estimateTokens()` over every historical turn across every chapter on every React render or streaming chunk wastes CPU during live streaming.

#### Decisions & Requirements
1. **Granular Turn Storage in `IndexedDB`**:
   - Store turns incrementally (per-turn or per-chapter records) rather than rewriting one giant project blob on every turn append.
2. **Indexed Range Queries & Paged Reads in `SQLite`**:
   - Ensure composite indexes on `(user_id, project_id, thread_id, seq)` so fetching a thread's tail or a specific chapter's turn slice is an fast index seek, and support paginated turn fetching for chunked sync.
3. **Cached Token Counts on Turns / Chapters**:
   - Persist/cache token counts on turns and closed chapters when they are written or edited so UI badges (`ChapterSection`), chapter cap checks (`64k` / `128k`), and `OpticalCompilerDomain` don't re-scan thousands of turn strings on every render frame.

---

## 4. Implementation Status & Future Horizon (Updated 2026-11-01)

### 4.1 What Is Shipped Today (`dev-vega`, commits `0167223` .. `e76c27c`)
- **Phase 1 (UI & Token Caching)**:
  - `TurnMeta.contentTokens` stamped at commit time (`planTurnCommit.ts`), read via `turnPromptTokens` + `compiledTurnText` WeakMap memoization (`shared/turnCommit/turnTokens.ts`), and summed in $O(1)$ per turn inside `OpticalCompilerDomain`.
  - Default-folding of older `full`-granularity chapters (`defaultChapterCollapsed`) + `MAX_OPEN_FULL_CHAPTERS = 3` (`evictOpenFullChapter`) with `useLayoutEffect` scroll-height compensation (`src/ui/chat/chapterFold.ts`, `ChatView.tsx`).
  - Within-chapter 40-turn trailing window (`CHAPTER_TURN_WINDOW_STEP = 40`) in `ChapterSection.tsx`, preserving true `globalTurnIndex = chapter.startIndex + hiddenTurnCount + windowIdx`.
  - Bounded `useMessageTts` device cache scan (only scans unfolded, windowed turns).
  - Synchronous bottom-first thread open (`useLayoutEffect` on `feedRef` in `ChatView.tsx`).
- **Phase 2 (64k Soft Cap, 128k Hard Cap + 2-Turn Grace, AI Auto-Split)**:
  - Pure `evaluateChapterTokenCap(turns)` (`src/domains/02-chapter-segmentation/chapterCap.ts`).
  - Soft-cap (`64k`), grace (`128k` + 2 user turns), and hard-blocked banners in `ChatView.tsx` + `capBlocked` composer enforcement in `ChatComposer.tsx`.
  - AI-assisted **Auto-Split Chapter** (`shared/prompts/autoSplit.ts`, `handleAutoSplitChapter` in `createChapterHandlers.ts`, `POST /api/auto-split-chapter`, `directAutoSplitChapter`, and hermetic capture-mode fixture), pinned by `chapter-token-cap.test.ts` and CUJ `28-long-chat-ui`.
- **Phase 3 (Storage & Paginated Endpoint)**:
  - Composite SQLite index `idx_turns_user_project_thread_seq` on `turns(user_id, project_id, thread_id, seq)` (`server/db/schemaSpec.ts`).
  - Tail-first paginated server endpoint `GET /api/projects/:projectId/turns?threadId=...&beforeSeq=...&limit=200` (`server/db/projectRepo.ts`, `server/routes/projects.ts`).
  - Incremental per-turn IndexedDB store (`DB_VERSION = 2` in `src/services/localBackend.ts`, pure core in `src/services/turnRecords.ts`) with atomic v1→v2 upgrade migration and signature-diff writes (`O(changed turns)` per save instead of rewriting the full project blob).

### 4.2 Future Horizon (Parked by David on 2026-11-01 — "for another day / another month")

1. **Client Storage Meter in Sidebar (`navigator.storage.estimate()`)**:
   - **Browser capability**: Modern browsers expose the Web Storage API `await navigator.storage.estimate()`, which returns `{ usage, quota }` in bytes for the entire origin (covering `markbrain-local` / `markbrain-vps-*` IndexedDB stores, `markbrain-tts-audio-v1` Opus cache, `markbrain-call-logs`, and `localStorage`).
   - **Important nuance on browser `quota`**: Browser-reported `quota` is based on free disk space (up to ~60% of disk in Chromium, ~1–2 GiB soft ceiling in Safari/iOS before eviction pressure), whereas practical single-tab **in-memory working-set limits** (hydration + domain maps) hit friction much earlier around **100–250 MB** of raw workspace data.
   - **Future UI idea (David)**: A small, quiet storage readout in the sidebar showing rough MB used and `% full` against a safe working ceiling (or browser quota), staying subtle under 50% and getting visually louder once past 50% / 80% — acting as the early-warning trigger for when we actually need the working-set archiver below.
2. **Working-Set Archiving (Offloading Cold Data from Client Memory/IDB to VPS)**:
   - Once real usage ever approaches those storage thresholds, introduce an archiving flow where older/settled chapters or projects are marked archived: their heavy turn bodies / audio are evicted from the client's in-memory domains and local IndexedDB mirror ("working set"), while remaining safely stored and queryable on the VPS.
3. **Phase 3-b Client Cold-Boot Chunked Hydration (Deferred — Option A chosen)**:
   - We kept `vpsStore.load` simple (single snapshot pull on cold boot, `/delta?since=rev` for ongoing sync, and incremental per-turn IDB writes). If a cold-boot download ever grows large enough to need chunked hydration, the server endpoint `GET /api/projects/:id/turns?beforeSeq=...&limit=200` is already built and ready to be wired.
