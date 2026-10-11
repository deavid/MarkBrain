# THE OPTICAL CONTEXT COMPILER SPECIFICATION (`CONTEXT_COMPILER.md`)

---

## 1. Conceptual Mechanics: The Depth-of-Field Engine

The Context Compiler is responsible for converting a multi-dimensional, non-linear knowledge graph into a clean, single-turn prompt payload for the LLM. 

Traditional context assemblers use sliding windows (truncate oldest) or semantic search/RAG (pull top-K chunks without structural context). The Optical Compiler behaves like a camera lens:

```
[OUT OF FRAME]      [TIER 0: TITLE]      [TIER 1: ABSTRACT]      [TIER 2: SUMMARY]      [TIER 3: VERBATIM]
(Clipped/Omitted)     (Label Only)       (Silhouette / Essence)    (Structured Bullets)   (Full Hi-Fi Body)
  > 3 Hops away         3 Hops away            2 Hops away              1 Hop away           FOCAL POINT
-------------------------------------------------------------------------------------------------------->
[ MAXIMUM BLUR ] <-------------------------------------------------------------------> [ SHARP FOCUS ]
```

### Optical Modes
1. **Autofocus (Default):** The active conversation chapter is locked as the Focal Point. Depth-of-field expands topologically outward through direct artifact references and parent hierarchies.
2. **Manual Focus:** The user explicitly selects one or more artifacts or historical chapters as the Focal Points (e.g., pinning a core architecture document).
3. **Macro / Myopia Mode (The Forest View):** Globally clamps the maximum resolution of *all* background nodes to Tier 1 (Abstract) or Tier 0 (Title), and compresses conversational history to Tier 2 (Summary). This removes implementation weeds entirely, forcing the model to synthesize high-level patterns and identify conceptual voids.

---

## 2. Compilation Algorithm

The compiler runs deterministically on the client device before every single API call.

```
       [ Start Compilation ]
                 |
                 v
      [ Identify Focal Target(s) ] (Active Chapter or User-Pinned Nodes)
                 |
                 v
      [ Graph Traversal: BFS ]
      - Traverse upwards to root ancestors (Hierarchical Backbone)
      - Traverse lateral edges out to Radius = 3 hops
                 |
                 v
      [ Assign Raw Optical Tiers ]
      - Focal Point(s)        -> Tier 3 (Verbatim)
      - Distance = 1 hop      -> Tier 2 (Detailed Summary)
      - Distance = 2 hops     -> Tier 1 (Abstract)
      - Distance = 3 hops     -> Tier 0 (Label/Tag only)
      - Distance > 3 hops     -> Cull (Omit from payload)
                 |
                 v
      [ Apply Recency Weight to Dialogue ]
      - Chapter immediately prior to active -> Boost to Tier 2 (if degraded)
                 |
                 v
      [ Token Budget & Dynamic Blurring ]
      - Calculate total projected tokens
      - IF Total > Token Budget Ceiling:
          Progressively blur furthest nodes first (T2 -> T1 -> T0 -> Cull)
                 |
                 v
      [ Assemble Structured Payload ]
      - Format XML / Markdown payload blocks
                 |
                 v
            [ Complete ]
```

### 2.1 Distance & Hierarchy Rules
1. **The Ancestor Backbone:** Any artifact that is an ancestor (`parent_of` path leading up to root concepts) of the focal node is never culled. It is kept at a minimum of **Tier 1 (Abstract)** to anchor the model to first principles.
2. **Topological Radius:** Any node with a shortest-path distance $> 3$ hops from the focal point is placed outside the depth of field and completely culled from the context.
3. **Temporal Recency Bias:** The conversation chapter immediately preceding the active chapter is guaranteed at least **Tier 2 (Summary)** to maintain immediate dialogue continuity, regardless of graph distance.

### 2.2 Budget-Driven Dynamic Blurring
When the compiled context exceeds the defined token budget (configured by the model preset, e.g., 32k for fast turns, 128k+ for deep turns):
1. Nodes at Distance 3 (Tier 0) are culled first.
2. Nodes at Distance 2 (Tier 1) are degraded to Tier 0.
3. Nodes at Distance 1 (Tier 2) are degraded to Tier 1.
4. *Inviolable Core:* The Focal Point (Tier 3) is never degraded unless explicitly forced by Macro/Myopia mode.

---

## 3. Resolution Tier Format Definitions

Every node stored in the graph stores its multi-resolution tiers pre-computed. The compiler injects them into the prompt using standardized XML enclosures:

