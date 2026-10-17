# STREAM PROTOCOL (`STREAM_PROTOCOL.md`)

> **TENTATIVE DRAFT — not decided.** Nothing here is doctrine; it's a snapshot
> of what the code does today plus open questions, written so we can discuss it.
> Written 2026-10-17 by Goose from the actual code
> (`src/domains/03-stream-protocol/`, `server.ts`); revised same day after
> David's first review pass ("it has to be all tentative… this is all open for
> discussion later"). **LGTM still pending on this revision.**

---

## 1. Purpose (fairly confident about this one)

Define how the LLM's single-shot response stream gets split: prose to the
user's eyes, structured tags to the graph — ideally within **one API call**
(Principle 2 in `00_core_philosophy_soul.md`). The parser shouldn't trigger
follow-up requests. Exact mechanisms below are current state, not fate.

## 2. Transport (deliberately vague — this WILL move)

Today, roughly:

1. Client sends the compiled single-turn payload (`CONTEXT_COMPILER.md` §4)
   to *some* local server process, which forwards it to *some* model provider.
2. Provider streams chunks back; the client demuxes them in real time
   (`demuxChunk` while in flight, `demuxFullTurn` at turn end).

What we're deliberately not pinning down yet:

- **The server.** Current code happens to live in `server.ts` (Express-ish
  proxy built inside the AI Studio app scaffold). That's an implementation
  accident, not a contract. Don't write docs — or code — that assume this file
  forever.
- **The provider.** It routes to **Gemini** today only because the app was
  built with Google AI Studio's build feature — that's what it spits out.
  David's actual preference: **generic routing, probably with OpenRouter in
  the picture** (interesting models there, free tiers that rotate, see cost
  discussion in `01_requirements_and_meta.md` Problem 4). Keep Gemini as one
  route; don't canonize it. A provider-adapter shape feels right, but that's
  a future design conversation.

## 3. Streaming & partial parsing (format requirement — still fuzzy)

- **Requirement we're fairly sure of:** the format must permit **approximate
  real-time extraction from incomplete input** — tags arrive chunk by chunk,
  often broken mid-attribute, and we still want to strip/act on what's
  parseable *now* rather than waiting for turn end.
- **Idea on the table (David):** XML/HTML-style parsing has decades of
  practice at exactly this — tolerating broken, in-flight markup. Current code
  is regex-based, which works for cooperative output but is brittle against
  creative models. Worth revisiting whether a more HTML-parser-minded approach
  is the sturdier base. Not decided — just an idea we don't want lost.

## 4. What the user sees (agreed direction + one inspiration)

- **Agreed:** functional tags must be stripped from visible prose as they
  stream — user reads clean text, never raw protocol.
- **Inspiration worth keeping (David):** we *may* borrow the *presentation*
  ideas from agentic platforms without borrowing their architecture — e.g.
  translating tags into small on-screen indicators: a step ticking, a cue
  "the model is organizing an artifact right now," "topic shift proposed."
  The agent-ness stays in the emitters' single shot; the UI just shows honest
  status. UI design question — parked in `MOBILE_UX_SPEC.md`'s neighborhood,
  not settled here.

## 5. Where does parsing happen? (never decided — tentative split hypothesis)

Both the server and the client parse today. That was flagged as "pick one" in
the previous draft; David's response: **we never decided, and maybe picking one
is the wrong frame.** Tentative reading — *his guess, offered as a guess:*

- Same source data, **different ends**:
  - **Backend / server-side:** full parsing and decoding — create the
    objects, persist them (database and such). Authoritative for *state*.
  - **Frontend / UI:** partial rendering only — update what's on screen as
    chunks arrive. Authoritative for *display*.
- i.e., not redundancy for safety, but **one pipeline serving two consumers**
  with different completeness needs.

If that split holds up, it's a clean story. It might not — flag remains open.

## 6. The tags (as implemented today; formats under discussion)

### 6.1 `<topic_shift … />` — chapter boundary proposal

```xml
<topic_shift title="New Chapter Title" abstract="1-sentence essence" summary="Key invariant bullets" />
```

