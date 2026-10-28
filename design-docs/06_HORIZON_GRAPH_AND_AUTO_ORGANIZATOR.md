# Design Document: Horizon Graph and Auto-Organizator

**Status:** Open Horizon / High Uncertainty (Unbuilt)
**Target:** MarkBrain Core Components
**Date:** 2026-10-28

This is an OPEN HORIZON document. It is honest about its unbuilt status and current uncertainties. It proposes moving from an unstructured graph toward a semantically grounded, coordinate-based organization system — a direction, not a build plan.

## §1. Why the Current Graph Is an Unused Toy

Frankly, the current graph implementation functions as a throwaway toy. This needs to change for the architecture to be viable.

- **`isHighConcept`**: This flag is currently a decorative metadata label, providing no functional benefit to the system.
- **Edges**: The existing edges (`relates_to`, `parent_of`, `refines`, `born_from`, `child_of`) have virtually no consumers. The current codebase shows they are only used to draw grey lines on `SpatialGraph.tsx`; no logic in the application *consumes* these relationships for navigation or automated organization.
- **Proximity Engine Flaw**: The proximity engine only suggests adding *unattached* notes. It fails to propose expansion or compaction for notes already in the artifact, creating a structural maintenance vacuum as conversations evolve.

## §2. The Two-Axis Semantic Coordinate System (Replacing `isHighConcept`)

To give our artifacts genuine semantic grounding, we need to replace the binary `isHighConcept` flag with a defined, navigable coordinate system. I consider this a **DECIDED DIRECTION (27, 2026-10-27)**, but the exact XML/UI affordances are still highly **OPEN**.

We propose two axes applied to every artifact in the `<knowledge_substrate>`:

### Axis 1: Scope / Altitude (Broad ↔ Specific)
This defines *what* the note is about conceptually.
*   **`canopy`**: Vision, high-level Pillar, or core concept.
*   **`system`**: A major subsystem or topic within the project.
*   **`leaf`**: A specific mechanic, detail, calculation, or piece of evidence.
*   **`evidence`**: Empirical data, playtest learning, or specific log snippets.

### Axis 2: Epistemic Time-State (Reality ↔ Wish ↔ Past)
This defines the note's status in the project's development.
*   **`current`**: This is the truth; it is built and correct in the project right now.
*   **`wish`**: Tentative design, exploration, or a proposal we haven't settled on yet.
*   **`superseded`**: Historical context. This is critical—it allows us to see why we moved away from an idea, but it **MUST NEVER** be interpreted by the LLM as the current specification.

**Implementation Payoff**: Both axes would ride as attributes on `<artifact file="slug.md" altitude="..." state="...">`, giving the LLM instant, unambiguous epistemic context.

## §3. Open Edges & Their Two Real Consumers

We need flexible relationships that actually *do* something. We should allow open/custom relationship kinds, alongside a core set (e.g. `parent_of`, `supersedes`, `depends_on`, `relates_to`).

### Consumer 1: Hierarchical Forest Map
The primary graph view should be reorganized based on **Altitude** (`canopy` → `system` → `leaf`) and visually filtered/tinted by **Time-State** (`current` vs. `wish` vs. `superseded`). This moves us away from an unstructured "physics hairball" visualization.

### Consumer 2: 1-Tap Neighborhood Staging
In the `ArtifactDetailModal` or library rows, we must surface a note's connected neighborhood (parent/children/related notes) in one tap. This pulls context into the `Summary` or `Description` field without requiring the user to navigate away or lose their place, maintaining 100% manual user control.

## §4. Bidirectional Context Suggestions (Attach + Expand + Compact)

Suggestions must be user-tapped, *never* silent auto-mutations (Pillar 1). These suggestions would be driven by local proximity (future WASM embeddings + BM25 lexical matching) and graph distance against the current chat draft/recent turns.

1.  **Unattached Notes**: If a note is lexically/graphically close to the topic → Suggest **`+ Attach`** (Pull in neighborhood).
2.  **Central Attached Notes**: If a note is in `Title/Description` but is now central to the draft → Suggest **`Push IN`** (Expand into Summary/Full body).
3.  **Drifting Attached Notes**: If a note is in the full body but is drifting and eating token budget → Suggest **`Push OUT`** (Compact back to Title/Description).

*Open Question: Where do these suggestion 'pills' live on a 350px screen without visual clutter? (Needs David's input).*

## §5. Chat-Driven Auto-Organizator (plan → agree → execute → rollback)

The LLM should evolve from a form-filler to a workflow partner.

1.  **The Flow**: The user discusses the corpus in chat, attaching notes loosely. The LLM emits a **Batch Organization Plan**.
2.  **The Output**: This plan would set the altitude, state, category/folder, tags, and edges across multiple artifacts simultaneously.
3.  **The Interface**: The user reviews this plan as an interactive 'diff' card. They can uncheck items they don't like and then apply the plan in one atomic click.
4.  **Safety**: The entire batch action is recorded as one rollback-able step. It is grounded in the existing manual workflow (dump → classify → bucket → refile), replacing the manual refiling step, not the human judgment.

## §6. Peer Collaborator vs Task-Monkey Persona Tuning

Once capability toggles strip the XML tool schemas out of "pure-thinking" turns, the base system prompt can be re-tuned. We want the base system to read and write like a sharp, opinionated peer, not a robotic form-filler. This is iterative prompt tuning, and David is co-writing this prompt work.

## §7. Open Design Questions to Settle with David Before Building

Before moving to implementation, we need settled answers on:
1.  Suggestion-pill placement on a phone screen (§4).
2.  The exact sentinel/XML syntax for the Batch Plan (§5).
3.  Whether Altitude/State get their own dedicated metadata tab UI or if they ride the existing rows.
4.  How superseded notes visually dim in the library or only differ in payload.