### Tier 3: Full Fidelity (Verbatim)
Used exclusively for the active focal point and pinned items.
```xml
<artifact id="art_physics_01" type="document" tier="3" focus="true">
  <title>Rigid Body Simulation Parameters</title>
  <content>
# Rigid Body Simulation Parameters
Detailed specifications of friction coefficients, mass distribution matrices, and step intervals for the custom deterministic physics engine...
[Full body text reproduced verbatim]
  </content>
</artifact>
```

### Tier 2: Detailed Summary (Mid Sharpness)
Used for direct neighbors (1 hop away) and recent chapters.
```xml
<artifact id="art_physics_01" type="document" tier="2" distance="1">
  <title>Rigid Body Simulation Parameters</title>
  <summary>
- Deterministic 60Hz physics loop using fixed-point arithmetic.
- Friction coefficients categorized into Static (0.8), Dynamic (0.4), and Slippery (0.05).
- Solver constraints enforce max 4 iterations per substep to preserve mobile CPU headroom.
  </summary>
</artifact>
```

### Tier 1: Abstract / Silhouette (Low Sharpness)
Used for 2-hop neighbors, distant ancestors, or globally when in Myopia mode.
```xml
<artifact id="art_physics_01" type="document" tier="1" distance="2">
  <title>Rigid Body Simulation Parameters</title>
  <abstract>
Defines deterministic collision, friction, and integration parameters for the project's physics subsystem, constrained for low-end mobile hardware.
  </abstract>
</artifact>
```

### Tier 0: Label / Tag (Peripheral Vision)
Used for 3-hop nodes at the periphery of the depth of field.
```xml
<artifact id="art_physics_01" type="document" tier="0" distance="3" title="Rigid Body Simulation Parameters" tags="physics, engine, constraints" />
```

---

## 4. Compiled Payload Structure

The output of the compiler is fed directly to the Gemini API as a single string payload. It enforces clear cognitive separation between background references and live conversation.

```xml
<system_instructions>
You are the optical sparring partner and systems architect.
You must adhere to the following protocol rules:
1. Ground your thinking in the provided Knowledge Graph context.
2. Maintain clean separation between high-level architectural constraints and implementation detail.
3. You may emit structured XML tags to create or modify artifacts, declare topic shifts, or propose graph edges inline with your conversational prose.
</system_instructions>

<knowledge_graph_substrate>
  <!-- Background reference artifacts compiled according to current depth of field -->
  <artifact id="doc_meta_00" type="document" tier="1" distance="2">
    <title>Game Design Vision Document</title>
    <abstract>Top-level vision emphasizing physics-based emergence and tactile player feedback.</abstract>
  </artifact>

  <artifact id="doc_weapons_04" type="document" tier="2" distance="1">
    <title>Ballistics & Recoil System</title>
    <summary>
    - Weapon recoil directly impacts camera pitch and physical projectile trajectory.
    - Uses deterministic spread cones driven by character stance.
    </summary>
  </artifact>
</knowledge_graph_substrate>

<conversation_history>
  <!-- Past chapters compressed according to distance; active chapter verbatim -->
  <chapter id="chap_01" tier="2" status="closed">
    <title>Initial Ballistics Scoping</title>
    <summary>
    - Explored hitscan vs projectile systems; finalized projectile approach.
    - Decided on deterministic recoil tables over procedural noise.
    </summary>
  </chapter>

  <chapter id="chap_02" tier="3" status="active" focus="true">
    <title>Fine-Tuning Recoil Kinematics</title>
    <turns>
      <turn role="user">How should the recoil impulse decay over time when firing automatic bursts?</turn>
      <turn role="assistant">An exponential decay curve with a hard reset ceiling is best here...</turn>
      <turn role="user">Let's refine that curve. What are the specific decay coefficients for heavy vs light weapons?</turn>
    </turns>
  </chapter>
</conversation_history>
```

---

## 5. Mobile HUD Telemetry

During compilation, the compiler generates a metadata report exported directly to the user interface. This drives the **Context HUD** so the user has immediate visual feedback on what the LLM can perceive:

```typescript
export interface ContextTelemetry {
  focal_artifact_ids: string[];
  optical_mode: 'autofocus' | 'manual' | 'myopia';
  token_breakdown: {
    system_tokens: number;
    substrate_tokens: number;
    history_tokens: number;
    total_tokens: number;
    budget_ceiling: number;
  };
  node_distribution: {
    tier_3_count: number;
    tier_2_count: number;
    tier_1_count: number;
    tier_0_count: number;
    culled_count: number;
  };
}
```