- Attributes: `title` (required to trigger), `abstract?`, `summary?` →
  `ExtractedTopicShift { title, abstract?, summary? }`.
- On detection (current behavior): chapter closes, new chapter starts; user
  can later drag/re-merge the boundary. Model proposes, user disposes.
- Legacy fenced JSON form (```` ```topic_shift {…}``` ````) still parsed —
  **and the server's default system instruction still teaches that JSON form.**
  Open question: which format do we actually teach?

### 6.2 `<artifact_upsert>…</artifact_upsert>` — create/update an artifact

```xml
<artifact_upsert id="art-123" title="Rigid Body Parameters" type="document">
  <abstract>1–2 sentence essence (→ t1)</abstract>
  <summary>Key bullets (→ t2)</summary>
  <content>Full markdown body (→ t3)</content>
</artifact_upsert>
```

- Attributes in any order; `id` optional (generated if missing);
  `type` = `document | chapter`.
- Inner blocks → tiers: title→t0, `<abstract>`→t1, `<summary>`→t2,
  `<content>`→t3, with fallbacks when blocks are omitted.
- `<artifact>` accepted as alias; legacy fenced ```` ```artifact ```` blocks
  also parsed — and *that's* the form the default system instruction teaches.
  So today the instruction and the modern parser disagree. Open question.

### 6.3 `<link … />` — propose a graph edge

```xml
<link source="art-1" target="art-2" kind="relates_to" />
```

- Multiple allowed per turn (parser loops).
- `kind` checked against a fixed list
  (`parent_of|child_of|relates_to|refines|born_from`), unknown → fallback
  `relates_to`.
- **Tension to resolve:** David wants edges *generic — any relationship type*
  (`01_requirements_and_meta.md` §5). The closed list contradicts that.
  Probably the parser should accept arbitrary kinds and only fallback when
  kind is missing entirely — but that's a code-change decision, not yet made.
- `<link>` also **isn't taught in the system instruction** — model may not
  know it exists. Teach it or consider links out-of-band?

## 7. Events emitted today (fairly confident — this is the code's contract)

Per `03_DOMAIN_ARCHITECTURE_RULES.md` rule 5, the parser emits typed events
rather than mutating state directly:

| Event | Payload | Emitted when |
|---|---|---|
| `onProseChunk` | cleaned text | every chunk, after tag stripping |
| `onTopicShiftDetected` | `ExtractedTopicShift` | valid `<topic_shift>` or legacy JSON |
| `onArtifactUpsertDetected` | `ExtractedArtifactUpsert` | valid upsert/artifact block |
| `onLinkDetected` | `ExtractedLink` | valid `<link>` |
| `onStatusChanged` | `StreamStatusPayload` | connecting/thinking/writing/indexing/completed/error |
| `onTelemetryReceived` | `BackendTelemetry` | token/latency metadata available |

`demuxFullTurn` returns `{ cleanReply, rawReply, artifacts, topicShift,
telemetry }` for end-of-turn reconciliation.

## 8. Invariants (these rest on principles, so firmer)

1. **One turn, one call.** Parsing may update state; it may never dispatch
   another LLM request. (The recalibration side-call is user-triggered — a
   separate user action, `SYSTEM_ARCHITECTURE.md` §4.2.)
2. **Prose purity.** Users see prose; protocol stays invisible.
3. **Events, not mutations.** Parser emits; domains apply.

## 9. Open questions (consolidated — this is the discussion list)

1. Canonical tag format: XML, fenced blocks, or tolerance for both? Update the
   system instruction to match whatever wins.
2. Authoritative parsing layer — or the frontend-partial / backend-full split
   hypothesis from §5?
3. Generic link kinds — loosen validation to match the generic-edges intent?
4. Teach the model `<link>` emission, or not?
5. Legacy fenced fallbacks — keep as tolerance, or delete?
6. Streaming parser robustness — regex today; is an HTML-parser-style tolerant
   approach worth adopting (David's idea)?
7. On-screen translation of tags into status/step indicators (agentic-UI
   inspiration, non-agentic architecture) — do we want it, where does it live?

---

**LGTM status: ⬜ NOT APPROVED — this is the revised draft after David's first
review; he still needs to read this version and approve.**