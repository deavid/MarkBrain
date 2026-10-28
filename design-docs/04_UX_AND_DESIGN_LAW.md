# 04 — UX & Design Law

> Working document, 2026-10-28. Written against the actual codebase
> (`src/index.css`, `src/domains/granularity.ts`, `src/ui/uiFontScale.ts`,
> `src/ui/context/EdgeHeatStrip.tsx`, `src/ui/context/ambientTelemetry.ts`,
> `src/ui/workspace/Sidebar.tsx`, `src/tests/design-law.test.ts`).
> Predecessors, archived: `MOBILE_UX_SPEC.md` (r4, LGTM'd and closed),
> `11_DESIGN_LEDGER.md` (§V2, §V2.1), `12_PLAN_OF_RECORD.md`,
> `TERMINOLOGY.md` (§0). **The code wins** — where this file and the code
> disagree, fix the file.

---

## §1. Mobile-First & Banned Chrome

**The phone is the primary device. Desktop is a courtesy** — not a responsive
checkbox, the actual point of the form factor. The tool has to work for
someone walking down the street with one thought they're about to lose.

**Minimum viewport: 350 × 700 px.** Below that: broken. Every design must
survive a genuinely small screen with **zero horizontal clipping** — if a
350px-wide viewport scrolls sideways, shows a clipped chip, or hides a control
behind the fold edge, the design is wrong, not the phone. (Ledger V1.6 caught
exactly this: at 350px the `Full` chip clipped and a fold control became
unreachable. That class of bug is a design violation, not a nit.)

### Banned chrome — forever

David has re-laid these down **15–20 times** against AI tools that keep
re-adding them because "apps have headers." No tool may claim ignorance:

- ❌ No top app bars.
- ❌ No sticky or fixed headers.
- ❌ No sticky footers.
- ❌ No bottom sheets. Artifact viewing is a **modal**, full stop
  (`ArtifactDetailModal.tsx`); the bottom-sheet idea was rejected by David —
  *"No. I don't. End of the topic."* Don't bring it back.
- ❌ No tab bars eating vertical space.

Vertical space on a phone is the scarcest resource in the product. Chrome
steals from the composer and the timeline, and the composer + timeline *are*
the product.

### The legal substitute: the in-flow clearance spacer

Floating top controls (hamburger, view switcher, filter pills) are allowed —
but they must live **over an in-flow scroll-clearance spacer**, with a
separator that scrolls away naturally with the content. Never
`position: fixed`, never `position: sticky`. The pattern is in the code today:
`data-testid="scroll-top-clearance"` spacers in `ChatView.tsx` and
`ArtifactsLibraryView.tsx`, where the comment reads *"No top bar and no sticky
header. The clearance spacer scrolls away; controls …"* — the spacer reserves
the space, the floating controls sit over it, and one scroll gesture returns
the full viewport to content. Nothing is pinned; nothing fights the scroll.

### Sparse desktop: accepted, every time

A decision that makes the phone better and the desktop a little emptier is
taken **every time**. Sparse desktop is accepted behaviour, not a regression.
Cramped phone is product failure. The desktop can live.

### The sacred capture flow

The interaction the entire app exists to protect:

1. Idea hits mid-walk. Open the app — **fast**. No splash theatre, no
   onboarding, no "welcome back."
2. Cursor already in the composer. Type the thought — paragraph, page,
   whatever the brain dumped.
3. Send.
4. **Close the phone.** The model hasn't answered; that's fine. The message
   is durable; the reply waits like email.

**Send persists before any model roundtrip completes.** The UI never blocks on
the LLM to confirm the thought is saved — bad network, bad model day, the
thought is still safe. Leaving mid-response is normal; returning shows an
honest state of how far things got. Slow replies are fine (email-grade
latency); "Thinking…" is information, not failure.

**Nothing may ride this path.** No dialogs, no tooltips, no auto-expanding
panels, no "are you sure." Anything that delays type-by-one-tap is a bug, not
a preference. The app's politeness is leaving you alone: no push, no badges,
no notification story.

### Settled placement facts (code-backed)

- **Sidebar: one visible button — the hamburger, top-left.** Not a gesture,
  not an edge-swipe; a button you can see. Decided, insisted on, fought for.
- Sidebar opens **overlay on phone, push on desktop**, switched by screen
  width. (An overlay-plus-pin-icon variant was floated and left undecided —
  not settled law.)
- Settings, granularity controls, text size — all live in the sidebar, never
  a top bar.

---

## §2. The Surface Ladder & Colour Law — "Step, Don't Stroke"

### History in one breath

The original app had **107 distinct `border-[#…]` colours across 325 uses**
in 25 files; elevation was unreadable, so a 1px line was the only instrument
left. David: *"We need to drive more tastefully via background color and less
via border. Border adds visual noise. It hurts to look at."* The de-border
sweep (Ledger V2) removed the lines; V2.1, same evening, named the principle:

> Two surfaces at the same tone with a bright 1px spike between them — the
> wireframe. Two surfaces at the same tone with nothing between them — the V2
> failure; the difference disappeared with the border. The answer is **a step
> up `_/=` or a step down `=\_`, driven with background colour and alpha**.
> The boundary is still there — it *is* the colour.

### The surface ladder (`src/index.css`, verified hexes)

Six steps, measured in **CIE L\***, not contrast ratio — near-black on
near-black renders a 1.04:1 "contrast" that is visually nothing:

| token | hex | L* | role |
|---|---|---|---|
| `surface-0` | `#0a0e1b` | 4.1 | page / canvas |
| `surface-1` | `#121526` | 7.3 | sidebar plane, chapter card (ΔL* 3.2) |
| `surface-2` | `#181c31` | 10.9 | section card, raised plate (ΔL* 3.6) |
| `surface-3` | `#1f243c` | 14.8 | hover, selected row, well (ΔL* 3.9) |
| `surface-4` | `#252c47` | 18.6 | menus, popovers, modals (ΔL* 3.7) |
| `surface-5` | `#2d3452` | 22.4 | the ceiling — never brighter (ΔL* 3.8) |

The hue is **indigo with a violet lean (hue 273)** — a navy re-saturated, not
grey. Ink tops out at `#d7ddf0` (L* 89.9); pure white is a flashlight in a
dark room and is banned. The whole app lives in a narrow band so nothing
glows: the brief is *easy to look at for hours*.

### Alpha instruments: the veil and the recess

Structural planes sit on the fixed ladder. Anything **nested inside** a plane
— chip, bubble, input, tag, key — is **alpha over whatever it hosts it**, so
it is correct on any host and can never clash:

- `veil-1` `rgb(150 165 215 / 0.06)` — one ladder rung **up**
- `veil-2` 0.115 — two rungs up; `veil-3` 0.18, `veil-4` 0.26 (the top plate's hover)
- `recess-1` `rgb(2 4 12 / 0.5)` — one rung **down** inside a card; `recess-2` 0.7

The measured claim: **one veil ≡ one ladder rung, wherever it lands**
(+3.7…+4.5 L\* for veil-1, −3.0 L\* or more for recess-1, on every host from
surface-0 to surface-3). Shadow is the third instrument, not decoration:
`shadow-lift` (raised plate: top lip + drop), `shadow-well`
(`inset 0 1px 2px` — the sunken lip), `shadow-step` (a card off the canvas),
`shadow-pop` (a modal). Where the sweep deleted a hairline, one of these
stands. Controls are **wells, not boxes**: inputs are `bg-recess-1/2 +
shadow-well`. A border colour is the **last** resort, and the only legal
colour roles are `border-line`, `border-line-soft`, `border-transparent`,
`border-brand`, `border-accent`, `border-none`.

**Enforcement:** `src/tests/design-law.test.ts` asserts **zero** hand-rolled
`border-[#…]` anywhere in `src`, only the six legitimate border roles, no
border colour without a width, the ladder's ΔL* ≥ 3 per step, and no drift
back into an unbounded background palette. `attachment-palette.test.ts`
additionally asserts the alpha instrument and the ladder cannot drift apart.
These tests are law, not lint.

### The six attachment/granularity states (`src/domains/granularity.ts`)

The cumulative cut is `title ⊂ description ⊂ summary ⊂ full`. Every state is
**always a dark plate with bright ink** — the colour lives in a saturated
state hue, as tints and as the ink of the active chip, never as an opaque
bright fill:

| state | hex | plate | ink of the active chip |
|---|---|---|---|
| **unstaged** | `#161b2e` | neutral `bg-veil-2` lift — no hue to give away | — |
| **staged** | `#38bdf8` (cyan) | `bg-[#38bdf8]/11` hover `/16` | `#7dd3fc` |
| **title** | `#79ca4b` (green) | `bg-[#79ca4b]/11` | `#a9e07a` |
| **description** | `#e2c328` (yellow) | `bg-[#e2c328]/11` | `#f0dd7a` |
| **summary** | `#f99014` (orange) | `bg-[#f99014]/11` | `#ffab5c` |
| **full** | `#f45a56` (red) | `bg-[#f45a56]/11` | `#ff9a96` |

Details that carry the law:

- **Unstaged** is a raised matte slate key whose dot is **dark grey**
  (`#161b2e` with a `#2f3a55` ring) — it must not read as a colour; it has no
  state to announce.
- **Staged** is cyan `#38bdf8` with a pulsing dot and a `0 0 10px` glow —
  "ready to send" is the loudest state on the row.
- **Selection is a well, not a highlight.** The **selected** cut chip steps
  *up* as a 22% tint of its own hue, with the hue as its ink and a soft
  hue-coloured **shadow** (never a stroke) — it reads as a pressed well
  carrying a punchy glowing dot (`bg-… ring-2 ring-…/30 shadow-[0_0_8px…]`).
  The **unselected** chip is a slightly brighter-than-nothing matte key:
  colourless `bg-recess-1` sinking with `text-ink-mute`, identical on every
  row. Six idle chips can never be six colours to read. (Ledger V1.5: the
  inverse arrangement made the active chip the *least* visible element on the
  row — fixed by inversion, not by patching.)
- Rows are alpha tints over the host (11%, hover 16%), never opaque plates,
  so the same row is correct on a chapter card, in the staged tray, anywhere.

### The 5px right-edge heat strip (`EdgeHeatStrip.tsx`)

The payload rail, top-right edge of the viewport, `absolute` (must stay out
of the main flex layout — an in-flow sibling collapses the chat viewport to
0px), 5px wide:

- **Order = real payload order:** system turn first (`#475872`,
  `SYSTEM_RAIL_HEX`), then attached artifacts in substrate order, then
  chapters chronologically. One segment per real part, exactly as sent.
- **Per-segment colour = that item's own state** — the same hex as its
  attachment state in the palette above (`railHexFor`). The rail is not a
  gradient meter; it is the payload drawn in its own colours.
- **Total height = `min(100, cbrt(totalTokens / yardstick) × 100)`**
  (`computeRailHeightPct` in `src/ui/context/ambientTelemetry.ts`; the yardstick
  is `RAIL_TOKEN_YARDSTICK` = `MAX_CONTEXT_TOKENS` = 1,000,000, from
  `src/utils/contextWindow.ts`). Cube root, so the first tokens matter and the last million don't
  dominate.
- **A 2px `min-height` floor per segment** so a Title cut (the cheapest cut)
  still shows as a visible tick — cheap things must be visible, or the mirror
  lies about smallness.

This strip and the saturation orb are the shipped first brick of the mirror
principle (§MOBILE_UX_SPEC §5): the user must be able to see, 1:1, what the
model will receive.

---

## §3. Compressive Text Size Scaling

The sidebar **"Text size"** preference (`Sidebar.tsx` → `uiFontScale.ts`),
a reading preference in `localStorage` (`markbrain:fontScale`), never
workspace data:

| label | scale | `data-font-scale` |
|---|---|---|
| Default | 1 | *(absence of the attribute — 1 is stored as absence)* |
| Large | 1.15 | `'115'` |
| Larger | 1.3 | `'130'` |
| Largest | 1.5 | `'150'` |

`applyUiFontScale` sets `data-font-scale` on `<html>` (`root.dataset`), which
selects a hand-set `--fs-*` variable table in `index.css`. Phones matter most
here: the viewport pins `maximum-scale`/`user-scalable`, so this preference is
the *only* way to turn the text up.

### Hard law 1 — the root font-size is never modified

The attribute drives a `--fs-*` table of **px** variables; it never touches
`font-size` on `:root`. Therefore **Tailwind's rem-based spacing, margins,
paddings and icon boxes never scale** — layout geometry is identical at every
size. Text grows inside fixed geometry; the UI never re-flows itself into a
different app at Largest. This is the entire reason the table is in px.

### Hard law 2 — the ladder is compressive

Each step is hand-set, and **small sizes move hardest while big ones barely
move**. The intent: tiny labels are the thing you can't read on a phone —
multiply them hard; a big heading already reads — nudge it:

| token | 1× | 115% | 130% | 150% | multiplier at Largest |
|---|---|---|---|---|---|
| `--fs-9` (text-9) | 9px | 10.5px | 12px | 13.5px | **×1.50** |
| `--fs-11` (text-11) | 11px | 12.5px | 14.5px | 16px | ×1.45 |
| `--fs-13` | 13px | 14.5px | 16.5px | 18.5px | ×1.42 |
| `--fs-15` | 15px | 16.5px | 18px | 20px | ×1.33 |
| `--text-2xl` | 24px | 26px | 28px | 30px | **×1.25** |

The same table also lifts the Tailwind named steps (`text-xs` 13.5 → 17.5px,
`text-base` 15 → 21.5px, `text-2xl` 24 → 30px at Largest) so every text
utility in the app participates — the ladder covers `text-9` through
`text-26` plus the standard Tailwind scale.

### Never `text-[Npx]`

Arbitrary pixel text classes (`text-[13px]`) are **banned**: they bypass the
table and freeze at design size, silently breaking the accessibility ladder.
Use the theme tokens — `text-9, text-10, text-11, text-12, text-13, text-15,
text-26` — which compile to `var(--fs-N)`. (The full token list is small on
purpose; if a size isn't in the table, the answer is a token, not a literal.)

**`--ui-scale`** exists for the few px-based body rules the token table
cannot reach — rendered markdown in `.md-body` (`font-size: calc(13.5px *
var(--ui-scale))`, code at 12.5px, tables likewise). `applyUiFontScale` sets
it to the raw number (1.15 / 1.3 / 1.5) alongside the attribute. New px-based
type rules must route through `--ui-scale`, not a raw px value.

---

## §4. Vocabulary Law (TERMINOLOGY §0 — decided by David, 2026-10-19)

These words are settled **in code and in UI copy**. Using the banned word in
a PR, a doc, or a label is a bug.

| Concept | The word (canonical) | Dies (banned) |
|---|---|---|
| How much of an artifact/chapter enters a chat | **Granularity** | tier, level, resolution, T0–T3 |
| The four amounts | **Title · Description · Summary · Full** (internal enum 10/20/30/100 — never shown in UI) | label, abstract, body |
| An artifact used in a conversation | **Attachment** — the artifact is *attached to* a chat; granularity lives on the attachment, **per chat** | pin, pinned, focal, focus |
| A stored thought unit | **Artifact** | note, document (as user-facing words) |
| Not in the conversation | **not attached** — there is **no state for it** | culled, out, excluded, hidden, detach |
| The code that puts text in front of the model | Context Compiler (**docs only** — **never named in the UI**; never "optical", never bare "compiler") | — |

### Focus is eradicated

**Focus** — the word *and* the concept — is killed with prejudice, and every
derivative with it: pin, pinned, focal, focus modes, depth of field,
autofocus, myopia, forest. Preserved in TERMINOLOGY §Eradicated so nobody
reinvents it by accident. What the "focus modes" actually were is now
understood correctly: they were at best **presets over the mirror** — one
auto-compaction setting deciding what resolution each chapter and artifact
enters the payload. If such a feature is ever built, it may return **only as
a described, tested feature with its own name** — never by resurrection of
the word. Likewise dead: the excluded/culled state and **detach** (an artifact
is attached or it isn't; shrink it to *Title* — the floor: a mention; too
heavy otherwise → start a new chat), and auto-compaction rules ("Focus
wearing a hat") — granularity is set **by hand**, per attachment.

### Model selection language

There are **no "presets."** Model choice is spoken of as **capability slots**
and **key tiers** — never "preset", never a picker with cute names. (Today:
Gemini Flash Lite; OpenRouter later.) The word "preset" was killed in the
same sitting as Focus; do not let it back in through a settings screen.

### Standing test for new UI copy

Before shipping a string, ask: could I have written it with only the left
column above? If the honest word is banned (e.g. the old instinct to write
"focus" or "tier"), the design is wrong, not the vocabulary. The words encode
decisions — *granularity lives per chat*, *there is no not-attached state*,
*nothing automatic compacts* — and breaking the words breaks those decisions.
