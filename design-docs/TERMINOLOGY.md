# TERMINOLOGY — inventory & candidates

> **Why:** David, 2026-10-19 — *"we have a lot of stretching in meaning when
> these terms were created… maybe I need to sit down to redo all the terms and
> meanings because it's all messed up. Maybe that's why all of you are going
> crazy."* This is the agenda for that sitting. Not a decree — a list to argue
> over.
>
> **How to read it:** every row is *what it means today* → *where it stretches*
> → *candidates*. Tags: **[CODE]** = an identifier in the source (renaming
> costs a refactor) · **[UI]** = user-facing copy · **[DOC]** = prose in docs
> only (free to change). No term is sacred; the code ones are just expensive.
>
> **The rules I'd test candidates against** (invented, argue freely):
> 1. One word, one meaning. If it carries two, split it or rename one side.
> 2. Name the thing **the user gets**, not the mechanism that made it.
> 3. Codewords stay in code. When a codename leaks into speech (and then into
>    the UI), it stops meaning anything to the person reading it.
> 4. Never reuse a word that is also a generic computer term (context, mode,
>    preset, compiler) for something product-specific.

---

## 0. DECIDED (David, 2026-10-19) — these words are settled

| Concept | The word | Dies |
|---|---|---|
| How much of an artifact/chapter goes into a chat | **Granularity** | tier, level, resolution, T0–T3 |
| The four amounts | **title · description · summary · full** (internal enum numbers 10/20/30/100 — never shown in UI) | abstract, label, body |
| An artifact used in a conversation | **attachment** — the artifact is *attached to* a chat; **granularity lives on the attachment, per chat** | pin, pinned, focal, focus |
| A stored thought unit | **artifact** | note, document (as user words) |
| Not in the conversation | not attached — **there is no state for it** | culled, out, excluded, hidden |
| The code that puts text in front of the model | Context Compiler (docs); never named in the UI | optical, bare "compiler" |

