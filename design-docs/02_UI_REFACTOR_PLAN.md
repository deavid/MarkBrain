# UI TEARDOWN & REFACTOR PLAN (The "No Gimmicks" Layered UI)

## 0. Hard Rules (David, 2026-10-17 — these override any tool habit)

- **NO top bars. NO sticky headers.** They waste precious vertical space on
  phone and keep getting re-added by AI tools that assume "apps have headers."
  This has been re-laid-down 15–20 times; it is banned unless David approves
  an exception explicitly.
- **Mobile-first, desktop-second.** If a decision improves the phone and makes
  desktop look sparse — take it. Desktop looking a bit empty is accepted.
- **Capture flow is sacred:** open → dump thought → send → leave. Nothing in
  the UI may slow that path (dialogs, onboarding, auto-expanding panels).

## 1. The Core UI Pivot
The current prototype is built like a traditional dashboard with tabs (Chat, Graph, Specs, Tokens). This destroys the cognitive flow. We are moving to a **Single-Canvas Layered Architecture**. 
You will rip out the tabs and replace them with contextual slide-overs and ambient telemetry.

## 2. Tear-Down (What to Delete/Deprecate)
- DELETE the Tab Navigation.
- DELETE `ArtifactsDesk.tsx` (bulk desk UI is dead; manual control belongs in
  the chat/mirror view, not a separate desk — *automation is the preset layer,
  not the truth*).
- DELETE `ContextInspector.tsx` / Token Ledger (Too invasive, feels like accounting).
- STRIP DOWN `ChatView.tsx` (Remove rigid L1/L2/L3 form popups for splitting chapters).

## 3. The New Layered Components to Build

### Layer A: Peripheral Ambient Telemetry (Zero Footprint)
Instead of a Token Ledger screen, we use ambient screen edges.
- **The 5px Edge Bar:** On the absolute right edge of the viewport, render a 5px-wide, 100%-height vertical bar. It visually stacks the current token footprint by color:
  - Red = Detail / Tier 3 (Focus)
  - Yellow = Summary / Tier 2
  - Blue = Title / Tier 0
- **The Token Orb:** Fixed at the top right (floating over the chat), a small circular orb. Its color indicates token saturation (e.g., Green < 40%, Yellow < 70%, Red > 85%).

### Layer B: The Base Canvas (planned name `ChatCanvas.tsx` — real component today: `ChatView.tsx`)
- The only permanent view. Displays verbatim Active Chapter chat bubbles at the
  bottom, and chapter cards above as you scroll (scrolling = navigation;
  *compaction* = a chapter showing its summary instead of its turns — compact
  manually, no scroll-depth magic).
- **Chapter boundaries:** the glowing drag handle originally planned here was
  **rejected** (never built; David 2026-10-17). Replacement: the KISS
  three-button toolkit — see `MOBILE_UX_SPEC.md` §6.

### Layer C: The Structural Sidebar (planned name `SidebarOutliner.tsx` — real component today: `Sidebar.tsx`)
- Hidden behind a visible hamburger button (top left — **settled**; fought for).
- Renders a hierarchical tree of the project: Super-Chapters -> Chapters -> Artifacts.
- Manual override controls (pin/mute eyeballs per node): **plan-shaped, not
  shipped** — treat as proposal until built.

### Layer D: The Artifact View
- Tapping an Artifact or Chapter Card opens the **existing modal**
  (`ArtifactDetailModal.tsx`): formatted markdown, revisions, tier tabs.
- The bottom sheet originally planned here was **rejected outright —
  "No. I don't. End of the topic." (David, 2026-10-17).** Do not resurrect it
  without a fresh decision.
