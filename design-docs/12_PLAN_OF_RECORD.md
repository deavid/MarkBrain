# 12 — Plan of Record: Dark Plates, Punchy Dots, One Widget, Honest Rail

> **Status:** Plan of Record (PoR) — ready for mechanical execution.
> **Author:** Altair (opus pass — self-review of `11_DESIGN_LEDGER.md` + concrete execution spec).
> **Supersedes:** the colour palette, widget surface, and rail portions of `10_ATTACHMENT_TIMELINE.md` and `11_DESIGN_LEDGER.md` where they differ.

---

## 0. Brutal self-review of what I wrote in `11_DESIGN_LEDGER.md`

Before writing a blueprint for a cheaper model to execute, I need to call out four places where my own ledger in `11_DESIGN_LEDGER.md` was either aesthetically blind, misread David's words, or punted a decision back to him that I had enough information to make myself.

### 0.1 My `#d4da5b` "yellow-lime" in the ledger was colour-blind math

In `11_DESIGN_LEDGER.md` §R1.2, I picked OKLCH hues `25° → 68° → 112° → 155°` and congratulated myself on a `1.10` ΔE ratio, then added a caveat excusing `#d4da5b` ("a chartreuse in slot three is unavoidable").

That was wrong. Look at the HSL hues of what we shipped vs what I proposed:
- **What we shipped (`741e6c7`):** Red `0°` (`#f87171`) → Orange `27°` (`#fb923c`) → Yellow `50°` (`#fde047`) → Green `142°` (`#4ade80`).
  Look at the hue gaps: **`+27°`, `+23°`, `+92°`**. *That* is what David saw when he said: *"the color scheme for red-orange-yellow-green doesn't really map. There's a huge hue shift in the yellow-green side. We want the same amount of hue shift here."*
  `#4ade80` isn't leaf green — it is a blue-shifted emerald/mint (`142°` HSL / `152°` OKLCH), nearly halfway to cyan! Moving green out to `155°` in my ledger made the yellow→green chasm *worse* and turned yellow into olive mustard (`#d4da5b`) to bridge it.
- **The actual fix:** Pull green back out of cyan-mint into **true warm leaf green** (`OKLCH h=136°`, `HSL 98°` — `#79ca4b`), and keep yellow in **real warm signal yellow** (`OKLCH h=97°`, `HSL 50°` — `#e2c328`).
  Now look at the four steps in OKLCH (`25° → 61° → 97° → 136°`):
  - **OKLCH hue steps:** **`+36°`, `+36°`, `+39°`** (even to within 3°!)
  - **OKLab perceptual step distances:** **`0.137`, `0.124`, `0.130`** (**ratio `1.10`** — completely uniform!)
  - **And every colour actually looks like its name:** `#f45a56` is crimson-red, `#f99014` is warm amber-orange, `#e2c328` is golden signal yellow (not mustard), and `#79ca4b` is leaf green (not mint-teal, so it also stops colliding with `#38bdf8` staged cyan).

### 0.2 I misread David's sentence about "which ones are not selected"

Re-read what David actually wrote:
> *"These bright colors should be for the circle. I don't like them for the background. Let's use a dark color always for the background, bright text; at all times. Let's just make it very clear which ones are not selected by making these bg colors just a bit brighter than the others, and the circle really punchy when it's in, and black or maybe drk grey when it's not."*

In `11_DESIGN_LEDGER.md` §R1.1 L3, I applied that to the 4 granularity chips ("selection is a well"). **He wasn't talking about chips. He was talking about the artifact rows in the folder!**
Read both halves of his sentence together:
- *"making these bg colors just a bit brighter than the others"*
- *"and the circle really punchy when it's in, and black or maybe drk grey when it's not."*

"When it's in" vs "when it's not" = **in the chat (staged or committed) vs not in the chat (unstaged)!**
In a folder of 20 artifacts where 2 are attached and 18 are not:
- If the 2 attached rows had neon backgrounds (`741e6c7`), it's a fairground.
- Under David's design: **every row is dark with bright text**, always. The **in-chat** rows (staged + committed) sit on the deep dark base plate (`#090e18`) with a **really punchy glowing circle** (cyan when staged, green/yellow/orange/red when committed). The **not-selected (unstaged)** rows sit on a dark slate plate **just a bit brighter** (`#131c2e`) with a **near-black / dark-grey circle** (`#18202c` fill, `#2b384e` border).
- Why does that work so well? Because the unstaged rows read as **unpressed keys on a dark keyboard** (slightly raised slate `#131c2e` with a dead dark-grey LED `#18202c`), and the moment you click a row to select it into the chat, the key **presses down into the dark well** (`#090e18`) and its **LED ignites** with a punchy colour!
- And for the 4 granularity chips inside a row or chapter header: the **active** chip gets a dark tinted well + crisp coloured border + bright text + a tiny 6px dot of the granularity colour, while **inactive** chips sit on a slightly lighter neutral slate (`#141e30`) with muted-bright text (`#93a8c7`). Both surfaces obey the exact same physical metaphor: **unselected is a slightly lighter matte key; selected is pressed-in dark with a lit indicator.**

### 0.3 The 5px Right Rail (`EdgeHeatStrip`) had an order bug in my own ledger

Look at `03-optical-compiler/index.ts:253`:
```ts
const compiledPrompt = `${substrateBlock}\n\n${historyBlock}`;
```
The literal compiled prompt puts `<knowledge_substrate>` (attachments) first, then `<conversation_chapters>` (chapters).
In `11_DESIGN_LEDGER.md` §R1.5 I wrote "system → substrate/notes → chapters chronologically → attachments" (putting attachments both second and fourth!).
What is the order the user experiences as "the context"?
1. **System instructions** (`systemTokens` — neutral cool slate `#475872`)
2. **Attached artifacts** in `attachmentBreakdown` order — each segment coloured by **that attachment's own state** (`staged` cyan `#38bdf8`, or committed `title` `#79ca4b` / `description` `#e2c328` / `summary` `#f99014` / `full` `#f45a56`)
3. **Conversation chapters** in chronological `chapterBreakdown` order — each segment coloured by **that chapter's own granularity** (`title` `#79ca4b` / `description` `#e2c328` / `summary` `#f99014` / `full` `#f45a56`)

