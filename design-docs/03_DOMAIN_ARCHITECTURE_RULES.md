# DOMAIN-DRIVEN ARCHITECTURAL GOVERNANCE & INVARIANTS (`03_DOMAIN_ARCHITECTURE_RULES.md`)

## 1. Absolute Directives for AI Agents
Any AI coding agent modifying this codebase MUST comply with the following non-negotiable architectural invariants. Violations of these rules represent immediate architectural failure.

1. **NO HORIZONTAL TIERS / NO MVC:** Code is organized strictly by **Vertical Business Domains** located in `src/domains/<domain-name>/`. Placing code in generic "controllers", "models", or monolithic "utils" is strictly prohibited.
2. **STRICT HIERARCHICAL DEPENDENCIES:** Dependencies flow strictly downward according to the Level Hierarchy defined in Section 3. Level $N$ may NEVER import from Level $\ge N$. Circular dependencies will fail compilation.
3. **100% UNIT TESTABLE VIA DEPENDENCY INJECTION:** Every domain must export a TypeScript interface (`I<DomainName>Domain`). Domains must accept dependencies via constructor or factory parameters so they can be tested in isolation using lightweight in-memory mocks without DOM or network access.
4. **NO GOD COMPONENTS:** `App.tsx` and UI views may NEVER contain business logic, parsing regexes, graph calculations, or direct API transport calls. UI components are dumb projections that dispatch commands to domain interfaces.
5. **EVENT-DRIVEN INGESTION:** The LLM stream protocol parser may NEVER mutate UI state or database persistence directly. It emits typed domain events (`onProseChunk`, `onTopicShiftDetected`, `onArtifactUpsertDetected`, `onLinkDetected`).
6. **SINGLE DATA MODEL (UNIVERSAL ARTIFACT):** The legacy `Project` vs `WorkspaceState` division is permanently abolished. All persistent thought units (documents and conversation chapters) conform to the Universal Artifact Schema with pre-computed multi-resolution tiers (T0-T3).

---

## 2. Directory Layout & Bounded Contexts

Every domain lives in its own isolated folder under `src/domains/`:

```
src/domains/
├── 00-workspace/                 # Level 0: Project container & disk sync
├── 01-dialogue-timeline/         # Level 1: Conversational turns (active buffer)
├── 01-artifact-document/         # Level 1: Multi-resolution living specs (T0-T3)
├── 01-artifact-versioning/       # Level 1: Append-only revision history & diffs
├── 02-chapter-segmentation/      # Level 2: Boundary slicing, merging, tactile drag
├── 02-provenance-tracking/       # Level 2: Bidirectional Artifact <-> Turn index
├── 02-topological-graph/         # Level 2: Semantic edge matrix & BFS pathing
├── 02-recursive-grouping/        # Level 2: Super-Chapters & hierarchical clustering
├── 03-stream-protocol/           # Level 3: 1-Turn transport & XML chunk demuxer
├── 03-chapter-recalibration/     # Level 3: Side-channel summary steering (Flash)
├── 03-optical-compiler/          # Level 3: Depth-of-Field prompt compiler & telemetry
└── 04-presentation/              # Level 4: UI Surfaces & Ambient Telemetry
    ├── canvas/                   # Chat timeline, cards, boundary handle
    ├── telemetry/                # 5px heat-strip, floating saturation orb
    ├── inspector/                # Bottom sheet for markdown & revisions
    └── cartography/              # Sidebar tree & Macro Forest Map
```

---

## 3. Standard Domain Interface Contract

Every domain folder must contain:
1. `types.ts`: Domain-specific entities and payload interfaces.
2. `interface.ts`: The public contract (`I<DomainName>Domain`) declaring Queries, Commands, and Events.
3. `<DomainName>Domain.ts`: The deterministic implementation.
4. `<DomainName>.test.ts`: Unit tests using mocks for all dependencies.

---

## 4. The 5 Dependency Levels (Strict Downward Flow)

```
Level 4 (Surfaces)     -> 04-presentation (Canvas, Telemetry, Inspector, Cartography)
                                │
Level 3 (Coordination) -> 03-optical-compiler, 03-stream-protocol, 03-chapter-recalibration
                                │
Level 2 (Structure)    -> 02-chapter-segmentation, 02-provenance-tracking, 
                          02-topological-graph, 02-recursive-grouping
                                │
Level 1 (Primitives)   -> 01-dialogue-timeline, 01-artifact-document, 01-artifact-versioning
                                │
Level 0 (Envelope)     -> 00-workspace
```

*RULE:* A domain in Level 2 may import from Level 1 or 0. It may NEVER import from Level 3 or 4.
