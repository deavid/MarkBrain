# TODO / BUGS — the pickup file

> **What this is:** the plain, current list of things *known broken, known
> missing, or decided-but-not-built* — written so anyone (human or AI) can pick
> up slack without re-reading the whole doc set. One item = enough context to
> start; keep items short and concrete, delete them when done.
>
> **What this is not:** the live project state (that's `scratch/pending.md`) or
> the architecture story (`STATUS.md`, `09_…`). When in doubt, an item here
> should cite the doc or decision that spawned it.
>
> Born 2026-10-19, David: *"note it down in design-docs in a new file for
> bugs/todo or something like that. Someone will pick up the slack soon."*

---

## Decided, not built

### 1. Compiler: give chapters real granularity (four values), not a two-branch guess
**Spawned by:** David, 2026-10-19 — *"Machine needs to do four, not two"* and
*"App is not even near production… no state to conserve. We get to decide
everything."*

Today `03-optical-compiler` knows exactly two shapes for a chapter — verbatim
turns for the open chapter, summary for every closed one. The rule in code
(`02-chapter-segmentation/selectors.ts` `isChapterOngoing`):
`status === 'active' || index === chapters.length - 1` → full, else summary.

Target: granularity **title / description / summary / full** (David's words;
"description" replaces the old "abstract"). **No hidden/excluded state**
(decided 2026-10-19) — a chapter is either in the chat or it isn't.

Blockers/notes:
- `ChapterPartition` has `title` + `summary` (+ stored-but-never-sent
  `keyPoints`) — **there is no short-description field**. Needs one (or a
  derivation) before "title + short description" is honest.
- The compiler needs a per-chapter level decision (user-forced or auto) wired
  into `chapterBreakdown` telemetry so the mirror/control rows stay truthful.
- Ties into the keyPoints send-or-stop decision (`STATUS.md`) — what lives at
  the "long summary" level depends on it.

### 2. Chapter row: label → real granularity control
**Spawned by:** the same conversation. Once (1) lands, the chapter row's
read-only label becomes the actual menu (the four granularities). Until
then the row shows the level as status only — **do not ship a menu the compiler
can't honor** (that's the killed compression-toggle lie, `corrections.md`).

### 3. Terminology pass
**Spawned by:** David, 2026-10-19 — *"maybe I need to sit down to redo all the
terms and meanings because it's all messed up."*
**Inventory written:** `design-docs/TERMINOLOGY.md` — every term, meaning today,
where it stretches, candidates, plus the 5 worst offenders. Next: David sits
and settles it term by term. Not decided.

### 4. Chapter resolution rule — extend & refactor
**Spawned by:** David, 2026-10-19 — the current rule (`isChapterOngoing`:
`status==='active' || last chapter` → verbatim, else summary) *"makes sense…
it's simple, it's not enough… needs to be extended and refactored entirely at
some point."* Ties to item 1: the rule must become a real per-chapter level
decision (four levels + hidden), not a two-branch guess.

### 5. Attachment model — granularity per chat
**Spawned by:** David, 2026-10-19 — *"the granularity belongs to the attachment
in the chat, not to the artifact on itself."*
An **attachment** = (chat, artifact) with its own granularity: title /
description / summary / full. Same artifact, different chats → different
granularities. **Nothing in the code models this today**: the compiler computes
granularity from graph distance, and there is no attachment entity. This is a
data-model change (persistence + compiler + control surface), not a UI tweak.
**No detach** (David, 2026-10-19) — attaching is one-way for now; the only knob
is granularity, floor *title*.

### 6. Remove the Focus machinery (pin / distance / radius)
**Spawned by:** David, 2026-10-19 — Focus is eradicated (`TERMINOLOGY.md`
§Eradicated). The compiler's `focalIds`, `TierReason`
(pin/fallback/ancestor/radius/culled), the distance/radius BFS, and the
detail-modal / tree **pin** UI are all the unborn Focus feature. They come out
of the compiler and the UI, replaced by manual per-attachment granularity.
Don't surface them — remove them.

---

## Bugs

*(none recorded yet — but note `09` §1c open problem #1, the in-turn vs
attachment duplication, which will bite at implementation.)*

---

## See also
- `scratch/pending.md` — live state, newest first.
- `STATUS.md` — cold-start snapshot + queued decisions (keyPoints, over-budget,
  tokenCeiling, 24px pass).
- `09_CHAT_ARTIFACTS_PAYLOAD.md` — the chat/artifacts/payload reshape this
  file's items 1–2 come from.
