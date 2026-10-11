# SYSTEM ARCHITECTURE SPECIFICATION (`SYSTEM_ARCHITECTURE.md`)

---

## 1. Architectural Philosophy: The Optical Workspace

The system treats conversation, knowledge management, and LLM context not as an append-only linear transcript, but as an **organic, multi-resolution knowledge graph**.

```
+-----------------------------------------------------------------------------------+
|                                 WORKSPACE GRAPH                                   |
|                                                                                   |
|    [Chapter Node 01] <---- (born_from) ---- [Artifact Node A (Doc)]               |
|            |                                           |                          |
|       (transitions)                                (relates_to)                   |
|            v                                           v                          |
|    [Chapter Node 02] ---------------------> [Artifact Node B (Doc)]               |
|       (Active Focus)                                                              |
+-----------------------------------------------------------------------------------+
                                      |
                           [ CONTEXT COMPILER ]
            (Calculates distances from Focus: T3, T2, T1, T0, Cull)
                                      |
                                      v
                             [ 1-TURN API CALL ]
                                (Gemini Pro/Flash)
                                      |
                                      v
                          [ STREAMING XML PARSER ]
              (Extracts talk, splits chapters, updates revisions)
```

### Core Tenets
1. **Universal Artifact Primitive:** There is only one fundamental data entity: the **Artifact**. Documents, design specs, blueprints, and blocks of conversation (**Chapters**) are all Artifacts sharing the same unified schema.
2. **Multi-Resolution Pre-computation:** Every artifact contains pre-computed representations at four progressive fidelity tiers (Tier 0 to Tier 3). Context compaction is instantaneous because resolutions exist prior to assembly.
3. **Strict Single-Turn Protocol:** Exactly one user action triggers one LLM API call. Tool-calling loops, multi-agent swarms, and hidden chained requests are strictly prohibited.
4. **Topological Optics:** Prompt context is dynamically assembled based on the graph distance from the active **Focal Point**, applying an optical depth-of-field blur (progressive down-sampling of resolution tiers) to non-focused nodes.

---

## 2. Core Entities & Data Schemas

### 2.1 The Universal Artifact Model
Both conceptual documents and temporal dialogue chapters conform to this interface:

```typescript
export type ArtifactType = 'document' | 'chapter';

export type ResolutionTier = 0 | 1 | 2 | 3;

export interface MultiResolutionContent {
  /** Tier 0: 1-5 words. Label / tag identifier */
  t0_label: string;

  /** Tier 1: 1-2 sentences. Pure conceptual essence / silhouette */
  t1_abstract: string;

  /** Tier 2: 3-6 bullet points. Key parameters, structural decisions, constraints */
  t2_summary: string;

  /** Tier 3: Full fidelity. Verbatim text / markdown / dialogue turns */
  t3_body: string;
}

export interface ArtifactRevision {
  revision_id: string;
  timestamp: number;
  content: MultiResolutionContent;
  /** Conversation turn or prompt context that authored this change */
  author_note?: string;
}

export interface Artifact {
  id: string;
  workspace_id: string;
  type: ArtifactType;
  created_at: number;
  updated_at: number;

  /** Multi-resolution representation of the latest active revision */
  current: MultiResolutionContent;

  /** Complete historical revision audit trail (revisions never deleted) */
  revisions: ArtifactRevision[];

  /** Graph connections to other artifacts */
  relations: ArtifactRelation[];

  /** Audit trail tying this artifact back to raw discussion turns */
  provenance: ProvenanceRecord;
}
```

### 2.2 Graph Relations & Provenance
Artifacts link to one another to establish topological distance for the Context Compiler.

```typescript
export type RelationKind = 
  | 'parent_of'       // Hierarchical abstraction (Parent is more abstract)
  | 'child_of'        // Hierarchical concretization (Child is more detailed)
  | 'relates_to'      // Lateral associative link
  | 'refines'         // Direct evolutionary update
  | 'born_from';      // Derived from a specific Chapter

export interface ArtifactRelation {
  target_artifact_id: string;
  kind: RelationKind;
  weight?: number;    // Optional semantic tightness (default: 1.0)
}

export interface ProvenanceRecord {
  /** Chapter ID during which this artifact was first drafted */
  origin_chapter_id: string;
  /** Turn index range within that chapter (e.g., [4, 7]) */
  turn_range?: [number, number];
  /** History of subsequent chapters that modified this artifact */
  mutation_chapter_ids: string[];
}
```

### 2.3 Chapters: The Dialogue Artifact
A Chapter is a specialized Artifact representing an unbroken stretch of conversation centered on a single conceptual subject.