That matches **both** `compiledPrompt` order (system → substrate → chapters) **and** the Mirror Panel's sections (`1 · Payload`, `2 · Attached artifacts`, `3 · Chapters, in send order`) 1:1!
And for the height:
$$\text{heightPct} = \min\!\left(100,\; \sqrt[3]{\frac{\text{totalTokens}}{1\,000\,000}} \times 100\right)$$
Wait: should the bar grow from the **top down** or from the **bottom up** (like a thermometer / fuel gauge), or top-down like a document?
In `EdgeHeatStrip.tsx`, it's a vertical strip along the right edge of the viewport (`top-0 right-0 w-[5px] h-full`). Because it maps the document order (System → Attachments → Chapter 1 → Chapter 2 → Active Chapter), **top-to-bottom** matches reading order and the scroll direction of the chat! The filled stack of total height `heightPct%` hangs from `top-0` (or sits inside the track with the dark empty remainder `#070b12` below it), and each segment's height inside the filled stack is proportional to `segment.tokens / totalTokens` (with a `min-h-[2px]` floor on non-zero segments so a `Title` cut is still visible as a crisp green tick).

### 0.4 I don't need to ask David the 4 questions — here are the right calls

David told me: *"this powerful LLM thrives much better in ambiguity, and might be your opportunity to have more thought, more taste, more opinionated stuff on your own, and after all that write a Plan of Record."*
So I am resolving all four questions here with clear product calls:

1. **Rail yardstick:** **`1_000_000` tokens (`cbrt(totalTokens / 1_000_000)`), capped at `100%`.** No gimmicky ceiling tick cluttering a 5px strip. At 1,000 tokens it's `10%` tall; at 8,000 tokens it's `20%` tall; at 100,000 tokens it's `46.4%` tall; at 1,000,000 tokens it hits `100%`. Clean, logarithmic-feeling perception, zero magic constants.
2. **Retry + queued send with staged items:** **Weld staged attachments on retry to the last user turn before the retried assistant turn.** Why? Because if the user staged an artifact and hit `Retry` (or already had one staged when retrying), the compiler *will* include it in the retry prompt; welding it to the user turn being answered keeps `payload === history` invariant 100% true and prevents sending it a second time as "staged". And in `enqueueSend` (new send), commit staged attachments when the turn is executed (already true), while in `retry` commit any staged attachments to the preceding user turn right before compiling.
3. **Row & chip plates:** **Dark base (`#090e18`) for active/in-chat rows with a punchy lit circle; slightly brighter dark slate (`#131c2e`) for unselected/unstaged rows with a near-black/dark-grey circle (`#18202c`).** Bright text (`#eef4fc` / `#d6e3f5`) at all times.
4. **350px chapter header:** **Two-row clean flex wrap inside the chapter header, with compact chips that never overflow 350px.** Specifically: the left side is `Chapter N · Title` (truncating cleanly), and the right side (`msg count · tok + 4 chips + fold chevron`) wraps onto a clean second line at narrow widths (`flex-wrap`), with `px-1.5` compact chips so `Title | Description | Summary | Full` + chevron totals `~260px` — well under `350px - 24px = 326px`! Why did it clip at `350px` in Vega's test? Because the message/token counter (`3 msgs · 34 tok`) and the 4 chips and the fold button were all in one `div` without allowing the counter and the chips to wrap separately, or `GranularityChips` + counter exceeded `326px` on a single line! Putting `N msgs · M tok` on the title row (right-aligned) and the 4 chips + chevron on the action cluster makes the widest unbreakable group `~235px`, which fits `350px` with `90px` to spare while keeping all four words spelled out in full.

---

## 1. The Exact Specification (6 Work Packages)

Execute these 6 work packages in order. Each package specifies the exact files, types, functions, and DOM attributes (`data-testid`, `data-state`, `aria-label`) so existing and new tests lock together cleanly.

---

### Package 1 — The Colour Law & Perceptually Uniform Palette (`src/domains/granularity.ts`)

#### 1.1 The 6 States: Dark Plates, Bright Text, Punchy Circles

Replace `ATTACHMENT_STATE_PALETTE` and `getGranularityChipClass` in `src/domains/granularity.ts`.
Add a `hex` and `glow` field to `AttachmentStatePalette` so `EdgeHeatStrip`, `MirrorPanel`, and inline styles can read the exact same hexes without hardcoding colours in UI files.

| State | Role | Dot Hex (`hex`) | Glow (`glow`) | OKLCH | Row Background (`rowClass`) |
|---|---|---|---|---|---|
| `unstaged` | Not in chat | `#18202c` (border `#33435c`) | `transparent` | dark grey | **Slightly brighter dark slate:** `bg-[#131c2e] hover:bg-[#18243a] border border-[#1f2d46] text-[#d6e3f5]` |
| `staged` | Armed for next send | `#38bdf8` | `rgba(56,189,248,0.55)` | `0.78 0.14 230` | **Deep dark cyan-tinted well:** `bg-[#081320] hover:bg-[#0c1a2b] border border-[#38bdf8]/45 text-[#eef6ff]` |
| `title` | Committed · Cheapest | `#79ca4b` | `rgba(121,202,75,0.50)` | `0.76 0.18 136` | **Deep dark well:** `bg-[#090f1a] hover:bg-[#0d1524] border border-[#79ca4b]/35 text-[#eef4fc]` |
| `description` | Committed · Light | `#e2c328` | `rgba(226,195,40,0.50)` | `0.82 0.16 97` | **Deep dark well:** `bg-[#090f1a] hover:bg-[#0d1524] border border-[#e2c328]/35 text-[#eef4fc]` |
| `summary` | Committed · Medium | `#f99014` | `rgba(249,144,20,0.50)` | `0.75 0.17 61` | **Deep dark well:** `bg-[#090f1a] hover:bg-[#0d1524] border border-[#f99014]/35 text-[#eef4fc]` |
| `full` | Committed · Heaviest | `#f45a56` | `rgba(244,90,86,0.50)` | `0.67 0.19 25` | **Deep dark well:** `bg-[#090f1a] hover:bg-[#0d1524] border border-[#f45a56]/35 text-[#eef4fc]` |

