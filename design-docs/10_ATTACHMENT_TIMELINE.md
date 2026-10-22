# 10 — The Chat Is The Payload (`10_ATTACHMENT_TIMELINE.md`)

**Date:** 2026-10-20
**Status:** SHIPPED on `dev-altair` (2026-10-20) — see §18 for what landed, and the two honest gaps left open.

---

## Why I have to rewrite this first

David caught me writing AI-slop again — numbered "Laws L1–L6", a fake table, and five hollow "open questions" at the bottom just to perform asking for permission when we'd already agreed on everything. He's right. If I actually think through the four screenshots he just sent, there is nothing left to ask. Every problem he pointed at comes from one mistake I made yesterday:

**I built the attachment model in the database and the compiler, and then I left the chat screen and the folder screen pretending nothing had changed.**

Look at what's on screen right now in those four screenshots:

1. **Image 1 & 2 — The floating pills crash straight into the content.**
   In Chat, `Brainstorming Unhaunter Game Mechanics ✨` on the left and `🟢 606` on the right sit right on top of the `CHAPTER 1 Genesis Architecture` header, covering `Recap` and the `^` fold button. In Artifacts, `🟢 606` sits directly on top of the upload button next to the search box.
   Why? Because we banned sticky top bars (rightly — on a 350×700 phone, a sticky bar steals vertical space forever), so the pills float with `position: absolute`. But I didn't put any empty space at the top of the scrolling list for them to live in when you're scrolled to the top!
   And the fix is NOT a fixed or sticky header. If you make it sticky, you lose 50px of phone screen permanently while reading. The fix is an **ordinary spacer inside the scroll container** with a subtle separator line underneath it. When you're at the top of the scroll, the floating pills sit in that empty space above the separator line. The moment you scroll down to read, that space and that separator scroll up and disappear off the top of the screen like any other message, giving 100% of the screen to the text. When you scroll all the way back up, the space comes back so the pills never overlap the first item.

2. **Image 3 — The folder row in Artifacts is a dead museum label.**
   Look at `Unhaunter Brainstorming Notes`. It has a little blue dot on the left. What does the dot do? Nothing. It's `art.color`, a leftover decorative hex code from when nodes had random pastel colors. Can you click it? No. Can you attach this note to the chat from here? No. Can you see if it's already in the chat, or change it from `Full` to `Title`? No — you have to tap the row, open a full-screen detail modal, find the toolbar, tap a button, close the modal, and repeat that ten times if you want to curate ten notes.
   Meanwhile I built a separate `AttachmentPicker.tsx` modal that duplicates the folder list just so you can click "Attach". That's two lists of the same artifacts, neither of which actually lets you steer properly.

3. **Image 4 — Where do attachments actually live in a conversation?**
   Look at the bottom of the chat view: `CHAPTER 1 Genesis Architecture` above, `[ 🔊 Kore v ] [ Keep typing... ] [ ➤ ]` below.
   Suppose I go to the folder view and select three notes to attach. Where do they go?
   Yesterday I made `attachArtifact` dump them straight into a timeless array on the thread. That was wrong in two ways at once:
   - First, **before I send my next message**, there is nowhere above the input box showing me what I'm about to attach, how many tokens those attachments cost, or letting me hit `×` because I clicked the wrong note by mistake.
   - Second, **after I send the message**, there is no record in the chat history of *when* those notes entered the conversation.
   And this is the insight David just handed me: **"you can't detach" is not some arbitrary rule we made up — it's because attachments follow chat turns.**
   Before you hit Send, an artifact you selected is just *staged* for the next turn. Of course you can remove it (`×`) while it's sitting in the input box waiting to be sent! You haven't sent the turn yet!
   Once you hit Send, those staged attachments get welded onto that turn in the chat history (just like an email attachment or a file you dropped into a message). Now it's part of the conversation history at Turn 3. You can't "detach" it for the exact same reason you can't delete Turn 3 — it already happened. What you *can* do, at any point later, is dial its granularity down (`Full → Summary → Description → Title`) so Turn 3's attachment stops eating your token budget without erasing the fact that it was brought up there.

