# 15 — Draft-Driven Artifact Proximity & Multi-Method Retrieval Testbed

> Written to be executed by a weaker coding agent. Zero assumptions. Every rule
> is either an implementation instruction or a hard law that has already broken
> a previous attempt. Do not improvise. Do not "improve" the architecture.

---

## 0. READ THIS FIRST OR YOU WILL BREAK THE BUILD (NON-NEGOTIABLE LAWS)

Do **NOT** be creative. Do **NOT** invent "smart" architectures. Previous AI
attempts had to be ripped out because they imagined a fantasy neural net and
broke core invariants of this app. Follow every rule below literally:

### LAW 1 — DO NOT TOUCH THE CONTEXT COMPILER (`src/domains/03-optical-compiler/index.ts`).

- This feature does **NOT** automatically inject documents into the LLM prompt.
- Only artifacts the user explicitly stages/attaches enter the prompt.
  (`for (const attachment of options.attachments)` — that loop is the whole story.)
- This feature ONLY powers:
  1. A badge on the `[+ Attach]` button in `ChatView` showing how many
     **unattached** artifacts match the user's current unsent chat draft.
  2. Highlighting those artifacts inside `ArtifactsLibraryView` and a
     **`Proximity`** lens that flattens folders, orders artifacts by score to
     the draft, and lets the user toggle retrieval methods on/off to compare them.

### LAW 2 — DO NOT PUT Q&A LISTS OR EMBEDDING VECTORS INSIDE `ProjectSnapshot` OR FIRESTORE.

- `src/services/stores/firestoreStore.ts` saves the **entire project** into a
  single Firestore document with a hard **1,048,576 byte (1 MiB)** limit.
  (`firestoreStore.ts` even logs a warning when the snapshot passes 900,000 bytes.)
- Documents in this app are **10 KiB to 200 KiB** (many are ~60 KiB). Generating
  Q&A proportional to document size would exceed the whole Firestore document
  ceiling on its own.
- Putting Q&A pairs or 768-float embedding vectors into
  `UniversalArtifactDocument` will blow past 1 MiB and break saving.
- **All generated Q&A pairs, sections, and embedding vectors MUST live in a
  separate IndexedDB database (`markbrain-search-index`)**, keyed by
  `projectId` and `artifactId`, with a `contentHash` to detect staleness.

### LAW 3 — DO NOT FAIL `src/tests/design-law.test.ts`.

- This test scans every `.ts`/`.tsx` under `src/` (except `src/tests/`) and
  **FAILS THE BUILD** if you:
  - Use ANY `border-[#...]`, `border-slate-...`, `border-white/...`,
    `border-cyan-...` utility. Only these colour roles are legal anywhere in
    the app: `border-line`, `border-line-soft`, `border-transparent`,
    `border-brand`, `border-accent`, `border-none` — and a colour role MUST be
    paired with a width (`border`, `border-b-2`, …) or it also fails.
  - Let the distinct `bg-[#...]` count climb past 110.
- **Solution:** Do NOT use borders to separate cards or pills. Use surface
  steps (`bg-surface-0..5`, `bg-recess-1..2`, `bg-veil-1..2`) and shadows
  (`shadow-well`, `shadow-lift`, `shadow-pop`). Prefer existing semantic
  background classes over inventing new `bg-[#...]` values.

### LAW 4 — DO NOT KEEP CHAT DRAFT TEXT ONLY INSIDE `ChatView.tsx` LOCAL `useState`.

- `src/App.tsx` renders:
  `{activeView === 'artifacts' ? <ArtifactsLibraryView ... /> : <ChatView ... />}`
- When the user clicks `[+ Attach]`, `activeView` becomes `'artifacts'` and
  **`ChatView` UNMOUNTS**.
- If the unsent draft (`inputText`) only lives in `ChatView`'s `useState('')`,
  clicking `[+ Attach]` destroys the draft AND the search query.
- The draft MUST be lifted into `App.tsx`, keyed by thread
  (`draftByThread: Record<string, string>`), and passed down to both views.

### LAW 5 — REMOVE THE OLD STAGED-COUNT BADGE FROM `[+ Attach]`.

- `ChatView.tsx` shows a cyan `stagedAttachments.length` badge on `[+ Attach]`
  in two places (hero form and footer form).
