# 11 — The Design Ledger

> **What this is:** the tracker for *external verdicts on this UI* — David's
> feedback rounds and the review reports (Vega, and whoever comes next).
> Findings are kept forever: they get **closed**, never deleted.
>
> **What this is not:** the live state (`scratch/pending.md`), the pickup list
> (`TODO.md`), or the spec (`10_ATTACHMENT_TIMELINE.md`, `09_…`). This file
> remembers **what was said about us and what we decided about it.**

---

## How an entry reads

```
ID · SOURCE · SEVERITY · VERDICT · STATUS · one line
```

- **SEVERITY**: `S1` breaks a promise we made in a doc · `S2` broken/no-way-out
  · `S3` taste / hygiene.
- **VERDICT**: `ACCEPT` · `ACCEPT-CHANGED` (with what changed) · `DISPUTE`
  (with the argument) · `DEFER` (with the trigger that would revive it).
- **STATUS**: `open` · `fixed` · `verify` (built, needs another pair of eyes)
  · `wontfix` (with the reason).

**Standing law for this file: a review finding is hearsay until I reproduce it.**
Every entry below that says *reproduced* was checked against the code
(`file:line`) or the running app, not taken on faith — including the ones where
agreeing was the easy move. When a review is wrong, that gets written down too;
an unchallenged review rots into folklore.

**Status 2026-10-20 evening: R1 and V1 are CLOSED.** Everything accepted below
is built — the built list, including the four places where execution deviated
from the plan, is `12_PLAN_OF_RECORD.md` §18. The entries stay as written (a
ledger closes findings, it does not rewrite them).

**Round index**

| id | when | source | what |
|---|---|---|---|
| R1 | 2026-10-20 evening | David, in chat | colours over the top · row click · the rail · taste |
| V1 | 2026-10-20 | *Review (via AI Agent Vega)*, `dev-altair` → `dev-vega` | gates, one S1 (cut lie), five S2s, hygiene |

---

# R1 — David, 2026-10-20 evening: "these bright colours are over the top"

The feedback arrived as prose, not as bullets; what follows is my reading of it,
in the order he gave it, with the decision I take out of each.

## R1.1 — The colour law is inverted: bright fields out, bright *ink* in · ACCEPT · open

His words: *"These bright colors should be for the circle. I don't like them for
the background. Let's use a dark color always for the background, bright text; at
all times. Let's just make it very clear which ones are not selected by making
these bg colors just a bit brighter than the others, and the circle really
punchy when it's in, and black or maybe dark grey when it's not. It's a bit over
the top."*

He is right, and the measurement backs him: the previous build filled whole rows
with `#f87171` / `#fde047` / `#4ade80` / `#67e8f9` and flipped the text dark.
Six bright plates in one column is a fairground, and it inverted the hierarchy —
the *active* chip (same fill as its own row) measured **1.34:1**, the weakest
thing on the row (V1.5).

**The law, v2 — one sentence each:**

- **L0 · Colour is a stroke and a light, never a field.** Hue appears as the dot,
  the left rail, chip ink, and a hairline ring. Never as a fill behind text.
- **L1 · One filled thing per row: the dot.** A row may carry exactly one
  saturated blob. That blob *is* the state.
- **L2 · Dark plate, bright ink, always.** Every surface keeps a navy plate and
  light text; contrast never depends on the state.
- **L3 · Selection is a well, not a highlight.** Taking his words literally: the
  *unselected* chip sits on a plate a touch **brighter** than the selected one,
  which drops into the base and is identified by hue ink + ring.
- **L4 · Grey is the absence of state.** Not in the chat = a neutral grey dot,
  no hue at all. Hue is earned by being in the payload.

Result: the 6-state language stops being 6 bright colours and becomes
**4 hues + 1 animated colour + grey**.

## R1.2 — "The red-orange-yellow-green doesn't map" · ACCEPT-CHANGED · decided here

