# Known Bugs & Feature Backlog — Session Log 2026-10-31

Purpose: Authoritative record of all bugs, UX fixes, and design discussions logged with David on 2026-10-31.
- Items that are **100% clear** have an implementation plan in `design-docs/BUGS/CLEAR_FIXES_PLAN.md` so another agent can execute them immediately.
- Items that need **coaching / design discussion** are marked below so we can work through them together.
- Future features are captured in `design-docs/BUGS/FEATURE_VIEW_COLOR_MAPPING.md`.

---

## Screenshots Index (`design-docs/BUGS/screenshots/`)

All screenshots from this session were extracted from the goose session DB and saved on disk:

| File | Bug / Topic |
|---|---|
| `BUG-001-graph-mode-toolbar.jpeg` | BUG-001 (Graph mode toolbar context) |
| `BUG-001-node-card-clickable.jpeg` | BUG-001 (Graph node card with tags, `Link`, and `Spec` buttons) |
| `BUG-002-detail-card-red-button.jpeg` | BUG-002 (Graph selected-node card with red "Open in Artifacts Desk" button) |
| `BUG-002-go-to-chat-button.jpeg` | BUG-002 (Bottom-right floating "go to chat" button covered by the detail card) |
| `BUG-003-auto-space-button.jpeg` | BUG-003 (`Auto-Space` toolbar button in Graph mode) |
| `BUG-004-graph-overview-tangled-red-cards.jpeg` | BUG-003, BUG-004, BUG-005 (Tangled graph edges, label issues, and 3 red-accented unselected cards) |
| `BUG-006-detail-view-full.jpeg` | BUG-006 (Artifact detail modal showing header `#e05a66`, H1 mismatch, tabs, bottom bar) |
| `BUG-007-chat-link-chips-at-end.jpeg` | BUG-007 (Rendered chat bubble with all link chips dumped at the bottom) |
| `BUG-008-raw-view-stripped-blank.jpeg` | BUG-008 (`<> Raw` view showing stripped XML gaps instead of raw model output) |
| `BUG-009-attach-button-too-dark.jpeg` | BUG-009 (Thread composer `+` Attach button too dark next to Chat behavior button) |
| `BUG-010-chat-behavior-no-autoclose.jpeg` | BUG-010 (Chat behavior popover staying open while typing in composer) |
| `BUG-012-thinking-render-raw-leak.jpeg` | BUG-011, BUG-012 (Conversation chapters / streaming view with missing links and raw markdown leak) |
| `BUG-014-text-size-naming.jpeg` | BUG-014 (Sidebar Text Size picker: `Default / Large / Larger / Largest`) |

---

## Summary Matrix: Clarity & Readiness