#### 1.2 Exact `AttachmentStatePalette` shape and classes

```ts
export interface AttachmentStatePalette {
  state: AttachmentVisualState;
  /** Canonical hex for the dot, rail segment, and mirror legend */
  hex: string;
  /** Box-shadow glow colour for punchy lit circles */
  glow: string;
  /** Solid circle dot classes */
  dotClass: string;
  /** Row / card container classes — ALWAYS dark bg, ALWAYS bright text */
  rowClass: string;
  /** Primary title text class inside the row/card */
  titleTextClass: string;
  /** Secondary description/meta text class inside the row/card */
  subTextClass: string;
  /** Tag / muted badge class inside the row/card */
  tagClass: string;
  /** Active chip classes when this granularity is selected */
  activeChipClass: string;
  /** Inactive chip classes — slightly brighter dark key so unselected is obvious */
  inactiveChipClass: string;
}
```

Use these exact definitions:
- **Unselected chip (`INACTIVE_CHIP_CLASS`) — shared across all states:**
  `'bg-[#152033] hover:bg-[#1b2940] text-[#9fb2ce] hover:text-[#e3edf7] border-[#24344f]'`
  *(Notice: `#152033` is visibly brighter than the `#090f1a` selected row well, with readable `#9fb2ce` text — contrast `> 5.5:1`.)*
- **Active chip (`activeChipClass`) per granularity — pressed dark well + punchy border + bright white text:**
  - `title`: `'bg-[#0c1f17] text-[#eefcf3] border-[#79ca4b] font-semibold shadow-[0_0_8px_rgba(121,202,75,0.25)]'`
  - `description`: `'bg-[#1f1c0b] text-[#fefce8] border-[#e2c328] font-semibold shadow-[0_0_8px_rgba(226,195,40,0.25)]'`
  - `summary`: `'bg-[#221408] text-[#fff7ed] border-[#f99014] font-semibold shadow-[0_0_8px_rgba(249,144,20,0.25)]'`
  - `full`: `'bg-[#240e10] text-[#fef2f2] border-[#f45a56] font-semibold shadow-[0_0_8px_rgba(244,90,86,0.25)]'`
  - `staged`: `'bg-[#092232] text-[#ecfeff] border-[#38bdf8] font-semibold shadow-[0_0_8px_rgba(56,189,248,0.25)]'`
  - `unstaged`: `'bg-[#0d1422] text-[#e3edf7] border-[#33435c]'`
- **Dot classes (`dotClass`):**
  - `unstaged`: `'bg-[#18202c] border border-[#33435c] group-hover:border-[#556985]'` *(dark grey / near-black when not in chat)*
  - `staged`: `'bg-[#38bdf8] ring-2 ring-[#38bdf8]/35 shadow-[0_0_10px_rgba(56,189,248,0.75)] animate-pulse'` *(punchy glowing cyan)*
  - `title`: `'bg-[#79ca4b] ring-2 ring-[#79ca4b]/30 shadow-[0_0_8px_rgba(121,202,75,0.65)]'`
  - `description`: `'bg-[#e2c328] ring-2 ring-[#e2c328]/30 shadow-[0_0_8px_rgba(226,195,40,0.65)]'`
  - `summary`: `'bg-[#f99014] ring-2 ring-[#f99014]/30 shadow-[0_0_8px_rgba(249,144,20,0.65)]'`
  - `full`: `'bg-[#f45a56] ring-2 ring-[#f45a56]/30 shadow-[0_0_8px_rgba(244,90,86,0.65)]'`
- **Text classes (bright text at all times):**
  - `unstaged`: `titleTextClass: 'text-[#d6e3f5]'`, `subTextClass: 'text-[#8499b8]'`, `tagClass: 'text-[#8499b8] bg-[#0c1322] border-[#1f2d46]'`
  - `staged`: `titleTextClass: 'text-[#f0f9ff] font-semibold'`, `subTextClass: 'text-[#93c5fd]'`, `tagClass: 'text-[#7dd3fc] bg-[#0c2236] border-[#38bdf8]/40'`
  - `title` / `description` / `summary` / `full`: `titleTextClass: 'text-[#eef4fc] font-semibold'`, `subTextClass: 'text-[#94a8c6]'`, `tagClass: 'text-[#b8cae4] bg-[#101929] border-[#22324d]'`
- **`getGranularityChipClass(target, active)`:**
  - When `active === true`: returns `ATTACHMENT_STATE_PALETTE[target].activeChipClass`.
  - When `active === false`: returns `ATTACHMENT_STATE_PALETTE.unstaged.inactiveChipClass`.
- Inside `GranularityChips` (`src/ui/context/AttachmentControls.tsx`), render a tiny `w-1.5 h-1.5 rounded-full` indicator dot inside each chip (or on the active chip) using `ATTACHMENT_STATE_PALETTE[g].hex` so even before clicking, the user sees the 4 rainbow dots (`green · yellow · orange · red`) right on the 4 buttons, and the active chip's border + dot glow in that hue.

---

### Package 2 — One Unified Artifact Widget Everywhere (`src/ui/context/AttachmentControls.tsx`, `ArtifactsLibraryView.tsx`, `ChatView.tsx`, `MirrorPanel.tsx`, `ArtifactDetailModal.tsx`, `App.tsx`)

