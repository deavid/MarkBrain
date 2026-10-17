# REQUIREMENTS & META (`01_requirements_and_meta.md`)

> Rewritten 2026-10-17. §3 now leads with the actual motivation (from David,
> verbatim-checked against `scratch/motivation.md`); problems describe the
> failure *before* naming any solution; solutions are labeled as current
> thinking, not destiny.

---

### 1. What kind of tool is this?

A **cognitive workbench for collecting, organizing, and exploring your own
thinking** with an LLM — with the user firmly in control of what the LLM sees.

* It is **not** a traditional chat assistant (which treats history as a dumb
  linear log).
* It is **not** a standard PKM/wiki like Obsidian or Notion (which requires
  manual filing and lacks conversational co-creation).
* It is **not** an IDE or agentic terminal like Antigravity/Devin (which focus
  on tool loops and autonomous execution).

Conversation is the furnace; artifacts are the output; a compiler shapes what
the AI can see at each level of detail. (Principles in
`00_core_philosophy_soul.md`.)

---

### 2. For who is this tool?

Honest answer first: **it's for David.** A personal tool built because he
needed it. If it turns out others think like this, bonus.

The general shape of that person:

* **High-volume conversational thinkers** — people who use LLMs as a sparring
  partner over conversations that scale into hundreds of thousands of tokens,
  who write many thoughts per message.
* **Deep systems thinkers** — projects that are *deep* (hundreds of technical
  details) and *wide* (dozens of interconnected branches): software
  architects, worldbuilders, researchers, designers.
* **Mobile-first ideators** — people who do their high-level steering and
  capture on their phone while away from the desk.

---

### 3. What problems does it solve? Why does it exist?

#### The root need: an overflowing brain

David talks a lot; his brain overflows with ideas and concepts and he needs to
pour them somewhere before they evaporate. MarkBrain is meant to be:

1. **The collector** of those ideas.
2. **The auto-organizer** (mechanism currently undefined — see open questions).
3. **The forest-viewer** — helping visualize the whole, so you can go abstract
   or drill into depth *without losing the high-level picture.*

Existing tools technically do pieces of this (Antigravity's artifacts/memories;
a plain markdown repo managed from an agentic chat). Two problems make that
approach unsatisfying — which seed the problems below.

#### Problem 1: Capture dies on the way (mobile)

*The Failure:* You're on the go, an idea hits, and you need to open something,
dump the thought *now*, and close the phone — maybe send it to chat and check
the reply 10 minutes later while still walking. Desktop-first agent platforms
are windows into a computer; running them from a phone doesn't work, and
bridging through external chat (tried at work — sidecar to Matrix/Google Chat)
works but costs ~3 calls per message.

*Current thinking:* one mobile-first webapp (usable on desktop too, even if it
looks sparse there), tolerant of email-grade latency — send, leave, come back.

#### Problem 2: Context blindness (the depth-vs-breadth trap)

*The Failure:* After 50 turns in the weeds of one feature, the LLM gets stuck
down there. Ask for high-level ideas and it hallucinates or loops around the
last thing discussed, because the context is flooded with low-level noise.

*Current thinking:* let the user blur or hide the weeds deliberately (forest
view), and assemble context by graph distance — near = detailed, far = labels
only. Details in `CONTEXT_COMPILER.md`.

#### Problem 3: The linear chat graveyard

*The Failure:* Good ideas, decisions, and trade-off debates get buried mid-log
in a 1,000-turn chat. Copy-pasting into docs breaks flow and loses the *why*
(decisions detach from the discussion that produced them).

*Current thinking:* everything of value crystallizes into revision-controlled
artifacts, each keeping provenance back to the chapter and turns that birthed
it.

#### Problem 4: Agent swarms are expensive — money *and* time

*The Failure:* Agentic platforms run many calls per action: context fills with
crap, costs balloon, and latency compounds — cheap models are slow or flaky,
and in an agentic loop "you could be sitting an entire day and doing nothing."
Personal ideation doesn't need a swarm.

*Current thinking:* strict one-turn discipline (1 Enter = 1 API call) — see
Principle 2 in `00_core_philosophy_soul.md`. Secondary ideas, not yet
committed: routing to free/cheap models (OpenRouter has free tiers that rotate)
with smart retry, so the tool could run at near-zero cost; multi-chat per
project as a *low-priority* nice-to-have (continuity of a single chat matters
more, but parallel threads could help absorb slow models).

#### Problem 5: The static taxonomy trap

*The Failure:* Early-stage ideas cross boundaries and defy folders or 20 coarse
buckets. Forced categorization fails immediately.

*Current thinking:* a fluid graph of nodes and generic edges, where proximity
(not folder path) drives what enters context. Who draws the edges: probably
hybrid (inferred + hand-authored) — see §5.

---

