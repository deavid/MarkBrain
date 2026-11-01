# Implementation Plan: 100% Clear Bug Fixes (2026-10-31)

This plan covers all bugs from `design-docs/BUGS_KNOWN.md` that David has reviewed and locked in as **100% clear**. Another agent can execute these fixes directly while David and Altair discuss the deeper architectural items (`BUG-006` tabs/IDs, `BUG-007/008/011/012` in-place chips & raw XML, `BUG-013` turns/thinking, `BUG-003` graph de-tangler).

> **Workflow Reminder for Implementing Agent**:
> 1. Follow TDD Law: write a failing test first that proves the bug, see RED, then implement the fix to go GREEN.
> 2. Run gates in order: `npx tsc --noEmit` -> `npx vitest run` -> `npm run build` -> hermetic evidence pack (`scripts/evidence.cjs`) if UI journeys are affected.
> 3. Do NOT touch items marked for Coaching / Drawer (`BUG-003`, `BUG-007`, `BUG-008`, `BUG-011`, `BUG-012`, `BUG-013`, or the remaining tabs/IDs of `BUG-006`).

---

## Task 1 — Graph Node Card, Bottom-Left Detail Card, Border-Clipped Edges & Min Distance (`BUG-001`, `BUG-002`, `BUG-004`, `BUG-005`)

**Primary file**: `src/ui/graph/SpatialGraph.tsx`

### 1.1 Strip per-artifact colors & fix selection highlight (`BUG-005`)
- **Problem**: Every node card in `SpatialGraph.tsx` reads `const artColor = art?.color || '#5d87b8'` and applies a 6px colored halo (`0 0 0 6px ${artColor}12, 0 10px 26px -6px ${artColor}26`) plus a colored dot. When `art.color` happens to be `#e05a66` (from `MELLOW_DARK_PASTELS`), unselected cards glow red and look like a broken/leaked selection cursor. Additionally, `isSelected` uses `ring-2 ring-[#e65a6c]` (also red!).
- **Fix**:
  1. Remove `artColor` halo and the colored dot from graph node cards in `SpatialGraph.tsx`. Use a neutral dark elevation shadow for unselected cards (`0 1px 2px rgb(0 0 0 / 0.35), 0 12px 26px -14px rgb(0 0 0 / 0.72)` with a subtle border `border border-surface-3/80`).
  2. Change the selected node highlight (`isSelected`) from red (`ring-[#e65a6c]`) to a clear sky/cyan accent: e.g. `ring-2 ring-[#38bdf8] shadow-[0_0_20px_-4px_rgba(56,189,248,0.45)]`.
  3. Also change the active linking line / banner accent in `SpatialGraph.tsx` from red (`#e65a6c`) to sky/cyan (`#38bdf8`) so red isn't randomly used for graph interactions.

### 1.2 Make graph node cards lean: `Title + Type` only, Click = Select, Double-Click = Open (`BUG-001`)
- **Problem**: Most of the node card is covered in clickable buttons (`#tag` pills, `Link` button, `Spec` button), which interferes with dragging the card.
- **Fix in `SpatialGraph.tsx`**:
  1. **Card content**: Render ONLY the **Type** badge (`node.type`) and the **Title** (`node.title`). Remove the `#tag` pills row, the `Link` button, and the `Spec` button from the canvas node card.
  2. **Card dimensions**: With only `Type + Title`, the card height is compact and predictable (e.g. width `220px`, height ~`64px`). Update any hardcoded card half-width/half-height constants (previously `105` and `40` or `220`/`110` in `fitViewToNodes`) to match the actual card box (`width = 220`, `height = 68`).
  3. **Interactions on the node card**:
     - `onPointerDown`: selects the node (`setSelectedNodeId(node.id)`) and begins drag tracking (or completes edge if `linkingSourceNode` is active).
     - `onDoubleClick`: opens the artifact detail view (`if (art) onSelectArtifact(art)`).
     - No inner buttons on the canvas card body at all.

