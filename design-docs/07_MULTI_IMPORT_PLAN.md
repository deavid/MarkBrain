# Multi-File Import — Phased Plan

**Date:** 2026-10-18 · **Status:** agreed, phased · **Scope:** local `.md/.markdown/.txt` multi-import first; Drive later.

## Vision

Import stops being a one-file ritual and becomes an **import session**: pick N files,
the session processes them one by one, each file *lands immediately* as its own artifact,
and the user clicks any row to open and check what landed. Duplicates are never resolved
during import — they are **flagged via an auto-added relationship** and dealt with
afterwards, in a triage view with a colored text diff. A batch can declare placement and
relations once ("all of these go under X" / "all of these relate to Y") and they apply to
every file in the session.

## Locked decisions (this conversation)

1. **Multi-select + process-as-you-go.** The UI supports picking multiple files. They are
   processed incrementally with live per-row status. Any landed import can be clicked
   open for inspection. No batch "commit" gate.
2. **Always import as a separate artifact.** Never merge/overwrite/omit during the import
   itself. A misclick during import is unrecoverable (you'd have to re-import to see the
   options again). All resolution happens *after the fact*, where it's undoable and
   inspectable.
3. **Duplicates are flagged, not handled.** If a file looks like something already
   imported, import it anyway as a new artifact and auto-add a relationship to the
   suspected prior version. That relationship *is* the flag and *is* the work queue.
4. **Post-import tools** (triage): keep both, overwrite old with new, delete new, delete
   old, merge (last), mark as not-a-duplicate (dismiss). Overwrite must go through the
   existing versioning domain (record a revision first) — we already have non-destructive
   rollback, so use it.
5. **Diff view is required** for triage: a text diff of the two bodies with added/removed
   lines colored (green/red), even a plain line diff is enough. Meta deltas (title, tags…)
   shown as chips above it.
6. **Size awareness, no ceremony.** Session header shows file count + word/token estimate
   (`estimateTokens` already exists). No confirmation screens — extraction runs on
   flash-lite free quota; Google pays the bill.
7. **Batch placement & relations for the whole session**: parent (folder/chapter), shared
   tags, and a bulk relationship target ("all relate to document X, type `cites`"), with
   per-row override.
8. **No zip.** Agreed dead end. No binary container formats, ever.
9. **Drive is deferred** (Phase 5), but the session/queue model is source-agnostic so
   multi-select Drive and folder-pick slot in without UI redesign.

## The core mechanic: import-as-new + link-as-flag

The type system already supports this. `ArtifactGraphData.relationships` is
`Array<{ target: string; type: string; note?: string }>` with a free-string `type`
(`src/types/index.ts`). So the whole duplicate story needs **no new persistence**:

- **Detection tiers** (cheap → expensive):
  1. **Content hash** — normalized body hash (trim/collapse whitespace) vs existing
     artifacts. Computed on the fly in Phase 2; optional `sourceHash` schema field only if
     scale demands it.
  2. **Code match** — frontmatter `code` / filename-derived code equals an existing
     artifact's `code`. Strong identity signal.
  3. **Title match** — trimmed, case-folded title collision (what `handleAddArtifact`
     does today, but as a *signal*, not an action).
- **On hit**, the new artifact gets:
  - `graph.relationships.push({ target: <old.id>, type: 'revision-of' | 'duplicate-of', note: 'Auto-flagged on import ' + date })`
    — `duplicate-of` for identical hash, `revision-of` for same-identity-different-content
    (title/code hit with differing body).
  - Nothing else changes. It lands like any other import.
- **The triage queue is derived, not stored**: all artifacts with an outgoing
  `revision-of`/`duplicate-of` relationship = the work list. Resolving an item deletes the
  relationship (dismiss) or consumes it (overwrite/delete actions remove the carrier
  artifact and its link). No flags table, no session records to rot.

Direction convention: the **new** artifact points at the **old** one
(`new --revision-of--> old`), so "which one is suspected of being the newer version" is
always the link source.

## Conflict analysis — what fights the current code