### 4. What are the core requirements?

#### Architectural & Cost Requirements

1. **Strict 1-Turn API Discipline:** One user input results in exactly one LLM
   API roundtrip. No hidden multi-step agent loops. *(Principle-level — see §2
   of the philosophy doc; definition may be refined deliberately, never
   drifted.)*
2. **Deterministic Context Compiler:** Reads the knowledge graph, calculates
   distance from the focal point, compiles the payload with resolution tiers
   (Label → Abstract → Summary → Verbatim). *Current implementation choice.*
3. **Multi-Model / Multi-Tier Support:** Fast preset switching (e.g., Gemini
   Flash for quick turns, Pro for deep synthesis).
4. **Cost target: as close to zero as practical.** Prefer cheap/free models
   where quality allows; smart routing and auto-retry are in scope to explore.
   Email-grade latency is acceptable — this is thinking work, not transactional.

#### Data Model Requirements

5. **Universal Artifact Schema (current decision, reversible):** chapters and
   documents share one schema with multi-resolution tiers (T0 label, T1
   abstract, T2 summary, T3 body).
6. **Revision Control:** artifacts track revisions; UI defaults to latest,
   history intact.
7. **Provenance Tracking:** artifacts store references to the chapters/turn
   ranges that generated or updated them.
8. **Generic graph edges:** nodes and edges where the edge type is open — any
   relationship — with the currently-known kinds as a starting set only.

#### UX & Interaction Requirements

9. **Mobile-First, period:** full friction-free usability on phone screens
   (drawers, minimal clutter — note: bottom sheets **rejected** 2026-10-17;
   artifact view stays the existing modal). Desktop may look sparse; that's
   accepted. **No top bars, no sticky headers** unless explicitly approved —
   they waste vertical space and keep getting re-added by tools that "know
   better." Spec: `MOBILE_UX_SPEC.md` *(LGTM'd 2026-10-17)*.
10. **Capture flow:** open → dump thought → send → close phone → reply waits
    for you. Works even if the model hasn't answered before you leave.
11. **The mirror (approved 2026-10-17 — the big one):** the chat interface must
    be almost **1:1 with what the tool sends the LLM** — same order, same
    contents. Compacted material is shown summarized *to the user too*; tokens
    visible per chapter; where the expensive part is, visible. Fine-tuning
    (ordering, detail level, injection) = wanted, low priority. Without the
    mirror, Principle 1 has no observable. See `MOBILE_UX_SPEC.md` §5.
12. **Context visibility seed:** tap the orb → popup with useful stats (cheap,
    explicitly wanted). The old "aperture-meter HUD" is AI-vibed — not a
    commitment.
13. **Chapter boundaries — KISS toolkit:** three operations over the last 1–2
    chapters — move seam one turn up/down, split last chapter in two, merge
    last two — behind a dropdown mode; plus recalibrate a chapter's summary
    via an isolated side-channel call that doesn't pollute the main timeline.
    The drag-handle design was rejected. See `MOBILE_UX_SPEC.md` §6.
14. **Manual context controls:** pin/mute, and compaction **presets over the
    mirror** (autofocus/forest-style — shape TBD, experiment after the mirror
    exists; the current implementation is a nonworking husk). Because the user
    is in control (Principle 1).

---

### 5. Meta-Questions (genuinely open)

These are real, not decorative. Answered so far only with gut feelings:

1. **The Graph Authoring Burden:** Who draws the links? LLM-emitted link tags
   during its single shot, automatic formation from active context, manual
   wiring on a canvas, or (gut answer) **hybrid**? Mechanism undefined.
2. **The "Out-of-Frame" Boundary:** At 500+ artifacts, even labels-only bloats
   the window. What's the culling rule — max hops, explicit active/inactive,
   something else? (Compiler currently specifies a 3-hop radius, but that's a
   number we chose, not a law of nature.)
3. **Chapter Lifecycle — when does a chapter close?** On auto-split, does the
   previous chapter collapse to summary next turn, or stay sharp for a 2–3 turn
   grace period?
4. **Export & Portability:** does thinking stay in the tool, or is there a
   1-click "compile project spec" flattening selected artifacts to
   Markdown/PDF?
5. **LLM data-requests:** if the model may emit a recognized "please pull X"
   format that the user accepts (or auto-accepts with undo) — how does that
   coexist with 1-turn discipline? Mechanism and default TBD.
6. **Auto-organization:** currently a manual loop (LLM classifies → human
   approves → human files). Plan→agree→execute→rollback is the spirit. Full
   auto is *not* the goal; the mechanism is undefined.
7. **Compaction preset shape:** what exactly the auto-compaction setting is —
   granularity, defaults, overrides — unspecified *by design*; experiment after
   the mirror exists. Tracked in `MOBILE_UX_SPEC.md` §9.