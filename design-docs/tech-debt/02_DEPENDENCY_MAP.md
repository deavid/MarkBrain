# Dependency Map — the mechanical import graph

*2026-10-30 @ fe3fbdd. Generated from `import`/`import()`/`from` statements across all 257 .ts/.tsx files under `src/` and `server/`, with module resolution (index.ts, extensions). Counts are import statements, not files.*

## Fan-in / fan-out per slice

*fan-in = how many import statements across the codebase point INTO this slice; fan-out = how many import statements this slice aims OUTSIDE itself.*

| slice | in | out | read |
|---|---:|---:|---|
| `src/utils` | **107** | 7 | biggest magnet, but nearly all leaf-type usage (pure helpers) — healthy *if* every resident is single-phrase |
| `server` | 91 | 25 | the "in" is tests; the **25 "out" all point into `src/**`** — see boundary section |
| `src/services` | 85 | 22 | stores + persistence + sync |
| `src/application` | 54 | **77** | the orchestration layer — imports from nearly everything |
| `src/ui` | 51 | **164** | UI reaches everywhere; details below |
| `src/data` | 45 | 11 | small layer, but least healthy per-file (see findings) |
| `src/gateway` | 27 | 15 | |
| `src/types` | 25 | 6 | ⚠ a "types" layer that itself imports from domains (direction worth questioning) |
| `domains/root` | **180** | 20 | the junk drawer: DomainRegistry, granularity, plaintextTree, callLogTypes, search/ |
| `domains/01-artifact-document` | 21 | 2 | |
| `domains/06-chat-threads` | 17 | 5 | |
| `domains/search` | 22 | 5 | |
| `domains/02-chapter-segmentation` | 11 | 6 | |
| `domains/01-dialogue-timeline` | 10 | 1 | |
| `domains/01-artifact-versioning` | 8 | 3 | |
| `domains/00-workspace` | 7 | 2 | |
| `domains/02-topological-graph` | 7 | 1 | |
| `src/prompts` | 7 | 2 | |
| `domains/03-optical-compiler` | **1** | 11 | consumed only by App.tsx — no facade, no other consumer |
| `domains/03-stream-protocol` | 1 | 4 | same shape |
| `domains/03-chapter-recalibration` | **0** | 4 | fan-in zero — alive (via DomainRegistry → createChapterHandlers), but invisible |
| `src/tests` | 0 | 313 | excluded from judgment |

## Cross-slice edges that matter

### Domains are internally near-clean ✅

Domain→domain runtime edges are rare and mostly types-only: `01-artifact-versioning→01-artifact-document` (3), `02-chapter-segmentation→01-dialogue-timeline` (1), `03-stream-protocol→02-topological-graph` (1), `06-chat-threads→01-dialogue-timeline` (1), `search→01-artifact-document` (2). The vertical-slice ideal largely holds *inside* domains/.

The exceptions are the three domains whose implementation IS `index.ts` (no facade at all): `03-optical-compiler`, `03-stream-protocol`, `03-chapter-recalibration`. Their imports go straight at other domains' internals (`03-optical-compiler → 01-artifact-document/ArtifactDocumentDomain.ts` for `STALE_LAYERS_NOTICE`).

### The UI reach 🚩

`src/ui` → 164 external imports, including:

- **49 into `domains/root`** (junk drawer) — of which **16 are deep imports of `granularity.ts`** (a file that mixes domain vocabulary with hardcoded CSS palette), 9 of `DomainRegistry.tsx`
- **12 deep imports past `06-chat-threads`' index** (its `types.ts` is a policy file: `resolveCapabilities`, `deriveThreadRuntime`, queue derivation)
- 6 into `00-workspace`, 15 into `src/data`, 44 into `src/utils`, 14 into `src/types`

### The layering direction breaks 🚩

Upward edges (lower layer importing higher layer):

- `src/services/vpsSync` → **`src/application/serverMutationQueue`** (services importing application)
- `server/db/projectRepo.ts` → **`server/jobs/serverArtifactIndexer`** (db importing jobs)
- `server/jobs/serverArtifactIndexer.ts` contains a **lazy `require('../routes/account')`** purely to dodge a circular import — a circular dependency that exists and is being hidden
- `src/data` — 5 of its 9 files reach upward into services/gateway/prompts; one has an import-time side effect

### The client/server boundary is a convention, not a seam 🚩

All 25 `server → src/**` imports run one direction (server→client), which keeps blast radius contained — but:

- there is **no neutral shared home**: the "shared layer" is whatever directory a file happens to sit in
- `ProjectSnapshot` — the server's core data contract — is defined inside a **client store file** (`src/services/stores/projectStore`)
- `server/routes/searchIndex.ts` imports **runtime client code**: `QueryVectorCache` class + `tokenizeForSearch`/`cosineSimilarity` from `src/domains/search/draftSearchEngine` — a client refactor breaks production search
- **two live copies of the same prompt/format rules**: `routes/searchIndex.ts` locally re-implements `buildQaPrompt`/`parseQaPairs` from `src/prompts/lanes`, which the indexer imports — drift is already possible, in both directions
- `server/lib/prompt.ts` is a 1-line file whose entire body is `export * from '../../src/prompts/prompt'` — the boundary defined by directory accident

## The one-phrase reading of the graph

| signal | phrase |
|---|---|
| domains import each other rarely, via types | "Domains keep to themselves; the slices are real." |
| `domains/root` fan-in 180 | "Everything the domains forgot to own got parked at their front door." |
| ui out=164 with deep imports | "The UI doesn't talk to facades; it reaches into guts." |
| application out=77 | "Orchestration is one layer that has heard of everything." |
| server→src ×25, no shared home | "The server reaches into the client's closet because no hallway exists." |
| upward edges + lazy require | "Three places where the layers point the wrong way, one of them hidden on purpose." |