4. **Image 1 again — The Chapter header is lying to my face.**
   Look at the Chapter 1 bar: `2 msgs | Title | Description | Summary | Full | Recap | ^` and underneath it: *"Sent to the model as Summary — these messages are shown for reading, not sent."*
   What is `Recap` doing there?! Yesterday I was too timid to hide the messages when you clicked `Summary` or `Title`, because I thought "what if the chapter doesn't have a summary yet, or what if the user wants to read the old messages?" So I kept showing the raw messages, left the old `Recap` button next to the four granularity buttons, and slapped a little apology banner underneath saying "hey, what you're looking at isn't what we're sending."
   That completely violates the Mirror Principle from `motivation.md` (*"The chat interface must be almost 1:1 with whatever the tool will send you. Same order, same contents. If we summarize, present it summarized to the user the same way; show tokens per chapter"*).
   If I click `Title`, I must see **only the title**. If I click `Summary`, I must see **the description + summary**, and I must **not** see the raw turns. I see what I send. `Recap` is a disconnected zombie feature from before chapters had granularity — kill it. The apology banner is a confession that the view was lying — kill it. And put the chapter's **token count** right on the chapter header so when I tap `Full → Summary → Title`, I watch the tokens drop from `420 tok` to `85 tok` to `12 tok` and I immediately see what I just saved.

---

## How the whole thing actually works (one coherent mental model)

Let's walk through how a human (David, on a phone or desktop) uses this from top to bottom.

### 1. The 6-Color Language: green is cheap, red is heavy, bright means dark text

Every artifact row in the folder view — and every attachment pill/card in the chat — has a state in the current chat. There are **6 states total**: 2 for when the artifact is *not yet in the chat history*, and 4 for when it *is in the chat history* at one of the four granularities.

The color rule is about **token heat**: fewer tokens is better (green), more tokens is worse (red). And whenever a pill or row background goes bright, its text flips to dark (`#080d16` / `slate-950`) so it's razor-sharp instead of white-on-yellow mush.

Here are the 6 states:

1. **Not staged (not in this chat):**
   - Dim default row (`bg-[#0c1322]`, light text `#e3edf7`), dim slate-blue dot (`#475569`).
   - It costs 0 tokens in this chat right now.
2. **Staged (queued for the next message, not sent yet):**
   - **Very bright cyan/ice** dot and row/pill highlight (`bg-[#67e8f9]` / `#22d3ee`, **dark text `#06131f`**).
   - It stands out immediately as *"this is armed for your next Send"*.
   - Because it hasn't been sent yet, you can toggle it right back off.
3. **Committed at `Title` (cheapest — green):**
   - Bright emerald green (`bg-[#34d399]`, **dark text `#052e16`**).
4. **Committed at `Description` (light — yellow):**
   - Bright warm yellow (`bg-[#fde047]`, **dark text `#1c1917`**).
5. **Committed at `Summary` (medium — orange):**
   - Bright orange (`bg-[#fb923c]`, **dark text `#1c1008`**).
6. **Committed at `Full` (heaviest — red):**
   - Vivid red/coral (`bg-[#f87171]`, **dark text `#1f0707`**).