| ID | Title | Clarity | Where it goes |
|---|---|---|---|
| **BUG-001** | Graph node card: lean (Title + Type only), click = select, double-click = open, drag = move | **100% Clear** | `BUGS/CLEAR_FIXES_PLAN.md` |
| **BUG-002** | Graph selected-node card: move to bottom-left, migrate node actions (`Link`, `Open`), remove red button | **100% Clear** | `BUGS/CLEAR_FIXES_PLAN.md` |
| **BUG-003** | Graph Auto-Space de-tangler algorithm | **Drawer / Discuss** | Needs algorithm design discussion |
| **BUG-004** | Graph edges & labels: clip lines to card border + enforce minimum distance for labels | **100% Clear** | `BUGS/CLEAR_FIXES_PLAN.md` |
| **BUG-005** | Strip per-artifact colors (`#e05a66`) everywhere; use clean non-red selection highlight | **100% Clear** | `BUGS/CLEAR_FIXES_PLAN.md` (+ future feature in `BUGS/FEATURE_VIEW_COLOR_MAPPING.md`) |
| **BUG-006.1** | Detail modal header: remove red dot & `#e05a66` hex readout | **100% Clear** | `BUGS/CLEAR_FIXES_PLAN.md` (covered with BUG-005) |
| **BUG-006.2** | Import title mismatch: markdown `# H1` must be used verbatim as the artifact title | **100% Clear** | `BUGS/CLEAR_FIXES_PLAN.md` |
| **BUG-006.5** | Wipe `High Concept` from UI & metadata | **100% Clear** | `BUGS/CLEAR_FIXES_PLAN.md` |
| **BUG-006.10** | Remove fake bottom-left `Title · Description · Summary · Full` text in detail modal | **100% Clear** | `BUGS/CLEAR_FIXES_PLAN.md` |
| **BUG-006 (all)** | Detail modal full redesign: 6 tabs (`Body` dedicated tab, `Overview & Layers` non-collapsible & editable, `Relationships` + similarity search, `Chats`, `History` always visible, `Q&A Index`), 1 visible editable Slug (`code`), unified `Category` with 6 options + descriptions | **100% Clear (Merged `089d3c3`)** | `BUGS/BUG_006_ARTIFACT_MODAL_PLAN.md` |
| **BUG-007** | Chat operations/chips (`<link>`, `<artifact_upsert>`, `<topic_shift>`) render IN PLACE + fix `?` link resolution (title/slug/`.md`) & chip traceability | **100% Clear (Merged `f2a0e2d` / `b01e599`)** | `BUGS/BUG_007_008_011_012_CHAT_PIPELINE_PLAN.md` (+ `BUGS/FEATURE_INLINE_ATTACHMENTS_AND_IMAGES.md`) |
| **BUG-008** | Chat `<> Raw` view shows true raw output (XML in place), with `<artifact_upsert>` collapsible `[+]` / `[-]` by default | **100% Clear (Merged `f2a0e2d`)** | `BUGS/BUG_007_008_011_012_CHAT_PIPELINE_PLAN.md` |
| **BUG-009** | Composer `+` Attach button is too dark; make it bright | **100% Clear (Merged `9518d17`)** | `BUGS/CLEAR_FIXES_PLAN.md` |
| **BUG-010** | Chat behavior popover does not auto-close on outside click / typing | **100% Clear (Merged `9518d17`)** | `BUGS/CLEAR_FIXES_PLAN.md` |
| **BUG-011** | Model sees its own past turns' operations in context (`<link>` verbatim, `<artifact_upsert>` compiled to `<!-- MarkBrain compiler: ... -->` stub) | **100% Clear (Merged `f2a0e2d`)** | `BUGS/BUG_007_008_011_012_CHAT_PIPELINE_PLAN.md` |
| **BUG-012** | Live streaming renders markdown + in-place streaming chips (`Writing artifact…`, `Linking…`) instead of raw asterisks or blank holes | **100% Clear (Merged `f2a0e2d`)** | `BUGS/BUG_007_008_011_012_CHAT_PIPELINE_PLAN.md` |
| **BUG-013** | Native API turns (`user`/`assistant`) for the last 2 chapters + persist thinking on every assistant turn + send thinking only for the last turn | **100% Clear** | `BUGS/BUG_013_TURNS_AND_THINKING_PLAN.md` |
| **BUG-014** | Text size: rename to `Small / Medium / Large / Largest` + scale sidebar width (`+5% / +10% / +15%`) | **100% Clear (Merged `9518d17`)** | `BUGS/CLEAR_FIXES_PLAN.md` |

---

## Detailed Bug Entries

### BUG-001 — Graph node card: click does too much, conflicts with drag
- **Area**: `src/ui/graph/SpatialGraph.tsx` (Graph mode node cards)
- **Reported**: 2026-10-31
- **Status**: open (100% clear — see `BUGS/CLEAR_FIXES_PLAN.md`)
- **Screenshots**: `BUG-001-graph-mode-toolbar.jpeg`, `BUG-001-node-card-clickable.jpeg`
- **Description**: Most of the node card surface is clickable (`#tag` pills, `Link` button, `Spec` button), which fights with dragging the card.
- **Locked-in decisions (David)**:
  1. Make the node card on the canvas as lean as possible: **only `Title + Type`** (no tags row, no `Link` button, no `Spec` button, no per-artifact color dot).
  2. **Single click / pointer down**: only selects the node (and starts drag if moved).
  3. **Double-click**: opens the artifact detail modal (`onSelectArtifact`).
  4. All interactive actions that used to be on the card (`#tag` filter pills, `Link` / connect edge, `Open` / inspect spec) move into the selected-node detail card (BUG-002).

### BUG-002 — Graph selected-node detail card: bad design, hides "go to chat", red button
- **Area**: `src/ui/graph/SpatialGraph.tsx` (selected-node floating card)
- **Reported**: 2026-10-31
- **Status**: open (100% clear — see `BUGS/CLEAR_FIXES_PLAN.md`)
- **Screenshots**: `BUG-002-detail-card-red-button.jpeg`, `BUG-002-go-to-chat-button.jpeg`
- **Description**:
  1. Positioned at `bottom-3 right-3`, which directly covers the floating "go to chat" button in the bottom-right corner.
  2. The primary button ("Open in Artifacts Desk") is red (`bg-[#a33945]`) for no reason.
  3. Overall card layout is clunky.
