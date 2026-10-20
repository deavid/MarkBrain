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
  `chapter.granularity`; sealing steps full → summary and keeps a manual choice.
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
`description` when no summary exists. Not decided.

### 2. Import/extraction prompts don't state the cut contract
`/api/extract-artifact-from-file` asks for "description: a few phrases" and
"summary: a few paragraphs" separately. They are close to the cut, but the
prompt does not tell the model *not to repeat* the previous layer. Same for
`<artifact_upsert>` in the compiler's system instruction. Worth aligning when
we touch those prompts — otherwise "read together" degrades into three
restatements.

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