Reproduced as a number. Converting the shipped palette to OKLab and measuring
perceptual steps between neighbours:

```
shipped:  #f87171  #fb923c  #fde047  #4ade80
ΔEok:      0.106  →  0.188  →  0.189        ratio max/min = 1.79
```

So he felt exactly what happened: the red→orange step is *half* the size of the
other two, and the move into yellow lurches (lightness .72 → .78 → .91 → .82 —
yellow spikes, then green drops back). It was never a hue problem alone; the
lightness curve was doing most of the damage.

**The palette, v2** — even OKLCH hue steps (43° / 44° / 43°), a mild lightness
curve, and one hex per state so the dot, the rail and the ink can never drift:

| state | hex | oklch | role |
|---|---|---|---|
| Title (cheapest, best) | `#41d686` | `0.78 0.17 155` | green |
| Description | `#d4da5b` | `0.86 0.15 112` | yellow-lime |
| Summary | `#ff9d00` | `0.78 0.18 68` | orange |
| Full (heaviest, worst) | `#ff645f` | `0.70 0.19 25` | red |
| **Staged** | `#37d2f2` | `0.80 0.13 215` | cyan — the only animated one |
| **Not in chat** | `#7d8792` | `0.62 0.02 250` | grey — no hue to give |

Steps now: `0.158 → 0.150 → 0.143`, **ratio 1.10** (was 1.79). Direction he
decided: cheap = green, expensive = red.

**Honest caveat, because it will come up again:** red→green is only ~130° of
hue. Four *evenly spaced* colours inside that arc are red / orange / yellow-lime
/ green — a chartreuse in slot three is unavoidable, it is not a bug. The only
way to get a proper lemon-yellow in that slot is to let it be much lighter, which
is precisely what made the shipped ramp lurch. Even spacing and tasteful yellow
are mutually exclusive here; even spacing wins, per his instruction.

Ring/glow variants for `ring-*` and the staged halo: same hues at
`oklch(0.92 0.07 h)` → `#ffd3cd` `#e5eab4` `#ffddb3` `#c0f3d0`.

## R1.3 — Clicking a row should select it; an arrow icon opens the popup · ACCEPT · open

Reproduced: today it is backwards in the folder and *absent* in the chat.

- Folder (`ArtifactsLibraryView.tsx:185`): clicking the row body calls
  `onSelectArtifact` → `App.tsx:474` → `setSelectedArtifactId` → the detail
  modal. A click that looks like "select" opens a modal.
- Chat (`AttachmentRow` in `AttachmentControls.tsx`): the only interactive
  element is the dot and the optional `✕`. **There is no path to the detail
  modal at all** — which is R1.4.

His model, which I'm adopting as the widget contract:

> **One widget, two homes.** The same artifact row renders in the folder tree,
> in the chat (turn cards, chapter strip, staged tray) and in the mirror.
> **The row body is the verb** (not in chat → stage · staged → unstage ·
> committed → cycle the cut) — same verb as the dot, because aiming at a 10px
> dot to change your mind is not a UI. **The arrow-out icon on the right is the
> noun** (± 24px target): it opens the detail modal, always, everywhere.

Consequence to respect: the row is no longer a link, so it must stop *looking*
like one, and the arrow must be the visually obvious affordance for "more".

## R1.4 — Chat attachments must open their popup · ACCEPT · open

Falls straight out of R1.3: "I click them and I can't see the popup, I should."
`AttachmentRow` gains an optional `onOpen` and every call site that has a modal
to open passes it (turn cards, chapter strip, staged tray, folder rows, mirror).
A nil `onOpen` must be a compile-time impossibility on those surfaces, not a
silently dead icon.

## R1.5 — The 5px rail: real order, real colours, cube-root height · ACCEPT · open

Today (`src/ui/context/EdgeHeatStrip.tsx`), all three complaints are true:

- **It does not respect order.** The segments are fabricated in
  `useContextPayload.ts`: `historyTokens * 0.7` → "active chapter",
  `historyTokens * 0.3` → "older chapters", remainder → substrate. It is a
  70/30 split of a sum, not the payload. Nothing about it is chronological, and
  the title text still says *"red = Detail / Tier 3 (Focus)"* — tiers died two
  slices ago.
- **It does not use our colours.** Hardcoded `#e05a66` / `#e0b96c` / `#5d87b8`,
  the old tier rainbow, unrelated to the granularity language.
- **It is always full height**, because the three segments stretch to fill.

**The rail, v2 — "the payload, read top to bottom":**

- One segment per part of the compiled prompt, **in payload order** (system →
  substrate/notes → chapters chronologically → attachments), fed by the
  compiler's own breakdown — the same one the mirror already trusts. No
  `* 0.7`, no invented categories: if a part is in the payload, it has a
  segment; if it isn't, it doesn't.
- Each segment wears **the hue of what it is**: a chapter segment wears its
  chapter granularity hue, an attachment segment wears that artifact's hue.
  Same four hues as the dot. Read the rail, read the row, read the cut.
- **Height law** (his instruction, my reading of the arithmetic):
  `fill = min(1, cbrt(totalTokens / 1_000_000))`. At 100k tokens →
  `cbrt(0.1)` = **46.4%** of the rail. Segments subdivide *that* fill in
  proportion to their real shares. **This is the one place I had to pick a
  reading**: the alternative — each segment at its own `cbrt(tokens/1M)` — can't
  sum to ≤100% (four 100k parts → 185%) and would tear the rail on any real
  chat, so segments subdividing one fill is the only coherent version of what he
  described.

**Open, one line, see §Open to David:** the yardstick. `1M` is as instructed and
it is an honest statement ("you are a rounding error against the window"), but
against a 32k container a *full* budget tops out at 31.7% of the rail, so the
rail will spend most of its life short. My default: ship `1M`, and draw a
hairline **tick at `cbrt(ceiling/1M)`** so "where my budget is" stays visible on
the same rail.

## R1.6 — "Everything could have a lot more taste and thought" · ACCEPT · open

The concrete list I'm holding myself to (nothing here is a rewrite):

1. **Intensity is not decoration.** The `Full` rows currently read as one loud
   red wall (already flagged to him after the merge). With L1 the row is a navy
   plate and the heat lives in the dot + the 2px left rail — so a column of
   rows becomes a legible stack of small chips instead of a paint swatch.
2. **Kill the duplicated token count** on folder rows (top-right *and* after the
   chips — V1.8).
3. **One counter, one base.** `Turn N` (0-based, mixed user/assistant) vs
   `N msgs` on the same screen is two clocks. Chapters win: everything counts
   messages, 1-based (V1.8).
4. **The footer copies.** Grove of small text under rows (granularity name, cost,
   provenance) collapses into: `Full · 84 tok · msg 4`.
5. **Motion is meaning.** Staged is the only thing that animates (a slow ring
   pulse). Nothing else moves, ever — animation that isn't state is noise.
6. **Hairline discipline.** One navy (`#121c2d`) for all separators, one plate
   family (`#0a1018` → `#0d1421` → `#111a2b`) for all wells; the "just a bit
   brighter" step is always the *same* step.
7. **≤390px**: the header row must not clip (`Full` chip + fold control measured
   off-screen at 350px — V1.6). Fold the chips to their 4 hot colours + a `···`
   menu, keep the token count in the rail.

## R1.7 — "Add a file to track all of this" · DONE · this file

Adopted as standing practice: **every feedback round and every review lands here
with a verdict before any of it is built.** Linked from `TODO.md`.

---

# V1 — Review by AI Agent Vega, 2026-10-20

## V1.0 — Scope · RECORD (accepted)

`main` is an ancestor of `dev-altair`; the reviewed range is exactly **one
commit**, `741e6c7` (22 files, +2038/−472). The "146-file merge" appearance was
his worktree being behind `main`, not a large merge. Recorded so nobody later
believes a big merge happened, and so nobody re-derives it.