David's instruction:
> *"The attachments in the chat, I click them and I can't see the popup, I should. In the artifact tree view, I would expect that clicking on the row itself would select it. And have maybe a big arrow out icon to see the pop-up. Maybe this navigation could be literally the same. Maybe we want same widget in both places - tree view and in chat; where an artifact, clicking cycles modes, and there's an arrow icon on the right to see details."*

#### 2.1 Upgrade `AttachmentRow` in `src/ui/context/AttachmentControls.tsx` to be the single widget

Extend `AttachmentRowProps`:
```ts
export interface AttachmentRowProps {
  artifactId?: string;
  state: AttachmentVisualState;
  title: string;
  tokens: number;
  granularity: Granularity;
  /** Clicking the row body OR the dot triggers the state verb (unstaged->stage, staged->unstage, committed->cycle). */
  onToggle?: () => void;
  onSetGranularity?: (g: Granularity) => void;
  /** Only staged rows get an unstage button; committed rows never do. */
  onUnstage?: () => void;
  /** Opens the ArtifactDetailModal (or triage modal if flagged). Rendered as a prominent ArrowUpRight button on the right. */
  onOpenDetail?: () => void;
  /** Optional description preview (used in the folder view). */
  description?: string;
  /** Optional tags list (used in the folder view). */
  tags?: string[];
  /** Optional badge text — e.g. 'msg 2' or 'start of chat' or 'next send'. */
  badge?: string;
  /** Optional flagged badge ('review'). */
  flagged?: boolean;
}
```

**Interaction & Layout rules for `AttachmentRow`:**
1. **Root element (`div`):**
   - Attributes: `data-state={state}`, `data-artifact-id={artifactId}`, `data-artifact-title={title}`.
   - If `onToggle` is provided, clicking anywhere on the row body (outside the granularity chips, unstage `✕`, or the arrow-out detail button) calls `onToggle()`. Give the row `cursor-pointer group select-none`.
2. **Left indicator (`AttachmentDot`):**
   - Renders the punchy glowing dot (or dark grey circle when `unstaged`).
   - Clicking the dot calls `onToggle()` (same verb as the row body, with `e.stopPropagation()` so it never fires twice).
   - Keep `aria-label={dotVerbLabel(state, title)}` on the dot button so `button[aria-label^="Stage"]` in Journey 14 & 15 continues to work without breaking!
3. **Center column:**
   - **Line 1:** Title (`text-xs font-mono truncate ${palette.titleTextClass}`), optional `flagged` badge (`review`), optional provenance `badge` (`next send`, `msg N`, or `in chat`), and **a single token readout** (`{formatTokens(tokens)} tok`, `text-[10px] font-mono tabular-nums ${palette.subTextClass}`).
     *(Never print the token count twice on the same row — fixes V1.8.1.)*
   - **Line 2 (optional, when `description` is passed):** 1–2 line snippet (`text-[10px] font-mono line-clamp-2 ${palette.subTextClass}`).
   - **Line 3 (when `state !== 'unstaged'` and `onSetGranularity` is passed):** `<GranularityChips ... />` (`e.stopPropagation()` on chip clicks so clicking a chip sets that granularity directly instead of cycling).
4. **Right action cluster:**
   - If `onUnstage` is passed (`state === 'staged'`), render the `✕` unstage button (`data-testid="unstage-attachment"`, `aria-label={`Unstage "${title}"`}`, `min-w-[28px] min-h-[28px]`).
   - If `onOpenDetail` is passed, render a prominent, unmistakable **arrow-out button** (`ArrowUpRight` from `lucide-react`, `w-4 h-4`) inside a `min-w-[30px] min-h-[30px] rounded-lg bg-[#141f33] hover:bg-[#1f304d] border border-[#243754] text-[#8ab1e0] hover:text-[#eef4fc]` button:
     - `data-testid="open-artifact-detail"`
     - `aria-label={`Open details for "${title}"`}`
     - `title={`Open "${title}" details`}`
     - `onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenDetail(); }}`

#### 2.2 Provenance copy: one human counter (`msg N`), honest legacy label

Fixes V1.8.2 and V1.8.3:
- Add a tiny helper `formatAttachmentProvenance(turnIndex: number | null | undefined, legacy?: boolean): string | undefined` in `AttachmentControls.tsx`:
  - If `turnIndex === null` → `'next send'`
  - If `turnIndex === undefined` or `turnIndex < 0` → `'in chat'`
  - Otherwise → `` `msg ${turnIndex + 1}` `` (and keep `Turn ${turnIndex + 1}` in `title` or aria if needed, OR wait: check `scripts/evidence.cjs` line 778: `check(/Turn\s*\d+|msg\s*\d+/i.test(rowText))` — update Journey 15 in `scripts/evidence.cjs` to match `msg \d+` or `Turn \d+`!).
- Even better: in `ThreadRegistry.ts` `normalizeAttachments`, when a legacy snapshot has `item.turnIndex === undefined`, set `turnIndex: -1` (committed prior to turn tracking, `isAttachmentStaged` is still `false` because `turnIndex !== null`), or keep `turnIndex: 0` for chapter-window matching and format `turnIndex` as `msg ${turnIndex + 1}`. Let's check: `attachmentsOfChapter` checks `a.turnIndex >= chapter.startIndex && a.turnIndex < end`. If `turnIndex === 0`, it anchors to chapter 1 (which starts at `0`), so when Chapter 1 is compacted to Title/Summary, the fixture's pre-attached artifact (`art-fx-alpha`) appears in Chapter 1's compacted attachment strip! And in `ChatView.tsx` `attachmentsOfTurn`, only match `turnIndex === globalIndex` when `a.turnId` is either matching or `a.addedAt` was welded, or let `turnIndex: 0` match `msg 1`. Wait: why did Vega say "Turn 8 for what the user counts as message 4"? Because Vega thought "msg" meant user-only messages, whereas `chapters` in `ChatView.tsx:587` literally says `{turns.length} msgs` (counting all turns, 1-based!). So using `msg ${turnIndex + 1}` makes the attachment badge and the chapter header (`3 msgs`) use the **exact same noun (`msg`) and 1-based turn count**!

