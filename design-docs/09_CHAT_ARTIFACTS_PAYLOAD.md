# 09 — CHAT, ARTIFACTS, AND THE PAYLOAD (`09_CHAT_ARTIFACTS_PAYLOAD.md`)

> **r5 — 2026-10-19 night: SHIPPED.** The attachment model, the four-value
> cut, chapter granularity, the Focus eradication and the `Chat | Artifacts`
> swap are **built on `dev-altair`** (details in §11). This doc stays the
> reference for *why*; the code + its tests are the reference for *what*.
>
> **r4 — 2026-10-19 night.** **§1c is the attachment-model spec — the spine.**
> If code and §1c disagree, §1c is what we are building toward.
>
> **r3 — 2026-10-19 evening.** The object model changed (David). **Granularity
> lives on the attachment, per chat** — not on the artifact, and not computed by
> distance. "Focus" is eradicated (word + feature), as is the excluded state and
> model selection. Wherever r2 below says *pin / excluded / tier / level*, **§1b
> wins.**
>
> **r2 — 2026-10-19 midday.** Rewritten after studying `dev-orion` read-only
> (tip `519b8ce`): that branch has **mirror v1** landed — an honest,
> compiler-fed display of the payload. The r1 design (same morning) invented a
> "control mode" skeleton that mostly *already exists* there. This revision
> stops inventing and starts building on it. r1's reshape (library vs payload,
> one presence vocabulary, order doctrine) survives unchanged.
>
> Epistemic status: **[settled]** = David's own words · **[soft]** = he made a
> noise at my lean · **[mine]** = I invented it, argue freely. Motivation first.

---

## 0. Why this doc exists (the motivation, first)

The context-control surface of this product — the thing Principle 1 is *about* —
lived in a sidebar accordion: ~280px wide, 11px rows, resolution tiers hidden
behind a per-row ⋮ menu. David: *"tiny, unusable, can't control things, don't
know what I'm selecting, no easy way to select the resolution."* His own
diagnosis (2026-10-19 evening, correcting an early draft of this doc): it fails
because it's **too small, too crammed, and missing critical functionality** —
a room problem *and* a capability problem, not a placement metaphor.

Meanwhile, on another branch, the mirror ("show me what the LLM will see") was
being built as a **read-only** popup — and got honest: rows fed from the
compiler's own numbers, reasons visible, `est.` label on totals. Two
conversations walking toward the same object from opposite sides. That's how we
ended up here. This doc joins them.

---

## 1. The two objects (unchanged from r1)

**Library** — everything that exists (documents + crystallized chapters).
Durable: revisions, provenance, graph edges. Job: read, edit, see the forest.

**Payload** — what the compiler sends the LLM next turn
(`<knowledge_substrate>` notes + `<conversation_history>` chapters). Recompiled
every call, but *authored*: pins, overrides, membership are user state.

**One presence vocabulary.** A payload item — note or chapter — has membership
(in/out), resolution (Auto, or forced Full/Summary/Abstract/Label), and focal
(pin). This vocabulary **already exists in the code** (`TierReason`,
`nodeTiers`, `TIER_LABEL: Full/Summary/Abstract/Label/Out` in MirrorPanel).
We are not inventing a model; we're giving the existing one handles.

**One order doctrine [settled — David, 2026-10-19]:** *"I ACTUALLY MEAN to
reorder the chat… I also want to reorder how the LLM receives it."* Send order
= chat order. No divergent playlist. (r1's "two lenses for order" idea is
recorded as **wrong** — a shadow playlist reintroduces the exact dishonesty the
mirror exists to kill.)

---

## 1b. The shift in one breath (2026-10-19 evening — supersedes pin/excluded/tier above; full spec in §1c)

David's correction, and it changes the object:

- An **artifact** lives in the library. To use it in a conversation you **attach
  it to a chat**. The attachment is the unit, and **granularity lives on the
  attachment, not on the artifact** — the same artifact can be *title* in one
  chat and *full* in another, because those are different attachments.