## V1.1 — My "evidence GREEN, 0 console errors" claim did not reproduce · ACCEPT · open

**This is my error and it is the most important line in this file.** He ran
`node scripts/evidence.cjs` twice; both RED, same cause — a console error from a
`POST /api/summarize-chapter` that was issued and never answered, then killed by
the next journey's reload. Journeys themselves 17/17, audits 0 fails.

My pack was green because the timing happened to be kind; the claim was not
reproducible, and "0 console errors" was a statement about a lucky run, not
about the code. Two things follow:

- **A gate claim is only valid for the artifact it was measured on.** The pack
  I quoted exists (`evidence/2026-10-20T09-23-38`); it is not evidence that the
  defect isn't there. When a review reports a different verdict, the review wins
  until I can show the *same* verdict.
- **The root cause is real and independent of the flake** (V1.7): no timeout, no
  abort, no visible failure. It is the sole reason both runs are RED.

## V1.2 — S1 · "What you see is what you send" is false at the Description cut · ACCEPT · reproduced · open

The exact lie, in the file that promises the opposite
(`ChatView.tsx:668–690`):

```tsx
{!isCollapsed && granularity !== 'title' && (
  <div data-testid="chapter-body" …>
    {chapter.description && ( … Description … )}
    {chapter.summary &&     ( … Summary … )}   // ← no cutIncludes() guard
```

The `cutIncludes` guards only exist in the *missing layer* chrome (`:691`). So at
the **Description** cut the payload is `<chapter granularity="description">
<title>…</title></chapter>`, the header claims the smaller number, and the body
renders the **summary paragraph**. Worse: on a chapter with a summary but no
description, the chrome says "No description yet for this chapter" *above* a
rendered summary box.

This is S1 because it is the exact defect doc 10 was written to kill. The
"honest strip" and `Recap` were removed for lying about this; a missing guard
reintroduces the same lie, one layer down. **Fix: gate both blocks on
`cutIncludes(granularity, 'description' | 'summary')`.** Journey `16-chapter-cut`
clicks Title → Summary → Full and never Description — the one cut that is broken.
Not a coincidence.

## V1.3 — S2 · Retry carries staged attachments but never welds them · ACCEPT · reproduced · open

`sendQueue.ts:296/310`: `commitStagedAttachments` runs only in the `else` (new
send) branch, while compile reads `getAttachments(threadId)` — staged included.
His capture of the live retry body is right, and I confirmed the code path:

```
trayBefore: 1 · retryPayloadCarriedBeta: true · stillStagedAfterRetry: true ·
chatMentionsAttachedOnTurn: false
```

The model receives an attachment that history says never entered, and it will be
sent **again** on the next turn. Same class as V1.2 with the sign flipped:
payload ≠ history. The same root cause bites a **queued** job: attachments are
thread-global and read at job time, not bound to the composition that staged
them, so a message queued before you staged can pick one up. Product call in
§Open to David; my default is "weld to the user turn of the job that actually
sent it" — history should record what was sent, not what was queued around.

## V1.4 — S2 · `Write it` silently changes (downgrades) the cut · ACCEPT · reproduced · open

`ChatView.tsx:707`: `handleSetChapterCut(…, chapter.summary ? 'description' : 'summary')`.
On the common `full → summary` seal (summary present, description absent), the
"Write it" that appears for a *missing description* sets the cut to
**description** — you asked to fill a gap and the chapter now sends 17 tokens
less, with V1.2 hiding the evidence that the summary vanished. The button must
never be a cut change in disguise: filling a layer and choosing a cut are two
verbs (fill → then offer the cut).

## V1.5 — S2 · Active chip is the least visible element on a bright row · ACCEPT · **resolved by R1.1, not patched**