#### 2.3 Wire `onOpenDetail` across all 5 surfaces

1. **`ArtifactsLibraryView.tsx`:**
   - Replace the bespoke row markup with `<AttachmentRow ... />`!
   - `onToggle={() => onToggleAttachment(art.id)}` (clicking the row OR its dot stages/unstages/cycles).
   - `onOpenDetail={() => (flagged ? onTriageArtifact(art.id) : onSelectArtifact(art))}` (clicking the `ArrowUpRight` button opens the detail modal / triage modal).
2. **`ChatView.tsx` — Staged Tray (`StagedTray`):**
   - Pass `onOpenArtifact={(id) => ...}` into `StagedTray`, which passes `onOpenDetail` to each `AttachmentRow`.
3. **`ChatView.tsx` — Turn-anchored attachment cards (`attachmentsOfTurn`):**
   - Pass `onOpenDetail={() => openArtifactById(att.artifactId)}` to each `AttachmentRow`.
4. **`ChatView.tsx` — Chapter compacted attachment strip (`attachmentsOfChapter`):**
   - Pass `onOpenDetail={() => openArtifactById(att.artifactId)}` to each `AttachmentRow`.
5. **`MirrorPanel.tsx`:**
   - Delete the duplicate local `GranularityChips` component in `MirrorPanel.tsx:78` and import `GranularityChips` from `./AttachmentControls` (fixes V1.8.4).
   - Pass `onOpenArtifact?: (artifactId: string) => void` into `MirrorPanel` from `App.tsx` (which closes the mirror and calls `setSelectedArtifactId(id)`), and wire `onOpenDetail` on both `stagedRows` and `committedRows`.
   - Update the Mirror's `granularityDistribution` legend (`MirrorPanel.tsx:246`) to use the 4 canonical palette colours from `ATTACHMENT_STATE_PALETTE` instead of the old hardcoded hexes.
6. **`ArtifactDetailModal.tsx`:**
   - Pass `attachmentTurnIndex?: number | null` into `ArtifactDetailModal` from `App.tsx`, and display the provenance (`msg ${turnIndex + 1}`) right in the modal's attachment bar (`In this chat at Full · msg 1`) — fixes V1.8.6.

---

### Package 3 — The 5px Right Rail (`src/ui/context/EdgeHeatStrip.tsx`, `ambientTelemetry.ts`, `useContextPayload.ts`)

David's instruction:
> *"The right bar that has around 5px wide, should actually map the actual context, in the same order, but it doesn't seem to currently respect order. And it should use the same color schema. Also, I think we should not map to 100% height all the time; can we compute a cube root of the factor over 1M tokens? and max out at 100% of course. So for 100k tokens, we would do cbrt(0.1) and convert to percent, that would be the height."*

#### 3.1 Exact data structure in `src/ui/context/ambientTelemetry.ts`

```ts
import type { AttachmentVisualState } from '../../domains/granularity';

export interface EdgeRailSegment {
  id: string;
  kind: 'system' | 'attachment' | 'chapter';
  label: string;
  tokens: number;
  /** 'system' uses neutral slate; attachments & chapters use their AttachmentVisualState hue */
  state: AttachmentVisualState | 'system';
  hex: string;
}

export interface AmbientTelemetryData {
  totalTokens: number;
  ceiling: number;
  saturationRatio: number;
  /** Total filled height of the 5px rail: min(100, cbrt(totalTokens / 1_000_000) * 100) */
  railHeightPct: number;
  /** Ordered payload segments: system -> attachments (in substrate order) -> chapters (in chronological order) */
  segments: EdgeRailSegment[];
}
```

Add a pure helper exported from `ambientTelemetry.ts`:
```ts
export const RAIL_TOKEN_YARDSTICK = 1_000_000;

export function computeRailHeightPct(totalTokens: number): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
  const factor = Math.min(1, totalTokens / RAIL_TOKEN_YARDSTICK);
  return Math.min(100, Math.cbrt(factor) * 100);
}
```
*(At `100_000` tokens: `Math.cbrt(0.1) * 100 = 46.415888...%`. Write a unit test in `src/tests/` asserting `computeRailHeightPct(100_000)` is `~46.42%`, `computeRailHeightPct(1_000_000) === 100`, `computeRailHeightPct(2_000_000) === 100`, and segment order matches compiler payload order.)*

#### 3.2 Build `segments` in `src/ui/context/useContextPayload.ts`

From `compiledContext.telemetry`:
1. **System segment** (if `tb.systemTokens > 0`):
   - `id: 'system'`, `kind: 'system'`, `label: 'System prompt'`, `tokens: tb.systemTokens`, `state: 'system'`, `hex: '#475872'`.
2. **Attachment segments** (for each `entry` in `compiledContext.telemetry.attachmentBreakdown`):
   - `state`: `entry.staged ? 'staged' : entry.granularity`
   - `hex`: `ATTACHMENT_STATE_PALETTE[state].hex`
   - `id: 'att-' + entry.artifactId`, `kind: 'attachment'`, `label: `${entry.title} (${entry.staged ? 'staged · ' : ''}${entry.granularity})``, `tokens: entry.tokens`.
3. **Chapter segments** (for each `entry` in `compiledContext.telemetry.chapterBreakdown`):
   - `state`: `entry.granularity`
   - `hex`: `ATTACHMENT_STATE_PALETTE[entry.granularity].hex`
   - `id: 'chap-' + entry.chapterId`, `kind: 'chapter'`, `label: `${entry.title} (${entry.granularity})``, `tokens: entry.tokens`.

Delete the fake `Math.round(tb.historyTokens * 0.7)` and `* 0.3` math completely.

#### 3.3 Render in `src/ui/context/EdgeHeatStrip.tsx`