- Granularity values: **title / description / summary / full** (internal enum
  numbers 10/20/30/100, never in the UI). "Tier", "level", "resolution",
  "T0–T3" are dead.
- **No excluded/culled/hidden state, and no detach.** David 2026-10-19:
  *"probably we can't detach it. Let's assume that feature won't be there."*
  So an attachment is one-way; the only knob is **granularity**, floor =
  *title* (a mention). A chapter shrinks the same way. Too heavy anyway → new
  chat.
- **Focus is eradicated** — word and feature (`TERMINOLOGY.md` §Eradicated). No
  pin, no focal, no distance-computed granularity. Granularity is **manual**,
  per attachment. The compiler's current distance/radius/pin machinery is *the
  unborn Focus feature*; it gets removed, not surfaced.
- **No model selection** (Flash Lite only) and **no auto presets**.

So the control surface is: this chat's **chapters + attachments**, each with a
**granularity** you set by hand. No pin column, no "Not included" section, no
distance reasons. (The library/payload split still stands; the sweep to strip
tier/pin/excluded language out of the rest of this doc is pending.)

---

## 1c. THE ATTACHMENT MODEL (r4 — the spec)

*The spine. If code and this section disagree, this section is what we build toward.*

### The object
An artifact lives in the library. Using it in a conversation means **attaching**
it to that chat. The **attachment** — not the artifact — carries the granularity.

```
Attachment {
  chatId:      string         // the chat (thread) it belongs to
  artifactId:  string         // the artifact in the library
  granularity: title | description | summary | full
  addedAt:     number         // when it was attached
}
```