*(Note: I think making the dot + the active granularity pill — or the row accent/fill — carry this bright background with dark text gives us the exact contrast switch without turning a 4-line paragraph in the folder into a blinding neon brick, OR we can tint the whole row background brightly with dark text when staged/attached. Actually, David literally asked: "Can we make the text change color to match the background too? so if the background goes bright the text goes dark??" Yes! Let's make the whole row/pill background take the state color with dark text when staged or committed, and keep unstaged rows dark with light text. That way, scrolling through the folder, every artifact that is active in your chat lights up in its heat color — green/yellow/orange/red, or bright cyan if staged — with crisp dark text.)*

### 2. What clicking the Dot does (and inline controls in the Folder view)

In the Artifacts Folder view, you never have to open the detail modal just to attach or change granularity.

- **Clicking the row body (title / description)** still opens `ArtifactDetailModal` so you can read or edit the markdown.
- **Clicking the circle dot on the left** (`e.stopPropagation()`) is the quick action:
  - If the artifact is **not in the chat yet**: clicking the dot toggles **Not Staged ↔ Staged** (dim ↔ very bright cyan, at `Full` by default).
  - If the artifact is **already committed in the chat**: clicking the dot **cycles its granularity** (`Title → Description → Summary → Full → Title`), shifting the row through Green → Yellow → Orange → Red and updating its token count live.
- **Right on the row (inline):**
  - When staged or committed, the row also shows the 4 granularity pills (`Title | Description | Summary | Full`) and the exact token cost at the current cut (`184 tok`), so if you don't want to cycle 3 times with the dot you can tap `Title` directly.
  - When **staged** (not sent yet), there's also a clear `Unstage` / `×` button (in addition to tapping the dot).
  - When **committed** (already sent on a turn), there is **no detach button** — only the granularity controls.

### 3. Navigating between Chat and Folder (`[ + ]` and the floating Chat bubble)

Right now the chat composer has a `🔊 Kore v` voice picker taking up space on the left of the input bar, and no `[ + ]` button to attach artifacts.

- **Move the TTS Voice selector into the Sidebar.** Nobody changes their TTS voice every two messages; it belongs in the sidebar settings, not eating horizontal space on a 350px phone composer.
- **Put a `[ + ]` button on the left of the chat composer** (both in the bottom input bar and in the empty-chat hero composer). Clicking `[ + ]` switches `activeView` straight to the **Artifacts Folder view**.
- **Delete `AttachmentPicker.tsx`.** We don't need a separate modal picker anymore because the Artifacts Folder view *is* the picker.
- **Add a floating Chat bubble button at the bottom-right of the Artifacts view** (next to the `Folders | Graph` pill, moving the `+` import button or keeping import in the top row next to Search where `Upload` already is!).
  Look at `ArtifactsLibraryView.tsx` right now: there are *two* import buttons — an `Import` button next to the Search bar at the top, AND a floating `+` button at the bottom right! That bottom-right `+` was redundant. Replace that bottom-right floating button with the **floating Chat bubble icon** (`MessageSquare`) that takes you straight back to the Chat view (with a badge showing how many items you have staged if `> 0`).
- **Bottom margin in the folder scroll container:** give the folder list generous bottom padding (`pb-28`) so you can scroll the very last artifact completely above the floating buttons at the bottom.

### 4. The Staged Tray in the Chat Composer → Welded to the Turn on Send

When you stage one or more artifacts in the folder view and tap the floating chat bubble to come back to Chat:

- **Before you send (Image 4):**
  Inside the chat composer box (right above the textarea), a **Staged Attachments strip** appears.
  Each staged artifact is rendered as a bright staged pill/row showing:
  - its dot + title,
  - its token count (`184 tok`),
  - the 4 granularity buttons (`Title | Description | Summary | Full`) so you can dial it down *before* sending if you see the token orb getting too high,
  - and an `×` button to unstage it.
  Crucially: **`useContextPayload` includes staged attachments in the live compile**, so the `🟢 606` orb at the top right updates *immediately* as you stage/unstage items. You see the exact token cost of your next turn before you press Send.

- **When you press Send:**
  In `sendQueue.ts`, right when the user turn is appended to the thread (`const userTurn = this.appendTurnToThread(...)`), we call `threadRegistry.commitStagedAttachments(threadId, userTurn.id, userTurnIndex)`.
  Every staged attachment gets `turnId: userTurn.id` and `turnIndex: userTurnIndex` stamped onto it.
  The staged tray in the composer empties out, and those attachments now appear **inline in the chat stream on that user turn**.

- **What about artifacts the LLM extracts during its reply?**
  When `onArtifact` fires during the assistant's reply, that artifact is auto-attached and welded to `assistantTurnId` at `Full` (idempotent — if the artifact was already attached earlier in the chat, it keeps its original turn anchor and user-chosen granularity; we never reset a granularity the user already lowered).

- **What an attachment looks like on a turn in the chat stream:**
  On the turn where it was introduced, we render a compact attachment card: colored by its current granularity (Green/Yellow/Orange/Red with dark text), showing its title, its current token cost, and the `Title | Description | Summary | Full` buttons. Clicking the title opens the detail modal; clicking the dot or the granularity buttons changes how much of it gets sent on future turns. There is no `×` button, because that turn is history.

### 5. Chapters: "What You See Is What You Send", Token Count, and Compacted Attachment Strips

Let's clean up `ChatView.tsx` chapters completely:

1. **Kill `Recap` and kill the "Sent to the model as…" apology banner.**
   Delete `expandedSummaryIds`, delete `toggleExpandSummary`, delete the `Recap` button, delete the honest strip.

2. **Put the Chapter Token Count right in the chapter header.**
   The compiler already calculates `chapterBreakdown` with the exact token count for every chapter at its current granularity (`compiledContext.telemetry.chapterBreakdown`). Pass those per-chapter token counts into `ChatView` (or compute with the exact same `chapterXml` + `estimateTokens` helper).
   Now the chapter header shows:
   `Chapter 1 · Genesis Architecture` — and on the right: `2 msgs · 184 tok`, the 4 granularity buttons (`Title | Description | Summary | Full`, colored Green/Yellow/Orange/Red when active with dark text!), and the fold chevron `^ / v`.

3. **When the chapter is unfolded, its body shows ONLY what is being sent at that granularity:**
   - **`Title`**:
     The chapter sends only `<title>`. So the chapter shows **only the header bar** (plus any committed-attachment strip from this chapter — see #4 below). No description, no summary, no messages.
   - **`Description`**:
     The chapter sends `<title>` + `<description>`. So the body below the header shows **only the chapter's description** (plus the chapter's attachment strip). The raw messages are NOT rendered.
   - **`Summary`**:
     The chapter sends `<title>` + `<description>` + `<summary>`. So the body shows **the description and the summary** (plus the chapter's attachment strip). The raw messages are NOT rendered.
   - **`Full`**:
     The chapter sends `<title>` + `<description>` + `<summary>` + `<turns>`. So the body shows the description/summary (if present) and **all the verbatim messages** of the chapter (with each turn's attachments rendered inline on the turn where they were attached).

4. **What if a chapter is set to `Description` or `Summary`, and those fields are empty?**
   This happens when an old chapter seals (`Full → Summary`) or when you manually click `Description` / `Summary` on a chapter that hasn't been summarized yet.
   - First: **when a chapter seals** (in `handleDeclareChapter` or `onTopicShift`) — or **when you click `Description` or `Summary` on a chapter whose description/summary is empty** — we automatically trigger `onSummarizeChapter(chapter.id)` in the background so Gemini writes the `description` and `summary` right away.
   - While it's generating (or if no API key is configured / it hasn't run yet), the unfolded box shows a clean one-line status with a `[Generate summary]` / `[Regenerate]` button so you're never staring at a mystery blank box.

5. **Keeping a chapter's attachments visible when the chapter's turns are hidden:**
   As we agreed: an artifact's granularity is independent of the chapter's granularity. If you attached `Unhaunter Brainstorming Notes` at Turn 2 (inside Chapter 1), and later you fold Chapter 1 or set Chapter 1 to `Title` or `Summary`, Turn 2's message bubble is no longer on screen — **but that attachment is still being sent to the LLM!**
   So whenever a chapter's turns are hidden (because `granularity !== 'full'` OR because the chapter is collapsed with `^`), any attachments that were committed during that chapter's turns (`turnIndex` within `[chapter.startIndex, chapter.endIndex)`) render in a **compact attachment strip right under the chapter header**. You can still see them, see their token cost, and change their granularity (`Title | Description | Summary | Full`) even while the chapter's conversation is compacted to `Title`. When the chapter is unfolded at `Full`, they sit on their actual turns instead (no duplicate strip).

### 6. Top Clearance + Separator in Scroll Containers (Zero Fixed Bars)

In both `ChatView.tsx` (the chat feed scroll container) and `ArtifactsLibraryView.tsx` (the folder list scroll container):

- The floating pills at the top (`Sidebar` hamburger at `top-3 left-3`, thread title pill at `top-1.5 left-14`, `SaturationOrb` at `top-3 right-4`) occupy roughly the top `0..48px` of the viewport.
- Instead of any fixed/sticky header bar, the **first element inside the scrolling div** is an in-flow clearance header:
  ```tsx
  <div
    data-testid="scroll-top-clearance"
    className="h-11 shrink-0 border-b border-[#162234]/80 mb-3"
    aria-hidden="true"
  />
  ```
- When `scrollTop === 0`, that 44px space + separator line sits directly behind the floating pills, and the real content (Chapter 1 in Chat, or the Search + Import bar in Artifacts) starts *below* the separator line. Nothing overlaps!
- When you scroll down (`scrollTop > 0`), that spacer and separator scroll up out of the viewport with the content, so on a phone screen you get the entire height of the window for reading.

---

## Concrete Implementation Plan (File by File)

### Phase 1 — Shared Granularity Palette + Single Token Measurer (`src/domains/granularity.ts` & `src/domains/03-optical-compiler/index.ts`)
1. In `src/domains/granularity.ts`:
   - Add `cycleGranularity(current: Granularity): Granularity` (`title → description → summary → full → title`).
   - Add visual state tokens (`AttachmentVisualState = 'unstaged' | 'staged' | Granularity`) and a shared styling helper `getStateStyle(state: AttachmentVisualState)` returning the 6-color classes (dot color, bright background fill, dark contrasting text color, border color) so `ArtifactsLibraryView`, `ChatView`, `MirrorPanel`, and `ArtifactDetailModal` use the exact same 6 colors and dark-text contrast rule.
2. In `src/domains/03-optical-compiler/index.ts`:
   - Export `artifactXml(art, granularity)` and `chapterXml(chap, granularity, turns)` plus `estimateArtifactCutTokens(art, granularity)` and `estimateChapterCutTokens(chap, granularity, turns)` so UI surfaces and the compiler always compute the exact same token count to the last integer.
   - Carry `staged: boolean` and `turnIndex: number | null` on `AttachmentBreakdownEntry` so `MirrorPanel` knows which attachments are staged for the next send vs. already committed on a turn.

### Phase 2 — Staged vs. Committed Attachments in `ThreadRegistry` & `sendQueue`
1. In `src/domains/06-chat-threads/types.ts`:
   - Extend `ChatAttachment`:
     ```ts
     export interface ChatAttachment {
       artifactId: string;
       granularity: Granularity;
       addedAt: number;
       /** null = staged for next turn (can be unstaged); number = committed at that turn index in the thread (cannot be detached). */
       turnIndex?: number | null;
       turnId?: string | null;
     }
     ```
2. In `src/domains/06-chat-threads/ThreadRegistry.ts`:
   - In `normalizeAttachments`: preserve `turnIndex` and `turnId`; if a legacy snapshot attachment has `turnIndex === undefined`, default it to `0` (committed at the start of the thread) so existing saved attachments don't suddenly pop up as unsent staged items.
   - Add / update methods:
     - `stageArtifact(threadId, artifactId, granularity = 'full')`: if not present, adds with `turnIndex: null, turnId: null`. If already staged (`turnIndex === null`), leaves it. If already committed (`turnIndex !== null`), leaves it untouched.
     - `unstageArtifact(threadId, artifactId)`: removes the attachment **only if `turnIndex === null`**. If `turnIndex !== null` (committed), it is a no-op!
     - `toggleStageOrCycleAttachment(threadId, artifactId)`:
       - If not attached → `stageArtifact(threadId, artifactId, 'full')`
       - If staged (`turnIndex === null`) → `unstageArtifact(threadId, artifactId)`
       - If committed (`turnIndex !== null`) → cycles granularity via `cycleGranularity(existing.granularity)`.
     - `commitStagedAttachments(threadId, turnIndex, turnId?)`: stamps `turnIndex` and `turnId` on every attachment where `turnIndex === null`.
     - `attachArtifact(threadId, artifactId, granularity = 'full', turnIndex: number | null = null, turnId: string | null = null)`: used by auto-extraction on an assistant turn (passes the assistant turn's index and id so extracted artifacts are immediately committed to the turn that birthed them) or staging when `turnIndex` is `null`.
3. In `src/application/sendQueue.ts`:
   - When a new user turn is appended (`mode !== 'retry'`), get its index (`const userTurnIndex = this.turnsOf(deps, threadId).length - 1`) and call `deps.threadRegistry.commitStagedAttachments(threadId, userTurnIndex, userTurn.id)` BEFORE compiling and streaming, so the attachments are welded to that user turn and compiled into the prompt.
   - When `onArtifact` fires during streaming, pass the assistant turn's index and `assistantTurnId` into `attachArtifact(threadId, artifactId, 'full', assistantTurnIndex, assistantTurnId)`.
4. In `src/ui/context/useContextPayload.ts`:
   - Include `turnIndex` in `attachmentKey` so staging/committing re-runs the memo cleanly.

### Phase 3 — Artifacts Folder View (`src/ui/artifacts/ArtifactsLibraryView.tsx`)
1. Top scroll clearance: add the in-flow spacer + bottom border as the first child of the folder scroll container so the floating hamburger and `SaturationOrb` (`🟢 606`) never overlap the Search bar or `Import` button when scrolled to top, and scroll away when scrolling down.
2. Row state & 6-color styling:
   - Pass `attachments: ChatAttachment[]`, `onToggleDot(artifactId)`, `onStage(artifactId)`, `onUnstage(artifactId)`, `onSetAttachmentGranularity(artifactId, granularity)`, and `onReturnToChat()` into `ArtifactsLibraryView`.
   - Each row derives its `AttachmentVisualState`: `'unstaged'`, `'staged'`, or committed `'title' | 'description' | 'summary' | 'full'`.
   - When `'unstaged'`: dark card background, light text, dim dot. Clicking the dot stages it (turns bright cyan with dark text). Also show token cost at `Full` and a subtle `Stage` button on the right.
   - When `'staged'`: bright cyan background with dark text! Clicking the dot (or the `×` button on the right) unstages it. The 4 granularity chips (`Title | Description | Summary | Full`) are interactive right on the row (`stopPropagation`) so you can pre-select the granularity before even returning to chat.
   - When committed (`title` / `description` / `summary` / `full`): row lights up in its rainbow heat color (Green / Yellow / Orange / Red) with dark contrasting text! Clicking the dot cycles granularity; clicking any of the 4 granularity chips jumps directly to that granularity. Shows `Turn N · X tok` and **no `×` button**.
3. Bottom-right floating **Back to Chat** bubble button (`MessageSquare`):
   - Replaces the redundant bottom-right `+` import button (since `Import` is already at the top right next to Search).
   - Shows a badge with the count of staged attachments when `stagedCount > 0`.
   - Folder scroll container has `pb-28` so all rows clear the floating buttons at the bottom.
4. Delete `src/ui/chat/AttachmentPicker.tsx` and remove its state from `App.tsx`.

### Phase 4 — Chat View, Staged Tray, Turn Attachments, Chapters, and Sidebar Voice Picker (`src/ui/chat/ChatView.tsx` & `src/ui/workspace/Sidebar.tsx`)
1. **Top scroll clearance in `ChatView`:**
   - First child inside the chat scroll container (and hero scroll container) is the in-flow spacer + separator line (`h-11 border-b border-[#162234]/80`), so the floating thread title pill and `SaturationOrb` sit cleanly above the line at scroll-top and scroll away on scroll-down.
2. **Move TTS Voice selector to `Sidebar.tsx`:**
   - Lift `chosenVoice` / `onSelectVoice` to `App.tsx` (default `'Kore'`), pass into `Sidebar` (compact voice selector row) and `ChatView` (for `handlePlayTTS`).
3. **`[ + ]` button + Staged Tray in `ChatView` composer (both hero and bottom bar):**
   - Above the textarea in the composer, if `stagedAttachments.length > 0`, render the **Staged Tray**: each staged item as a bright cyan pill/row with dark text, its title, token count, the 4 granularity chips, and `×` to unstage.
   - To the left of the textarea, render the `[ + ]` button (`title="Attach artifacts from folder"`) which switches `activeView` to `'artifacts'`.
4. **Chapters — "What You See Is What You Send" + Token Count + Auto-Summarize:**
   - Remove `Recap` button, `expandedSummaryIds`, and the `granularity !== 'full'` apology banner.
   - Show `${chapterTokens} tok` right in the chapter header next to `${turns.length} msgs`.
   - Style the chapter header's 4 granularity chips (`Title | Description | Summary | Full`) with the rainbow heat colors (Green / Yellow / Orange / Red + dark text for the active chip).
   - Clicking a granularity chip sets the chapter granularity, unfolds the chapter if collapsed, and if `Description` or `Summary` is selected while that layer is empty (and there are turns), automatically triggers `onSummarizeChapter(chapter.id)`.
   - Also trigger `onSummarizeChapter` automatically when a chapter is sealed via `handleDeclareChapter` or `onTopicShift`.
   - Render the unfolded chapter body strictly according to `granularity`:
     - `title`: nothing below the header (except the chapter's committed-attachment strip if any).
     - `description`: renders the chapter description box (or a compact generating/summarize prompt if empty). No turns.
     - `summary`: renders the chapter description + summary box (or generating/summarize prompt if empty). No turns.
     - `full`: renders description/summary (if present) + the verbatim turns.
5. **Turn-anchored committed attachments & compacted chapter attachment strip:**
   - When a chapter renders its turns (`granularity === 'full'` and not collapsed), each turn renders any attachments committed on that turn (`att.turnId === message.id` or `att.turnIndex === globalTurnIndex`) as a rainbow-colored attachment card (Green/Yellow/Orange/Red with dark text, dot cycler, 4 granularity chips, token count, click title to inspect, **no `×`**).
   - When a chapter's turns are hidden (`granularity !== 'full'` or `isCollapsed`), any attachments committed within that chapter's turn range (`[chapter.startIndex, chapter.endIndex)`) render in a compact strip right below the chapter header so they never disappear when a chapter is compacted.

### Phase 5 — MirrorPanel & ArtifactDetailModal updates
1. `MirrorPanel.tsx`:
   - Split section 2 into **Staged for next turn** (bright cyan badge, granularity chips, token count, `×` unstage button) and **Committed in chat** (rainbow chip color, `Turn N`, granularity chips, token count, no `×`).
   - `+ Attach` button in Mirror closes the mirror and navigates to the Artifacts Folder view (`setActiveView('artifacts')`).
2. `ArtifactDetailModal.tsx`:
   - Update toolbar to reflect the 3 attachment states: Not in chat (`Stage for next turn`), Staged (`Staged for next turn` + 4 rainbow/cyan chips + `Unstage`), or Committed (`In chat (Turn N)` + 4 rainbow chips, no detach).

### Phase 6 — Tests & Evidence Harness
1. Update `src/tests/attachments.test.ts` and `src/tests/optical-compiler.test.ts` to cover:
   - `stageArtifact` → `unstageArtifact` works while staged;
   - `commitStagedAttachments` welds to `turnIndex` / `turnId`;
   - `unstageArtifact` on a committed attachment is a no-op (cannot detach after send);
   - `toggleStageOrCycleAttachment` toggles unstaged ↔ staged and cycles `title → description → summary → full → title` when committed;
   - Chapter and artifact cut token helpers match compiler breakdown 1:1.
2. Update `scripts/evidence.cjs` journeys for the new flow (top clearance non-overlap check, folder dot staging + rainbow cycling, floating chat bubble return, staged tray in composer, chapter cut view without `Recap` + chapter token count) and run all three gates (`bunx tsc --noEmit`, `bunx vitest run`, `node scripts/evidence.cjs`).

---

## 18. What actually shipped (2026-10-20, `dev-altair`)

Everything specified above is in the code. Gates at commit: `bunx tsc --noEmit`
clean, `bunx vitest run` 118/118 across 15 files, `node scripts/evidence.cjs`
**GREEN — 17/17 journeys, 0 failures, 0 warnings, 0 geometry fails/warns,
0 console/page/http errors**.

**The timeline (data + domain)**
- `ChatAttachment` gained `turnIndex` / `turnId`. `null` = staged; a number =
  welded to that turn. `ThreadRegistry`: `stageArtifact`, `unstageArtifact`
  (no-op once committed), `commitStagedAttachments`, `toggleStageOrCycleAttachment`
  (the dot verb), `getStagedAttachments`.
- Legacy snapshots without a `turnIndex` hydrate as **committed at turn 0** —
  already-sent attachments never resurrect into the staged tray.
- `sendQueue` welds staged attachments to the user turn it just persisted,
  *before* compiling, so the announcing turn and the payload agree. Extracted
  artifacts are welded to the assistant turn that produced them (idempotent).

**The surfaces**
- **Folder = picker.** Every row is a state: dim (unstaged) → bright cyan
  (staged) → green/yellow/orange/red (committed at title/description/summary/
  full), always with dark text on a bright fill. Dot = verb: stage / unstage /
  cycle. The four chips sit on the row; the token count comes from the
  compiler's own `estimateArtifactCutTokens`. `AttachmentPicker.tsx` is deleted.
- **Composer.** A staged tray above the input (in the hero composer too), each
  item removable with `×` and re-cuttable, included in the live total. `[ + ]`
  replaces the voice selector and opens the folder. The voice selector moved to
  the sidebar.
- **Chat.** Attachments render on the turn that carried them (no `×`), and a
  compact strip under the chapter header whenever the chapter's turns are not
  on screen — so a chapter cut can never hide the artifacts you still steer.
- **Chapters.** `Recap` and the honest strip are gone. The body renders exactly
  the layers the cut includes (description → summary → turns at Full) plus
  chrome for a layer the chosen cut promises but doesn't have yet ("Write it").
  Token count per chapter sits in the header; the chips wear the heat colors.
- **Top clearance.** An in-flow spacer + separator, first child of the chat
  feed and the folder list. It scrolls away; nothing is sticky.
- **Mirror.** Split into *Next send* (staged, removable) and *In the chat*
  (committed, granularity only), with turn provenance.

**Two honest gaps**
1. **Auto-summarize on seal is only half-wired.** A *manual* split now fires the
   background summarize for the chapter it seals (`createChapterHandlers`), and
   clicking `Description`/`Summary` on a chapter missing that layer fires it
   too. But a chapter sealed by the *model's* `<topic_shift>` is not
   auto-summarized: that seal happens inside the stream, for whatever thread,
   and the summarize endpoint is active-thread-only today. Those chapters show
   the honest "No summary yet" chrome until someone asks. Fixing it properly
   means a thread-aware summarize call in the queue — one call per chapter
   boundary, which is a money decision, not a code decision.
2. **No "Regenerate" affordance** next to a chapter's token count. `Write it`
   covers the empty-layer case only; re-summarizing a stale summary has no
   button yet.

## 19. Laws added 2026-10-21 (`dev-vega`) — chat noise, and the cut law

**The chat card is a card, not a control panel.** Inside the chat, an artifact
renders WITHOUT the `Title | Description | Summary | Full` chips: the row body is
the whole control (click cycles the cut, the dot does the same), and the card is
a fixed **240px** — a quarter narrower than the 320px library/staged row, and
deliberately NOT `grow`ing, because a growing card fills its line and the
reduction would never be visible. The chips stay where a cut is *chosen*: the
folder row, the staged tray (with its bulk "Set all to"), the chapter header,
the detail modal. Props: `AttachmentRow`'s `hideGranularityChips` +
`size="compact"`; `ChatView` passes both on the chapter strip and the per-turn
strip. Evidence: J15 counts `[data-granularity]` inside the chat card (0),
measures its width (≤260px) and clicks it to prove the cycle.

**Nothing but the user moves a chapter's cut.** The app auto-sealed every
chapter the moment it closed (`full → summary`), so chapters "defaulted to
Summary" and quietly sent less than the user asked for — indistinguishable from
a summary the user had chosen. `sealedGranularity` is deleted; sealing,
splitting and closing only fix turn windows now, and
`resolveChapterGranularity(chapter)` is "the explicit choice, else Full". A
snapshot written before the law carries no `granularityLaw` marker, so hydrate
resets those auto-sealed `summary` values to Full **exactly once** — the marker
(`GRANULARITY_LAW`, written on every save) makes it idempotent, so a Summary
picked by hand afterwards survives every reload.

## 20. Law added 2026-10-22 (`dev-vega`) — the composer's keyboard contract

David: *"Shift+Enter never sends, Ctrl+Enter always send, and Enter may or may
not send depending on a configuration. We need an option in the sidebar for
Enter (even on phone) sending or not sending by default."*

**Three keys, three fixed truths, one preference — and the truths are not
negotiable.** `Shift+Enter` never sends (it always makes a new line);
`Ctrl/Cmd+Enter` always sends, in every mode and on every keyboard; only a
**bare Enter** answers to the preference. Nothing else is a send, and a keypress
arriving mid-IME (`isComposing`) is never a send either — treating a candidate
commit as "send" would fire a half-typed message.

**One pure function owns it.** `composerKeyAction(event, mode)` in
`src/ui/chat/sendOnEnter.ts` returns `send | newline | ignore`; both composers
(hero and in-thread) route through a single `handleComposerKeyDown`. The old
inline rule (`e.key === 'Enter' && !e.shiftKey`) is gone — it was unconfigurable
and sent on Ctrl+Enter's behalf by accident. A `newline` verdict deliberately
does **not** `preventDefault`: the textarea inserts the break itself.

**The preference is a browser preference, not project data.** `enterSend` is
`'send' | 'newline'`, defaults to `'send'` (the behaviour we always had, stored
as *absence* of the key), and persists in localStorage next to `chatRender`. So
the sidebar — where it lives — carries it on a phone too, through the drawer;
that is why it is not in the composer. Evidence: **J20** flips the switch and
presses all three keys in the real composer, then reloads at 390px and opens the
drawer to prove the option is reachable there and the choice survived.

## 21. Law added 2026-10-22 (`dev-vega`) — a note is sent as a FILE, not as a row

David, verbatim: *"it seems that we are sending the IDs to the LLM in chat which
incorrectly is taking it as the filename, so it says things like '…the early,
sprawling sci-fi/4D procedural dream (art-1792614286498-4845,
art-1792614209332-9472)…' — we need to present clear filename-like to the AI."*

**Root cause.** `artifactXml` opened every attached note with
`<artifact id="art-1792614286498-4845">` — the internal database key. Nothing
told the model what that was, so it read it as the note's name and wrote it into
prose. The payload was correct in content and wrong in *addressing*.

**The fix: the note's name is its title, slugified, as a filename.** A machine id
is a key; a reader — human or model — needs a handle, and the title is the handle
the model would reach for anyway. So:

```
<artifact file="early-sprawling-sci-fi-4d-procedural-dream.md" granularity="summary">
  <title>Early, sprawling sci-fi/4D procedural dream — Non-Euclidean mazes, gradient descent AI, heavy logistics.</title>
```

- `artifactFileName()` slugifies the **title** (falling back to the note's `code`,
  then to `note.md`, when a title is punctuation or non-latin script); it clamps
  at 60 characters without leaving a trailing dash.
- `uniqueFileName()` disambiguates per payload — two notes may legitimately share
  a title, and a name that means two notes is worse than none (`-2`, `-3`).
- **`id` is gone from the payload entirely.** Telemetry still carries
  `artifactId` — that is app-side, and the mirror's breakdown rows still key on
  it; what the *model* reads has no keys in it.

**The whole protocol now speaks filenames.** The system instruction says notes are
named by their `file` and never to invent an identifier; the upsert example is
`<artifact_upsert file="kebab-case-slug.md" …>` and links are
`<link source="file1.md" target="file2.md">`. The stream parser accepts `file`
(stripping the extension so the note id stays a clean slug) **and** the legacy
`id` — anything already emitting `id="…"` keeps working. Server-side
`DEFAULT_SYSTEM_INSTRUCTION` is kept in step.

**One honest gap, unchanged by this.** A note the *app* created has a
timestamped id (`art-…`), and there is no code→id resolver, so a model that
re-emits an attached note's filename creates a second note instead of updating
the first. That was already true when the model had to invent a slug; this change
does not fix it and does not make it worse. Fixing it means resolving an incoming
`file` against attached/known notes before upsert — a deliberate next step, not a
side effect.

Tests: `src/tests/artifact-filename.test.ts` (15). Evidence: **J16** reads the
literal raw payload out of the Mirror and asserts it names the fixture note as
`<artifact file="fixture-artifact-alpha.md"` and contains **no** `art-fx-` id.