- Track container: `className="absolute right-0 top-0 w-[5px] h-full flex flex-col justify-start bg-[#070b12] border-l border-[#101827] z-30"`
- Attributes on track: `data-testid="edge-heat-strip"`, `data-rail-height-pct={telemetry.railHeightPct.toFixed(2)}`.
- Inner filled stack wrapper:
  - `style={{ height: `${telemetry.railHeightPct}%` }}`
  - `className="w-full flex flex-col overflow-hidden transition-all duration-300 border-b border-[#1f2d46]"`
- Inside the filled stack, map `telemetry.segments`:
  - `const sharePct = total > 0 ? (seg.tokens / total) * 100 : 0;`
  - Each segment `div`:
    - `key={seg.id}`
    - `data-segment-id={seg.id}`
    - `data-segment-kind={seg.kind}`
    - `data-segment-state={seg.state}`
    - `style={{ height: `${sharePct}%`, backgroundColor: seg.hex, minHeight: seg.tokens > 0 ? '2px' : 0 }}`
    - `title={`${seg.label}: ${seg.tokens} tok`}`
- Also update `SaturationOrb.tsx` to be a real `<button type="button">` with `aria-label` (fixes V1.8.5) and use the new palette hexes (`#79ca4b` / `#e2c328` / `#f45a56`) in `computeAmbientColor`.

---

### Package 4 — Chapter Cut Truth, `Write it` Fix, and 350px Responsive Header (`src/ui/chat/ChatView.tsx`)

#### 4.1 Fix S1 (`V1.2`): Gate `description` and `summary` blocks on `cutIncludes`

In `src/ui/chat/ChatView.tsx` inside `<div data-testid="chapter-body" ...>`:
```tsx
{cutIncludes(granularity, 'description') && chapter.description && (
  <div
    data-testid="chapter-layer-description"
    className="text-xs text-[#b8cce6] leading-relaxed bg-[#0d1424] p-3 rounded-xl border border-[#141f33]"
  >
    <div className="font-semibold text-[10px] text-[#e2c328] mb-1 font-mono uppercase tracking-wider">
      Description
    </div>
    <p className="text-[#dbe7f6]">{chapter.description}</p>
  </div>
)}
{cutIncludes(granularity, 'summary') && chapter.summary && (
  <div
    data-testid="chapter-layer-summary"
    className="text-xs text-[#b8cce6] leading-relaxed bg-[#0d1424] p-3 rounded-xl border border-[#141f33]"
  >
    <div className="font-semibold text-[10px] text-[#f99014] mb-1 font-mono uppercase tracking-wider">
      Summary
    </div>
    <p className="whitespace-pre-wrap">{chapter.summary}</p>
  </div>
)}
```
Now at `granularity === 'description'`, `cutIncludes('description', 'summary')` is `false`, so the summary paragraph is **never** rendered when the cut is `Description`. What you see is literally what you send at all 4 cuts.

#### 4.2 Fix S2 (`V1.4`): `Write it` must NEVER change or downgrade the cut

Extract a dedicated helper `triggerChapterSummarize(chapterId: string)` in `ChatView.tsx`:
```tsx
const [summarizeErrorIds, setSummarizeErrorIds] = useState<Record<string, string>>({});

const triggerChapterSummarize = (chapterId: string) => {
  setSummarizeErrorIds((prev) => {
    const next = { ...prev };
    delete next[chapterId];
    return next;
  });
  setSummarizingIds((prev) => ({ ...prev, [chapterId]: true }));
  Promise.resolve(onSummarizeChapter(chapterId))
    .catch((err) => {
      const msg = err instanceof Error ? err.message : 'Summarize failed';
      setSummarizeErrorIds((prev) => ({ ...prev, [chapterId]: msg }));
    })
    .finally(() =>
      setSummarizingIds((prev) => ({ ...prev, [chapterId]: false }))
    );
};
```
- In `handleSetChapterCut(chapter, next)`:
  - Call `onSetChapterGranularity?.(chapter.chapter.id, next)`
  - Unfold: `setCollapsedChapterIds((prev) => ({ ...prev, [chapter.chapter.id]: false }))`
  - If `missingLayer && chapter.turns.length > 0`, call `triggerChapterSummarize(chapter.chapter.id)`.
- On the **`Write it` / `Retry`** button inside the missing-layer chrome (`ChatView.tsx:703`):
  - Call **`triggerChapterSummarize(chapter.id)` directly** — NEVER call `handleSetChapterCut` with a guessed granularity! The user's selected cut stays untouched while the missing layer is generated.
  - If `summarizeErrorIds[chapter.id]` is set, display `'Summary request timed out or failed.'` with button label `'Retry'`.

#### 4.3 Fix S2 (`V1.6`): 350px Chapter Header Layout (Zero Clipping)

Why did `Full` and the fold chevron clip at `350px`?
Because `GranularityChips` + `3 msgs · 34 tok` + the chevron were all inside one horizontal row that couldn't wrap cleanly inside `326px`.
Restructure the Chapter Header Ribbon in `ChatView.tsx`:
- Row 1 (`flex items-center justify-between gap-2 min-w-0`):
  - Left (`flex items-center gap-2 min-w-0 flex-1`): status dot + `Chapter N` + `<h3 className="font-semibold text-xs sm:text-sm text-[#eef4fc] truncate font-mono">{chapter.title}</h3>`
  - Right (`flex items-center gap-1.5 shrink-0`):
    - `<span className="text-[10px] font-mono text-[#758ca8] tabular-nums">{turns.length} msg{turns.length !== 1 ? 's' : ''}{chapterTokens[chapter.id] !== undefined && <> · <span className="text-[#b8cae4]">{formatTokens(chapterTokens[chapter.id])} tok</span></>}</span>`
    - Fold chevron button (when `granularity !== 'title'`, `min-w-[24px] min-h-[24px]`)
