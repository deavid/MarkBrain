# 03 — Data & Context Model (`03_DATA_AND_CONTEXT_MODEL.md`)

> **Status: CURRENT (2026-10-28).** The reference for how Projects, Threads,
> Turns, Drafts, Chapters, Attachments, and Artifacts actually work — written
> against the Oct 28 codebase. **The code wins** where this file and reality
> disagree; fix the file. Historical specs live in `archive/` (09, 10, 14, 18,
> 23, 28).

---

## §1. The 4-Layer Cut Symmetry (Artifacts & Chapters)

Chapters and Artifacts are **different objects** (`ChapterPartition` vs
`UniversalArtifactDocument`, separate tables) — but both expose the same four
**cumulative granularity cuts**, which is the symmetry the product is built
around ("a chapter is like an artifact that contains turns and attachments"):

| Cut | Value | What the LLM (and the mirror) gets |
|---|---|---|
| `title` | 10 | Title + `subtitle` — a ~40-token italic hook, not a bare name |
| `description` | 20 | + Description — ~200 tokens |
| `summary` | 30 | + Summary — ~800–1,500 tokens |
| `full` | 100 | + **verbatim body** (artifact) or the **verbatim `<turn>` messages** in the chapter window |

- **Numbers are enum internals.** The words `title | description | summary |
  full` are the only user-facing vocabulary (see `04_UX_AND_DESIGN_LAW.md` §4).
- A **100k-token brainstorming chapter** is real usage — that is why all four
  layers exist on chapters, not just artifacts (`archive/27` §3).
- **A cut is cumulative, not a substitution** — the layers are written to be
  read together in order.

### The compaction contract (how layers get written)

Measured on real imports, then re-specified (2026-10-21): the four layers are
**four distinct jobs at four scales**. Prompts state the sizes and say the
layers are read together; responses are parsed as plain-text **sentinel
blocks** (`=== SUBTITLE ===` / `=== DESCRIPTION ===` / `=== SUMMARY ===`) —
**no JSON anywhere** in LLM responses; imported bodies are **spliced verbatim
from the source file**, never retyped by the model. Evidence:
`src/tests/compaction-prompts.test.ts`, `archive/09` §"The compaction
contract".

### The stale-layer guard (when layers lie)

When a **manual edit** changes `body` without updating `description`/`summary`,
the artifact gets `layersStaleAt`. Then:

- At `full`, the compiler **omits the stale description/summary** — it sends
  Title + Subtitle + Body only. A stale summary never reaches the LLM as if
  it were current.
- At `description`/`summary` cuts, the UI shows an amber
  "Summary layers out of date" badge with a **Refresh layers** button that
  regenerates the layers via `/api/extract` (recording a revision of the
  stale state first). Evidence: `src/tests/stale-layers.test.ts`.

## §2. Artifacts, Revisions & Provenance

- **Artifacts are "my Google Docs"**: the AI may upsert them freely during
  chat; the user may also edit them manually. Safety comes from persistent
  revision history + diffs + one-click revert + provenance — never from
  confirmation popups.
- **Filenames, not ids:** notes travel in the prompt as
  `<artifact file="slug.md">` (`uniqueFileName()`) — never internal `art-…`
  ids (`archive/10` §21).
- **Every write records a full snapshot of the OLD state:**

  ```
  ArtifactRevision {
    version, timestamp,
    actor: 'user' | 'ai',
    changeSummary,
    provenance?: { threadId, turnId, turnIndex },
    title,                       // full title at this revision
    layers,                      // full 4-layer snapshot at this revision
  }
  ```

  Both the AI path (`<artifact_upsert>` on existing artifacts, client
  `sendQueue.ts` and server `commitJobPairTransaction`) and the user path
  (manual Edit mode in `ArtifactDetailModal`, `+ New Note`) record revisions.
  Reverts snapshot the current state first, then restore.
- **Persistence:** `ProjectSnapshot.revisions` + SQLite `artifact_revisions`
  (envelope + `layers_json`), included in snapshot GET, delta sync, and
  purge. F5 no longer wipes the History tab.
- **History tab:** per revision — version badge, timestamp, actor chip
  (`Manual edit` / `AI · chat "…" msg #N`), changeSummary; inline **line
  diffs** (`src/utils/lineDiff.ts`); **Revert to this version**; **Open
  chat** provenance jump when `provenance.threadId` exists.

## §3. Attachments & The Timeline Law

An attachment lives on `ChatThread.attachments`
(`{artifactId, granularity, staged, turnIndex, turnId}`):

- **Staged** — armed for the next send; rendered in the composer tray;
  freely removable (`×`). It has not happened yet.
- **Committed** — welded to a turn at send time (`turnIndex`/`turnId`).
  **It cannot be detached** — for the same reason you can't delete Turn 3:
  it already happened. What stays dialable forever is its **granularity**:
  `Full → Summary → Description → Title` reclaims tokens without erasing
  history. Floor is `title`; nothing is ever fully excluded.
- Extracted artifacts auto-weld to the assistant turn that produced them.
- Legacy attachments hydrate at `turnIndex: -1` — "in chat, provenance
  unknown" (never a fabricated `msg 1`).

