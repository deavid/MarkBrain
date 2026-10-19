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

## Open — decided or discovered, not built

### 1. Chapters have no summary until someone presses Summarize
A chapter closes on a topic shift; nothing summarizes the chapter that just
ended. `description` is seeded by the model's topic-shift turn, `summary` is
only produced by the explicit `/api/summarize-chapter` call. A closed chapter
therefore often sends `title + description` while claiming granularity
`summary` (the mirror shows the real token cost, so it is not a lie — but the
level is empty).
**Options:** auto-summarize on seal (costs a call per chapter, background),
or lower the default for a summary-less chapter to `description` on seal.
Not decided.

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
Deliberate call in this slice: the chat stays the conversation (scroll is not
compaction) and shows an honest strip — *"Sent to the model as Summary — these
messages are shown for reading, not sent."* The mirror is the payload.
Alternative (chapter body renders its cut) was rejected for now because legacy
chapters often have no summary, which would hide content behind nothing.
Revisit if the strip reads as noise.

### 6. `full` sends the whole cut (Option A) — token cost
Confirmed by David (2026-10-19): at `full`, title + description + summary +
body / verbatim turns are all sent, because the layers are written to be read
together. If real artifacts turn out to repeat themselves, revisit whether
`full` should drop the summary layer.

### 7. Detail modal edits only the body
`ArtifactDetailModal` shows description/summary but the editable field is the
body (raw YAML/rendered). Editing the description/summary layers by hand is
not wired. Low priority; imports set them.

### 8. No detach (accepted, not a bug)
`TERMINOLOGY.md` §0: attaching is one-way, floor = title. Artifact deletion
garbage-collects dangling attachments. If "attach forever" gets annoying in
practice, the change is a new feature, not a fix.

---

## See also
- `scratch/pending.md` — live state, newest first.
- `STATUS.md` — cold-start snapshot + queued decisions (keyPoints, over-budget,
  tokenCeiling, 24px pass). Note: keyPoints are now **deleted** (were never
  sent); over-budget + tokenCeiling setter remain open.
- `09_CHAT_ARTIFACTS_PAYLOAD.md` — the reshape this slice implements.