- Row 2 (`flex items-center justify-between gap-2 pt-1`):
  - `<div data-testid="chapter-cut" data-chapter-id={chapter.id} className="max-w-full overflow-x-auto">` containing `<GranularityChips compact ... />`.
  - Check the width of `<GranularityChips compact />`: 4 buttons (`Title`, `Description`, `Summary`, `Full`) with `px-1.5 text-[10px] gap-1` = `~220px` total! On a `350px` screen (`~310px` inner width), `220px` fits on a single line with `90px` to spare, and Row 1 has the title + `3 msgs · 34 tok` + chevron with zero horizontal overflow.

Also delete the dead `const TTS_VOICES` in `ChatView.tsx:91` (V1.8.4).

---

### Package 5 — Retry Weld & Summarize Timeout (`src/application/sendQueue.ts`, `src/gateway/api.ts`, `server/routes/summarize.ts`, `src/ui/chat/createChapterHandlers.ts`)

#### 5.1 Fix S2 (`V1.3`): Weld staged attachments on `retry` too

In `src/application/sendQueue.ts` inside `executeTurn`:
```ts
    let assistantTurnId: string;
    if (job.mode === 'retry' && job.turnId) {
      assistantTurnId = job.turnId;
      // If the user staged attachments before hitting Retry, they ARE about to
      // be compiled into this retry payload. Weld them to the user turn
      // immediately preceding the retried assistant turn (or turn 0) so
      // payload === history and they never stay stuck in the staged tray.
      const turns = this.turnsOf(deps, threadId);
      const retryIdx = turns.findIndex((t) => t.id === assistantTurnId);
      let anchorIdx = retryIdx > 0 ? retryIdx - 1 : Math.max(0, turns.length - 1);
      for (let i = retryIdx - 1; i >= 0; i--) {
        if (turns[i].role === 'user') {
          anchorIdx = i;
          break;
        }
      }
      const anchorTurn = turns[anchorIdx];
      const committed = deps.threadRegistry.commitStagedAttachments(
        threadId,
        anchorIdx,
        anchorTurn?.id ?? null
      );
      if (committed > 0) {
        logger.info('App', `Committed ${committed} staged attachment(s) on retry to turn ${anchorIdx}`, {
          threadId,
        });
      }
      this.updateTurnInThread(deps, threadId, assistantTurnId, {
        content: '',
        extractedArtifacts: [],
        meta: { model: ctx.model.name, isStreaming: true, streamState: 'connecting' },
      });
    } else {
```
Write a unit test in `src/tests/attachments.test.ts` (or `sendQueue` test) verifying that staging an artifact and running a retry commits the attachment to the user turn and clears `getStagedAttachments()`.

#### 5.2 Fix S2 (`V1.1` / `V1.7`): Summarize timeout, abort tolerance, and zero console-error flake

Why did `node scripts/evidence.cjs` turn RED in Vega's two runs?
1. `POST /api/summarize-chapter` had no timeout on client or server, so when Gemini hung for >40s, the request sat open until a subsequent journey navigated/reloaded the page.
2. When the page reloaded or the request timed out, `createChapterHandlers.ts:91` called `logger.error('App', 'Failed to summarize chapter ...', err)`, which prints `console.error`, which `evidence.cjs` records in `summary.consoleErrors` → **RED verdict**.

Fix both client and server cleanly:
1. **`src/gateway/api.ts` — `summarizeChapter`:**
   Add a 15-second `AbortSignal.timeout(15_000)` (or `AbortController` + `setTimeout` for broad compatibility):
   ```ts
   export async function summarizeChapter(
     params: SummarizeChapterRequest,
     timeoutMs = 15_000
   ): Promise<Response> {
     const controller = new AbortController();
     const timer = setTimeout(() => controller.abort(new Error('summarize-chapter timeout')), timeoutMs);
     try {
       return await fetch('/api/summarize-chapter', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           title: params.title,
           messages: params.messages,
           steeringPrompt: params.steeringPrompt,
         }),
         signal: controller.signal,
       });
     } finally {
       clearTimeout(timer);
     }
   }
   ```
2. **`server/routes/summarize.ts`:**
   Wrap the `ai.models.generateContent` call in a 12-second race (`Promise.race`) or `AbortController`. If the upstream model call times out or errors out during background chapter summarization, fall back gracefully to a deterministic local synthesis from the messages (first turn snippet as description + condensed turn digest as summary) OR return a clean status so the server never hangs a socket for 40+ seconds.
   Wait — think about that! If Gemini is slow or rate-limited during a background chapter summarize, returning a clean fallback or timing out in 12s means `/api/summarize-chapter` **never** hangs indefinitely.
3. **`src/ui/chat/createChapterHandlers.ts`:**
   In `handleSummarizeChapter`, if `err` is an abort/timeout or page-unload `TypeError: Failed to fetch`, log via `logger.warn` instead of `logger.error`, and re-throw (or return `false`) so `ChatView` can show the inline `'Retry'` button in the chapter chrome instead of dumping an unhandled `console.error` into the browser console!

---

### Package 6 — Evidence Harness & Unit Tests (`scripts/evidence.cjs`, `src/tests/`)

1. **Unit tests (`src/tests/attachments.test.ts`):**
   - Test the new `ATTACHMENT_STATE_PALETTE` invariants:
     - All 6 states have dark backgrounds (`#08...` / `#09...` / `#13...`) and bright text.
     - `unstaged` has a dark-grey dot (`#18202c`) and a slightly brighter row background (`#131c2e`) than committed/staged (`#090f1a` / `#081320`).
     - The 4 granularities (`title`, `description`, `summary`, `full`) have distinct hexes (`#79ca4b`, `#e2c328`, `#f99014`, `#f45a56`).
   - Test `computeRailHeightPct`:
     - `0` → `0`
     - `100_000` → `Math.cbrt(0.1) * 100` (`~46.4159`)
     - `1_000_000` → `100`
     - `5_000_000` → `100`

