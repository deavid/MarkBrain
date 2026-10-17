# Pending / open work

## Main task

- [x] **Green-lit by David 2026-10-17 ~20:46**
- [x] **REWRITE EXECUTED 2026-10-17 ~21:15** per the six answers:
  - `00_core_philosophy_soul.md` — rewritten: 2 principles first (user controls
    context; reject agentic), decisions marked reversible, uncertainty section,
    camera analogy **once at the end** (§5), filename kept per David.
  - `01_requirements_and_meta.md` — rewritten: root motivation first (brain
    overflow/collector/forest-view), 5 problems with failure-before-solution,
    cost target added, capture flow added, generic edges, §5 expanded with 2
    new genuine questions. Still no solutions smuggled into problem statements.
  - `SYSTEM_ARCHITECTURE.md` — "Core Tenets" → Principles (2) + Current design
    decisions (3, reversible); edge model marked generic; section 1 retitled;
    references to the two new docs marked "draft, pending LGTM."
  - `CONTEXT_COMPILER.md` — reframed as implementation spec; header note;
    "optical sparring partner" → "thinking partner"; focus-modes retitled;
    algorithm left intact (it was never the problem).
  - `02_UI_REFACTOR_PLAN.md` — new §0 Hard Rules: no top bars/sticky headers,
    mobile-first/desktop-second, capture flow sacred.
  - `03_DOMAIN_ARCHITECTURE_RULES.md` — rules 1–5 stay firm (decided), rule 6
    hedged as current decision; "Absolute Directives" → "Directives"; "dumb
    projections" → "projections."