- **Delete that badge from both.** Staged files are already visible in the
  `<StagedTray>` directly above the composer.
- The badge on `[+ Attach]` becomes **exclusively** the count of unattached
  artifacts matching the current draft above the score threshold.

### LAW 6 — L2-NORMALIZE ALL GEMINI EMBEDDINGS.

- We use `gemini-embedding-001` with `outputDimensionality: 768`.
- Truncated Matryoshka output is **NOT** unit-length. Every vector MUST be
  L2-normalized before storage and before cosine scoring, or scores are garbage.

### LAW 7 — KILL THE SERVER BEFORE PROBING.

- `DISABLE_HMR=true` means Vite does not invalidate cached transforms. A probe
  against a server started before your edit reads STALE code. Restart after
  every UI edit, always.

---

## 1. WHAT WE ARE BUILDING

A **multi-method retrieval testbed** so the user can compare 4 retrieval
signals on real 10–200 KiB documents in real time while typing an unsent
chat draft:

| Flag | Signal | Needs API call while typing? |
| :--- | :--- | :--- |
| `ftsSections` | Local BM25 over markdown sections + title/subtitle/tags/layers | No (instant) |
| `ftsQa` | Local BM25 over LLM-generated Q&A pairs | No (instant, needs one-time indexing) |
| `vecSections` | `gemini-embedding-001` cosine similarity over sections | Yes (1 call per 5s typing pause) |
| `vecQa` | `gemini-embedding-001` cosine similarity over Q&A pairs | Yes (reuses the SAME draft vector) |

Plus `splitClauses` (split multi-topic drafts so one topic doesn't average the
others away) and a live `threshold` slider (default `0.55`).

**The UX contract (agreed with David, do not alter):**

1. Type in the chat composer. Draft text is the query. **There is no separate
   search box for this feature.**
2. After ~350ms of pause, FTS signals run locally. After 5s of pause, if a
   `vec*` flag is on, the draft is embedded once (cached by draft text).
3. Unattached, non-archived artifacts scoring `>= threshold` increment a badge
   on `[+ Attach]`.
4. Clicking `[+ Attach]` opens `ArtifactsLibraryView` (already what it does),
   with matched rows highlighted and a **`Proximity`** lens available.
5. In `Proximity`: draft readout, method toggles, threshold slider, index
   status + "Index All" button, flat score-ordered list, and an X-Ray
   diagnostic line per row showing per-method scores and exactly which
   section or Q&A matched.
6. Generated Q&A is readable in a new **`Q&A Index`** tab inside
   `ArtifactDetailModal`.

---

## 2. FILE PLAN

### STEP 1 — `src/utils/sectionChunker.ts`

Export:

```ts
export interface DocSection {
  id: string;      // 'sec-meta', 'sec-1', 'sec-2', …
  heading: string; // 'Unhaunter — Overview', 'Vision > Motto', 'Vision > Motto (part 2)'
  text: string;
}

export function computeArtifactContentHash(art: UniversalArtifactDocument): string;
export function splitArtifactIntoSections(art: UniversalArtifactDocument, maxCharsPerSection?: number): DocSection[];
```

Rules:

- `computeArtifactContentHash` = FNV-1a 32-bit over
  `title\n§\nsubtitle\n§\ntags.join(',')\n§\ndescription\n§\nsummary\n§\nbody`,
  returned as `` `${hex}-${raw.length}` ``.