2. **Browser Evidence Suite (`scripts/evidence.cjs`):**
   - **Update J14 & J15** for the unified widget:
     - In J14, verify clicking the **row body** stages the artifact (or clicking the dot), and verify `[data-testid="open-artifact-detail"]` (the arrow-out button) opens the detail modal from both the folder row and the chat attachment card!
     - In J15, check for `msg \d+` (the unified 1-based message counter) on the committed row.
   - **Upgrade J16 (`16-chapter-cut`) to test ALL 4 cuts including `Description`, AND assert `UI === Payload`:**
     - Click `description` on the chapter with a summary but no description: assert `[data-testid="chapter-layer-summary"]` count is `0` (proving V1.2 is dead!) and the missing-description chrome is visible.
     - Click `summary`: assert `[data-testid="chapter-layer-summary"]` is visible and matches the Mirror's `chapterBreakdown` cut.
     - Click `title`: assert `[data-testid="chapter-body"]` count is `0`.
     - Click `full`: assert the verbatim turns are visible.
   - **Add a rail check (in J7 or J17):**
     - Verify `[data-testid="edge-heat-strip"]` has `data-rail-height-pct` matching `cbrt(totalTokens / 1_000_000) * 100` (< 100% for normal chats, never hardcoded 100%) and its `[data-segment-kind]` children appear in order `system` → `attachment` → `chapter`.
   - **Upgrade `runGeometryAudit` in `scripts/evidence.cjs`:**
     - Add a check for **horizontal clipping inside `overflow-hidden` ancestors**: for every visible button inside a chapter header (`[data-testid="chapter-cut"] button`), assert `rect.left >= 0 && rect.right <= vw` at all 4 viewports (including `350x700`), so a clipped `Full` chip or fold button at `350px` is an automatic geometry FAIL.

---

## 2. Execution Checklist for the Next Turn

When switched back to the fast/cheap model, execute directly without further design debate:
1. Edit `src/domains/granularity.ts` (Package 1).
2. Edit `src/ui/context/AttachmentControls.tsx`, `src/ui/artifacts/ArtifactsLibraryView.tsx`, `src/ui/chat/ChatView.tsx`, `src/ui/context/MirrorPanel.tsx`, `src/ui/artifacts/ArtifactDetailModal.tsx`, `src/App.tsx` (Package 2 & Package 4).
3. Edit `src/ui/context/ambientTelemetry.ts`, `src/ui/context/useContextPayload.ts`, `src/ui/context/EdgeHeatStrip.tsx`, `src/ui/context/SaturationOrb.tsx` (Package 3).
4. Edit `src/application/sendQueue.ts`, `src/gateway/api.ts`, `server/routes/summarize.ts`, `src/ui/chat/createChapterHandlers.ts` (Package 5).
5. Update `src/tests/attachments.test.ts` and `scripts/evidence.cjs` (Package 6).
6. Run gates:
   - `bunx tsc --noEmit`
   - `bunx vitest run`
   - `node scripts/evidence.cjs` (against the running dev server on `:3036`) — verify **GREEN**, 17/17 journeys, 0 geometry fails at `350x700`, 0 console errors.
7. Update `design-docs/11_DESIGN_LEDGER.md` statuses (`open` → `fixed`), `design-docs/TODO.md`, `design-docs/scratch/pending.md`, `changelog.md`, and commit locally.

---

## 18. What actually shipped (2026-10-20 evening)

All six packages built and green. Gates at close: `bunx tsc --noEmit` clean ·
`bunx vitest run` **133/133 across 16 files** (15 new tests in
`src/tests/attachment-palette.test.ts`) · `node scripts/evidence.cjs`
**GREEN** — 18/18 journeys, 0 fails, 0 warnings, audit 0 fails/warns at
350×700 / 390×844 / 768×1024 / 1440×900, 0 console · 0 page · 0 http errors
(pack `evidence/2026-10-20T20-05-44`).

**Shipped as specified:** the six-state palette and the four-click chips; the
one `AttachmentRow` with row-body verbs and the arrow-out detail button on all
five surfaces; the payload-ordered rail with `cbrt(tokens/1M)` height; the
`cutIncludes` guards on the chapter body; the retry weld; the 15s client abort
and 12s server race; the two-row chapter header; the new unit tests and the
J14/J15/J16/J18 journey changes.

**Where execution deviated from this document** (all four are deliberate):

1. **Legacy attachments hydrate at `turnIndex: -1`, not `0`.** §2.2 offered
   "`-1`, or keep `0`". `0` was a lie (every old attachment claimed message 1)
   and `-1` alone would have made them vanish from the chat. So `-1` is now a
   first-class value: committed (only `null` is staged), badged **`in chat`**,
   and attached to the *first* chapter's strip instead of to a turn card.
2. **`Write it` never erases.** §4.2 covered the cut; running J16 exposed the
   neighbour bug: an empty chapter's server placeholder returns `summary: ''`,
   and `updateLevels` wrote that straight over a real summary. `handleSummarizeChapter`
   now ignores empty layers and keeps existing text — a call made to *add*
   something must not subtract.
3. **The clip audit needed a `position: fixed` guard.** A centered fixed modal
   is not clipped by an ancestor's `overflow: hidden`; without breaking the
   ancestor walk at the first fixed ancestor, my new check reported the 768px
   mirror as six failures. The check now flags `clipped-by-viewport` and
   `clipped-inside-overflow` for real (350px `Full` chip would be caught).
4. **J16 accepts two honest chrome states.** Selecting a missing layer *also*
   fires the summarize (by design), so the moment after the click shows
   `Writing summary…` — and an empty chapter fills instantly server-side. The
   journey asserts "filled, or named as a gap, never faked" and keeps its hard
   assertion where it matters: at the `Description` cut the summary layer must
   not render, and the Mirror's raw bytes must not contain it.

**Not done here, still open** (unchanged by this slice): model-sealed chapters
are still not auto-summarized (`TODO.md` 1, a money decision), no `Regenerate`
affordance for a stale summary (9), the graph lens shows no attach state (10),
and the import/extraction prompts still do not state the cut contract (2).
