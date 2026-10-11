### 1. What kind of tool is this?
It is a **Cognitive Workbench with Variable-Resolution Context Management** (or an **Optical Ideation Engine**).

* It is **not** a traditional chat assistant (which treats history as a dumb linear log).
* It is **not** a standard PKM/wiki like Obsidian or Notion (which requires manual filing and lacks conversational co-creation).
* It is **not** an IDE or an agentic terminal like Antigravity/Devin (which focus on tool loops and autonomous code generation).
* It is an **interactive ideation and design environment** where conversation acts as the furnace, living artifacts act as the output, and an "optical" context compiler continuously shapes what the AI can see at varying degrees of abstraction (sharp vs. blurred).

---

### 2. For who is this tool?
* **Deep Systems Thinkers & Complex Project Designers:** People who design massive, multi-dimensional systems (game designers, software architects, worldbuilders, product strategists, researchers) whose projects are both *deep* (hundreds of technical details) and *wide* (dozens of interconnected conceptual branches).
* **High-Volume Conversational Thinkers:** People who use LLMs not to get quick answers, but as a sparring partner over conversations that routinely scale into the hundreds of thousands or millions of tokens.
* **Mobile-First Ideators:** People who do their best high-level steering, conceptual brainstorming, and reading on their phone while away from their desk, but need desktop-grade rigor.

---

### 3. What problems does it solve? Why does it exist?

#### Problem 1: "Context Blindness" (The Depth-vs-Breadth Trap)
* *The Failure:* In long chat sessions, the moment you deep-dive into the minutiae of one feature (50 turns of detail), the LLM gets stuck in the weeds. When you ask for new high-level ideas, it hallucinates or loops tightly around the last thing you discussed because the context is flooded with high-frequency noise.
* *The Solution:* **Myopia Mode and Depth of Field.** You can intentionally blur or hide the weeds, forcing the model back to the conceptual canopy to think wide again.

#### Problem 2: The Linear Chat Graveyard
* *The Failure:* Brilliant ideas, architectural decisions, and trade-off debates get buried in the middle of a 1,000-turn chat log. Manual copy-pasting into docs breaks the flow and loses the context of *why* the decision was made.
* *The Solution:* **Unified Artifacts with Provenance.** Everything of value crystallizes into living, revision-controlled artifacts. Every artifact retains an audit link back to the exact discussion chapter that birthed it.

#### Problem 3: The Expense and Chaos of Agent Swarms
* *The Failure:* Industrial agent environments (like Antigravity) are powerful, but their tool-calling loops and background swarms burn exorbitant tokens and API credits for personal ideation, while introducing high latency and unpredictability.
* *The Solution:* **Single-Turn Structured Protocol (1 Enter = 1 API Call).** The conversation model handles chat, artifact generation, and structural signaling simultaneously in one clean stream.

#### Problem 4: The Static Taxonomy Trap
* *The Failure:* Trying to force a complex, evolving project into rigid folders or 20 coarse taxonomy buckets fails immediately because early-stage ideas cross boundaries and defy neat categorization.
* *The Solution:* **Organic Associative Graph.** Ideas sit in a fluid network connected by topological relationships, where proximity dictates context inclusion rather than rigid folder paths.

---

### 4. What are the core requirements?

#### Architectural & Cost Requirements
1. **Strict 1-Turn API Discipline:** One user input must result in exactly one LLM API roundtrip. No hidden multi-step agent loops.
2. **Deterministic Context Compiler:** An engine that reads the knowledge graph, calculates topological distance from the focal point, and compiles the prompt payload with appropriate resolution tiers (Title $\rightarrow$ Abstract $\rightarrow$ Summary $\rightarrow$ Verbatim).
3. **Multi-Model / Multi-Tier Support:** Fast preset switching (e.g., Gemini Flash for quick ideation, Gemini Pro for deep architectural synthesis).

#### Data Model Requirements
4. **Universal Artifact Schema:** Every chapter and document must support multi-resolution metadata (YAML frontmatter containing Tier 0 label, Tier 1 abstract, Tier 2 summary) and a body (Tier 3 verbatim).
5. **Revision Control:** Artifacts must track revisions across time, with the UI defaulting to the latest version while keeping historical versions intact.
6. **Provenance Tracking:** Document artifacts must store references to the conversation chapters and turn ranges that generated or updated them.

#### UX & Interaction Requirements
7. **Mobile-First Responsive Layout:** Full, friction-free usability on mobile screens (using slide-out drawers, bottom sheets, and minimal clutter) that expands smoothly into a multi-pane workspace on desktop.
8. **Context HUD (Aperture Meter):** A transparent, glanceable interface showing the user exactly what the LLM currently sees (what is sharp, what is blurred, and total token footprint).
9. **Tactile Chapter Splitting:** 
   * LLM emits inline markers to declare topic shifts.
   * User can slide the split line up/down between turns.
   * User can undo/remerge splits with confirmation.
   * Side-channel / isolated prompt channel to recalibrate a chapter's summary without polluting main context.
10. **Manual Optical Controls:** 1-click toggles for "Autofocus" (follow active thread), "Manual Focus" (pin specific nodes as sharp), and "Macro/Myopia" (blur everything to force forest-level thinking).

---

### 5. Meta-Questions to Address

Here are four questions that define how this system behaves when it hits edge cases:

1. **The Graph Authoring Burden:**
   * Who draws the links? If you have 100 artifacts, does the system ask the LLM during single-turn output to emit link tags (e.g., `relates_to: [id]`), do links form automatically from the active context, or do you want to manually wire them on a visual canvas?
2. **The "Out-of-Frame" Boundary:**
   * When the knowledge graph grows to 500+ artifacts, even sending Tier 0 (titles only) for everything will bloat the context window. What is the rule for cutting an artifact out of the prompt entirely? (e.g., max graph distance of $N$ hops, or an explicit active/inactive toggle)?
3. **Chapter Lifecycle – When does a Chapter close?**
   * If a chapter auto-splits, does the previous chapter automatically collapse into Tier 2 (Summary) in the prompt on the very next turn, or does it stay sharp for a grace period of 2–3 turns while the transition settles?
4. **Export & Portability:**
   * This is your thinking workbench, but where does the final output go? Do you need a 1-click "Compile Project Spec" that flattens selected Tier 3 artifacts into a clean Markdown/PDF export, or does the data live permanently inside this tool?