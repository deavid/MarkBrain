# 1. The Core Philosophy (The Soul)

### 1.1 The Photographic Context Model (Cognitive Optics)
Traditional LLM interfaces treat conversation memory as an append-only paper scroll: either something is in the context window (100% sharp) or it is truncated/forgotten (0% sharp). RAG systems attempt to fix this with keyword/vector chunking, but they pull out disjointed snippets without narrative context.

This system treats LLM working memory as an **optical field with adjustable depth of field**:
* **The Focal Plane:** The exact idea, artifact, or discussion thread you are actively working on. It is rendered at 100% optical clarity (verbatim text, full detail).
* **Progressive Blur (Depth of Field):** Concepts topographically adjacent to the focus remain visible, but progressively lose detail the further away they sit. Instead of falling out of memory completely, they soften into rich summaries, then one-liners, then semantic labels/titles, then disappear beyond the horizon.
* **Myopia Mode (Forced Defocus / Forest View):** The deliberate, global suppression of all high-frequency detail. By pulling the focus entirely out of the weeds, the model is barred from looking at implementation minutiae. This forces the LLM to think purely in architectural patterns, conceptual gaps, and strategic breath.

### 1.2 The Unified Artifact Paradigm ("Everything is an Artifact")
There is no hard boundary between "chat history" and "produced documents." Both are artifacts:
* A working deliverable (spec, design doc, architecture draft) is an artifact.
* A historical burst of conversation around a specific topic is also an artifact (a **Chapter**).
* Because both share the same universal structure, both participate equally in the graph, both have revisions, and both can be compressed or expanded along the optical spectrum.

---

# 2. Structural & Data Architecture

```
                          [ WORKSPACE / PROJECT ]
                                     |
               +---------------------+---------------------+
               |                                           |
       [ KNOWLEDGE GRAPH ]                        [ CONVERSATION TIMELINE ]
               |                                           |
    +----------+----------+                         +------+------+
    |                     |                         |             |
[DOC ARTIFACTS]    [CHAPTER ARTIFACTS]         [PAST CHAPTERS] [ACTIVE CHAPTER]
    |                     |                         |             |
    +----------+----------+                         (Compressed)  (Full Sharpness)
               |
     [ MULTI-RESOLUTION DATA ]
       - Title (Label)
       - Abstract (Low Sharpness)
       - Summary (Mid Sharpness)
       - Body / Raw (Hi-Fi)
       - Provenance / Lineage
```

### 2.1 The Universal Artifact Node
Every unit of thought in the workspace contains multi-resolution tiers pre-computed at generation time:
* **Resolution Tier 0 (Label):** Title and semantic tags. (Zero-cost contextual awareness).
* **Resolution Tier 1 (Abstract / Silhouette):** A 1–2 sentence essence of what this entity is and why it exists.
* **Resolution Tier 2 (Detailed Synopsis):** A multi-bullet structured breakdown of decisions, parameters, and constraints.
* **Resolution Tier 3 (Full Fidelity / Verbatim):** The raw markdown document or verbatim conversation log.
* **Metadata & Provenance:** Revision history, parent/child links, associative graph edges, and backward pointers to the exact conversation turn(s) that birthed or revised it.

### 2.2 The Knowledge Graph (Topological Space)
Ideas are not locked into a rigid filesystem hierarchy. They live in an organic, associative web:
* **Nodes:** Document artifacts and conversation chapter artifacts.
* **Edges:** Direct semantic relationships (e.g., `implements`, `refines`, `contradicts`, `depends_on`, `born_from`).
* **Distance Metric:** The topological distance (number of hops along the graph) directly governs the default degree of optical blur when compiling context.

---

# 3. Dynamic Context Assembly & Compilation

When you press Enter, the system compiles a tailored prompt payload before dispatching it to the LLM. It does not just dump chat history; it renders a scene.

### 3.1 Separation of Cognitive Semantics
The LLM must understand the difference between *what we are doing right now* and *what reference material exists*:
1. **The Conversational Thread (Temporal Flow):** The immediate, sequential back-and-forth dialogue leading up to the current turn.
2. **The Reference Substrate (Exhibits & Context):** The connected graph of artifacts, pulled in at varying resolutions based on their distance from the focal point.

### 3.2 The Optical Compiler Pipeline
1. **Identify the Focal Target:** By default, the active chapter. If manually overridden, a user-selected set of artifacts/nodes.
2. **Calculate Distance & Aperture:** 
   * Node is at focus $\rightarrow$ Tier 3 (Verbatim).
   * Node is 1 hop away $\rightarrow$ Tier 2 (Detailed Summary).
   * Node is 2 hops away $\rightarrow$ Tier 1 (Abstract).
   * Node is $>2$ hops away $\rightarrow$ Tier 0 (Title only) or omitted.
   * Recency decay adds a subtle weight to keep the immediately preceding chapter sharper than older ones.
3. **Assemble the Payload:** Pack the prompt deterministically into designated markdown/declarative blocks.

---

# 4. Interaction & Orchestration (The Single-Turn Protocol)

### 4.1 Strict Single-Turn Execution (Cost & Latency Discipline)
Multi-agent swarms with autonomous tool ping-pong loops are expensive, erratic, and slow. 
* **1 User Turn = 1 API Call.**
* The conversation model performs cognitive work and structure manipulation simultaneously in a single stream.
* The frontend parses structured delimiters in the LLM's response in real time to update client state, split chapters, or spawn artifact revisions without triggering secondary tool loops.

### 4.2 Chapter Lifecycle & Boundary Control
As conversation naturally meanders, topics drift. Instead of letting context rot:
* **Inline Shift Detection:** The model signals a topic migration within its response stream (e.g., via a declarative marker), specifying what just concluded and what new topic is opening.
* **Tactile User Overrides:**
  * **Boundary Sliding:** You can drag the chapter split line up or down the message stack if the model split too early or too late.
  * **Ad-Hoc Steering ("Local Recalibration"):** You can open a side channel on a specific past chapter to say: *"Your summary is wrong; this chapter was actually about X."* An isolated single-shot call updates the YAML resolutions for that chapter without pulling it into the main chat context.
  * **Undo / Re-Merge:** Collapse an erroneous split back into the active chapter with confirmation.

### 4.3 Provenance & Negatives (The "Audit Trail")
When inspecting an artifact, you have instant access to its "film negative":
* An artifact links back to the specific Chapter and Turn range where it was authored.
* Clicking into provenance opens a lightweight pop-up reader showing the raw discussion that led to that specific text, keeping you grounded in *why* a decision was made without forcing that raw transcript into the LLM's active working memory.

---

# 5. Form Factor & Ergonomics

### 5.1 Mobile-First Spatial Management
Thinking, ideation, and conversational steering frequently happen on a phone while on the move.
* **Primary Surface (Single Column):** A focused, clean conversational canvas.
* **Context Trays / Drawers:** Graph nodes, artifact viewers, and context inspectors live in slide-over drawers or bottom sheets on mobile, expanding into a multi-pane command desk only on wide desktop viewports.
* **Context HUD (Heads-Up Display):** A minimal, visual token/aperture bar that communicates at a glance what the model can see right now (e.g., color-coded chips indicating what is sharp, what is blurred, and what is out of frame).