- `splitArtifactIntoSections` default `maxCharsPerSection = 1800` (~450 tokens,
  safely under `gemini-embedding-001`'s 2,048 input-token cap).
- Section 0 is ALWAYS the metadata block: title, subtitle, `Tags: …`,
  description, summary. If summary alone exceeds the cap, it is sub-chunked.
- Body is split on `/^#{1,4}\s+.+$/m`, tracking a breadcrumb heading
  (`'Gameplay > Fluids'`). Any resulting block over the cap is sub-split on
  `\n\n` into ≤ cap pieces labelled `'… (part 2)'`, `'… (part 3)'`.
- Empty/whitespace-only sections are dropped.
- The stored/embedded text for a body section is
  `` `${art.title} — ${sec.heading}\n${sec.text}` `` (built by the caller), so
  every chunk carries its document and section context.

### STEP 2 — `src/services/searchIndexStore.ts`

A SECOND IndexedDB database. Do NOT touch `src/services/localBackend.ts`
(it is private to `stores/localStore`).

- DB `markbrain-search-index`, version 1, store `artifact_index`, `keyPath: 'key'`,
  index `byProject` on `projectId`.
- `key = `${projectId}::${artifactId}``.

```ts
export interface GeneratedQaPair {
  id: string;
  sectionHeading: string;
  question: string;
  answer: string;
  keywords: string[];
}

export interface ArtifactSearchIndexRecord {
  key: string;
  projectId: string;
  artifactId: string;
  contentHash: string;
  updatedAt: number;
  qaPairs: GeneratedQaPair[];
  sectionIds: string[];
  sectionHeadings: string[];
  sectionSnippets: string[];  // first ~220 chars of section text, for UI
  sectionVectors: Float32Array[];
  qaVectors: Float32Array[];
}

export async function loadProjectSearchIndex(projectId: string): Promise<Map<string, ArtifactSearchIndexRecord>>;
export async function saveArtifactSearchIndex(record: ArtifactSearchIndexRecord): Promise<void>;
export async function deleteArtifactSearchIndex(projectId: string, artifactId: string): Promise<void>;
export async function clearProjectSearchIndex(projectId: string): Promise<void>;
```

Every function must degrade to a no-op / empty `Map` when
`typeof indexedDB === 'undefined'` (unit tests run in Node).

### STEP 3 — `server/routes/searchIndex.ts`

Register in `server/app.ts` after `registerExtractRoutes(app)`.

**3A `POST /api/search-index/generate-qa`**

Request:
```ts
{ title: string; subtitle?: string; sections: Array<{ id: string; heading: string; text: string }> }
```

- Reject empty `sections` with 400.
- Cap `sections.length` at 12 and total section text at 20,000 chars per call
  (the caller windows long documents; see STEP 6).
- Model `gemini-3.5-flash-lite`, `temperature: 0.2`.
- Prompt: build a high-recall search index. For every concrete fact, rule,
  mechanic, number, visual detail, design philosophy, comparison or decision,
  write one Q&A a human might ask in casual language. Scale density to text
  size (~1 Q&A per 300–600 chars of substantive text). Include everyday
  synonyms in `KW:`. Output ONLY repeatable blocks:
  ```
  === QA ===
  SECTION: <exact section heading>
  Q: <natural question>
  A: <concise factual answer, 1-2 sentences>
  KW: <comma-separated synonyms>
  ```
- Parse every `=== QA ===` block; regex fallback when the model omits the
  marker (`Q:`/`A:`/`KW:` line pairs).
- If `ai === null`: emit ONE deterministic fallback Q&A per section
  (`Q: What does "<heading>" say?` / first sentence of the text / keywords =
  unique words of the heading) so offline and CI still work.
- Response: `{ qaPairs: GeneratedQaPair[] }` with sequential ids `qa-0…`.

**3B `POST /api/search-index/embed`**

Request:
```ts
{ texts: string[]; taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'; title?: string }
```

- Validate non-empty `texts`, cap at 80 strings per request, truncate each to
  6,000 chars (~1,600 tokens).
- Call `ai.models.embedContent({ model: 'gemini-embedding-001', contents: batch,
  config: { taskType, outputDimensionality: 768, title? } })` in sub-batches of
  50.
- **L2-normalize each returned `values` array before responding.**
- If `ai === null`: return deterministic pseudo-vectors built from character
  trigram counts of each text, 768 dims, L2-normalized — so the offline path
  is still exercised end-to-end.
- Response: `{ embeddings: number[][] }`.

Add client wrappers in `src/gateway/api.ts`.

### STEP 4 — `src/domains/search/searchConfig.ts`

```ts
export interface SearchTestbedConfig {
  ftsSections: boolean;
  ftsQa: boolean;
  vecSections: boolean;
  vecQa: boolean;
  splitClauses: boolean;
  threshold: number; // 0.20 .. 0.85
}

export const DEFAULT_SEARCH_CONFIG: SearchTestbedConfig = {
  ftsSections: true,
  ftsQa: true,
  vecSections: true,
  vecQa: true,
  splitClauses: true,
  threshold: 0.55,
};

export function loadSearchConfig(): SearchTestbedConfig;
export function saveSearchConfig(config: SearchTestbedConfig): void;
```

- Persist to `localStorage` key `markbrain:searchConfig`.
- On load, also honour URL overrides `?searchMethods=a,b,c&searchThreshold=0.6`
  so bookmarks and probes can force a combination.
- `loadSearchConfig` must try/catch and fall back to defaults.

### STEP 5 — `src/domains/search/draftSearchEngine.ts`

Pure and synchronous. Signature:

```ts
export interface DraftSearchInput {
  draftText: string;
  clauseVectors: Float32Array[] | null; // query embeddings, or null when no vec flag needs them
  artifacts: UniversalArtifactDocument[];
  indexMap: Map<string, ArtifactSearchIndexRecord>;
  attachedArtifactIds: Set<string>;
  config: SearchTestbedConfig;
}

export interface ArtifactMatchResult {
  artifactId: string;
  isAlreadyAttached: boolean;
  bestScore: number;        // 0..1
  aboveThreshold: boolean;
  winningMethod: 'ftsSections' | 'ftsQa' | 'vecSections' | 'vecQa' | null;
  methodScores: { ftsSections?: number; ftsQa?: number; vecSections?: number; vecQa?: number };
  matchedSectionHeading?: string;
  matchedSnippet?: string;
  matchedQa?: { question: string; answer: string; sectionHeading: string };
  indexStatus: 'missing' | 'stale' | 'ready';
}

export function splitDraftIntoClauses(draftText: string, splitClauses: boolean): string[];
export function tokenizeForFts(text: string): string[];
export function scoreBm25(queryTokens: string[], docTokens: string[], stats: { avgDocLen: number; docLen: number; docFreqMap: Map<string, number> }): number;
export function l2Normalize(v: number[] | Float32Array): number[]; // re-export helper for tests
export function scoreArtifactsAgainstDraft(input: DraftSearchInput): ArtifactMatchResult[];
export function countMissingMatches(results: ArtifactMatchResult[]): number;
```

Implementation rules:

1. **`splitDraftIntoClauses`** — if `!splitClauses` return `[draft.trim()]` (or
   `[]` when blank). Otherwise split on `/[.?!;\n]+/` plus long comma/conjunction
   clauses, drop fragments with fewer than 3 non-stopword chars, ALWAYS keep the
   full draft as an element, cap at 6 elements.
2. **`tokenizeForFts`** — lowercase, split on `/[^a-z0-9.]+/` so `v0.3` survives,
   drop a standard conversational stopword list, light suffix stemmer for words
   ≥ 5 chars (`ing`, `ed`, `es`, `s`, `ly`, `tion`).
3. **BM25** — `k1 = 1.2`, `b = 0.75`. Raw score is unbounded, so normalize to
   `[0, 1]` or the `0.55` threshold means nothing:
   ```
   coverage   = sum(IDF of matched unique query terms) / sum(IDF of all query terms)
   rawSat     = raw / (raw + 4)
   normalized = 0.55 * coverage + 0.45 * rawSat
   ```
   plus `+0.12` (capped at `1.0`) when a query token hits `title` or `tags`.
   Expected calibration: 1 weak common word ≈ `0.25`; two rare query words in
   the same section ≈ `0.65–0.88`.
4. **Cosine** — vectors are L2-normalized, so `Math.max(0, dot(a, b))`.
5. **Aggregation** — per artifact, per method, take the max across all clauses.
   `bestScore = max(enabled method scores)`, plus an agreement bonus of `+0.05`
   (capped at `1.0`) when **both** an FTS method and a Vector method
   independently clear `0.45`.
6. **Sections for FTS** — always split live via
   `splitArtifactIntoSections(art)` and memoise by `contentHash` in a module-level
   `Map` (this runs on every keystroke otherwise).
7. **`indexStatus`** — `'missing'` when no record; `'stale'` when
   `record.contentHash !== computeArtifactContentHash(art)`; else `'ready'`.
8. **Exclusion** — any artifactId in `attachedArtifactIds` gets
   `isAlreadyAttached: true` (staged AND committed both count: both are already
   in the compiled payload).
9. **Skip archived** artifacts (`isArtifactArchived`) from badge counts.

`countMissingMatches` = results where
`!isAlreadyAttached && aboveThreshold && indexStatus !== 'missing'` — wait, no.
A document can match on `ftsSections` with zero indexing work, so
`indexStatus` must NOT gate the count. Correct rule: count results where
`!isAlreadyAttached && aboveThreshold`, after dropping archived artifacts in
the engine itself.

### STEP 6 — `src/application/artifactIndexer.ts`

```ts
export function isIndexStale(indexMap, projectId, art): boolean;
export async function indexSingleArtifact(
  projectId: string,
  art: UniversalArtifactDocument,
  onProgress?: (stage: string) => void
): Promise<ArtifactSearchIndexRecord>;
export async function indexProjectArtifacts(
  projectId: string,
  artifacts: UniversalArtifactDocument[],
  indexMap: Map<string, ArtifactSearchIndexRecord>,
  opts: { force?: boolean; onProgress?: (done: number, total: number, stage: string) => void; signal?: { aborted: boolean } }
): Promise<Map<string, ArtifactSearchIndexRecord>>;
```

`indexSingleArtifact` sequence:
1. `contentHash`, `sections = splitArtifactIntoSections(art, 1800)`.
2. Group sections into windows of ≤ 15,000 chars / ≤ 12 sections.
3. For each window: `generateArtifactQa(...)`, progress
   `Generating Q&A (window i/n)…`; concatenate with ids `qa-0…`.
4. Embed section texts
   `` `${art.title} — ${heading}\n${text}` `` as `RETRIEVAL_DOCUMENT`.
5. Embed QA texts
   `` `${art.title} (${qa.sectionHeading}) — Q: ${qa.question}\nA: ${qa.answer}\nKeywords: ${keywords}` ``
   as `RETRIEVAL_DOCUMENT`.
6. Wrap every vector in `new Float32Array(l2Normalize(v))`.
7. Save through `saveArtifactSearchIndex` and return the record.

`indexProjectArtifacts` loops sequentially (one doc at a time — free-tier rate
limits), skips fresh records unless `force`, honours `signal.aborted`, and
reports progress.

### STEP 7 — Lift the draft + wire the badge

**`src/App.tsx`**
- `draftByThread: Record<string, string>` state, cleared on send for that thread.
- Pass `draftText` / `onDraftTextChange` into `ChatView`.
- Pass `draftText`, `searchConfig`, `searchIndexMap`, `draftResults`,
  `onSearchConfigChange`, `onIndexAll` into `ArtifactsLibraryView`.
- `searchConfig` state via `loadSearchConfig()` / `saveSearchConfig()`.
- `searchIndexMap` loaded from `loadProjectSearchIndex(projectMeta.id)` when
  the project id changes.
- Two-tier debounce:
  - 350ms → recompute FTS results.
  - 5000ms → if a `vec*` flag is on and the trimmed draft is ≥ 12 chars and the
    clause texts are not already in `queryVecCacheRef`
    (`Map<string, Float32Array[]>`), call `/api/search-index/embed` with
    `taskType: 'RETRIEVAL_QUERY'` and cache.
  - Toggling flags / threshold re-scores with **zero** API calls (cache hit).
- `missingMatchCount = countMissingMatches(draftResults)`.

**`src/ui/chat/ChatView.tsx`**
- New optional props: `draftText?`, `onDraftTextChange?`, `missingMatchCount?`,
  `onOpenArtifactsWithProximity?`. Keep the internal `useState('')` as a
  fallback when `draftText === undefined` so bare unit-test mounts keep working.
- LAW 5: delete BOTH `stagedAttachments.length` badges from the two `[+ Attach]`
  buttons.
- Add `missingMatchCount > 0` badge (`data-testid="attach-match-badge"`) to both
  `[+ Attach]` buttons; when the count is positive, clicking calls
  `onOpenArtifactsWithProximity?.()` first, falling back to `onOpenArtifacts?.()`.
- Do not invent new `bg-[#…]` hexes — reuse an existing semantic background or a
  value already counted by `design-law.test.ts`.

### STEP 8 — `src/ui/artifacts/ArtifactsLibraryView.tsx`

- `LibraryLens = 'folders' | 'graph' | 'proximity'`.
- Third pill in the floating lens switcher: `Proximity`
  (`data-testid="lens-proximity"`).
- **Folders lens:** pass `badge={match ? \`match ${Math.round(match.bestScore*100)}%\` : undefined}`
  to `AttachmentRow` for unattached artifacts above threshold, so related docs
  are visible without leaving the folder tree.
- **Proximity lens layout** (NO borders, surfaces + shadows only):
  1. Draft readout (`bg-surface-2 rounded-xl p-3`), or an inline editable test
     input when the chat draft is empty.
  2. Method toggles: `FTS: Sections`, `FTS: Q&A`, `Vec: Sections`,
     `Vec: Q&A`, `Split Clauses` — pill buttons with `aria-pressed`.
  3. Threshold `<input type="range" min=0.20 max=0.85 step=0.05>` with live
     readout and live count of unattached docs above it.
  4. Index status (`Indexed: X / Y notes`) + `Index All Unindexed` /
     `Re-index All` + `Stop`, with a live progress line
     (`Indexing 2/10: Unhaunter Vision — Generating Q&A (window 1/3)…`).
  5. Flat ordered list, split `Suggested to Attach (Above Threshold)` then
     `Below Threshold / Already Attached`, each `AttachmentRow` followed by an
     X-Ray bar (`bg-recess-1 rounded-lg px-2.5 py-1.5 text-[10px] font-mono`):
     `Score: 0.74 [fts-sec: 0.48 · fts-qa: 0.69 · vec-sec: 0.61 · vec-qa: 0.74]`
     plus `Matched Q (heading): "question" → "answer"` or
     `Matched Section (heading): "snippet"`.

### STEP 9 — `src/ui/artifacts/ArtifactDetailModal.tsx`

- Tab union becomes `'content' | 'qa' | 'metadata' | 'history'`.
- Button `Q&A Index (${qaPairs.length})` with `data-testid="tab-qa-index"`.
- Tab body: index status (`Not indexed yet` / `Stale (document edited…)` /
  `Indexed · N Q&A pairs · M section vectors`), a single-artifact
  `Index / Regenerate Q&A & Embeddings` button with live status, and all
  `qaPairs` grouped by `sectionHeading`.
- Needs new optional props from `App.tsx`: the artifact's index record, its
  status, and an `onIndexArtifact` callback.

### STEP 10 — Tests

New `src/tests/draft-search-engine.test.ts` covering:
- `splitArtifactIntoSections` on multi-heading 60 KiB markdown (headings
  preserved, nothing over the cap).
- `l2Normalize` on an unnormalized 768-dim array → length 1.0.
- `scoreArtifactsAgainstDraft` with each flag toggled individually:
  - `ftsSections` finds a fact buried mid-document.
  - `ftsQa` matches through a generated question when body words differ.
  - `vecSections` / `vecQa` rank by cosine.
  - attached artifacts are excluded from `countMissingMatches`.
  - `splitClauses: true` stops a 3-topic draft from diluting a single-topic hit.

New `src/tests/search-config.test.ts`:
- defaults, localStorage round-trip, junk values fall back, URL override.

---

## 3. MANDATORY VERIFICATION CHECKLIST

1. `npm run lint` — must exit 0.
2. `npx vitest run` — must be green, **including `design-law.test.ts`**.
3. If any design-law failure names a border or a new `bg-[#…]`, fix it with
   surfaces/shadows — do not weaken the test.
4. Live browser probe (if run): restart the server after every UI edit
   (LAW 7). Boot button text is `Use local storage instead`.

---

## 4. EXPLICIT OUT-OF-SCOPE (DO NOT DO THESE)

- No changes to `optical-compiler`, no auto-attach, no `<recall>` prompt block.
- No embeddings or Q&A inside `ProjectSnapshot` / Firestore.
- No graph-lens overlay, no colouring of `SpatialGraph` nodes by relevance.
- No shallow-cut / granularity badge on `[+ Attach]` (rejected: wrong place).
- No new dependency (no FlexSearch, no MiniSearch, no HNSW). Plain TS only.