- [ ] **🔴 BLOCKING — LGTM REQUIRED (David said: "Test me"):**
  - [ ] `STREAM_PROTOCOL.md` — first review pass done 21:30; **rewrite ordered:**
    doc must be *tentative, hedged, not authoritative* — "all open for
    discussion." David's notes to fold in:
    - §2 Transport was **overly specific** — no `server.ts` (might change), no
      "Gemini" hardwired ("Nah, to whatever" — Gemini is AIStudio heritage;
      likely keeps it *plus* wants generic routing → **OpenRouter**, likes those
      models).
    - Format must allow **approximate real-time extraction** of partial input;
      his idea: HTML-style parsing is good at broken/in-flight inputs.
    - Tag stripping: agreed (present clean text); inspiration OK from agentic
      UIs — **translate tags into on-screen indicators** (steps, "where it's
      working") without having agentic architecture.
    - Dual parsing: **never decided.** His tentative guess: not redundancy —
      same source, different ends: **UI = partial rendering (frontend), backend
      = full parse/decode → create objects/store.** "Just a guess - no idea."
    - Rewrite → then he LGTM's. He went off to read MOBILE_UX_SPEC meanwhile.
  - [x] `STREAM_PROTOCOL.md` — **LGTM APPROVED by David 2026-10-17 21:49**
  ("Looks good. Approved.") — covers the tentative rewrite.
- **Mirror principle LGTM'd** (David, 22:24: "Now you understood it!!! Yes,
  the mirror principle is it… all you said, LGTM"). Ordered: improve spec with
  the follow-up insight, then he reads the final version.
- **Modes — final understanding (his correction/expansion of my "sugar"
  guess):** focus modes are **presets for what compacts and what doesn't — a
  sort of autopilot for compaction, an auto-compaction rule/config.** Exactly
  what that is: *"not clear yet but you got the gist."* It's **one simple
  setting controlling at what resolution each chapter and each artifact enters
  the single compiled payload** — then manual adjustment / overrides on top
  ("or overrides, no idea"). **Must be experimented with: "we never saw
  anything similar in any app so can't tell what would work best."**
- [x] `MOBILE_UX_SPEC.md` — **✅ LGTM APPROVED (r4), file CLOSED** by David
  2026-10-17 22:25: "LGTM, we can close this file now."
  - Both blocking docs (`STREAM_PROTOCOL.md`, `MOBILE_UX_SPEC.md`) now approved.
  - Remaining softer item: quiet LGTM sweep of the other six rewritten docs
    (00/01/02/03/compiler/system-arch) — ask when natural, no ceremony.
  - **8.1 bottom sheet:** "No. I don't. End of the topic." → modal stays;
    sheets banished from spec.
  - **8.2 boundaries:** my scroll-vs-compaction framing was **wrong** — scrolling
    the chapter list is natural; *compacted* means showing the summary instead.
    Drag UI **confirmed nonexistent**; some "split at point X"-ish control(s)
    may exist but "It works? I don't think so." Feature is **very complicated —
    needs its own full topic/file. KISS design proposed:** only 3 ops, mostly
    over last 1–2 chapters, via a dropdown-activated *mode* that changes the UI:
    (1) move seam one turn up / one turn down — 2 buttons, repeatable, seam
    between last 2 chapters; (2) split last chapter in 2; (3) merge last 2.
    "Doesn't need to feel fast or natural."
  - **8.3 modes/HUD:** **modes don't work at all — "empty husk shell," entire
    feature was AI-vibecoded "from vibes, from poorly understood stuff… not
    sure if even it makes sense at all."** Toggle usually resurrected in the
    top bar (banned); belongs in sidebar if anywhere. My assumption the project
    resembles his intent → wrong; "very at despair with mr AI Studio."
    **The REAL HUD ask (tremendous simplification):** the chat UI must be
    **~1:1 with what the tool sends the LLM — same order, same contents.**
    Compacted thing → shown summarized to user too. Show tokens per chapter,
    where the expensive part is; let user control ordering/detail/injection —
    those control features = low priority he knows are features. **Core ask:
    "show me what the LLM will see."** Orb-tap → small popup with interesting
    stats = "nice and I would use it." Mode-switch questions: unanswerable —
    "we're thinking on different things… we need to keep discussing this."
  - **8.4 sidebar:** top-left hamburger = **decided, insisted, fought for.**
    Thumb-reach = good observation, **pinpoint for later.** Space analysis:
    top-left floats w/ text below ≈ zero lost space; bottom-left needs sticky
    bar = 20px unacceptable; beside composer fits that screen only (graph
    screen unclear). Needs discussion. **Overlay on phone, push on desktop
    (screen-width based); alternative: overlay + pin icon → pinned = push.**
    - Called out invented-sounding items: bottom sheet / drawers / drag handle
      — "sounds made up, do you understand what you are speaking about?"
      Research confirmed: `ArtifactSheet.tsx` doesn't exist (plan-speak;
      reality = `ArtifactDetailModal.tsx`); no drawers (Sidebar uses inline
      accordions); drag-handle UI unverified (segmentation *domain* exists).
      **Lesson: verify against code before spec'ing UI; plan ≠ shipped.**
    - §5 context controls were "sparse ideas without connections, cool factor
      without anything" — if sparse, **sell as sparse**, format honestly.
    - Overall: lacks flow/narrative, dry/stuttering — **rant a notch more**
      (not a lot). Garbled question ("voice-search-free…") got "What?" —
      hamburger is a button, ask clear questions.
    - **Answers received:** chapter cards = manual compact control;
      notifications = not needed (capture flow shouldn't pull user back);
      min phone = **350×700px**.
    - He went off to read STREAM_PROTOCOL rewrite meanwhile.
  - Must get explicit LGTM on each. Do not accept a vague yes.
- [ ] **Self-correction:** I claimed "zero docs mention mobile" — **wrong.**
      Mobile-first appears in `00` §5.1, `01` req #7–8, `SYSTEM_ARCHITECTURE`
      §3. What's actually missing is the *capture flow* (dump → close phone →
      reply-later), email-grade latency, mobile-first-over-desktop priority.
- [x] **Edge vocab — David's answer 21:07:** "probably both are wrong" — the doc
      likely has one fewer telephone-game pass. Doesn't recall `contradicts`.
      What he *does* recall wanting: **generic nodes and edges, where the edge
      could be any relationship type.** → rewrite as generic edge model with
      extensible type; known kinds (parent_of, relates_to, refines, born_from)
      are a starting set, not a closed enum.

- [ ] **Design-docs cleanup rewrite** — motivation-first, corrected pillar
      hierarchy (user-controlled context; reject agentic; universal artifact as
      reversible simplification), metaphor demoted to one labeled analogy,
      internals as current implementation choices. Likely start with
      `00_core_philosophy_soul.md` and `01_requirements_and_meta.md`.
      - Update §3 of requirements with David's real motivation (mobile capture,
        collector/auto-organizer/forest-view, expensive-agentic problem,
        time economics).
      - **Not green-lit yet** — confirm with David before starting.

## Doc/code inconsistencies