### 1.3 Move selected-node detail card to Bottom-Left & migrate actions (`BUG-002`)
- **Problem**: The selected-node card is at `bottom-3 right-3` (`sm:left-auto sm:right-3`), hiding the floating bottom-right "go to chat" button (`BUG-002-go-to-chat-button.jpeg`), and has an ugly red button (`bg-[#a33945]`).
- **Fix in `SpatialGraph.tsx`**:
  1. Position the `selectedNode` panel at **bottom-left**: `absolute bottom-3 left-3 z-30 w-80 max-w-[calc(100vw-1.5rem)] bg-surface-2/95 backdrop-blur-md border border-line rounded-xl p-3.5 shadow-2xl`.
  2. Include in this bottom-left card all the functionality migrated off the node card:
     - **Header**: Full title (wrapping or 2-line clamp so long titles are readable), `Type` badge, and close (`✕`) button (`onClick={() => setSelectedNodeId(null)}`).
     - **Tags**: Clickable `#tag` pills (when `tags.length > 0`) that call `onFilterByTag?.(t)`.
     - **Actions row** (two clear buttons, no red!):
       - **Link / Connect**: `<button onClick={() => setLinkingSourceNode(selectedNode)} ...>` with `LinkIcon` + `"Link to…"` (styled in `bg-surface-3 hover:bg-surface-4 text-[#9bb0d1] hover:text-ink`).
       - **Open**: `<button onClick={() => onSelectArtifact(selectedNode.artifact)} ...>` labeled `"Open"` or `"Open Artifact"` styled in calm primary blue/cyan (`bg-[#2563eb] hover:bg-[#1d4ed8] text-ink` or `bg-surface-4 hover:bg-surface-5 text-[#67e8f9]`), replacing the red `bg-[#a33945]` button.

### 1.4 Clip edges to card borders & enforce minimum distance between linked cards (`BUG-004`)
- **Problem**:
  1. Edges are drawn from `(sourceNode.x + 105, sourceNode.y + 40)` to `(targetNode.x + 105, targetNode.y + 40)` (center-to-center), so lines and labels disappear behind node cards.
  2. When linked nodes are too close, the visible segment between cards is shorter than the 80px label box, so the label overlaps the cards or renders poorly.
- **Fix in `SpatialGraph.tsx`**:
  1. **Rectangle-border intersection helper**:
     Write a pure helper function (export it so it can be unit-tested directly):
     ```ts
     export function clipEdgeToNodeRects(
       sRect: { x: number; y: number; width: number; height: number },
       tRect: { x: number; y: number; width: number; height: number },
       curveOffset?: number
     ): { sx: number; sy: number; tx: number; ty: number; midX: number; midY: number }
     ```
     - Given source center `(scx, scy)` and target center `(tcx, tcy)` (or the quadratic control point direction), compute the exact intersection point where the ray from `sRect` center toward `tRect` exits `sRect` (with a `4px` outer margin), and where the ray enters `tRect` (with a `4px` outer margin).
     - Draw the edge between `(sx, sy)` and `(tx, ty)` on the card borders, and place the label at the midpoint `(midX, midY)` of the **border-to-border** curve so the label is centered in the open gap between the two cards, never underneath a card.
     - Dynamically size the label `<rect>` width to `Math.max(56, edge.kind.length * 6 + 16)` so short labels aren't wider than necessary.
  2. **Enforce minimum distance between linked nodes**:
     - Define `MIN_LINKED_CENTER_DISTANCE = 320` (so with 220px-wide cards, the border-to-border gap is at least ~100px–180px depending on angle, plenty of room for an 80px label).
     - When a node drag finishes (`handlePointerUpBg`) or during initial fallback placement / `runPhysicsStep`, if a node is closer than `MIN_LINKED_CENTER_DISTANCE` to any node it has an edge with (or closer than card-collision distance `240px` X / `90px` Y to any node), push it outward along the connecting vector so it settles at >= `MIN_LINKED_CENTER_DISTANCE`.

---

## Task 2 — Artifact Detail Modal Cleanups & Import H1 Title Fix (`BUG-006.1`, `BUG-006.2`, `BUG-006.5`, `BUG-006.10`)

**Primary files**:
- `src/ui/artifacts/ArtifactDetailModal.tsx`
- `src/ui/artifacts/import/useImportSession.ts`
- `src/utils/yamlArtifactParser.ts`
- `src/utils/projectExporters.ts`

