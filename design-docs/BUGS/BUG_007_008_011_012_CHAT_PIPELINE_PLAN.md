# Implementation Plan: In-Place Chat Operations, True Raw View, Compiler Stubs & Streaming (`BUG-007`, `BUG-008`, `BUG-011`, `BUG-012`)

- **Status**: **100% Clear — Ready for Implementation** (approved by David on 2026-10-31).
- **Covers**:
  - **BUG-007**: Render `<link>`, `<unlink>`, `<artifact_upsert>`, and `<topic_shift>` chips **IN PLACE** right where the model wrote them in the message prose (never dumped as a disconnected block at the bottom of the bubble).
  - **BUG-008**: Make `<> Raw` show the **real, unprocessed model output** (XML included in its exact spot), with `<artifact_upsert>` blocks **collapsible (`[+]` / `[-]`) by default** so huge artifact bodies don't flood the screen unless expanded.
  - **BUG-011**: Preserve operations in `turn.content` when compiling past turns for the model so the model sees its own past `<link>`, `<unlink>`, and `<topic_shift>` tags in place — and compile past `<artifact_upsert>` blocks into a **self-documenting HTML comment stub** (`<artifact_upsert file="slug.md"><!-- MarkBrain compiler: ... --></artifact_upsert>`) so we never pay 2,000 tokens twice AND never teach the model to emit empty self-closing tags.
  - **BUG-012**: Live streaming & link resolution fixes:
    1. Render streaming partials (`DraftQueueTray` / streaming message) through the same segment renderer so in-progress XML tags (`<artifact_upsert...`, `<link...`, `<topic_shift...`) render as live in-place status chips (`Writing artifact "slug.md"…`, `Linking…`) and prose renders as formatted markdown instead of leaking raw asterisks or blank gaps.
    2. Fix link endpoint resolution so `.md` suffixes, titles, slugs (`code`), and renamed slugs (`previousCodes`) all resolve cleanly, with clear inline traceability when a link endpoint is unresolved or ignored.

> **Workflow Reminder for Implementing Agent**:
> 1. Follow TDD Law: write failing tests first at the real seams (`demuxFullTurn` / `planTurnCommit` / `chapterXml` / `parseMessageSegments` / `MessageBody`), verify RED, then implement to go GREEN.
> 2. Run gates in order: `npx vitest run` -> `npm run build` -> evidence pack.

---

## 1. Root Cause of All Four Bugs

Right now, `demuxFullTurn(rawText)` in `shared/stream/demuxer.ts` strips all `<topic_shift>`, `<link>`, `<unlink>`, and `<artifact_upsert>` XML blocks out of `cleanText`, leaving behind blank empty lines where the XML used to sit. Then `planTurnCommit` saves that stripped `cleanText` as `assistantTurn.content` and throws away the raw text positions!
As a result:
1. **Rendered view (`MessageBubble.tsx`)** has no idea where in the prose the tags were, so it renders the stripped text (with blank gaps) and dumps `TurnReceiptsRow` at the very bottom (`BUG-007`).
2. **`<> Raw` view (`MessageBody.tsx`)** just prints `turn.content` — which is already stripped ("well done meat", `BUG-008`).
3. **Optical Compiler (`src/domains/03-optical-compiler/index.ts`, `chapterXml`)** sends `<turn role="assistant">${t.content}</turn>` into future prompts (`BUG-011` and screenshot `BUG-012-thinking-render-raw-leak.jpeg` from the Mirror / Inspector). Because `t.content` had its `<link>` and `<artifact_upsert>` tags ripped out, the prompt literally says `"Here are the links:\n\n\n"` with nothing below it! The model sees its own past turn with missing links, thinks its previous turn failed, and gets confused.
4. **Link resolution (`planTurnCommit.ts` lines 311–318)** only indexes `artifactFileName({ code, title })` and `a.code`, never `a.title` directly and never `a.previousCodes`! So when the model writes `<link source="Unhaunter Development Design Notes" target="unhaunter-design-and-systems-spec-2.md" kind="relates_to"/>` (mixing a Title on one side and a `code.md` on the other), `sourceId` fails to resolve, producing `? Unhaunter Development Design Notes → ...` and dropping the graph edge!

---

## 2. Architecture of the Fix

### 2.1 Keep Inline XML in `turn.content` (or Compiler-Normalized Form)

Instead of stripping XML tags out of `turn.content`:
- **What `turn.content` stores**:
  The assistant turn's `content` preserves the model's prose **with the XML operation tags in their exact inline positions**!
  Specifically:
  - `<link source="..." target="..." kind="..." />` stays **in place**.
  - `<unlink source="..." target="..." kind="..." />` stays **in place**.
  - `<topic_shift title="..." ... />` stays **in place**.
  - `<artifact_upsert file="slug.md" title="..." ...>...</artifact_upsert>` stays **in place** in `turn.content` (so `<> Raw` and Copy have the exact full text the model produced, in the exact spot).
  - *(Note: if the model emitted legacy fenced blocks like ```` ```artifact ```` or ```` ```topic_shift ````, canonicalize them into `<artifact_upsert ...>` / `<topic_shift .../>` in place or keep them parseable by the segment parser.)*