```typescript
export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  timestamp: number;
  content: string; // The raw conversational text (excluding internal XML commands)
  raw_payload?: string; // Complete unstripped model stream for debugging
}

export interface ChapterArtifact extends Artifact {
  type: 'chapter';
  turns: Turn[];
  status: 'active' | 'closed';
  /** Optional side-channel recalibration dialogue associated solely with this chapter */
  recalibration_thread?: Turn[];
}
```

---

## 3. Subsystem Architecture

### 3.1 Subsystem Overview

```
+---------------------------------------------------------------------------------+
|                                USER INTERFACE                                   |
|   (Mobile-First: Adaptive Drawers, Focus Selector, Timeline, Context HUD)       |
+---------------------------------------------------------------------------------+
          |                                                              ^
          | (1 User Action / Enter)                                      | (State Update)
          v                                                              |
+----------------------+      +----------------------+      +---------------------+
|   CONTEXT COMPILER   | ---> |     LLM GATEWAY      | ---> | STREAMING XML ENGINE|
| Calculates Aperture, |      | (Single 1-Turn Call: |      | Parses inline tags, |
| Assembles Prompt     |      |  Gemini Pro / Flash) |      | updates Graph/Nodes |
+----------------------+      +----------------------+      +---------------------+
          ^                                                              |
          |                                                              v
+---------------------------------------------------------------------------------+
|                              WORKSPACE GRAPH STORE                              |
|                (Artifact Registry, Edge Matrix, Revision History)               |
+---------------------------------------------------------------------------------+
```

### 3.2 Subsystem Responsibilities

#### 1. Workspace Graph Store
* Maintains the in-memory graph of all Chapters and Document Artifacts.
* Handles CRUD operations for artifacts and revisions.
* Computes shortest topological paths between any given node and the active Focal Point using graph traversal (Dijkstra / BFS).

#### 2. The Context Compiler (Detailed in `CONTEXT_COMPILER.md`)
* Runs entirely client-side right before firing the API request.
* Reads the current Focal Point (active chapter or user-pinned node).
* Applies the optical depth-of-field rules: resolves nodes to Tier 3, Tier 2, Tier 1, Tier 0, or drops them beyond the clipping boundary.
* Emits a strictly formatted prompt payload split into `<system_instructions>`, `<knowledge_graph_context>`, and `<conversation_history>`.

#### 3. LLM Gateway
* Manages direct API transport to Google Gemini models (Pro or Flash presets).
* Enforces single-turn semantics: sends payload, streams response, finishes turn.
* Disallows multi-agent recursive loops and autonomous secondary API dispatches.

#### 4. Streaming XML Engine (Detailed in `STREAM_PROTOCOL.md`)
* Consumes the chunked response stream from the LLM Gateway.
* Strips functional XML tags from conversational chat text in real time so the user experiences zero visual clutter on mobile.
* Detects `<topic_shift>`, `<artifact_upsert>`, and `<link>` tags, executing atomic state updates inside the Graph Store upon completion of the turn.

#### 5. Mobile-First Adaptive Interface (Detailed in `MOBILE_UX_SPEC.md`)
* Renders a clean conversational timeline optimized for handheld screens.
* Houses the Context HUD (showing live aperture, focal targets, and token budget).
* Employs slide-over sheets for Artifact inspection, side-channel recalibration popups, and the tactile chapter-boundary slider.

---

## 4. State Management Lifecycle

### 4.1 The Lifecycle of an Ideation Turn
1. **Input Submission:** User enters text and taps Send on mobile.
2. **Context Compilation:**
   * Compiler locates active Focus (default: Active Chapter).
   * Graph Store traverses edges up to parent hierarchy and out to 3 hops.
   * Compaction algorithm maps nodes to Tiers (T0-T3) respecting token ceiling.
   * Final single-turn payload is compiled.
3. **Gateway Dispatch:** Prompt is sent via Gemini API.
4. **Streaming & Parsing:**
   * User sees clean dialogue text streamed into the timeline.
   * Internal parser intercepts any XML instructions emitted by the model.
5. **Turn Reconciliation:**
   * If `<topic_shift>` was detected: Active chapter is closed, its YAML multi-resolution frontmatter is recorded, and a new Active Chapter is instantiated.
   * If `<artifact_upsert>` was detected: A new artifact or revision is stamped with provenance pointing directly to the current chapter and turn index.
   * Graph edges are updated.
   * Context HUD recalculates based on new state.

### 4.2 Chapter Recalibration State Flow (Side-Channel)
When a user challenges an existing chapter's summary:
1. User taps Chapter card $\rightarrow$ opens Recalibration Sheet.
2. User enters feedback: *"This chapter was about player velocity, not terrain bounds."*
3. Isolated API Call: System sends *only* the chapter's raw Tier 3 dialogue plus the user feedback to a fast model (Gemini Flash).
4. Model returns updated `t0_label`, `t1_abstract`, and `t2_summary`.
5. Chapter Artifact is updated in-place without injecting this meta-conversation into the main workspace timeline.