| Current behavior | Why it conflicts | Resolution |
|---|---|---|
| `handleFileUpload` reads `e.target.files?.[0]` only | Multi-select silently drops files 2..N | Queue all files; rows for each |
| Source lock: one source, locked while extracting | Session has N sources hot at once | Lock becomes "session is processing" on the *commit/action* area only; the picker stays open to append files |
| `handleAddArtifact` idempotent-by-title (upserts onto existing id) | Directly violates "always import as a different artifact" — a second `Notes.md` would silently *overwrite* the first | Import path forks: **always mint a new id**. The title-idempotency stays for the chat-extraction path (its comment explains why: extracted notes are pre-upserted and "Save as Artifact" must update, not clone). Two call sites, two policies |
| Review form is the commit gate (Fields / Raw YAML+MD toggle before save) | N files × review gate = ritual hell | Demoted to *inspection*: rows land first; click expands in-place preview / opens `ArtifactDetailModal`. Keep the form's raw-YAML toggle inside the row expansion for checking |
| Single-modal rule (only one `fixed inset-0` modal at a time — enforced by tests) | "Click row to open artifact" while ImportModal is mounted would stack modals | Row click = in-place expansion by default; a "Open full artifact" button hides the import modal (session keeps running) and opens `ArtifactDetailModal` |
| `ImportModal` state is singular (`uploadContent`, `uploadFileName`, `artifactTitle`…) | One-file state machine | New `ImportSession` state type: `rows: [{ file, status, artifactId?, error?, flag? }]` + batch rules. The existing form bits get extracted as a row-inspector component |
| `handleAddArtifact` hardcodes `relationships: []` on the import path | Kills the flag mechanic | Import path passes detected relationships through |
| Instrumentation law: ≤16 log events per human action | Picking 30 files must not emit 120 log lines | One `logger.action` summary per session (`Import session: 30 files, 24 landed, 4 flagged, 2 failed`); per-row logs only `warn` on failure |
| Firestore undefined-field poisoning / IndexedDB `put()` replaces | Staggered saves across a session re-expose the class of bug we just fixed | Every row save goes through the existing `sanitizeForStorage` + omit-undefined upsert path (unchanged), and a session never partially updates an artifact it didn't fully build |

## Phases

### Phase 1 — Import sessions (multi-file pipeline)
*The "small, dumb, high value" slice, with your process-as-you-go + click-to-check requirements.*

**Scope**
- `multiple` on the file input (`.md,.markdown,.txt`), plus basic drag-drop of files onto
  the upload tab. (Folder-drop / `webkitGetAsEntry` is Phase 5.)
- **Import session model**: file list → per-row status
  (`queued → parsing → extracting → landed | failed`), processed one at a time as we go.
  Frontmatter lane (`parseYamlArtifactDoc` hit) lands instantly; no-frontmatter lane goes
  through Gemini extraction (existing `triggerAIExtraction`, 120s cap) and lands when done.
- **Land-as-you-go**: each row, the moment it's ready, becomes a real artifact via a new
  `handleImportArtifact` (new id always, no title-idempotency). Rows show a green "landed"
  state with the artifact title.
- **Click-to-check**: clicking a landed row expands it in place — title/abstract/tags/
  body preview + the existing Raw YAML+MD toggle. "Open full artifact" button hides the
  import modal and opens `ArtifactDetailModal`. Failed rows expand to show the error +
  Retry.
- **Session header**: `N files · X landed · Y failed · ~Z words / ~T tokens`.
- **Appendable**: picker/drop stays live mid-session to add files to the queue.
- **Cancel remaining** (frees the queue; already-landed artifacts stay). Closing the modal
  hides it but the session keeps processing (session state lives above the modal, in
  `App`/workspace level) with a small floating status (`SaturationOrb` pattern reuse).
- Retry-per-failed-row.

**Explicit non-goals of Phase 1**: duplicate detection, batch rules, diff, Drive.

**Acceptance**
- Select 5 mixed files (3 with frontmatter, 2 without) → all 5 land, statuses visible
  live, each click opens its result, no modal stacking, one summary log line, zero console
  errors. Escape closes the modal; a later re-open shows the session still there.
- Select 2 files with identical titles → **two** artifacts exist (regression check against
  title-idempotency).
- Headless run in the spirit of the existing `/tmp/pw` visual-review scripts; `tsc` clean;
  vitest green.

### Phase 2 — Identity detection + flagging
*Your "smart detection if the artifact is already imported".*

**Scope**
- Detection tiers on every session row: content-hash → code → title (as above).
- On hit: auto-relationship (`duplicate-of` | `revision-of`) from new → old, with
  `note: 'Auto-flagged on import YYYY-MM-DD'`. Row shows an amber "flagged — possible
  version of *Old Title*" chip; the tree shows a small amber dot on flagged artifacts.
- Import path passes `relationships` through instead of `[]`.
- A derived **"Revisions"** list (filter over artifacts with those relationship types)
  exposed in the sidebar — the work queue for Phase 3. Empty state: "No flagged revisions."
- `handleAddArtifact` policy split implemented and unit-tested (chat path = title-idempotent;
  import path = always-new).

**Acceptance**
- Re-import of an identical file lands as artifact #2 with `duplicate-of` pointing at #1;
  body-differing same-title file gets `revision-of`; a distinct file gets nothing.
- Import log summary includes flagged counts. Unit tests for the three detection tiers and
  the policy split.

### Phase 3 — Triage UI + colored diff + resolution tools
*Post-import resolution, exactly as argued: safe, inspectable, after the fact.*

**Scope**
- **Triage view** (from the sidebar "Revisions" list): each flagged pair rendered
  old ← new, with a **line-based text diff** of `current.t3_body` (green adds / red
  removes; ~60-line in-repo LCS diff util — no new dependency unless it gets ugly), plus
  meta delta chips (title/tags/abstract changed).