## §4. Chapters & Boundaries

A `ChapterPartition` is a contiguous window of turns on a thread
(`startIndex..endIndex`), with its own 4 layers and cut.

- **In-progress law (2026-10-21):** the **last two chapters** are in progress.
  They are forced to `Full`; their cut chips are replaced by an
  `In progress · Full` badge; `handleSummarizeChapter` refuses them — a
  chapter you are still talking inside is not one to cut or recap. A manual
  split fires the background summarize for the chapter that just **left** the
  window (that one is leaving, so sealing it makes sense).
- **User-only cut law:** nothing but the user moves a chapter's cut. Sealing
  never silently changes granularity (`sealedGranularity` was deleted; the
  one-time hydrate marker is `GRANULARITY_LAW`, defined in `src/domains/granularity.ts`).
- **Chapter header `⋯` controls:** Split at this message; **Merge with
  previous** (`mergeChapters` — extends the previous chapter's `endIndex`,
  refuses if the previous one is in progress); **Move seam up/down**
  (`shiftBoundary`, bounds-guarded — never past turn 0 or into the next
  chapter); **Regenerate summary** (`recalibrateSummary`, with an optional
  steering note, refused on in-progress chapters).

## §5. Chat Pairs, The Send Queue & Send-and-Forget

- **Chat is pairs.** History holds only completed `(user, assistant)` pairs.
  An unpaired ask — including failures, stops, and partials — is a **draft**,
  never a turn. Errors are final: no silent model downgrade, and a failed
  request never impersonates the model.
- **The Draft is the unit of a send** (`archive/23`):
  - It owns an **attachments snapshot** taken at enqueue (the tray edits the
    un-sent payload; sending freezes it; **retry re-sends the same
    snapshot**; discard drops it with nothing silently re-armed).
  - It owns **honest, observable progress**: `queued | connecting |
    awaiting-first-token | writing`, each with a `since` clock. The word
    "Synthesizing" is banned; the model's "thinking" is not observable —
    waiting-for-first-token is, and the copy says exactly that.
  - It exits exactly three ways: **paired**, **store as-is**, **discard**
    (plus retry/regenerate, which create new drafts). Nothing auto-commits.
- **Queue discipline:** strict FIFO, one send at a time; the walk **stops at
  a failed head and never skips it** — later drafts wait until the head is
  resolved.
- **Composer draft persistence** (`composerDrafts.ts`): unsent text per
  thread survives app kills — mode-scoped `localStorage`, 300 ms debounce,
  synchronous flush on `pagehide`/`visibilitychange` (mobile kill events),
  50-thread cap.
- **Send-and-Forget (VPS):** `POST /api/jobs/chat` runs the turn server-side
  (`chatJobRunner.ts`) — SSE attach/detach **never cancels** a job; only
  explicit `/stop` does. On completion one SQLite transaction commits the
  pair, buffered artifacts, chapter shift, thread title, and revision bump;
  on failure zero turns are written. Reconnects reconcile via
  `GET /api/projects/:id/jobs`.
- **Offline:** sends stay `queued` (never attempted) and auto-flush when
  connectivity returns (`connectivity.ts` + the sendQueue gate).

## §6. Context Compiler & Stream Protocol

- **Compiler output** (`src/domains/03-optical-compiler`):
  1. `systemInstruction` — base persona **plus only the enabled
     `ChatCapabilities` XML blocks** (`writeArtifacts` default ON,
     `autoChapter` default OFF, `graphLinks` default OFF). When a capability
     is off, its instruction block is absent entirely — the model stops
     losing IQ to harness bloat.
  2. `compiledPrompt` — `<knowledge_substrate>` (attached
     `<artifact file="slug.md">` blocks) then `<conversation_chapters>` in
     chronological order. Send order = chat order, always.
- **Stream demuxer** (`03-stream-protocol`): strips
  `<topic_shift>` / `<artifact_upsert>` / `<link>` from clean prose — always,
  so a rogue model can't pollute the chat with XML — but the **apply paths**
  gate on the capability flags (client `sendQueue.ts` and server
  `commitJobPairTransaction`): shifts ignored when `autoChapter` is off,
  upserts ignored when `writeArtifacts` is off, links ignored when
  `graphLinks` is off.

## §7. Referential Deletion Law

From `archive/14`, re-confirmed aligned in `archive/27` §4:

- **Lifecycle:** `active → archived → delete` (typed `DELETE` confirm, in
  `CleanupModal` only). Nothing is ever deleted from `active`.
- **Archive is not a visibility switch.** An archived artifact is still
  attachable, still compiles into context when attached, still renders in the
  mirror. Archive means "parked and eligible for cleanup" — never "hidden
  from the LLM".
- **The referential law:** an artifact pointed at by an **active** chat can
  never be deleted — the tool names those chats and offers to archive them
  ("the chats must go first"). Artifacts referenced only by archived chats
  are deletable; a second explicit checkbox cascades to those archived chats.
  Deleting an artifact garbage-collects its edges, attachments, and revision
  rows.