- **Locked-in decisions (David)**:
  1. Move the selected-node card to the **bottom-left** (`bottom-3 left-3`) so the bottom-right "go to chat" button is never obstructed.
  2. Migrate all actions removed from the canvas node card into this bottom-left card:
     - Title + Type badge + close (`✕`) button
     - Clickable `#tag` pills (filtering folder tree by tag)
     - **Link / Connect Edge** button (triggers `setLinkingSourceNode(selectedNode)`)
     - **Open** button (opens `ArtifactDetailModal`, styled with the standard calm blue/accent palette instead of red).

### BUG-003 — Auto-Space makes the graph worse, not better
- **Area**: `src/ui/graph/SpatialGraph.tsx` (`handleAutoArrange` / `runPhysicsStep`)
- **Reported**: 2026-10-31
- **Status**: drawer / needs design discussion
- **Screenshots**: `BUG-003-auto-space-button.jpeg`, `BUG-004-graph-overview-tangled-red-cards.jpeg`
- **Description**: Auto-Space runs 45 steps of a naive spring/repulsion loop that leaves dense graphs as a tangled mess of crossing lines.
- **Expectation (David)**: A real **de-tangler algorithm** that untangles the web of edges, respects space, and organizes connected nodes cleanly. Parked for design discussion before touching code.

### BUG-004 — Graph edges & labels: center-to-center lines hide behind cards, short edges break labels
- **Area**: `src/ui/graph/SpatialGraph.tsx` (SVG edge rendering & layout distance)
- **Reported**: 2026-10-31
- **Status**: open (100% clear — see `BUGS/CLEAR_FIXES_PLAN.md`)
- **Screenshots**: `BUG-004-graph-overview-tangled-red-cards.jpeg`
- **Description**:
  1. Edges are drawn from card center to card center (`x + 105, y + 40`), so part of the line and label gets hidden underneath the opaque node cards when nodes are close.
  2. When two linked cards are too close together, the edge is too short and the label pill (`rect` + `text`) overlaps the cards or renders badly.
- **Locked-in decisions (David)**:
  1. **Clip edges to the card border** (compute line/curve intersection with the source and target node rectangles, including a small padding/arrow clearance, so lines connect cleanly from border to border and never disappear under the cards).
  2. **Enforce a minimum distance between linked cards** (and/or between cards generally when placed/moved/arranged) so that the edge between two connected cards always has enough visible span between borders to render its label cleanly.

### BUG-005 — Red accent / halo on unselected cards + strip per-artifact colors
- **Area**: `src/ui/graph/SpatialGraph.tsx`, `src/ui/artifacts/ArtifactDetailModal.tsx`, `shared/turnCommit/planTurnCommit.ts`
- **Reported**: 2026-10-31
- **Status**: open (100% clear — see `BUGS/CLEAR_FIXES_PLAN.md` and `BUGS/FEATURE_VIEW_COLOR_MAPPING.md`)
- **Screenshots**: `BUG-004-graph-overview-tangled-red-cards.jpeg`, `BUG-006-detail-view-full.jpeg`
- **Description**: Three cards in the graph have a red border/shadow glow even when nothing is selected, which looks like a leaked selection cursor. Root cause found in code: `planTurnCommit` assigns each artifact a random-ish pastel color (`getMellowPastelColor`), one of which is coral red (`#e05a66`), and `SpatialGraph.tsx` renders every card with a 6px halo + shadow in `art.color` (`boxShadow: ... ${artColor}12, ... ${artColor}26`), while ALSO using red (`ring-[#e65a6c]`) for `isSelected`! Meanwhile `ArtifactDetailModal.tsx` renders a red dot and the literal string `#e05a66` in the header.
- **Locked-in decisions (David)**:
  1. **Strip per-artifact colors completely** from the UI (no `art.color` halo or dot on graph cards, no color dot or `#e05a66` hex string in `ArtifactDetailModal`).
  2. Change the **selected node highlight** in the graph from red (`#e65a6c`) to a clean, unmistakable selection accent (e.g. bright sky/cyan `#38bdf8` ring + subtle glow) that isn't alarm-red.
  3. **Future feature logged**: See `design-docs/BUGS/FEATURE_VIEW_COLOR_MAPPING.md` for bringing back colors later as a **view-level configurable color mapping** (color nodes by current chat attachment granularity, by tag, by folder, etc.), NOT a fixed color per artifact.

---