### 2.2 Compiling Past Turns for the LLM (`chapterXml` in `src/domains/03-optical-compiler/index.ts` & `server/jobs/chatJobRunner.ts`) — `BUG-011`

When building the prompt for a new turn (`chapterXml` in `src/domains/03-optical-compiler/index.ts`, and any transcript builder in `chatJobRunner.ts`):
- **`<link>`, `<unlink>`, and `<topic_shift>` tags inside `t.content` are sent VERBATIM in place.**
  Now, in the Inspector's `Conversation chapters` view (`BUG-012-thinking-render-raw-leak.jpeg`) and in the LLM's context window, right after `"Here are the links:"`, the LLM sees its exact `<link .../>` tags!
- **`<artifact_upsert>` blocks inside `t.content` are compiled into the MarkBrain Compiler Stub** (`compileTurnContentForPrompt(content, attachmentState)`):
  Whenever an `<artifact_upsert ...>[\s\S]*?</artifact_upsert>` block appears in a past turn's `content`, replace its inner body in the compiled prompt with the self-documenting HTML comment:
  ```xml
  <artifact_upsert file="slug.md" title="Title">
  <!-- MarkBrain compiler: Artifact body (1,842 words) was saved into "slug.md" and moved to the attached knowledge substrate above so it is not duplicated in the chat transcript. When creating or updating an artifact in a new reply, you MUST still write the full <subtitle>, <description>, <summary>, and <content> inside <artifact_upsert>. Never emit this compiler comment yourself. -->
  </artifact_upsert>
  ```
  - **Why this works**:
    1. We don't pay 2,000 tokens twice (once in `<knowledge_substrate>` and once in `<conversation_chapters>`).
    2. The model sees in place that its `<artifact_upsert>` succeeded and where the content lives (`"slug.md"`).
    3. It does NOT invent a fake self-closing attribute like `action="saved"` that the model might mimic, and explicitly instructs the model inside the comment never to emit the comment itself.
  - Also add a 1-sentence note in the system prompt where `<artifact_upsert>` is taught:
    *"In past turns of the transcript, completed `<artifact_upsert>` blocks have their body replaced by a `<!-- MarkBrain compiler: ... -->` comment to save context space; when you emit a new `<artifact_upsert>`, always write out the full layer tags and body."*

---

## 3. Segment Parser & In-Place Rendering (`BUG-007` & `BUG-012`)

Create a pure, shared module `src/ui/chat/messageSegments.ts` (and export for tests):

### 3.1 `parseMessageSegments(content: string): MessageSegment[]`

Parses a message string (whether complete or mid-stream!) into an ordered array of segments:

```ts
export type MessageSegment =
  | { kind: 'prose'; text: string }
  | {
      kind: 'link';
      rawXml: string;
      action: 'link' | 'unlink';
      source: string;
      target: string;
      relKind: string;
      streaming?: boolean;
    }
  | {
      kind: 'topic_shift';
      rawXml: string;
      title: string;
      subtitle?: string;
      description?: string;
      summary?: string;
      streaming?: boolean;
    }
  | {
      kind: 'artifact_upsert';
      rawXml: string;
      id: string;
      file: string;
      title: string;
      type: string;
      innerXml: string;
      wordCount: number;
      streaming?: boolean;
    };
```

- **Handling complete tags**:
  Matches `<link .../>`, `<unlink .../>`, `<topic_shift .../>`, and `<artifact_upsert ...>[\s\S]*?</artifact_upsert>` (plus `<artifact ...>...</artifact>`) in exact order of appearance, emitting `{ kind: 'prose', text }` for the markdown text between them.
  *(Collapse excessive blank lines immediately surrounding a tag so stripping/replacing a tag never leaves awkward 3-line vertical holes.)*
- **Handling in-progress streaming tags at the tail of `content` (`BUG-012`)**:
  If the string ends with an **unclosed** sentinel tag (e.g. `<artifact_upsert file="foo.md" title="Foo">...partial body...` without `</artifact_upsert>` yet, or `<link source="a"` without `/>` yet, or `<topic_shift title="New"` without `/>` yet):
  - Do NOT leak raw half-written XML into the prose markdown!
  - Emit a trailing segment with `streaming: true` (extracting whatever `file`/`title`/`source`/`target` attributes have arrived so far).

### 3.2 In-Place Rendered Mode in `MessageBody.tsx` / `MessageBubble.tsx` (`BUG-007`)

