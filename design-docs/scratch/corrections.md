# Corrections & Pillars — what's actually true (David's authority)

## The actual pillars (David's words, essentially)

1. **Context control belongs to the user.** The whole design is about giving the
   user easy control over what the LLM sees — tools and information to decide
   what to pull into context, but **the user is in control**. This is the real
   pillar. The design language is **context control and context manipulation**.

2. **Reject agentic platforms.** Hard rejection. Sharpened by David (2026-10-17):
   - Agentic **tries to be everything**: gives the agent multiple turns until *it*
     decides to delegate back to the user, and gives tools to the agent.
   - MarkBrain: **no tools per se, no agentic mode, no multi-turn.** The
     architecture should fit into **one turn does everything the LLM needs** —
     no back and forth. (At least in spirit — "we'll see if we need to push this
     definition later.")
   - It's also about **the tools**: **more specificity, less generality.**
     Agentic tools = "give it bash/shell access and let it rip whatever it
     wants. Cool but no."
   - If we ever revisit, it must be to do it **cheaply and fast** — not to
     become an agentic platform.
   - **My overreach, corrected:** I framed this as "no *autonomous* agents, with
     David as the only allowed loop" (plan→execute→rollback as human-gated
     agenting). Wrong — the rejection is stricter than that. One turn, no tool
     rip, no agent loop at all. The human-gated-step framing was *my* softening;
     David: "I think you're not understanding where am I trying to go."

3. **Universal Artifact (chat + docs share one schema)** — NOT a pillar. It's a
   simplification we arrived at. Might be right, might be wrong. Open to revision.

## Explicit corrections (my earlier AI-amplified readings, corrected by David)

- ❌ **"The optical metaphor is the whole design language"** — Incorrect. The
  photography/depth-of-field metaphor is *David's own analogy*, used to illustrate
  the design — but it has been overblown by AI conversations. It illustrates the
  design; it is **not** the architecture. Never mistake it for doctrine again.

- ❌ **"The Compiler is deterministic and client-side" as a *pillar*** — "This is
  BS and I don't even know what it means." Internals dressed as doctrine.
  Same category: telemetry, XML payload formats, provenance records, chapter
  segmentation — **implementation choices, not pillars.**

- ⚠️ **Diagnosis of the docs:** David was "vibecoding it in AI Studio, not having
  much success." AI assistants latch onto his cool throwaway lines "like an
  obsession" and amplify cool-factor until it's "pointless and disconnected."
  The docs contain truth, but **importance has been misassigned.**

## Motivation audit of existing docs (asked: do they explain motivation?)

- `01_requirements_and_meta.md` §3 — **yes**, the real motivation section in the
  docs (4 problems: context blindness, linear chat graveyard, agent-swarm expense,
  static taxonomy trap). Most honest doc of the set.
  - **BUT:** it does *not* contain David's actual top-two reasons from
    motivation.md (expensive agentic overkill — partially covered; **mobile
    capture — missing entirely**; "collector for my overflowing brain" — missing).
- `00_core_philosophy_soul.md` — partially; motivates by contrast but dissolves
  into metaphor.
- `SYSTEM_ARCHITECTURE.md` / `CONTEXT_COMPILER.md` — **weakly**; describe
  mechanics as if they were reasons. This is where the AI-amplified cool factor
  lives.

## Doc-writing rules (anti-slop)

- Motivation first, mechanics second.
- Metaphor: at most **one clearly-labeled analogy**, demoted, never architecture.
- Internals = "current implementation choices," phrased as such, revisable.
- Honest about what's undecided — the tool itself is exploratory ("I don't know
  what I want; I know I need it").
- No pillars invented that David didn't state. If in doubt: ask, don't guess.
- **Verify against code before spec'ing UI.** A refactor *plan* is not a
  shipped feature — don't cite proposed components as existing ones
  (David: "sounds made up, do you understand what you are speaking about?" —
  he was right: bottom sheet/drawers/drag handle weren't in the code).
- **Sell sparse ideas as sparse ideas.** Don't format scattered intuitions as
  a coherent buildable feature set. Honest labeling > false coherence.
- **Narrative over inventory.** Docs should flow and carry a notch more voice;
  dry feature-list prose gets called out as AI slop too.
- **Ask clear questions.** Garbled shorthand ("voice-search-free one-handed
  reach") wastes his time. Hamburger is a button; say so.
- **Don't assume the code works or matches intent.** Vibecoded features may be
  "empty husk shells" (compiler focus modes: "WAIT IT IS SUPPOSED TO WORK?
  LOL"). Feature entirely AI-generated "from poorly understood stuff… not sure
  if it even makes sense." Verify *behavior*, not just file existence.
- **Scroll ≠ compaction.** Scrolling the chapter list is natural navigation;
  *compacted* = a chapter displaying its summary instead of turns. Don't blur
  these — David corrected it explicitly.
- **Don't assume the current project resembles what David wants.** He's "at
  despair with mr AI Studio"; the codebase is evidence of attempts, not of
  settled intent.

## Instrumentation law (David, 2026-10-18)

- **1 event per human action = guideline** (aspirational target).
- **MAX 16 events per human action = hard rule.** No exceptions, no excuses.
- **If honoring it is hard → don't add the logging.** Silence beats flood.
- **Never log hot loops** — per-chunk / per-iteration / per-tick paths.
  (The per-chunk `logger.action` in `Timeline.updateTurn` violates this today.)
- Every silent fallback ≥ WARN; user-visible failure = ERROR through `logger`.
- `action` level is for human gestures only — domain internals are not "user
  actions" no matter what the prefix says.

## Product identity (David, 2026-10-18 — settled)

- It's a **brain collector**. *"What else is there??"* — no option B. The
  architect/design-system persona in code and fixtures is fake-soul and dies.
- Daily driver (once it works): **chat + chapters**. He's never used it as-is.
- TTS: keep, low priority. Drive import: wanted, broken (artifacts are raw
  Google Docs, not YAML). SpatialGraph: unrequested-but-liked, keep, no
  investment. Full triage in `design-docs/05_CLEANSE_DECISIONS.md`.