### BUG-006 — Artifact detail view (`ArtifactDetailModal.tsx`): umbrella entry
- **Area**: `src/ui/artifacts/ArtifactDetailModal.tsx`, `src/ui/artifacts/import/useImportSession.ts`
- **Reported**: 2026-10-31
- **Status**: split — sub-issues **1, 2, 5, 10** are **100% clear** (in `BUGS/CLEAR_FIXES_PLAN.md`); sub-issues **3, 4, 6, 7, 8, 9, 11, 12** are queued for our design discussion.
- **Screenshot**: `BUG-006-detail-view-full.jpeg`
- **Sub-issues that are 100% CLEAR**:
  - **6.1 — Red dot + `#e05a66` hex text in header**: Remove the color dot and raw `#e05a66` string from the modal header (part of BUG-005).
  - **6.2 — Title vs Markdown `# H1` mismatch on import**: In `BUG-006-detail-view-full.jpeg`, the markdown body starts with `# Night Vision Acoustic-Visual Synesthesia Design Document`, but the artifact title became `Night Vision Acoustic-Visual Synesthesia Design` (dropped "Document"). Root cause in `src/ui/artifacts/import/useImportSession.ts`: `buildArtifactFromExtraction` uses `ex.title || fallbackTitle` where `ex.title` is invented/paraphrased by the AI extractor instead of preferring the literal `# H1` heading inside the markdown body! Fix: when the markdown body has a top-level `# Heading`, extract it deterministically and use it verbatim as the artifact title on import.
  - **6.5 — Wipe "High Concept"**: `High Concept: Yes (Core Anchor) / No (Component)` is still rendered in `ArtifactDetailModal.tsx` (lines 625–630) and `projectExporters.ts`. Remove it completely.
  - **6.10 — Fake bottom bar `Title · Description · Summary · Full`**: Rendered as static decorative text at the bottom-left of `ArtifactDetailModal.tsx` (lines 756–758). Pure theater — delete it.
- **Sub-issues to DISCUSS with David**:
  - **6.3 & 6.8 — History / Revisions visibility**: In code, the `History ({history.length})` tab is hidden whenever `history.length === 0` (`{history.length > 0 && <button ...>}`), so imported or single-version artifacts show no History tab at all! Even when edited, we should check why history wasn't visible and how revisions should always be accessible.
  - **6.6, 6.7, 6.9 — Editing metadata, two IDs (`Artifact ID` vs `Code Identifier`), and `Category`**: Currently Pencil only edits `Title`, `Subtitle`, and `Body`. Why are there both `Artifact ID` (`art-...`) and `Code Identifier` (slug), can the user edit them, are they unique, and what is `Category` (`note` vs `specification` vs `general`)?
  - **6.4 & 6.12 — Relationships / Edges tab + similarity search**: Adding a dedicated tab in the detail view to inspect, add, and remove edges/relationships for this artifact, with similarity search to find related notes.
  - **6.11 — Chats-using-this tab**: Adding a dedicated tab showing which chats in the project reference/attach this artifact and at what granularity level (`Full`, `Summary`, `Description`, `Title`).

---

### BUG-007 — Chat operations / chips (`<link>`, attachments) render at the END instead of IN PLACE
- **Area**: Chat message rendering & stream/commit parser (`MessageBubble.tsx`, `TurnReceiptsRow.tsx`, stream demuxer)
- **Reported**: 2026-10-31
- **Status**: needs coaching / deep talk with David
- **Screenshots**: `BUG-007-chat-link-chips-at-end.jpeg`, `BUG-008-raw-view-stripped-blank.jpeg`
- **Description**: When the model writes `<link .../>` (or artifact operations) in the middle of its explanation, the parser strips the XML out of the body (leaving blank vertical gaps) and dumps all the link chips in a pile at the bottom of the message (`TurnReceiptsRow`).
- **Intended design (David)**:
  1. Chips for links, attachments, and any model operations must render **IN PLACE** right where the model wrote them in the message flow.
  2. Ideally, the user should be able to do the same: inject and reference attachments mid-chat in their own messages.

### BUG-008 — Chat `<> Raw` view is already processed ("well done meat"), not raw
- **Area**: `src/ui/chat/MessageBubble.tsx` (`<> Raw` toggle)
- **Reported**: 2026-10-31
- **Status**: needs coaching (part of the BUG-007/011/012 message-pipeline talk, though the requirement itself is 100% clear)
- **Screenshot**: `BUG-008-raw-view-stripped-blank.jpeg`
- **Description**: Clicking `<> Raw` on an assistant message shows the post-processed `turn.content` where the XML tags were already stripped out, leaving giant empty blank lines. Raw must show the actual untouched output the model emitted (including XML tags).