In **Rendered (Markdown) mode**:
- Iterate through `parseMessageSegments(content)` in order:
  1. **`prose` segment**: Render with `renderMarkdown(seg.text)`.
  2. **`link` segment**:
     - If `seg.streaming`: render a subtle inline pulsing chip: `Linking ${seg.source || '…'} → ${seg.target || '…'}…`
     - If complete: look up the matching receipt in `message.extractedLinks` (or resolve against `artifactTitles` / workspace artifacts) and render the **Link Chip right here in place**!
     - **Traceability on the Link Chip**:
       - Both endpoints (`from` and `to`) show their resolved human title (with `slug.md` on hover), and clicking source or target opens that artifact.
       - Show the relation kind badge (`relates_to`, `parent_of`, etc.) clearly between the two names: `[Source Title] ── relates_to ──▶ [Target Title]`.
       - If an endpoint failed to resolve (`!sourceId || !targetId`), show an explicit warning badge on the unresolved side (e.g. `⚠ Unresolved: "foo.md" (not found in project)`) instead of a mysterious `?`.
       - If `Capabilities: Link artifacts` was OFF (`!applied`), show `(ignored — Link artifacts was off)`.
  3. **`artifact_upsert` segment**:
     - If `seg.streaming`: render a live in-place card: spinner + `Writing artifact "${seg.title || seg.file || 'note'}"… (${seg.wordCount} words)`.
     - If complete: render the clickable **Artifact Chip right here in place** (`Created / Updated: ${seg.title} (${seg.file}) — click to open`).
  4. **`topic_shift` segment**:
     - If `seg.streaming`: render `Starting new chapter…`.
     - If complete: render the inline **Chapter Shift Chip** (`Chapter: ${seg.title}`).

- **What happens to `TurnReceiptsRow` at the bottom of `MessageBubble.tsx`?**
  - When all `extractedArtifacts`, `extractedLinks`, and `topicShift` are already present as inline tags in `message.content`, **do NOT duplicate them at the bottom** in `TurnReceiptsRow`!
  - Only render `TurnReceiptsRow` as a fallback for legacy saved turns whose `message.content` had its XML stripped before this fix (i.e. when `message.extractedArtifacts` or `message.extractedLinks` is non-empty AND `parseMessageSegments(message.content)` found zero inline operation segments), plus for `linked` turn attachments if not inline.

---

## 4. True `<> Raw` View with Collapsible `<artifact_upsert>` (`BUG-008`)

In `MessageBody.tsx` when `raw === true`:
- Render the segments from `parseMessageSegments(content)` in monospace font (`data-testid="message-raw"`):
  - **`prose`, `link`, and `topic_shift` segments**: render their exact raw text (`seg.text` or `seg.rawXml`) inline with `whitespace-pre-wrap`.
  - **`artifact_upsert` segment**:
    - By default, render **collapsed** as a single interactive monospace block:
      ```
      [+] <artifact_upsert file="slug.md" title="…" …> … (1,840 words — click to expand) </artifact_upsert>
      ```
    - Clicking the `[+]` toggle flips local state for that segment to expanded (`[-]`), revealing the full untouched `seg.rawXml` (`[-] <artifact_upsert ...>\n...full body...\n</artifact_upsert>`).
- **Copy button (`handleCopyMessage`)**:
  - Copies the full `message.content` (with all raw XML intact).

---

## 5. Streaming Partials in `DraftQueueTray.tsx` (`BUG-012`)

- **Problem**: While a message is streaming, `sendQueue.ts` and `chatJobRunner.ts` were passing `demuxed.cleanText` as `partialText`, which stripped XML tags mid-stream and rendered `d.partial` in `DraftQueueTray.tsx` (line 309) as unformatted plain text (`whitespace-pre-wrap`), causing raw `**bold**` asterisks and stripped gaps to show while writing.
- **Fix**:
  1. Stream the **raw accumulated text** (or keep tags in `partialText`) into `d.partial`.
  2. In `DraftQueueTray.tsx`, render `d.partial` through `MessageBody` (`raw={false}`), which uses `parseMessageSegments`!
     - As the model writes markdown (`**5. Community and shipping.**`), it renders formatted markdown in real time.
     - As the model streams `<artifact_upsert ...>` or `<link .../>`, `parseMessageSegments` renders the live in-place streaming chip (`Writing artifact…` / `Linking…`) right where the model is writing it, without leaking raw XML or leaving blank holes!

---

## 6. Fix `<link>` Endpoint Resolution for Titles, `.md`, and `previousCodes` (`BUG-007` `?` Chips)

In `shared/turnCommit/planTurnCommit.ts` (lines 311–325):
- Currently `indexNames` only indexes `fileKey(artifactFileName({ code, title }))` and `fileKey(a.code)`.
- Update `TurnCommitState['artifacts']` to include `previousCodes?: string[]` and update `indexNames` so `idByFile` maps ALL of the following (normalized via `fileKey`: trim, strip `.md`, lowercase, and also normalized slug form `normalizeSlug`):
  1. `fileKey(a.code)` (e.g. `unhaunter-design-and-systems-spec-2`)
  2. `fileKey(a.title)` (e.g. `unhaunter development design notes` — exact lowercase title!)
  3. `normalizeSlug(a.title)` (e.g. `unhaunter-development-design-notes`)
  4. `fileKey(artifactFileName({ code: a.code ?? '', title: a.title ?? '' }))`
  5. Every entry in `a.previousCodes ?? []` (so renamed slugs still resolve!).
  6. `a.id.toLowerCase()`
- Now whether the model writes `source="Unhaunter Development Design Notes"` (by title) or `target="unhaunter-design-and-systems-spec-2.md"` (by `code.md`), BOTH resolve to the artifact ID, `applied` is `true`, the graph edge is created, and the `?` disappears!