Stored per chat: `chat.attachments: Attachment[]`. An artifact attaches to a
chat at most once. Worked example (David's): Chat A attaches Artifact C at
**title**, Chat B attaches Artifact C at **full** — one artifact, two
attachments, two granularities, and neither chat modifies the artifact.

### Granularity — four values, one axis
| value | enum | artifact content | chapter content |
|---|---|---|---|
| title | 10 | `t0_label` | chapter title |
| description | 20 | `t1_abstract` (rename) | **needs a field** |
| summary | 30 | `t2_summary` | `summary` |
| full | 100 | `t3_body` | the verbatim turns |

Numbers are enum internals only — never in the UI. *tier / level / resolution /
T0–T3* are dead words.

The library stores an artifact's content at **all four** levels
(`MultiResolutionTiers`); the attachment **chooses** one. Chapters belong to the
chat and carry their own granularity, defaulting to the current rule (open
chapter → full, closed chapter → summary) and overridable.

### What the Compiler does now
For a chat, emit exactly: (1) its attached artifacts, each at its attachment's
granularity; (2) its chapters, each at its chapter granularity; (3) the system
instruction. Nothing else — no distance, no radius, no pins, no culling, no
ancestor backbone. An artifact not attached to this chat is simply not in the
payload.

### What dies (implementation hit-list)
`focalIds` · `nodeTiers` (tier/distance/reason) · `TierReason` · `culled` · the
BFS radius walk · ancestor-backbone rescue · `tierOverrides` · the recency-boost
rule. The **graph stays** — it's the forest view (the graph lens) — it just
stops deciding context.

### How attachments appear
- `[+]` picker in the chat → attach (multi-select). **Default granularity:
  full** — *"you attach something because you want the LLM to read it."* You
  drop to summary/description when reclaiming space.
- Extracting an artifact from the conversation → **auto-attaches** to the chat
  it was born in, at *full* — but see the **duplication problem** below.
- Import (markdown / Drive) → lands in the library, not attached. The four
  levels are generated here.
- **No detach** (decided). One-way. The only knob is granularity, floor =
  *title* (a mention). Too heavy anyway → new chat.

### Resolved in r4
- Default when you attach by hand: **full**.
- Same artifact twice in one chat: **no** — raise the granularity instead.
- A chapter can be *title* only: **yes** — that's how you shrink a chapter.
- Order: attachments in attach order, then chapters in chat order (send order
  unchanged); reorder stays deferred (§5).
- The four levels are generated **at artifact creation** (import / extraction).

### Open problems — write down now, solve at implementation
1. **Duplication: the artifact the model wrote in-turn vs the attachment.**
   If the model emits an artifact inside a turn and we also attach it, the
   payload must not carry it twice. David's shape: attach it *after*, but mark
   the turn (*"this turn already contains artifact X at version Y"*) so the
   Compiler **suppresses the attachment while that turn is still verbatim in
   context** — and the attachment **reappears** once the chapter is summarized
   and the turn is gone. The UI side is the mirror of this: we strip the
   model's raw chunk to keep the pretty view, but **the model learns the
   attachment format from whatever stays in the transcript** — strip it and it
   will imitate the other format instead. Format and suppression are one
   problem, not two. *(David, 2026-10-19: "needs more discussion… write it down
   as an open problem to be solved later when implementing.")*
2. **The cut at *full*** — body alone vs the whole chain (see above).
3. **Who writes a chapter's levels?** Artifacts get theirs at creation/import;
   chapters are born from conversation, not import. Their *description* (level
   20) has no producer today, and their *summary* comes from the side-channel
   summarize. Needs a decision.

---

### Granularity is a **cut**, not a substitution (David, 2026-10-19)

The four values are not four alternative texts — they're layers of **one**
document, authored to be **read together**, each continuing instead of
restating:

- **title** — ~20 words
- **description** — ~200 words
- **summary** — ~2000 words

Sending at a granularity means including everything up to it:
**title → title+description → title+description+summary → (+ the body) full.**

The rule David gave: don't write three summaries that each start from scratch
(*"X is an article about Y…"* three times). Each layer adds; none repeats. It's
one text with a cut line. Those word counts are targets, not limits.

The **four levels are generated when the artifact is created** — i.e. on
**import** (and on extraction from a chat). Nothing generates them today.

*Open flag:* whether *full* means the body alone or title+description+summary+
body. For documents the body subsumes the rest; for chapters "full" is the
verbatim turns. Confirm at implementation.

---

## 2. What already exists on `dev-orion` (study notes — read before building)

`MirrorPanel` (opened by tapping the orb) is the mirror v1: a modal with

1. payload totals vs ceiling (`est.` prefixed), tier distribution;
2. **notes in context** — title, tier word, quiet *reason* badge (manual pin /
   auto focus / forced / ancestor / auto / culled), compiler-fed token count;
3. **chapters in send order** — full (n turns verbatim) vs summary only,
   compiler-fed token count;
4. raw payload (literal `systemInstruction` + `compiledPrompt`).

The numbers are honest by construction: `telemetry.chapterBreakdown` /
`noteBreakdown` are recorded from the *same XML strings* the compiler pushes
into the prompt (orion's tests enforce Σrows vs totals tolerance).

**What it deliberately is not:** interactive. Reason badges are status text, not
controls. It's a read-out.

**What it means for us:** the *display* half of the r1 "control mode" is built.
The missing half is handles. We do not design a new payload view — we give the
existing one a steering wheel.

*Also on orion (don't re-litigate):* touch targets now **fail <12px / warn
<16px — the project's own rule, chosen by David 2026-10-19** (supersedes WCAG's
16/24 advisory band, which made every pack amber forever over 10 compact
controls); first **GREEN** evidence pack landed 19:57; `keyPoints` are **not sent**
by the compiler (summary-only chapters) — a send/stop decision is queued for
David and the mirror rightly doesn't display them; package renamed `markbrain`;
`STATUS.md` exists there as the cold-start snapshot (scratch/pending.md wins on
conflicts).

---

## 3. The surfaces (r2)

```
orb → Mirror (read · 1:1 · popup)          ← exists on dev-orion
        └ "Steer" → CONTROL MODE (edit)    ← the work to do
Chat ←——clean swap——→ Artifacts (library: folders | graph)
 [+] picker (library → payload)            ← the work to do
```

### Chat — conversation (default). Capture path sacred. Unchanged.

### Mirror (popup) — read-only, stays pure.
Its claim is "same order, same contents." Keep it non-interactive: the moment
it grows handles, it stops being a mirror and becomes an editor, and we lose
the one surface that can honestly say *this is what gets sent*. Orb popup also
keeps its stats job (tap-orb = first brick, already shipped).

### Control mode — the editable mirror **[settled: "more or less what I had in mind"]**
Entered from the mirror ("steer") and/or the sidebar. **Full-swap surface**
(David chose clean swap; and a max-w-md modal is not a cockpit at 12+ rows).
Renders the same rows as the mirror — notes block, chapters block, in send
order — with handles:

- per-row **word-chip**: Full · Summary · Abstract · Label · Out · Auto
  (Auto = compiler's depth-of-field; explicit = forced override — matches
  `TierReason: override` exactly). Rows wear their resolution: the row *is*
  that much text. No dials. *(Words match MirrorPanel's `TIER_LABEL` — one
  naming. r1 said "Title"; the code says "Label"; we use **Label**.)*
- per-row **pin** (focal) — the existing stronger gesture.
- below the send-order list, a quiet **"Not included"** section (the Out ones)
  so you can bring things back. The list *above* remains the 1:1 payload; the
  section below is clearly not-sent. This keeps the mirror's honesty claim
  intact while giving the cockpit a place for the out-list.
- `[+]` opens the **picker** (phone: full-screen multi-select; desktop: popup —
  David's own counter-example) — membership only, default in at Auto.
- **reorder: deferred** — §5.

One home for granularity: here. **[soft→argued]** The library stays clean.

### Artifacts — the library. Clean swap **[settled]**
- **Folders lens** — the tree promoted to full size (search, groups, readable
  rows). Find things, open them.
- **Graph lens** — SpatialGraph, full size. The forest (Mode 3). No investment
  in its internals — just a home.
- Reading/editing stays the existing modal ("modal, full stop"). Library shows
  maybe a quiet "in payload" dot **[soft]**, nothing more.

### Sidebar
Tiny artifacts tree **dies**. Its jobs split: *control* → control mode;
*browse* → Artifacts surface. Sidebar keeps project/threads/settings/I/O.

---

## 4. The one honest gap I found (scoping — this bites)

**Notes are ready for handles. Chapters are not.**

*David's correction, 2026-10-19 evening:* a chapter should have **four levels** —
title / title + short description / + long summary / full verbatim — possibly a
fifth, **hidden** (excluded from the payload), which he hasn't decided he wants.
What actually exists today is narrower: `ChapterPartition` carries `title` +
`summary` (plus a stored-but-never-sent `keyPoints`), there is no "short
description" field, and the compiler emits only **two shapes** — full turns for
the active chapter, summary for every closed one. So the four levels are his
*intent*, not current data; the gap is the missing short-description level plus
the compiler learning to emit each level on demand (that's §8.4).

The compiler today gives notes full T0–T3 + culled + override + reasons. But
chapters are **binary**: active chapter → `tier="3" full`, closed chapter →
`tier="2" summary`. There is no per-chapter override, no T0/T1 chapter, no
chapter culling. So:

- Resolution handles on **notes** = UI work on existing compiler state.
- Resolution handles on **chapters** = **compiler feature work** (chapter tier
  overrides, chapter Out/culling, probably `chapterBreakdown` carrying the
  forced tier). Until that lands, chapter rows can honestly show only
  full/summary/Auto. Don't fake the rest. *(Build items for the four-level
  chapter model + its row control: `TODO.md` items 1–2.)*

Adjacent, from orion's queue: **keyPoints send-or-stop** is a payload-content
decision that will change what "Summary" even contains. Decide it before we
polish the Summary row.

---

## 5. The deferred reorder (worm list — for the record)

Intent **[settled]**: reordering edits the chat; the model receives it moved;
one order. Implementation **[deferred — can of worms, David's own call]**:

1. Chapter windows are index pairs — permuting turns breaks every window.
2. Causality — replies are downstream; reordered transcripts show answers to
   questions not yet asked. Unknown effect on the model; experiment, don't spec.
3. The active window assumes "the end"; the stream appends.
4. Provenance ranges break on index moves (IDs survive).
5. Move granularity: chapter-blocks first, turn-level never (my lean).
6. Timestamps stay creation times; reorder ≠ rewrite history.

No partial "payload-only reorder" sneaks in under the mirror's nose — it
violates the order doctrine.

---

## 6. Where the three modes land (from `motivation.md`)

| mode | home |
|---|---|
| 1. Chat → extract → repeat | chat (furnace); extraction → library, `[+]` → payload |
| 2. Pull related context | future auto-membership, user-knobbed — visible in control mode as Auto rows with `reason: radius`-style badges |
| 3. Organize from above | Artifacts → graph lens |

Control mode is the supervision surface for all three.

---

## 7. Supersessions & doc hygiene

- **`02_UI_REFACTOR_PLAN.md`** — partially superseded (header note added 2026-10-19):
  "only permanent view" reversed *deliberately* (Artifacts = first-class swap
  surface; chat gets control mode). ArtifactsDesk kill survives narrowly (no
  filing desk; a library + a picker is not that desk).
- **`01_requirements_and_meta.md` §4.11** — "ordering" clarified = chat reorder,
  deferred (clause added 2026-10-19).
- **`MOBILE_UX_SPEC.md`** — closed (r5+ only). Its "control the ordering" is
  interpreted here (§1 order doctrine) so nobody builds a playlist.
- **`CONTEXT_COMPILER.md`** — unchanged; its vocabulary is what we put handles
  on. Will need a § for chapter tier overrides when §4's compiler work starts.
- **`STATUS.md` (orion)** — will need a "what changed" pass when this lands;
  it's orion's file to update, not something to edit across branches.

---

## 8. Build-on plan (work happens *on top of* `dev-orion`)

David: *"we need to plan to work on top of that work anyway."* Git state is
his (branches/worktrees are David's to merge — agents don't touch git outside
their own worktree+branch). Design assumption: **the base is orion's tip
(`519b8ce`)** — MirrorPanel v1, breakdown telemetry, touch-target fixes,
98/98. In a merge, take orion's MirrorPanel + optical-compiler wholesale
(honest rows beat the re-estimating originals).

**Phase shape [mine — argue the order]:**

1. **Handles on the rows, control mode surface** — the word-chip + pin + Out
   section + "Steer" from the mirror. Notes fully; chapters honestly limited
   (§4). This is the pillar getting its hands.
2. **`[+]` picker** — membership from the library (phone full-screen / desktop
   popup).
3. **Artifacts clean-swap surface** — folders|graph promotion, tiny tree
   deleted. (Cheap-ish: components exist; it's layout + IA.)
4. **Compiler: chapter tier overrides / culling** — unlocks full chapter rows.
5. **Deferred:** reorder (worms), presets (experiment after all this),
   keyPoints content decision, auto-pull (Mode 2).

Every UI step rides the evidence-pack law (tsc · vitest · `scripts/evidence.cjs`).

---

## 9. Naming debt (small, noted so it stops leaking)

The same object is called **artifact** (tree, domains, UAD), **note**
(MirrorPanel, compiler `noteBreakdown`), and **document**/spec in older copy.
Mirror's UI word is "notes." Pick one for UI copy before building rows twice;
my lean is whatever David calls them when he yaps — probably *artifacts*, with
"note" demoted to flavor. One line of decision, not a religion.

---

## 10. Open questions (revised — fewer than r1)

1. **Control mode entry** — "Steer" from the mirror popup, sidebar toggle, or
   both? Lean: both (mirror for discoverability, sidebar for muscle memory).
2. ~~lie-by-omission~~ **withdrawn** — the mirror *is* the "show me the notes"
   surface, by design (its whole job). The conversation stream doesn't need
   substrate cards; §3 keeps the mirror pure instead. Revisit only if the flip
   into control mode starts feeling like a tax.
3. **Library `+` while reading?** Strict one-home says jump to control mode
   instead. Strictness first; loosen if painful.
4. **Chapter rows before the compiler work:** show the honest binary
   (full/summary only), or hide chapter handles until §8.4? Lean: honest
   binary — a truthful row beats a disabled fake menu.

---

## 11. What actually shipped (2026-10-19 night)

> **Follow-up (2026-10-20):** the *surface* half of this model shipped the next
> morning — staged→committed attachments on turns, the folder row as the picker
> (6 states, dot verb), the staged tray, the chapter body rendered as the cut.
> See `10_ATTACHMENT_TIMELINE.md`. Where that doc and this one disagree about
> UI, 10 wins; the data/compiler story here still stands.

Built in one slice on `dev-altair`, gated green (`tsc`, 111/111 vitest,
evidence pack 13/13 journeys, 0 geometry fails, 0 console/page/http errors).

**Data**
- `ChatAttachment { artifactId, granularity, addedAt }` on `ChatThread`
  (`06-chat-threads`). Attach at *full*, idempotent, per chat; no detach.
  Artifact deletion purges dangling attachments (`purgeArtifact`).
- `UniversalArtifactDocument.current` is now `{ description, summary, body }`
  — the title is the artifact's own field (no duplicated `t0_label`).
  `resolution` (an artifact-level husk nothing read) is gone.
  Legacy snapshots hydrate from `t0..t3` in `stores/hydrate.ts`.
- `ChapterPartition` gained `description` + `granularity`; `keyPoints` and
  `topicShiftReason` are gone (`topicShiftReason` backfills into
  `description`, because that is what it actually was: the model's
  topic-shift *essence*, rendered as a "Shift" chip).
- `WorkspaceContainer` lost `focalArtifactIds`, `tierOverrides`, `opticalMode`.

**Compiler** (`03-optical-compiler`)
- Inputs are `{ attachments, historyTurns?, historyChapters?, tokenCeiling? }`.
  No graph, no distance, no radius, no pins, no culling, no ancestors.
- The cut is cumulative, as decided (Option A): `title` → `+description` →
  `+summary` → `+body` / verbatim turns. `domains/granularity.ts` holds the ONE
  cut rule (`cutIncludes`), shared by compiler, previews and UI.
- `ContextTelemetry`: `attachmentBreakdown` (was `noteBreakdown`),
  `chapterBreakdown` with `granularity` (was `mode`), `granularityDistribution`.
  Rows are still recorded from the assembled XML strings, so Σrows = subtotal.

**Chapters**
- `resolveChapterGranularity(chapter, open)` — explicit wins, else open → full,
  closed → summary. `isChapterOngoing` is now purely geometric (which turns a
  chapter owns).
- Sealing (`declareNewChapter`, `splitChapter`, `closeChapter`) steps
  `full → summary` and **keeps a manual title/description choice**.
- New chapters are born `full` with the description the model emitted in
  `<topic_shift description="…">` (legacy `abstract=` accepted).
- `/api/summarize-chapter` now returns `{ description, summary }` (layers that
  continue each other), and `recalibrateSummary` writes both. keyPoints died.

**UI**
- `Chat | Artifacts` replaces `Dialogue | Spatial Graph`. Artifacts is a
  full-size library with floating `Folders | Graph` lenses; the crammed
  sidebar tree, the optical-mode toggle and the whole artifact-tier menu are
  gone. `ArtifactFolderTree` is deleted.
- Chapter rows carry the four-word granularity control; the chat shows an
  honest strip when a chapter is sent below `full` (the messages stay readable
  — scroll is not compaction — but the payload is the mirror's job).
- Mirror is the steering wheel now: totals, attached artifacts (each with its
  granularity control + token cost), chapters in send order (same control),
  `[+ Attach]` picker, raw payload. No reason badges, no out/culled section.
- Artifact detail: "Attach to this chat" + the four-word control replaces
  pin/tier. The library itself has no context controls.

**Known gaps** (`TODO.md`): closed chapters may have no summary until someone
presses Summarize; import prompts don't yet state the cut contract; model
picker still exists although "no model selection" was decided.