**Killed outright, with prejudice:**
- **Focus** — the word *and* the feature, and every derivative (pin, pinned, focal, focus modes, depth of field, autofocus, myopia, forest). Preserved in §Eradicated so nobody reinvents it by accident.
- **Model selection / "preset"** — it's Gemini Flash Lite; OpenRouter later. No picker, no presets, no euphemisms.
- **The excluded/culled state — and detach** — an artifact is attached or it
  isn't. Shrink it → granularity *title* (the floor: a mention). **No detach**
  (David, 2026-10-19: *"probably we can't detach it — assume that feature won't
  be there"*). Too heavy anyway → start a new chat.
- **Auto-compaction / "auto rule"** — that was Focus wearing a hat. Granularity is set **by hand**, per attachment. The one automatic behaviour left is the chapter default (open→full, closed→summary), which needs a proper refactor: `TODO.md` #4.

---

## 0b. (superseded) The earlier five-pick proposal — kept for the record, **not** the decision

Rather than you grinding through the inventory below: here are my picks for the
five worst collisions. Reply **"all ok"**, or name the ones you'd change. If you
don't want to decide at all, say **"you decide"** and I'll apply them and stop
asking.

| # | Today (colliding) | My pick | Killed |
|---|---|---|---|
| 1 | tier vs level (`ResolutionTier` numbers vs `AbstractionLevel` words) | **level** — words everywhere: title / abstract / summary / full / excluded; numbers stay in code only | "tier" in UI/docs |
| 2 | culled / out / excluded / hidden | **excluded** — one word, everywhere | the other three |
| 3 | artifact / note / document | **artifact**; "note" dies; "document" survives only as a code kind | "note", UI "document" |
| 4 | focus (pinned / husk modes / camera analogy) | **pin / pinned / focal** | "focus" (except the dead husk docs) |
| 5 | preset (model vs compaction) | models are just **model**; the compaction autopilot = **auto rule** | "preset" |

Honourable mentions, same deal: **compiler** never appears in the UI (docs: "Context Compiler") · **control mode** → **Context** (it's a screen) · **workspace/project** → **project** in UI, workspace stays in code · **compaction** splits into *display* vs *payload*.

**After your answer:** I sweep docs + UI copy to match (cheap, days not weeks).
The code renames go into `TODO.md` as one batch, done when we touch those files
anyway — no separate refactor project.

---

## 1. The things (what exists)

| Term | Tags | Means today | Where it stretches | Candidates |
|---|---|---|---|---|
| Artifact | CODE UI | Any stored thought unit (`UniversalArtifactDocument`) | In the mirror it's called a **note**; in its own `type` field, a **document**; old docs say **spec** | Pick ONE UI word. My lean: keep "Artifact" (it's the `Artifacts` surface) |
| Note | UI | MirrorPanel's word for an artifact | Same object as artifact — two names, one thing | Drop it, or make it THE word and kill "artifact" |
| Document | CODE | `type:'document'` — the non-chapter *kind* of artifact | Reads like a synonym for artifact; it's actually a subset | Keep as a kind-name ("document artifact") |
| Chapter | CODE UI | Two different things: (a) `ChapterPartition`, a **window of turns**; (b) `type:'chapter'`, a **crystallized** chapter-artifact | Same word, two objects, and they interact | Disambiguate: e.g. "chapter" (window) vs "chapter artifact" (crystallized) |
| Turn | CODE | One message | UI says "message"; code says "turn" | Align UI+code |
| Message | UI | = Turn | Legacy `ChatMessage` was deleted; word lingers | Same as above |
| Thread | CODE UI | A chat thread (`ChatThread`) | — | Fine |
| Workspace | CODE | The project container (`workspaceId` on everything, `WorkspaceDomain`) | UI calls the same thing a **project** (`ProjectMetadata`, "Project Launcher") | One word. My lean: "project" (user-facing), workspace demoted to code |
| Project | UI CODE | = Workspace | See above | See above |
| Chat / Dialogue | UI DOC | The conversation surface | Old copy says "Dialogue" | "Chat" |

## 2. The context machine (what gets sent)

| Term | Tags | Means today | Where it stretches | Candidates |
|---|---|---|---|---|
| Compiler | CODE DOC | `03-optical-compiler` — builds the prompt | A bare codename; also "optical compiler", "context compiler", and just "compiler" in speech | Never user-facing. In docs: one qualified name (e.g. "Context Compiler") |
| Optical | CODE | Codename from the camera analogy | Means nothing to a reader; the analogy is labeled "once, optional" elsewhere | Internal only, never UI |
| Payload | DOC CODE | The assembled text sent to the model | Also called **prompt**, **compiledPrompt**, "the context" | One word — see below |
| Prompt | CODE | `compiledPrompt` + `systemInstruction` | Overlaps "payload" | Pick payload-or-prompt, not both |
| Substrate | CODE | `knowledge_graph_substrate` XML, `substrateTokens` — the **notes block** | Obscure; "substrate" says nothing | "notes" / "references" |
| History | CODE | `conversation_history`, `historyTokens` — the **chapters block** | "History" is generic | "conversation" / "chapters" |
| Tier | CODE UI | `ResolutionTier = 0\|1\|2\|3`, **and** `AbstractionLevel = 'full'\|'summary'\|'description'\|'title'\|'excluded'` | **Two vocabularies for one axis** — a number and a word — plus `MultiResolutionTiers { t0_label, t1_abstract, t2_summary, t3_body }` mixing both | One axis, one name. My lean: words (title/abstract/summary/full), numbers only inside code |
| Level words | CODE | title / abstract / summary / full / excluded | Chapters use a *different* set (title / short / long / full) | Same four words for both, or make the difference deliberate |
| Culled / Out / Excluded / Hidden | CODE UI DOC | "not sent to the model" | **Four words for one idea** | One word. My lean: "excluded" (code) / "out" (UI) |
| Pin / Focal / Focus | CODE UI | User marks an item as the centre (`focalIds`, `pin`) | "Focus" also = the husk "focus modes"; also = "depth of field" | Keep "pin" as the verb; "focal" as the state |
| Focus / Autofocus / Myopia / Forest | DOC CODE | The non-working "optical modes" | Three unrelated meanings under one word | Retire with the husks; presets get a new name |
| Override / Forced | CODE UI | Manual tier set by the user | Two words | One |
| Radius / Distance | CODE | Graph hops from the focal point | — | Fine |
| Fallback / Auto | CODE UI | Compiler's default focal when nothing is pinned | — | Fine |
| Preset | DOC | **Two things:** model preset (fast/deep) *and* auto-compaction preset | Straight collision | Rename one (e.g. "model preset" vs "auto rule") |
| Telemetry | CODE DOC | `ContextTelemetry` (the numbers) **and** "ambient telemetry" (orb + heat strip) | Two senses | Numbers = "the numbers"/"context stats"; visuals get their own word |
| Budget / Ceiling | CODE DOC | `tokenCeiling`, `budget_ceiling`, "token budget" | Three names | One ("ceiling") |

## 3. The verbs (what you do)

| Term | Tags | Means today | Where it stretches | Candidates |
|---|---|---|---|---|
| Compaction / Compact | DOC | **Two mechanisms:** (a) *display* — a chapter card shows summary instead of turns; (b) *payload* — the model gets a summary instead of turns | One word, two systems that don't know about each other (see `09` §4-era finding) | Separate them; the mirror principle wants them linked |
| Summarize / Recalibrate | CODE DOC | `03-chapter-recalibration` + `/api/summarize` — regenerate a chapter summary | Two words, one operation | One |
| Extract | CODE DOC | Pull an artifact out of the conversation | — | Fine |
| Split / Merge / Seam / Boundary | CODE DOC | Chapter window editing | "seam" vs "boundary" both used | One |
| Crystallize | DOC | A chapter becoming an artifact | Never defined anywhere | Define or drop |
| Provenance / born_from / lineage | CODE DOC | Which chapter/turns birthed an artifact | Three words | One |
| Revision / Version | CODE UI | Artifact history (`01-artifact-versioning`) | "revision" and "version" alternate | One |
| Degradation | DOC | Over-budget downgrade of tiers | — | Fine |

## 4. The places (surfaces)

| Term | Tags | Means today | Where it stretches | Candidates |
|---|---|---|---|---|
| Control mode | DOC | The new editable-mirror screen | **A screen named a mode** | "Context editor" / just "Context" |
| Library | DOC | The Artifacts surface (read/edit) | New term, unused in code | OK pending the terms above |
| Mirror | DOC UI | The "what the LLM will see" view (`MirrorPanel`) | — | Keep — it's David's word and it means one thing |
| Orb | UI | `SaturationOrb` — button + saturation indicator | — | Fine |
| Heat strip | UI | `EdgeHeatStrip` | — | Fine |
| Sidebar | CODE | The hamburger drawer | Planned name was `SidebarOutliner` | Fine |
| Canvas | DOC | Planned `ChatCanvas` | — | "Chat" is enough |
| Spatial graph / Topological graph | UI CODE | The graph view | **Two names** — `SpatialGraph` (UI) vs `02-topological-graph` (domain) | One |

---

## 5. The worst offenders (if you only fix five)

1. **tier vs level** — two vocabularies (`ResolutionTier` numbers, `AbstractionLevel`
   words) for one axis, plus mixed field names (`t0_label`). Pick words, hide numbers.
2. **culled / out / excluded / hidden** — four words for "not sent". One.
3. **artifact / note / document** — three words, one-ish object.
4. **focus** — pin-focal vs the husk modes vs the camera metaphor. Three meanings.
5. **preset** — model preset vs compaction preset. Straight collision.

Honourable mentions: **compiler** (codename leaked), **control mode** (screen ≠
mode), **compaction** (display vs payload), **workspace vs project**.

---

## Eradicated: "Focus" — documented, not built

David, 2026-10-19: *"Focus is a special feature that probably has not been
described, or maybe I did in some chat and it has been completely misinterpreted
and butchered over and over."*

What Focus was ever *meant* to be, in his words: you have an artifact attached
to a chat, and you mark **that attachment** as the current focus of the
conversation — then the system handles granularity for you by computing
distance. That's it. That's the whole idea.

**Status: eradicated.** Untested, utopic, not buildable at this stage. The word
and every derivative are retired because they were butchered and confused —
pin, pinned, focal, focus modes, depth of field, autofocus, myopia, forest. The
compiler's current distance/radius/pin machinery *is* this unborn feature, and
its removal is tracked in `TODO.md`.

If it ever comes back, it comes back as a **described feature with tests** —
not as a word we half-remember.
