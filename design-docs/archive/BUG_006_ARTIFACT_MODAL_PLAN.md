# Implementation Plan: Artifact Detail Modal Redesign (`BUG-006`)

- **Status**: **100% Clear — Ready for Implementation** (approved by David on 2026-10-31).
- **Covers**: All sub-issues of `BUG-006` (`6.1` through `6.12`).

---

## 1. Identifier Model: One Visible Editable Slug (`code`), Hidden Internal UUID

### Decision
- The user and the LLM only ever see **ONE identifier**: the human-readable **Slug** (`artifact.code`, e.g. `night-vision-acoustic-synesthesia-design`, presented to the LLM as `night-vision-acoustic-synesthesia-design.md`).
- Under the hood, we keep `artifact.id` (`art-...`) strictly as an immutable internal primary key so renaming a slug never requires fragile mass-rewrites of edges, chat attachments, or revision tables in IndexedDB / server storage.
- **Hide `artifact.id` completely from the UI**: never display `Artifact ID: art-...` anywhere in the modal.
- **Uniqueness & Collisions**:
  1. **Chat `<artifact_upsert>` on existing slug**: updates that existing artifact (creates a new revision in History).
  2. **Import / New Note collision**: if an imported file or newly created note produces a slug that is already taken by another artifact in the workspace, automatically suffix it (`-001`, `-002`, etc., e.g. `night-vision-design-001`).
  3. **Manual Slug edit**: in the modal, the user can edit the slug. Validate uniqueness within the workspace (normalize to lowercase `a-z0-9-`, show inline error or prevent save if another artifact already uses that slug). Optionally record the old slug in `previousCodes?: string[]` on the artifact so any older `<link>` or chat reference using the old slug still resolves cleanly.

---

## 2. Unify `Type` & `Category` into One Editable `Category` with Descriptions

### Decision
Previously artifacts had both `type` (`'document' | 'chapter'`) and `category` (`'specification'`, `'note'`, `'general'`), which was redundant and opaque. We unify them into a single concept (**Category**) with 6 canonical options and explicit descriptions visible both in the code and in the UI picker:

```ts
export const ARTIFACT_CATEGORIES = [
  {
    value: 'note',
    label: 'Note',
    description: 'Quick thoughts, scratchpad ideas, or rough notes',
  },
  {
    value: 'document',
    label: 'Document',
    description: 'General long-form prose or article',
  },
  {
    value: 'spec',
    label: 'Spec',
    description: 'Technical or design specification',
  },
  {
    value: 'reference',
    label: 'Reference',
    description: 'Facts, research, worldbuilding, or API reference',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Roadmap, tasks, timeline, or milestones',
  },
  {
    value: 'chapter',
    label: 'Chapter',
    description: 'Conversation chapter summary extracted from chat',
  },
] as const;
```
- Where legacy code reads `artifact.type` vs `artifact.category`, keep them synchronized (or derive the card badge from `artifact.category || artifact.type`).
- In the modal header and in the Overview tab, render a clean Category selector showing both the **label** and its **description** so the user (and other agents reading the code) always knows what each category means.

---

## 3. New 6-Tab Structure for `ArtifactDetailModal`

Remove the `Layers & YAML` tab completely (portable YAML/Markdown export is already handled by Download / Export). Replace the modal tabs with these **6 clear tabs**:

1. **`Body` (default tab)** — Dedicated tab for reading and editing the full Markdown body.
2. **`Overview & Layers`** — Metadata (Title, Slug, Category + description, `#tags`) + the three summary layers (**Subtitle**, **Description**, **Summary**) shown **openly (NOT collapsed)** and all editable!
3. **`Relationships (N)`** — View/edit outgoing & incoming graph edges for this artifact + **Similarity Search** to find and link related artifacts.
4. **`Chats (N)`** — Which chat threads in this project use this artifact and at what granularity level (`Full`, `Summary`, `Description`, `Title`, `Staged`).
5. **`History (N)`** — Always visible (never hidden when `N <= 1`), showing `v1..vN` revisions, diffs, and revert.
6. **`Q&A Index (N)`** — Existing Q&A pairs and embedding index status.

### Detail of Each Tab

