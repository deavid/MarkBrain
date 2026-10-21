# TODO / BUGS — the pickup file

> **What this is:** the plain, current list of things *known broken, known
> missing, or decided-but-not-built* — written so anyone (human or AI) can pick
> up slack without re-reading the whole doc set. One item = enough context to
> start; keep items short and concrete, delete them when done.
>
> **What this is not:** the live project state (that's `scratch/pending.md`) or
> the architecture story (`STATUS.md`, `09_…`). When in doubt, an item here
> should cite the doc or decision that spawned it.

---

## Done — 2026-10-21 night: the four noise/data-loss items (`dev-vega`)

David, verbatim: *"shouldn't we have some ephemeral red notification for critical
errors? like, we've been losing data and didn't notice… the chapters default to
granularity=Summary… They should default to Full, and nothing except the user
should move them… hide the Title-Description-Summary-Full controls, the user can
click to cycle the granularity and that's it. And I would make the width of the
artifact 25% smaller in the chat."* All four shipped.

- **Critical failures are now visible.** `utils/criticalNotifications.ts` +
  `ui/system/CriticalNotifications.tsx`: a red `role="alert"` banner, one human
  sentence, no stack (that stays in the console), gone on its own after 12s, a
  repeating failure refreshes one banner instead of stacking. Reported into from
  exactly two places, both silent-data-loss paths: a failed **save**
  (`persistWorker`) and a failed **load** (`snapshotLoader`). Law recorded in
  `05_CLEANSE_DECISIONS.md`; tests in `src/tests/critical-notifications.test.ts`;
  live proof in `/tmp/critical-banner-check.cjs` (fires, renders, dismisses,
  expires, never stacks).
- **…and it did not fire. Fixed the same night, properly.** David reloaded and
  said so, with his console attached: the writes were failing with
  `resource-exhausted` and the banner never appeared. Root cause: **a
  quota-blocked Firestore write does not reject.** The client keeps it in its
  retry loop with a backoff cap ("Using maximum backoff delay to prevent
  overloading the backend"), so `setDoc` NEVER settles — the `catch` that raises
  the banner simply never ran. The wiring was fine; the failure was invisible by
  construction.
  - `utils/deadline.ts` — `withDeadline(op, ms, what)`: an operation that never
    settles still fails loudly (the deadline does not cancel the write; it stops
    waiting for it).
  - `SAVE_ACK_DEADLINE_MS = 15s` around `getStore().save(...)` in
    `persistenceService` — a save that sits unacknowledged for 15s counts as
    failed, so the fingerprint stays unset (it retries) and the user is told.
    `LOAD_DEADLINE_MS = 30s` for reads (a hung load is at least *visible*: the
    boot loader spins, the save gate stays shut).
  - `persistWorker` no longer blames the cloud for every error in the block:
    payload assembly and transmission are separate `try`s, with separate
    messages (an assembly crash says "Could not save your work").
  - Evidence seam `?slowsave=1` (dev only): the save path hangs exactly like a
    quota-blocked write and never consults a backend, so fixture runs stay
    read-only. **Journey `19-critical-notice`** drives it end to end and asserts
    the banner appears, says what is at risk, carries no error specifics, is a
    live region, and dismisses. Tests: `deadline.test.ts` (5),
    `save-watchdog.test.ts` (4), plus the app-layer wiring in
    `critical-notifications.test.ts`.
- **Nothing but the user moves a chapter's cut.** `sealedGranularity` is deleted
  (it was called at `ChapterSegmentationDomain` ×3 and `ThreadRegistry` ×1);
  sealing/splitting/closing now only fix turn windows, and
  `resolveChapterGranularity(chapter)` = explicit choice, else Full. Legacy
  snapshots are migrated ONCE on hydrate (`granularityLaw` marker written on
  every save), so the chapters that already read Summary come back Full and a
  Summary the user picks afterwards stays. See `10_…` §19, item 1 below.
- **The chat artifact card lost its chips** (`hideGranularityChips`): the row
  body is the control — click cycles the cut, exactly as asked. Chips remain
  where a cut is *chosen*: folder row, staged tray, chapter header, detail modal.
- **The chat card is 25% narrower**: a fixed 240px (`size="compact"`) instead of
  the 320px library row, and it no longer `grow`s — the first attempt kept
  `grow`, measured 852px in evidence, and the reduction was invisible.

Evidence: J15 gained the card checks (no chips, ≤260px, click cycles the cut);
gates GREEN — `tsc` clean, **226/226** vitest, evidence 18/18 journeys, 0 fails,
0 warns, 0 console errors.

---

## Done — 2026-10-20: the attachment timeline (10_ATTACHMENT_TIMELINE.md)

The four things David flagged from the screenshots are built (commit on
`dev-altair`): top clearance that scrolls away, the folder row as the picker
(6 states, dot verb), staged tray → welded-to-turn attachments, and the chapter
view = the cut (Recap eradicated, token count per chapter). Details: doc 10 §18.

- ~~Top pills overlap content~~ → in-flow clearance spacer in the chat feed and
  the folder list; nothing sticky (verified by journey `17-top-clearance`).
- ~~No attach / granularity control outside the detail modal~~ → folder rows
  carry the dot + the four chips + the token cost; `AttachmentPicker` deleted.
- ~~Nothing shows what will be sent~~ → staged tray in the composer (both
  composers), removable with `×`, counted in the live total.
- ~~No record of where an attachment entered~~ → `turnIndex`/`turnId` welded at
  Send; the card renders on that turn and in the chapter's compacted strip.
- ~~Chapter view ≠ payload (`Recap` + honest strip)~~ → the body renders the cut
  (description → summary → turns) + `N tok` per chapter; `Recap` is gone.
- ~~Voice selector eats composer space~~ → it lives in the sidebar; `[ + ]`
  opens the library.
- **Also:** manual chapter split now fires the background summarize for the
  chapter it seals (so the `summary` cut it steps to is backed by text).

---

## Done — 2026-10-19 night: the attachment slice (all six original items)

Items 1–2, 4–6 of the previous list are **built** (commits on `dev-altair`).
The payload is now: this chat's attachments (each at its own granularity) +
this chat's chapters (each at its own granularity). Nothing is included by
distance. Details in `09_CHAT_ARTIFACTS_PAYLOAD.md` §11 and `changelog.md`.

- ~~Compiler: four chapter granularities~~ → `03-optical-compiler` emits
  title / description / summary / full, cumulative (a cut, not a swap).
- ~~Chapter row: real granularity control~~ → the chat header and the mirror
  both carry the four-word control; the compiler honors it.
- ~~Chapter resolution rule~~ → `resolveChapterGranularity()` + explicit
  `chapter.granularity`; **sealing does NOT step full → summary** (that
  auto-seal was removed 2026-10-21 — see the top of this file).
- ~~Attachment model~~ → `ChatAttachment` on `ChatThread`, per chat, attach at
  full, no detach, no excluded state. `ThreadRegistry.attachArtifact` /
  `setAttachmentGranularity` / `purgeArtifact`.
- ~~Remove Focus machinery~~ → `nodeTiers`, `TierReason`, pins, overrides,
  radius BFS, ancestor backbone, `opticalMode` and its sidebar toggle are gone.
  The graph is a library lens only.
- **Bonus found in the code and fixed:** the model's `<topic_shift>` already
  carries `abstract` (= what the new chapter is about) and `summary`; the first
  was being stored as `topicShiftReason` (and rendered as a "Shift" chip) and
  the second was dropped. New chapters are now born with a description; the
  legacy field is backfilled in `hydrate.ts`.

---

## Done — 2026-10-20 night: the colour law, one widget, the honest rail (12)

**All nine items below shipped** on `dev-altair`; the built list (with the
deviations) is `12_PLAN_OF_RECORD.md` §18, the verdicts are
`11_DESIGN_LEDGER.md`. The items stay below as the statement of the problem,
not as work.


Full verdicts live in `11_DESIGN_LEDGER.md`; the concrete, self-reviewed
execution blueprint (with all 4 open questions resolved and exact hexes,
props, and file-by-file changes) lives in **`12_PLAN_OF_RECORD.md`**. Execute
Packages 1–6 in `12_PLAN_OF_RECORD.md` in order:

11. **The chapter body lies at the `Description` cut** (S1): `ChatView.tsx:671/679`
    render `description`/`summary` with only a `granularity !== 'title'` gate, so
    the payload carries the title while the UI shows the summary paragraph
    (ledger V1.2). Gate both on `cutIncludes`, add the J16 Description step, and
    one journey that asserts **UI == payload** (via the Mirror breakdown) instead
    of element counts.
12. **Colour law v2** (R1.1/R1.2): hue becomes a stroke/ink/dot, never a fill;
    dark plate + bright ink always; one filled thing per row (the dot); 6 states
    = 4 even-spaced hues (`#41d686` `#d4da5b` `#ff9d00` `#ff645f`) + animated
    staged cyan `#37d2f2` + hue-less grey `#7d8792`. Kills the 1.34:1
    active-chip inversion by construction (V1.5).
13. **The 5px rail** (R1.5): real payload order + real breakdown (no
    `historyTokens * 0.7`), one segment per part, hue = that part's own
    granularity, height = `min(1, cbrt(total/1M))` with segments subdividing that
    fill. Yardstick open (ledger §Open to David 1).
14. **One artifact widget everywhere** (R1.3/R1.4): row body = the verb, arrow-out
    icon = the detail modal, same component in folder / chat cards / staged tray
    / chapter strip / mirror. Chat cards have *no* modal route today.
15. **Retry must not carry un-welded attachments** (V1.3): `sendQueue.ts:296/310`
    commits staged items only on the new-send branch while compile reads them
    anyway → sent, unrecorded, re-sent. Product call open (ledger §Open 2).
16. **`Write it` must not change the cut** (V1.4): on `full → summary` seals it
    silently downgrades to `description` (17 fewer tokens, masked by item 11).
17. **350px header** (V1.6): `Full` chip clipped, fold control off-screen inside
    `overflow-hidden`; add a *clipped-inside-overflow* geometry check to the audit
    (it currently only checks touch size + document scroll).
18. **Summarize: timeout + abort + visible failure** (V1.7) — also the source of
    the console error that makes the evidence pack RED (V1.1). Doubles as item 9's
    Regenerate.
19. **Taste/hygiene pass** (R1.6 + V1.8): one token count, one message counter
    (`msg N`, 1-based), legacy attachments say "from the start of this chat",
    dead `TTS_VOICES` / `estimateChapterCutTokens`, the duplicate
    `GranularityChips` in `MirrorPanel`, orb gets role/keyboard/aria, modal gets
    provenance, ≤390px pill band.

---

## Open — decided or discovered, not built

### 1. Chapters have no summary until someone presses Summarize
A chapter closes on a topic shift; nothing summarizes the chapter that just
ended. `description` is seeded by the model's topic-shift turn, `summary` is
only produced by the explicit `/api/summarize-chapter` call. A closed chapter
therefore often sends `title + description` while claiming granularity
`summary` (the mirror shows the real token cost, so it is not a lie — but the
level is empty).
**State after 10:** a *manual* split fires the background summarize for the
chapter it seals, and clicking `Description`/`Summary` on a chapter missing
that layer fires it too. A chapter sealed by the model's `<topic_shift>` inside
the stream is still not auto-summarized (summarize is active-thread-only
today). Those show the honest "No summary yet" chrome.
**Options left:** a thread-aware summarize call in the queue (costs one call
per chapter boundary — a money decision), or lower the sealed default to
`description` when no summary exists. Not decided — and note the second option
is now partly moot: since 2026-10-21 (top of this file) a closed chapter does
NOT drop to a lower cut at all; it stays Full until the user moves it, so the
"level is empty" problem only appears when the user asks for a layer nobody
wrote (which the "Write it" chrome handles honestly).

**Law added 2026-10-21 (David): the last TWO chapters are in progress.** They
are forced to Full, their cut controls are replaced with an "In progress ·
Full" badge (chat header and mirror), and `handleSummarizeChapter` refuses them:
a chapter you are still talking inside is not one to cut or recap. The
background summarize on a manual split now targets the chapter that just
LEFT the window (it is the one whose sealed cut starts promising layers), so
nothing summarizes inside the window. `isChapterInProgress` /
`resolveChapterSendGranularity` in `02-chapter-segmentation/selectors.ts` own
this; `isChapterOngoing` stays purely geometric (turn ownership never moves).
Evidence: J04 now makes four chapters, J16 asserts the badge and the hidden
chips; `src/tests/chapter-in-progress.test.ts`.

### 2. Import/extraction prompts don't state the cut contract — CLOSED 2026-10-21
**Measured, then rebuilt.** The prompts asked for "a few phrases" and "a few
paragraphs"; the export showed 31-token descriptions, 151-token summaries, 33 of
41 summaries opening by restating the description, and imported bodies that had
kept 59% of their source files. The layers are now four distinct jobs at four
scales, the prompts say the layers are read together in order, JSON is gone from
every LLM call (sentinel `=== HEADER ===` blocks), and the body is spliced from
the uploaded file instead of being retyped by the model.
Evidence: `src/tests/compaction-prompts.test.ts`, design-docs/09 §"The
compaction contract".

#### 2b. NEW — the subtitle is a layer, and every row shows it
The old one-sentence `description` was the missing half of a title: a bare
four-word name told the reader (and the model) nothing, and ~40 tokens is free.
`subtitle` is now a layer sent with the title at the `title` cut, rendered inline
in every row (`title — subtitle`, two lines, italic hook), and legacy notes get
it on hydrate from a short description. Re-importing the surviving source files
is still the only way to recover the content the old imports dropped.

### 3. Terminology sitting (unchanged)
`TERMINOLOGY.md` §1–§5 inventory is still the agenda. §0 (granularity /
attachment / artifact / Focus eradication) is now *code*, not prose. Remaining
offenders: tier/level in stale docs, workspace vs project, control mode,
compaction (display vs payload), telemetry (numbers vs ambient).

### 4. Model picker vs "no model selection"
`TERMINOLOGY.md` §0 kills model selection ("it's Gemini Flash Lite"). The
sidebar model picker and `/api/models` still exist (journey 11 exercises them).
Remove when the provider story settles — it is a UI + server contract change,
not part of the attachment work.

### 5. Chat shows turns even when the chapter isn't sent that way
**SUPERSEDED 2026-10-20** — the chat body now renders exactly the cut (doc 10).
Kept here so the old objection is on record: it was rejected because legacy
chapters often have no summary "which would hide content behind nothing". The
resolution was chrome, not a lie: a missing layer renders a "No summary yet —
[Write it]" prompt, so nothing hides behind nothing.

### 6. `full` sends the whole cut (Option A) — token cost
Confirmed by David (2026-10-19): at `full`, title + description + summary +
body / verbatim turns are all sent, because the layers are written to be read
together. If real artifacts turn out to repeat themselves, revisit whether
`full` should drop the summary layer.

### 7. Detail modal edits only the body
`ArtifactDetailModal` shows description/summary but the editable field is the
body (raw YAML/rendered). Editing the description/summary layers by hand is
not wired. Low priority; imports set them.

### 8. No detach once committed (accepted, not a bug)
Attaching is one-way **at the moment it is sent**: staged items are freely
removable (they haven't happened yet), committed ones are welded to a turn
(`turnIndex`) and expose granularity only (doc 10 §2 L2). Artifact deletion
garbage-collects attachments everywhere. Floor = title. If "sent forever" gets
annoying in practice, that is a new feature (an excluded state), not a fix.

### 9. No "Regenerate" next to a chapter's token count
`Write it` appears only when the promised layer is missing. A summary that has
gone stale (or was written from a thinner chapter) has no re-run affordance in
the header yet — `/api/summarize-chapter` is already there to call.

### 10. The graph lens is not a picker
Staging lives in the folders lens (the rows). The graph renders nodes with no
attach state — fine for now (it is the forest view), but a node with a "what
does this cost me in this chat" ring would be the natural next step.

---

## See also
- `11_DESIGN_LEDGER.md` — **external verdicts** (David's feedback rounds,
  review reports) with verdicts + measurements. Every round lands there before
  any of it is built; the actionable subset lands here.
- `scratch/pending.md` — live state, newest first.
- `STATUS.md` — cold-start snapshot + queued decisions (keyPoints, over-budget,
  tokenCeiling, 24px pass). Note: keyPoints are now **deleted** (were never
  sent); over-budget + tokenCeiling setter remain open.
- `09_CHAT_ARTIFACTS_PAYLOAD.md` — the reshape this slice implements.