### 2.1 Remove red dot & `#e05a66` color hex from `ArtifactDetailModal` header (`BUG-006.1` / `BUG-005`)
- **In `src/ui/artifacts/ArtifactDetailModal.tsx` (lines 182–201)**:
  - Remove the colored circle `<span className="w-3.5 h-3.5 rounded-full ..." style={{ backgroundColor: artColor }} />`.
  - Remove `<span>•</span>` and `<span style={{ color: artColor }}>{artColor}</span>` from the subtitle metadata line so the raw hex code (`#e05a66`) is never displayed.

### 2.2 Use Markdown `# H1` verbatim as Artifact Title on import (`BUG-006.2`)
- **Problem**: When importing a markdown document that has `# Night Vision Acoustic-Visual Synesthesia Design Document`, `buildArtifactFromExtraction` in `src/ui/artifacts/import/useImportSession.ts` (line 139) sets:
  ```ts
  const title: string = ex.title || fallbackTitle || 'Imported document';
  ```
  Because `ex.title` comes from the LLM extraction response, the LLM often shortens or paraphrases the title (e.g. dropping `"Document"`), causing the artifact title to mismatch the `# H1` inside its own markdown body!
- **Fix**:
  1. Write a pure helper `extractLeadingMarkdownH1(markdown: string): string | null` (e.g. in `src/utils/yamlArtifactParser.ts` or `useImportSession.ts`):
     - Strip optional YAML frontmatter (`--- ... ---`).
     - Find the first ATX `# Heading` line (`/^#\s+(.+)$/m` — specifically single `#`, H1, stripping any trailing `#` or surrounding inline markdown formatting like `**`).
     - If no `# H1` exists, fall back to the first heading `/^#{1,6}\s+(.+)$/m` if appropriate, or `null`.
  2. In `buildArtifactFromExtraction` (`src/ui/artifacts/import/useImportSession.ts`) and in `parseYamlOrMarkdownToArtifact` (`src/utils/yamlArtifactParser.ts`):
     - If the markdown body contains an `# H1` heading (`extractLeadingMarkdownH1(body)`), **always use that exact H1 text** as the artifact `title` (taking precedence over `ex.title` from the AI). Only fall back to `ex.title || fallbackTitle` when the markdown has no `# H1` heading.
  3. Add a unit test with `"# Night Vision Acoustic-Visual Synesthesia Design Document\n\nBody..."` where `ex.title` is `"Night Vision Acoustic-Visual Synesthesia Design"`, asserting that the resulting artifact title is `"Night Vision Acoustic-Visual Synesthesia Design Document"`.

### 2.3 Wipe `High Concept` from Detail Modal & Exporters (`BUG-006.5`)
- **In `src/ui/artifacts/ArtifactDetailModal.tsx` (lines 625–630)**:
  - Delete the `High Concept:` block (`Yes (Core Anchor)` / `No (Component)`).
- **In `src/utils/projectExporters.ts` (line 47)**:
  - Change `md += \`**Type:** ${art.type} | **High Concept:** ${art.isHighConcept ? 'Yes' : 'No'}\n\n\`;` to `md += \`**Type:** ${art.type}\n\n\`;`.

### 2.4 Delete fake bottom bar `Title · Description · Summary · Full` (`BUG-006.10`)
- **In `src/ui/artifacts/ArtifactDetailModal.tsx` (lines 755–766)**:
  - Remove the `<span className="text-10 font-mono text-[#556985]">Title · Description · Summary · Full</span>` theater from the modal footer (keep the `Done` button aligned to the right, or remove the footer bar if redundant with the top-right `X`).

---

## Task 3 — Chat Composer: Brighten Attach (`+`) Button & Auto-Close Chat Behavior Popover (`BUG-009`, `BUG-010`)

**Primary files**:
- `src/ui/chat/ChatComposer.tsx`
- `src/ui/chat/CapabilitiesPopover.tsx`

### 3.1 Brighten the `+` Attach button in `ThreadComposer` (`BUG-009`)
- **Problem**: In `src/ui/chat/ChatComposer.tsx` (line 488), the `open-artifacts` (`+`) button in `ThreadComposer` has:
  `bg-recess-1 shadow-well hover:bg-recess-2 text-ink-dim hover:text-ink`
  Because `bg-recess-1` is nearly black (`#070a0f`), the button disappears into the background (`BUG-009-attach-button-too-dark.jpeg`).