Measured 1.34:1 (title/description/summary) and 1.46:1 (full) for active chip vs
row; the inactive chips were paler and louder, so the selection hierarchy was
inverted on the surfaces meant to teach the language. Under L0/L3 this class of
bug cannot exist: chips live on dark plates, the active one is hue ink + ring,
the inactive one is a slightly brighter plate with dim ink. Nothing to patch once
the law changes — recording it here so it isn't "fixed" twice in two idioms.

## V1.6 — S2 · At 350px the `Full` chip is clipped and the fold control is unreachable · ACCEPT · open

```
chip "full"   left 317 right 355   (viewport 350)
fold button   left 361 right 385   (entirely off-screen)
document.scrollWidth === innerWidth (cannot scroll to it)
```

`GranularityChips` root is `shrink-0` inside an `overflow-hidden` section, so the
header cannot wrap its way out. The audit missed it because it checks touch size
and *document* overflow, never **clipped-inside-overflow** controls. Partly
inherited (`Recap` sat there before), but the commit is the state of record and
it added `· N tok` to the same row. Fix with R1.6.7; add a geometry check for
"every control is fully inside its scroll container at 350px".

## V1.7 — S2 · The summarize call can hang forever and fails silently · ACCEPT · open

`/api/summarize-chapter` has **no timeout and no abort**; the SDK retries
internally. Observed: one request unanswered >40s (twice, in both his runs) and
normal latencies of 4.1s vs 15.3s on identical payloads. Client side,
`handleSetChapterCut → .catch(() => logger.error(…))` — console only. The user
watches "Writing summary…", the spinner clears, "No summary yet" returns, and
nothing explains why. This is also V1.1's console error. Minimum fix: an
`AbortController` + timeout, a visible failed state on the chrome, and a retry
button that is the same affordance for "Regenerate" (TODO.md item 9).

## V1.8 — S3 · Hygiene cluster · ACCEPT ×5, DISPUTE ×1 · open

| # | finding | verdict |
|---|---|---|
| 1 | Token count printed twice per folder row | ACCEPT — one count, R1.6.2 |
| 2 | `Turn N` is a raw 0-based user+assistant index ("Turn 8" for message 4) next to chapters' `N msgs` | ACCEPT — one counter, 1-based messages, R1.6.3 |
| 3 | Legacy hydration welds every old attachment to turn 0, so all claim "Turn 1" | ACCEPT — documented safe default, wrong provenance: render *"from the start of this chat"* rather than a false turn |
| 4 | `TTS_VOICES` dead in `ChatView.tsx:91`; `estimateChapterCutTokens` never called; two `GranularityChips` implementations (one local to `MirrorPanel`) | ACCEPT — dies in the R1.3 one-widget pass, which is the only honest way to kill the duplicate |
| 5 | `SaturationOrb` is a `<div onClick>` with no role/tabIndex/aria, while being the only route to the Mirror | ACCEPT — it's load-bearing now; give it `role="button"`, keyboard, label |
| 6 | Modal omits turn provenance though §Phase 5 asked for it | ACCEPT — `Full · 84 tok · msg 4` in the modal header |
| 7 | "Floating pills sit over the text whenever scrolled (i.e. almost always)" | **DISPUTE** — this is the chosen consequence of *no bars*, agreed with him twice, and the clearance spacer is verified at `scrollTop === 0` (journey 17). The real residue is only the ≤390px case where the pill band is proportionally huge → R1.6.7. Not a bug; a cost we chose and can afford to shrink. |

## V1.9 — What the review taught me (kept as method, not as a finding)

1. **A journey that asserts presence can never catch a lie of arithmetic.** Every
   journey was green while the Description cut was wrong: they counted elements,
   never compared *UI to payload*. **New law for the harness: every promise in a
   doc gets one journey that asserts the equality, not the presence.** The Mirror
   already exposes the compiler's own breakdown — that is the oracle; use it in a
   journey, not in a manual probe.