- [x] ~~Docs reference non-existent files: `STREAM_PROTOCOL.md`,
      `MOBILE_UX_SPEC.md`~~ — **both now written and LGTM'd** (2026-10-17).
      References in `SYSTEM_ARCHITECTURE.md` still say "draft, pending LGTM" —
      stale header notes, flip to approved when doing the six-doc sweep.
- [x] ~~`04-presentation/telemetry/` is empty~~ — **stale after pull:** now has
      `EdgeHeatStrip.tsx`, `SaturationOrb.tsx`, `ambientTelemetry.ts`. Spec and
      code roughly aligned again.
- [ ] `package.json` still named `"react-example"` (AI Studio scaffold leftover).
- [ ] No README — design-docs serve that role for now.

## David's six answers (2026-10-17 21:07) — rewrite is GO

1. **Metaphor → option (a):** one clearly-labeled section at the END of the
   philosophy doc — explanatory, never structural.
2. **Edges → generic:** both doc vocabularies probably wrong; he wanted generic
   nodes/edges, edge type open/any relationship.
3. **Rewrite spine → YES:** user-controls-context #1; reject-agentic #2 (one
   turn, specific tools, no rip); universal artifact = current simplification;
   internals = current choices; motivation opens requirements from `motivation.md`.
4. **`STREAM_PROTOCOL.md` + `MOBILE_UX_SPEC.md` → WRITE BOTH.** David's words:
   *"make sure I give you the LGTM for them. Ensure I review them. Test me."*
   → **BLOCKING: do not mark done until David has read both and said LGTM.
   Actively push him to review — "test me" = don't let it slide.**
5. **`03` voice:** command only when 100% clear; hedge otherwise.
6. **Filename:** keep `00_core_philosophy_soul.md` — dramatic names survive AI
   agents better ("Everything is Overview and they reshape it to what they want").

## Genuine open design questions (from `01_requirements_and_meta.md` §5)

- [ ] Graph edge authoring. *(partial gut answer from David: hybrid —
      hand-authored + inferred; mechanism still undefined)*
- [ ] Out-of-frame cutoff rule.
- [ ] Chapter-close grace period.
- [ ] Export/portability story.

## Resolved 2026-10-17 evening (answers in motivation.md → "RESOLVED")

- [x] Mode 2 ownership → deterministic vector-DB pull, user knobs (enable/disable,
       amount). LLM can't touch settings; may emit recognized request format,
       user accepts / auto-accept with undo. Spirit-level; details TBD.
- [x] Auto-organizator → plan → user agrees → LLM executes → rollback or
       roll-forward. Not full-auto. Current workflow is painfully manual
       (LLM classifications → manual bucketing → folders/YAML/tags by hand).
- [x] Mobile story → **mobile-first single webapp**; desktop emptiness acceptable.
       Top bars/sticky headers repeatedly re-added by AI Studio = banned.
- [x] Graph edges → hybrid (hand-authored + inferred).
- [x] Cost argument → money **and** time economics; cheap models slow/flaky;
       agentic = "sitting an entire day doing nothing," chat = doesn't matter.

## New open questions after David's answers

- [ ] Multi-chat/multi-thread per project — **desired but low priority**;
      currently single chat per project, and "one chat works way too well"
      (continuity). Nice-to-have for organization + possible cheap/slow-model
      benefits. (My "pipeline parallelism" reading was romanticizing — struck.)
- [ ] **Free-model routing** (OpenRouter free tier, always some available,
      rotate): smart routing + auto-retry → could approach zero cost. Slow = OK,
      "more like Email." Explore later.
- [ ] **Email integration** — parked deliberately: "shortcut/revolution or huge
      waste of thinking time, no idea." Do not deepen until David reopens it.
- [ ] Relationship of the three modes to the existing multi-resolution tiers
      (T0–T3) and graph-distance compiler — do they map, or are they separate
      ideas? (Still my open question — David hasn't weighed in.)
- [ ] LLM data-request format: "specific format the app would recognize" +
      auto-accept-with-undo — how does this coexist with "one turn does
      everything"? My current guess: the request rides in the same single shot —
      but that's my guess, needs David's confirmation. (Note: pillar itself may
      flex later — "we'll see if we need to push this definition later.")
- [ ] **Mobile UX spec** needs to actually exist (docs reference the missing
      `MOBILE_UX_SPEC.md`; now we know mobile-first is a top requirement).