- **Fix**:
  - Style it so it is bright and clearly visible next to the `CapabilitiesPopover` button: e.g. `bg-surface-3 hover:bg-surface-4 text-ink hover:text-white border border-line/60 shadow-sm` (and ensure the `<Plus className="w-4 h-4 text-[#67e8f9] shrink-0" />` or `text-ink` is crisp and bright). Check both `HeroComposer` and `ThreadComposer` so both look bright and consistent.

### 3.2 Auto-close `CapabilitiesPopover` on outside click / focus (`BUG-010`)
- **Problem**: In `src/ui/chat/CapabilitiesPopover.tsx` (lines 44–51), the `useEffect` only listens for `Escape`. Clicking into the composer textarea and typing leaves the popover open (`BUG-010-chat-behavior-no-autoclose.jpeg`).
- **Fix in `src/ui/chat/CapabilitiesPopover.tsx`**:
  - Inside the `useEffect` when `open` is `true`:
    1. Listen for `pointerdown` (or `mousedown`) on `document`: if `wrapRef.current && !wrapRef.current.contains(e.target as Node)`, call `setOpen(false)`.
    2. Listen for `focusin` on `document`: if `wrapRef.current && !wrapRef.current.contains(e.target as Node)`, call `setOpen(false)` (so tabbing or focusing into the textarea also closes it).
    3. Clean up all listeners on unmount / close.
  - Write a unit/component test verifying that clicking or focusing outside `CapabilitiesPopover` (e.g. into the composer textarea) closes `data-testid="capabilities-popover"`.

---

## Task 4 — Text Size Naming (`Small / Medium / Large / Largest`) & Sidebar Width Scaling (`BUG-014`)

**Primary files**:
- `src/ui/workspace/SidebarPreferencesPanel.tsx`
- `src/ui/workspace/Sidebar.tsx`
- `src/ui/uiFontScale.ts`

### 4.1 Rename Text Size choices to `Small / Medium / Large / Largest`
- **In `src/ui/workspace/SidebarPreferencesPanel.tsx` (lines 42–47)**:
  Update `UI_FONT_SCALE_CHOICES`:
  ```ts
  export const UI_FONT_SCALE_CHOICES: { scale: UiFontScale; label: string; hint: string }[] = [
    { scale: 1, label: 'Small', hint: '100% — compact design size' },
    { scale: 1.15, label: 'Medium', hint: '115% — a gentle step up everywhere' },
    { scale: 1.3, label: 'Large', hint: '130% — comfortable reading size' },
    { scale: 1.5, label: 'Largest', hint: '150% — arm\u2019s length reading' },
  ];
  ```
  And update the fallback on line 152 from `'Default'` to `'Small'`.
  *(Note: check any existing tests in `src/tests/` or `scripts/evidence.cjs` that query `aria-label="Text size: Default"` or `'Larger'` and update them to the new labels!)*

### 4.2 Scale Sidebar width by `+5% / +10% / +15%` at larger font sizes
- **In `src/ui/uiFontScale.ts`** (or `Sidebar.tsx`):
  Add a helper `getSidebarWidthPx(scale: UiFontScale): number`:
  - `scale === 1` (Small): `350` (base `350px`)
  - `scale === 1.15` (Medium, +5%): `Math.round(350 * 1.05)` = `368` (`368px`)
  - `scale === 1.3` (Large, +10%): `Math.round(350 * 1.10)` = `385` (`385px`)
  - `scale === 1.5` (Largest, +15%): `Math.round(350 * 1.15)` = `403` (`403px`)
- **In `src/ui/workspace/Sidebar.tsx` (lines 222–227)**:
  - Apply the dynamic width when `isOpen` is true (e.g. via inline `style={isOpen ? { width: `${sidebarWidth}px`, maxWidth: '85vw' } : undefined}` or CSS custom property `--sidebar-w` on `<aside>`), so that on desktop (`md:`) and large screens the open sidebar expands to `350px / 368px / 385px / 403px` according to `fontScale` while still respecting `max-w-[85vw]` on narrow mobile screens.
  - Write a unit test asserting that `getSidebarWidthPx` returns `350, 368, 385, 403` for the four scales and that `Sidebar` applies the scaled width when open.