#### Tab 1: `Body`
- **View mode**:
  - Toggle between `Rendered` (formatted markdown) and `Raw` (raw markdown source) at the top-right of the body pane.
  - Takes full vertical space of the modal without Subtitle/Description/Summary accordions pushing it down.
- **Edit mode** (toggled via the Pencil button or an inline `Edit Body` button):
  - Full-height markdown `<textarea>` with `Save` and `Cancel` buttons.
  - Saving records a new revision in `History` and marks summary layers stale if the body changed.

#### Tab 2: `Overview & Layers`
- **No collapsible accordions**: because `Body` now has its own tab, `Subtitle`, `Description`, and `Summary` are displayed expanded and readable at a glance.
- **Everything is editable**:
  - **Title** (text input)
  - **Slug (`code`)** (monospace input, normalized to `a-z0-9-`, uniqueness checked across workspace)
  - **Category** (dropdown/radio cards showing the 6 `ARTIFACT_CATEGORIES` with their descriptions)
  - **Tags** (add `#tag` input + `×` button on each existing tag to remove it; clicking a tag text still filters library if desired)
  - **Subtitle** (text input — "ships with the title")
  - **Description** (textarea — medium layer)
  - **Summary** (textarea — detailed summary layer, plus the `Refresh layers` AI regeneration button when body has been edited)
- **Wipe `High Concept`**: completely gone from the UI.

#### Tab 3: `Relationships (N)`
- **Top section — Connected Artifacts**:
  - Lists all edges where `edge.sourceId === artifact.id || edge.targetId === artifact.id`.
  - Shows direction (`this → [kind] → Target Title` or `Source Title → [kind] → this`), clickable target title (switches modal to that artifact), relation kind selector (`relates_to`, `parent_of`, `refines`, `depends_on`, `contradicts`, etc.), and an **Unlink (`×`)** button (`onRemoveEdge(edge.id)`).
- **Bottom section — Find & Link Related Notes (Similarity Search)**:
  - Search input (filters by title/tags/content or runs semantic/Q&A similarity scoring against the rest of the workspace's artifacts).
  - By default (even with empty query), shows top **Similar Artifacts** (computed via shared tags + Q&A/section vector cosine similarity if indexed, or title/keyword overlap as fallback), excluding already-linked artifacts.
  - Each row shows the candidate artifact's Title, Category, similarity/reason badge, a relation-kind dropdown (default `relates_to`), and a **`+ Link`** button (`onAddEdge(artifact.id, candidate.id, kind)`).

#### Tab 4: `Chats (N)`
- Lists every chat thread in the active project that has an attachment entry for `artifact.id`.
- Each row shows:
  - **Chat Title** (clickable → calls `onOpenThread(thread.id)` to jump straight to that conversation).
  - **Provenance**: e.g. `Staged for next send` or `Attached at msg #3`.
  - **Granularity level**: interactive chips (`Title` | `Description` | `Summary` | `Full`) so the user can see and even adjust the granularity level for that chat right from this tab.
- If no chats use this artifact yet, shows a calm empty state (`"Not attached to any chat in this project yet."`) with a button to stage it into the current active chat.

#### Tab 5: `History (N)`
- **Always show the tab button** in the tab bar (remove the `{history.length > 0 && ...}` condition that hid it!).
- Ensure that when an artifact is first created or imported, an initial `v1` revision is either present or synthesized from the artifact's current state so `History (1)` is never blank.
- Keep the existing per-revision `View diff`, `Revert to this version`, and `Open chat` provenance controls.

#### Tab 6: `Q&A Index (N)`
- Keep existing Q&A Index tab functionality as-is.

---

## 4. Header & Footer Cleanups (`BUG-006.1`, `BUG-006.2`, `BUG-006.10`)

1. **Header**:
   - No red/pastel color dot (`artColor`), and no `#e05a66` hex readout.
   - Displays: **Title**, **Slug badge** (`night-vision-acoustic-synesthesia-design.md`), and **Category badge** (`Spec`, `Note`, etc.).
2. **Footer**:
   - Delete the fake `Title · Description · Summary · Full` text on the bottom-left (`BUG-006.10`).
3. **Import `# H1` Title Rule (`BUG-006.2`)**:
   - When importing any Markdown file that contains a top-level `# H1` heading, extract that `# H1` text verbatim and use it as `artifact.title` (overriding any shortened/paraphrased `ex.title` returned by AI extraction).