2. **The broken case hides in the path nobody clicks.** J16 exercised 3 of 4
   cuts; P1 lived in the fourth. Coverage means *all* branches of the axis, not
   a representative sample.
3. Vega's probe would have taken ten minutes to write as a permanent check, and
   it found a real defect that four gates missed. Adopt it; don't admire it.

---

# Open to David — RESOLVED in `12_PLAN_OF_RECORD.md` §0.4

All four open questions and three design flaws in this ledger's first draft were
reviewed and resolved during the opus pass in **`design-docs/12_PLAN_OF_RECORD.md`**:

1. **Palette correction (`12` §0.1):** `#d4da5b` (olive mustard) and `#41d686`
   (mint-cyan) in §R1.2 above were a math trap caused by anchoring green at
   `155°` OKLCH. Pulling green to true leaf green (`136°` OKLCH = `#79ca4b`) and
   yellow to warm signal yellow (`97°` OKLCH = `#e2c328`) yields **equal OKLCH
   hue steps (`+36°, +36°, +39°`) AND a `1.10` OKLab step ratio**:
   - Title: `#79ca4b` (leaf green)
   - Description: `#e2c328` (warm signal yellow)
   - Summary: `#f99014` (warm amber-orange)
   - Full: `#f45a56` (crimson-coral)
   - Staged: `#38bdf8` (punchy glowing cyan)
   - Unstaged: `#18202c` dot with `#33435c` border (dark grey / near-black)
2. **"Which ones are not selected" (`12` §0.2):** David was talking about the
   **unstaged rows in the folder**, not just chips. Unstaged rows sit on a
   slightly brighter dark slate (`#131c2e`) with a dark-grey/black circle
   (`#18202c`); selected/in-chat rows press down into the deep dark base
   (`#090f1a`) with a punchy glowing circle. Bright text at all times.
3. **5px rail order & yardstick (`12` §0.3–0.4):** Order matches `compiledPrompt`
   and the Mirror 1:1 (`system` → `attachments` in substrate order → `chapters`
   in chronological order). Height is `min(100, cbrt(totalTokens / 1_000_000) * 100)`.
4. **Retry weld (`12` §5.1):** Staged attachments on retry weld to the user turn
   preceding the retried assistant turn right before compile.
5. **350px chapter header (`12` §4.3):** Two-row layout inside the header ribbon
   (`Chapter N · Title · X msgs · Y tok · chevron` on row 1, `Title | Description | Summary | Full`
   compact chips on row 2 — `~220px` wide, zero clipping at `350px`).

# Order of work (see `12_PLAN_OF_RECORD.md` §1–§2 for exact file-by-file blueprint)

1. **V1.2** the cut guard — it is a lie in the core promise of doc 10, ~5 lines
   + the J16 Description step + the UI==payload assertion (V1.9.1). Nothing else
   gets built until the promise is true.
2. **R1.1 + R1.2** the colour law and palette — one file
   (`domains/granularity.ts`), every surface follows or is wrong.
3. **R1.5** the rail (order, colours, `cbrt`) — depends on 2.
4. **R1.3 + R1.4 + R1.6** the one widget, row click / arrow, and the taste pass
   — one slice, one journey each.
5. **V1.3** retry weld (after the product call).
6. **V1.4** `Write it` stops being a cut change.
7. **V1.6** the 350px header + the clipped-inside-overflow geometry check.
8. **V1.7** summarize timeout/abort/visible failure (+ the retry that doubles as
   Regenerate, TODO.md item 9).
9. **V1.8** hygiene.

# Verification bar for everything above

- `npx tsc --noEmit` clean · `npx vitest run` green · evidence pack with the new
  journeys, **failures first**, and the console-error count reported honestly
  (V1.1: no claim wider than the artifact it was measured on).
- Each fix ships the assertion of the promise it touches — equality, not presence.
- The 350px viewport check gains: *every control fully inside its scroll
  container*.
- The RED console error from V1.7 is gone, or the pack says why not.