### BUG-009 — Attach (`+`) button in chat composer is too dark
- **Area**: `src/ui/chat/ChatComposer.tsx` (`ThreadComposer` open-artifacts `+` button)
- **Reported**: 2026-10-31
- **Status**: open (100% clear — see `BUGS/CLEAR_FIXES_PLAN.md`)
- **Screenshot**: `BUG-009-attach-button-too-dark.jpeg`
- **Description**: In `ThreadComposer` (line 488 of `ChatComposer.tsx`), the `+` Attach button uses `bg-recess-1 shadow-well`, making it sink into the dark background and look disabled/invisible right next to the `CapabilitiesPopover` button (`bg-surface-3 hover:bg-surface-4`).
- **Fix**: Style the `+` Attach button brighter so it stands out clearly (matching or exceeding the brightness of the neighboring control button).

### BUG-010 — Chat behavior popover does not auto-close
- **Area**: `src/ui/chat/CapabilitiesPopover.tsx`
- **Reported**: 2026-10-31
- **Status**: open (100% clear — see `BUGS/CLEAR_FIXES_PLAN.md`)
- **Screenshot**: `BUG-010-chat-behavior-no-autoclose.jpeg`
- **Description**: `CapabilitiesPopover` only listens for `Escape` (`keydown`). It has no outside-click / pointerdown or focus-in listener, so when the user clicks into the chat composer and starts typing (`"im typing but the chat behavior is open"`), the popover stays open covering the chat.
- **Fix**: Add a `pointerdown` / `mousedown` + `focusin` outside-click listener on `document`/`window` (checking `!wrapRef.current?.contains(target)`) so clicking or focusing anywhere outside `wrapRef` (including typing in the composer) immediately closes the popover.

### BUG-011 — Model does not see its own past turns' operations
- **Area**: Conversation context builder / turn storage
- **Reported**: 2026-10-31
- **Status**: needs coaching / deep talk with David (linked with BUG-007, BUG-008, BUG-013)
- **Screenshot**: `BUG-012-thinking-render-raw-leak.jpeg`
- **Description**: Because the stream/commit pipeline strips the XML operations (`<link>`, `<artifact_upsert>`, etc.) out of `turn.content`, subsequent turns sent to the model only contain the stripped prose (with blank gaps). The model cannot see that it actually emitted the operations in its previous turn, gets confused thinking its previous attempt failed or was botched, and tries to apologized or redo them.

### BUG-012 — Actions & markdown not rendered properly while model is thinking/writing
- **Area**: Streaming demuxer & live message/chapter rendering
- **Reported**: 2026-10-31
- **Status**: needs coaching / deep talk with David (linked with BUG-007, BUG-011)
- **Screenshot**: `BUG-012-thinking-render-raw-leak.jpeg`
- **Description**: During streaming/thinking (and in Conversation chapters preview), XML actions and markdown (`**5. Community and shipping.**`) are either not escaped, stripped leaving blank spaces (`Here are the links:` followed by nothing), or rendered as raw unformatted text.

### BUG-013 — DRAWER: Turns & thinking steps architecture across model APIs
- **Area**: Gateway / provider adapters / dialogue timeline storage
- **Reported**: 2026-10-31
- **Status**: drawer — requires investigation & architectural discussion with David
- **Description**:
  1. Investigate what we are actually sending to providers for multi-turn conversations ("I thought all APIs have a clear way to send turns, but we don't seem to be sending turns. WTF are we sending?").
  2. Most reasoning/thinking models require previous thinking steps (or signatures/reasoning blocks) to be sent back on multi-turn continuations, or require a specific turn structure.
  3. We need to permanently store thinking steps and design how thinking + turns + operations work end-to-end.

### BUG-014 — Text size: rename to `Small / Medium / Large / Largest` + scale sidebar width
- **Area**: `src/ui/workspace/SidebarPreferencesPanel.tsx`, `src/ui/workspace/Sidebar.tsx`, `src/ui/uiFontScale.ts`
- **Reported**: 2026-10-31
- **Status**: open (100% clear — see `BUGS/CLEAR_FIXES_PLAN.md`)
- **Screenshot**: `BUG-014-text-size-naming.jpeg`
- **Description**:
  1. The 4 text size choices in `SidebarPreferencesPanel.tsx` are currently labeled `Default / Large / Larger / Largest` (`scale: 1 | 1.15 | 1.3 | 1.5`). Rename them to **`Small / Medium / Large / Largest`**.
  2. In `Sidebar.tsx`, the sidebar width is hardcoded to `350px` (`max-w-[350px] md:w-[350px]`). When larger font sizes are selected, the sidebar gets cramped. Scale the sidebar width by **`+5%` (Medium), `+10%` (Large), and `+15%` (Largest)** relative to the base width (`350px` → `368px` → `385px` → `403px`).