- **Actions per pair** (the menu you named):
  - **Keep both** — dismiss the flag (drop the relationship), both survive.
  - **Overwrite old with new** — `ArtifactVersioningDomain.recordRevision(old)` first
    (we already have non-destructive rollback — use it), then copy new's content/meta onto
    old's id, remove the carrier (new) artifact + link. Recoverable forever.
  - **Delete new** ("omit the import") / **Delete old** ("make the new one the keeper").
  - **Mark as not-a-duplicate** — dismiss without any content change (for title collisions
    that aren't really related).
  - **Merge** — last, and honestly optional for v1: keep both bodies (new appended under a
    "Imported revision" heading, or manual merge from the diff view). Ship after the other
    four feel good.
- Everything undoable at the *content* level via the versioning domain; deletes are real
  deletes (with the existing confirm style, if any).

**Acceptance**
- Flagged pair → see colored diff → overwrite → old artifact id survives with new content,
  version history shows pre-overwrite revision, rollback restores it. Same drill for
  delete/keep-both. Diff renders added/removed lines colored, including at 200+ line
  bodies.

### Phase 4 — Batch placement & relations
*Your "all these go to X folder / relate in this way to X document" for the whole import.*

**Scope**
- **Batch rules bar** at the top of the session: parent picker (chapter/folder artifact),
  shared tags (append to per-file tags), and bulk relationship ("all new artifacts get
  `relation type [cites|belongs-to|responds-to|…] → target X`"), all optional, all
  applied at row-land time. Per-row override in the row inspector.
- Frontmatter parent (`graph.parent`) still wins per-file when present unless the user
  explicitly overrides it with batch rules — documented choice: batch rules are
  *defaults*, frontmatter is *declared intent*, manual override beats both.
- Session rows show what placement they received ("→ under *Thesis*, tagged `chapter`,
  `cites` *Core Claim*").

**Acceptance**
- Import 10 files with batch parent X + tags + `cites` Y → all 10 carry parent X, the
  tags, and a `cites`→Y relationship; a row-level parent override sticks.

### Phase 5 — Source expansion (deferred)
- Drive multi-select (Google Picker `setMultiSelectEnabled` — verify flag name against the
  Picker docs when we get here) and **folder-pick** → `files.list` children → same session
  queue. Folder name as default parent (feeds Phase 4 batch rules).
- Folder drag-drop locally (`webkitGetAsEntry`), relative paths → parent structure.
- Optional: 2-way concurrent extraction, background session survival across reload
  (only if sessions-in-the-wild prove to outlive a page), `sourceHash` schema field if
  on-the-fly hashing gets slow at large N.
- A rough cost line remains in the session header the whole time (file/word counts) — no
  confirmation screens.

## Tech notes & constraints

- **Relationships model**: `ArtifactGraphData.relationships: Array<{target, type, note?}>`,
  free-string `type`. Define two constants (`revision-of`, `duplicate-of`) + keep `cites`
  etc. for Phase 4. No schema migration.
- **Versioning**: `01-artifact-versioning` already has `recordRevision`, `getRevision`,
  non-destructive rollback. Overwrite is built on it, not on top of raw upserts.
- **Storage safety**: every save through the existing omit-undefined upsert +
  `sanitizeForStorage` boundary (the `{x: undefined}` Firestore poison class of bug).
- **Instrumentation law**: one `logger.action` summary per session; per-row failures are
  `logger.warn`. No per-row info spam.
- **Single-modal rule** respected: row inspection is in-place; full artifact open hides
  the import modal (session keeps running in App-level state).
- **Idempotency policy split**: chat path keeps title-idempotent upsert (its rationale
  stands); import path always mints new ids. Unit-tested both ways.
- **New/changed files (roughly)**: `ImportModal.tsx` (session shell), new
  `src/components/import/ImportSession.ts` (state machine) + `RowInspector.tsx`,
  `src/utils/contentHash.ts`, `src/utils/lineDiff.ts`, `App.tsx` (`handleImportArtifact`,
  session ownership), `ArtifactFolderTree.tsx` (amber flag dot, Revisions entry),
  `src/components/RevisionTriage.tsx` (Phase 3).

## Non-goals (forever, unless re-litigated)

- Zip or any binary container import.
- Inline overwrite/merge/omit *during* import (the misclick argument — resolution is
  always post-import).
- Cost-confirmation modals; token-bill anxiety UI. (flash-lite = free quota.)
- Background sessions surviving full page reload (Phase 5 "optional" at the earliest).
- Auto-merge on duplicate detection in any form.

## Open questions (small, decide during Phase 1/2)

1. Floating "session still running" indicator: reuse `SaturationOrb` vs a small dedicated
   chip. (Taste call when wiring it.)
2. Does the amber flag dot live on the tree row, the tier badge row, or both? (Both is
   fine; keep it one dot.)
3. Merge action's exact semantics when we get to Phase 3 — ship the other four first and
   design merge with real usage data.
