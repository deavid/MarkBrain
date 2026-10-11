# UI TEARDOWN & REFACTOR PLAN (The "No Gimmicks" Layered UI)

## 1. The Core UI Pivot
The current prototype is built like a traditional dashboard with tabs (Chat, Graph, Specs, Tokens). This destroys the cognitive flow. We are moving to a **Single-Canvas Layered Architecture**. 
You will rip out the tabs and replace them with contextual slide-overs and ambient telemetry.

## 2. Tear-Down (What to Delete/Deprecate)
- DELETE the Tab Navigation.
- DELETE `ArtifactsDesk.tsx` (Manual sliders are dead. Optics are automated).
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

### Layer B: The Base Canvas (`ChatCanvas.tsx`)
- The only permanent view. Displays verbatim Active Chapter chat bubbles at the bottom, and compressed "Chapter Cards" (showing only Tier 2 summaries) as you scroll up.
- **Tactile Chapter Splitting:** Instead of a form, clicking "Split" drops a glowing horizontal line `[===]` between messages. The user can drag it up/down to adjust the boundary.

### Layer C: The Structural Sidebar (`SidebarOutliner.tsx`)
- Hidden behind a floating hamburger menu icon (top left).
- Renders a hierarchical tree of the project: Super-Chapters -> Chapters -> Artifacts.
- This is the manual override control panel: Users can tap an "eyeball" icon next to any node to manually pin it (Tier 3) or mute it (Tier 0). 

### Layer D: The Artifact Inspector Sheet (`ArtifactSheet.tsx`)
- When a user taps an Artifact or Chapter Card in the chat timeline, a bottom sheet slides up covering 80% of the screen.
- Displays the formatted Markdown, revision history, and resolution tabs (Title, Summary, Full).
- Swiping down dismisses it instantly, returning focus to the chat.
