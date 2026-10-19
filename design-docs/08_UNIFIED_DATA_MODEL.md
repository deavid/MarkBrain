# UNIFIED DATA MODEL — the type-collapse proposal (`08_UNIFIED_DATA_MODEL.md`)

> Status: **EXECUTED 2026-10-18 ~20:40** (David granted free reign: *"leave the
> house better than it was"*). Decision register below executed as written,
> plus agent judgment calls recorded in §Execution-status. Gates: tsc clean,
> 71/71 (68 + 3 new unified-model tests), rot-rg clean, capture green with
> visual confirmation.
>
> Original header: written 2026-10-18 after David
> rejected a hand-waved "pick OpenAI names" lean and demanded ground work.
> Evidence base: full field-level audit (every field traced to writers/readers
> with file:line; re-verifiable with `rg`). This file is the durable record so
> the audit never has to be redone — David reads the chat narrative, not this.

---

## The story (what this is about)

The app stores each conversation once, in a simple shape: a list of turns,
chapters slicing that list by index. That shape is what persistence writes,
what tests assert, what the fixture holds, and what the context compiler reads
when it builds the prompt the LLM actually sees.

The chat screen doesn't read that shape. It reads a second, older description
(ISO timestamps, embedded `messages[]` arrays, OpenAI-ish meta names), built
by a projection layer that re-runs on every redraw — and during streaming that
is every chunk. The projection drops, hardcodes, and renames fields on the way.

This matters because of the **mirror** (the pillar): "show me what the LLM
will see." The compiler eats the source; the mirror displays the converted
copy. Any field the conversion loses makes the mirror lie. The fix is to
delete the translator, not to maintain it better.

## Findings that drive the proposal (punchlines)

1. **Legacy `Turn` (src/types): zero importers.** Free deletion.
2. **Legacy `Chapter`: ~20 fields, ~4 alive.** Compression toggle is a
   documented no-op; `keyPoints` hardcoded `[]`; `topicShiftReason` dropped by
   projection (badge permanently blank); `createdAt` regenerated per chunk,
   read by nobody; `deepSummary`/`depth`/`code`/`isPinnedAsArtifact`/`graph`/
   `projectId` dead or zombie.
3. **Meta dual-vocabulary is pure redundancy:** sendQueue writes Gemini names
   AND OpenAI aliases in the same literal, same values; projection's `??`
   fallbacks never fire on real data; domain `latencyMs` has no writer;
   `interrupted` always co-written with `streamState==='interrupted'`.
4. **Hidden type-unsafety:** SpatialGraph authors `'references'`/`'#tag'`
   labels → projection → unchecked cast into domain `RelationKind` → invalid
   kinds silently fail ancestor/dedupe matching. The translator launders type
   errors into the graph.
5. **Severed vision data:** server summarize returns `keyPoints` — UI
   discards at the writer. Domain `topicShiftReason` dropped. (Compiler prompt
   format in CONTEXT_COMPILER §4 shows Key Points; code doesn't emit them.)
6. **Tests, fixture, persistence are ALL already domain-shaped.** Removing
   legacy types breaks zero tests. `ChatMessage.chapterId`,
   `createdArtifacts`/`updatedArtifacts`/`costEstimate`: zero readers.
7. **Three token estimators** (3.8 client / 3.8 server dup / ÷4 compiler) —
   mirror rows can disagree with mirror totals. Adjacent debt, not this task.

## The frame

**Domain types are the one truth.** `Turn`, `ChapterPartition`,
`SemanticEdge`, `UniversalArtifactDocument`. Screens consume them directly;
where a screen needs "chapters with their messages," a **selector** groups by
the chapter window (`getTurnSlice` already exists) — a selector is not a
second type system. The projection layer is deleted. Mirror and compiler then
read the same bytes by construction.

Chapters stay **windows** (startIndex/endIndex), not owners (embedded arrays),
because requirement §4.13 — the KISS seam toolkit (move/split/merge) —
operates on seams. Provenance stays **off** messages: §4.7 puts it on
artifacts (chapter/turn ranges) + `born_from` edges + versioning.

**Not decided here (left open on purpose):** Universal Artifact for chapters
(`UAD.type` already `'document' | 'chapter'` — the crystallized-chapter
concept untouched; §4.5 reversibility intact).

## Decision register

| # | Decision | Ground |
|---|---|---|
| D1 | Message type = domain `Turn` (legacy Turn + ChatMessage deleted) | persisted/tested/compiler-input shape; legacy Turn has zero importers |
| D2 | `timestamp` = epoch `number` everywhere; format at display edge | storage truth; tests assert `typeof number`; per-chunk ISO conversion was churn |
| D3 | Meta vocabulary = wire names (`promptTokens/candidatesTokens/totalTokens/durationMs`); alias pair + `latencyMs` dropped; `interrupted` folded into `streamState` | already the normalized BackendTelemetry; tests assert it; aliases always dual-written with identical values |
| D4 | Chapter = `ChapterPartition` (window); ongoing-rule centralized in segmentation domain (was duplicated in 3 places) | §4.13 seams; dedupe drift risk |
| D5 | `GraphEdge`/`GraphNode` legacy deleted; SpatialGraph consumes artifacts + `SemanticEdge` (view-local `node-` prefix convention stays inside the component) | kills the laundering cast (finding 4) |
| D6 | Projection deleted; ui-local selectors (`groupTurnsByChapter`-style) | mirror honesty; no competing type system |
| D7 | Dead debug fields dropped: `rawMetadata`, `timeToFirstChunkMs`, `costEstimate`, `raw_payload`, legacy Chapter dead fields | zero readers; re-add WITH a reader when orb/mirror needs them (avoid re-growing zombies) |

## Self-decided (surfaced for veto, not asked)

- **Edge vocabulary follows requirement §4.8** — open (`string`), known kinds
  as exported constant; SpatialGraph UI restricted to valid kinds (fixes the
  laundering). Rationale: decided doc beats accidental closed union.
- **`isFallback` (estimated-vs-real telemetry): deferred to mirror work** —
  no reader exists today; adding unread fields is the disease we're curing.
- **Compression toggle removed** (lying UI per corrections.md); real presets
  return later over the mirror. Reversible — shout to keep the husk.
- **`extractedArtifacts` writer**: add `code`/`category` (chips currently show
  `'spec'` fallback). One-line bug fix.
- **Genesis chapter write**: new projects write `workspaceId` properly; old
  bytes untouched (no readers today).

## Out of scope (sequenced, with reasons)

| Item | When |
|---|---|
| Token-estimator unification (3 estimators) + mirror per-chapter totals from compiler | with mirror v1 work |
| Sidebar hardcoded 128000 bar | follow-up |
| Over-budget degradation ("no degradation path exists yet") | compiler work |
| OpenRouter provider adapter | parked (David discarded) |

## Execution status (2026-10-18)

D1–D9 all done. Beyond-register judgment calls (made under free reign):
`Project` aggregate killed (it embedded the dead shapes — consumers got
granular domain props instead of a new view-model); demux link parser no
longer coerces unknown edge kinds (open vocabulary means open — LLM kinds
round-trip); `ExtractedArtifact` gains required `id` so chips' Inspect
resolves (was a silent no-op); abort-path telemetry now carries
`isFallback: true` (those numbers ARE estimates); fixture assistant turn
carries meta so capture demonstrates the vocabulary; compiler ongoing-window
now shares the one selector rule (it used slice(start,endIndex) while
projection used getTurnSlice — a real mirror-honesty discrepancy, now fixed).
`types/index.ts` 178→74L; `useProjectProjection` 205L→deleted;
`tokenCalculator` 415→283L; single estimator `utils/estimateTokens.ts`.
Export output shape changed (chapters are windows + turns; `boundaryRules`
died with `Project` — it never had a writer).

Still open (from §out-of-scope): mirror self-check (diff mirror rows against
compiler's actual emitted XML), sidebar 128000 was FIXED (now uses
tokenCeiling — the chain didn't exist, was threaded), over-budget
degradation remains compiler work.

## Gates for execution

`tsc` clean · vitest 68/68 · headless capture green · `rg` proves zero
legacy-type imports · report to David as narrative (corrections.md narrative
law), not tables.