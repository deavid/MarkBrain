import { Project, ModelOption, Artifact, Chapter, GraphNode, GraphEdge } from '../types';
import { serializeArtifactToYamlDoc } from '../utils/yamlArtifactParser';

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    badge: 'Lightweight Scout',
    powerRating: 2,
    latency: '~220ms',
    contextWindow: '1M tokens',
    description: 'Fast, cost-efficient model for rapid token refinement and initial drafts.',
    costMultiplier: 0.4,
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    badge: 'Architect Core',
    powerRating: 4,
    latency: '~580ms',
    contextWindow: '1M tokens',
    description: 'Balanced systems reasoning model for design tokens, component contracts, and boundaries.',
    costMultiplier: 1.0,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    badge: 'Deep Synthesis Pro',
    powerRating: 5,
    latency: '~1.6s',
    contextWindow: '2M tokens',
    description: 'High-power multi-repository synthesis and complex state machine verification.',
    costMultiplier: 3.5,
  },
];

// Helper to seed artifacts with YAML document string & version history
function createSeedArtifact(art: any): Artifact {
  const title = art.title || 'Untitled Artifact';
  const desc = art.description || art.abstract || 'Conceptual abstract.';
  const summ = art.summary || 'Key parameters and constraints.';
  const body = art.content || `# ${title}\n\nDocument body.`;
  const createdAtMs = art.createdAt ? new Date(art.createdAt).getTime() : Date.now();
  const updatedAtMs = art.updatedAt ? new Date(art.updatedAt).getTime() : createdAtMs;
  const wsId = art.workspace_id || art.projectId || 'ws-default';

  const fullArt: Artifact = {
    ...art,
    id: art.id,
    workspace_id: wsId,
    type: 'document',
    created_at: createdAtMs,
    updated_at: updatedAtMs,
    current: art.current || {
      t0_label: title,
      t1_abstract: desc,
      t2_summary: summ,
      t3_body: body,
    },
    revisions: art.revisions || [],
    relations: art.relations || [],
    provenance: art.provenance || {
      origin_chapter_id: 'chap-init',
      mutation_chapter_ids: [],
    },
    history: art.history || [
      {
        version: 1,
        timestamp: art.createdAt ? String(art.createdAt) : new Date().toISOString(),
        changeSummary: 'Initial specification baseline',
        content: body,
      },
    ],
  };
  return {
    ...fullArt,
    yamlDocument: serializeArtifactToYamlDoc(fullArt),
  };
}

// 1. PROJECT: Unhaunter Game
const unhaunterArtifacts: Artifact[] = [
  createSeedArtifact({
    id: 'art-unhaunter-combat-loop',
    projectId: 'proj-unhaunter',
    code: 'combat-loop',
    title: 'Core Combat Loop & Tick Cadence',
    type: 'architecture',
    category: 'game-mechanic',
    description: 'Central real-time combat arbitration engine governing 60Hz tick simulation and priority events.',
    summary:
      'Governs the real-time interaction between player inputs, hitbox verification, and enemy reaction windows. Maintains a deterministic 60Hz tick rate with decoupled rendering interpolation. Dispatches combat events to the Rage System, Audio Engine, and Camera Shake shaders.',
    content: `# Core Combat Loop & Tick Cadence

## Architecture Overview
The Unhaunter combat loop enforces deterministic tick execution decoupled from variable frame display rates.

### Primary Loop Stages
1. **Input Sampling (Pre-Tick):** Buffers light/heavy attack and dodge commands in a 120ms sliding intake window.
2. **State Arbitration:** Evaluates stamina availability, poise breaking threshold, and status effects.
3. **Collision Verification:** Sweeps capsule colliders against registered enemy hurtboxes.
4. **Event Dispatch:** Triggers rage momentum, micro-freeze hitstop (40ms), and audio spatial pings.

\`\`\`typescript
export interface CombatTickPayload {
  tickNumber: number;
  deltaTimeMs: number;
  activeStance: 'aggressive' | 'defensive' | 'haunted';
  bufferedAction: PlayerAction | null;
}
\`\`\`

## System Invariants
- Hitstop pause must never halt the underlying network synchronization clock.
- Dodges grant 14 invulnerability frames starting on frame 2.`,
    isHighConcept: true,
    resolution: 'full',
    graph: {
      parent: undefined,
      children: ['rage-mechanic', 'enemy-state-machine'],
      relationships: [
        { target: 'rage-mechanic', type: 'feeds-momentum', note: 'Supplies hit events to rage meter' },
        { target: 'enemy-state-machine', type: 'applies-stagger', note: 'Controls enemy poise breakdown' },
      ],
      is_high_concept: true,
      x: 100,
      y: 120,
    },
    tags: ['combat', 'core-engine', 'deterministic'],
    createdAt: '2026-10-09T10:00:00.000Z',
    updatedAt: '2026-10-10T06:00:00.000Z',
    history: [
      {
        version: 1,
        timestamp: '2026-10-09T10:00:00.000Z',
        changeSummary: 'Initial combat loop specification',
        content: '# Core Combat Loop\nInitial tick draft.',
      },
      {
        version: 2,
        timestamp: '2026-10-10T06:00:00.000Z',
        changeSummary: 'Added hitstop duration and dodge invulnerability invariants',
        previousContent: '# Core Combat Loop\nInitial tick draft.',
        content: `# Core Combat Loop & Tick Cadence\n\n## Architecture Overview\nThe Unhaunter combat loop enforces deterministic tick execution...`,
      },
    ],
  }),
  createSeedArtifact({
    id: 'art-unhaunter-rage-mechanic',
    projectId: 'proj-unhaunter',
    code: 'rage-mechanic',
    title: 'Adrenaline & Rage State Machine',
    type: 'game-mechanic',
    category: 'game-mechanic',
    description: 'Dynamic momentum accumulator unlocking frenzy abilities while multiplying stamina penalties.',
    summary:
      'The rage mechanic accumulates momentum whenever the player takes or deals damage within a 3-second cadence window. Reaching 100% triggers Frenzy State, unlocking spectral strikes while doubling stamina drain. Includes exponential decay after 4 seconds of inactivity.',
    content: `# Adrenaline & Rage State Machine

## Functional Specification
Rage serves as Unhaunter's core risk/reward mechanic. Players walk the line between heightened spectral potency and deadly stamina exhaustion.

### Tier Thresholds
- **Tier 0 (0-25%):** Latent. Standard stamina regen (45 units/sec).
- **Tier 1 (26-70%):** Primed. +15% melee damage, subtle chromatic aberration screen edge.
- **Tier 2 (71-99%):** Volatile. +30% attack speed, stamina drain +25%.
- **Tier 3 (100%):** **Frenzy Overload.** Unleashes spectral tear attack; stamina regen cut by 50%. Lasts 8 seconds before dropping to Tier 1.

\`\`\`yaml
decay_parameters:
  grace_period_sec: 4.0
  decay_rate_per_sec: 12.5
  combat_hit_bonus: 18.0
  damage_taken_bonus: 25.0
\`\`\`

## Invariants
- Rage meter cannot drop while actively charging a heavy attack.
- Frenzy triggers audio low-pass filter at 800Hz.`,
    isHighConcept: false,
    resolution: 'full',
    graph: {
      parent: 'combat-loop',
      children: ['vignette-shaders'],
      relationships: [
        { target: 'vignette-shaders', type: 'modulates-vfx', note: 'Drives pulse rate of edge shader' },
      ],
      is_high_concept: false,
      x: 340,
      y: 90,
    },
    tags: ['rage', 'mechanic', 'risk-reward'],
    createdAt: '2026-10-09T11:30:00.000Z',
    updatedAt: '2026-10-10T06:15:00.000Z',
    history: [
      {
        version: 1,
        timestamp: '2026-10-09T11:30:00.000Z',
        changeSummary: 'Initial prototype with linear decay',
        content: '# Adrenaline & Rage\nLinear decay prototype.',
      },
      {
        version: 2,
        timestamp: '2026-10-10T06:15:00.000Z',
        changeSummary: 'Refined into 4 tiers with Frenzy Overload and stamina penalty',
        previousContent: '# Adrenaline & Rage\nLinear decay prototype.',
        content: `# Adrenaline & Rage State Machine\n\n## Functional Specification\nRage serves as Unhaunter's core risk/reward mechanic...`,
      },
    ],
  }),
  createSeedArtifact({
    id: 'art-unhaunter-vignette-shaders',
    projectId: 'proj-unhaunter',
    code: 'vignette-shaders',
    title: 'Spectral Post-Processing Vignette',
    type: 'architecture',
    category: 'system-spec',
    description: 'Screen-space HLSL/GLSL shader pipeline visualizing fear, sanity loss, and frenzy aura.',
    summary:
      'Full-screen post-processing pass rendering dynamic chromatic distortion, blood-rush vignetting, and spectral grain modulated by player rage and sanity levels. Executes in 0.4ms budget on mobile GPU targets.',
    content: `# Spectral Post-Processing Vignette

## Shader Contract
The shader runs as a composite pass prior to UI rendering.

### Uniform Parameters
- \`u_RageNormalized\`: Float [0.0 - 1.0]
- \`u_SanityNormalized\`: Float [0.0 - 1.0]
- \`u_HeartbeatPulse\`: Float sine-wave driver

\`\`\`glsl
// Screen Vignette Edge Falloff
float vignette = smoothstep(0.4, 0.95, length(uv - 0.5));
vec3 spectralColor = mix(baseColor, vec3(0.85, 0.15, 0.22), vignette * u_RageNormalized);
\`\`\`

## Performance Invariants
- Max instruction count: 32 cycles.
- Half-precision floats enabled on mobile targets.`,
    isHighConcept: false,
    resolution: 'summary',
    graph: {
      parent: 'rage-mechanic',
      children: [],
      relationships: [],
      is_high_concept: false,
      x: 580,
      y: 90,
    },
    tags: ['shaders', 'graphics', 'mobile-perf'],
    createdAt: '2026-10-09T14:00:00.000Z',
    updatedAt: '2026-10-09T14:00:00.000Z',
  }),
  createSeedArtifact({
    id: 'art-unhaunter-enemy-ai',
    projectId: 'proj-unhaunter',
    code: 'enemy-state-machine',
    title: 'Haunter Perception & Ambush AI',
    type: 'architecture',
    category: 'game-mechanic',
    description: 'Hierarchical state machine driving acoustic perception, shadow stalking, and ambush lurches.',
    summary:
      'Enemies utilize sensory raycasts and navmesh acoustic cones. When the player runs or enters Frenzy, haunters detect vibrations through walls and transition from Stalk to Pounce behavior.',
    content: `# Haunter Perception & Ambush AI

## Behavioral State Tree
1. **Lurking (Patrol):** High hearing sensitivity, slow wall crawls.
2. **Acoustic Alert:** Turns toward noise origin; investigates within 2.5s.
3. **Ambush Pounce:** Teleports behind player when line of sight is broken.`,
    isHighConcept: false,
    resolution: 'summary',
    graph: {
      parent: 'combat-loop',
      children: [],
      relationships: [],
      is_high_concept: false,
      x: 340,
      y: 280,
    },
    tags: ['ai', 'stealth', 'sound-cones'],
    createdAt: '2026-10-09T16:00:00.000Z',
    updatedAt: '2026-10-09T16:00:00.000Z',
  }),
];

const unhaunterNodes: GraphNode[] = [
  {
    id: 'node-unhaunter-1',
    artifactId: 'art-unhaunter-combat-loop',
    projectId: 'proj-unhaunter',
    title: 'Core Combat Loop & Tick Cadence',
    type: 'architecture',
    isHighConcept: true,
    status: 'active',
    x: 80,
    y: 120,
    tags: ['core-engine'],
  },
  {
    id: 'node-unhaunter-2',
    artifactId: 'art-unhaunter-rage-mechanic',
    projectId: 'proj-unhaunter',
    title: 'Adrenaline & Rage State Machine',
    type: 'game-mechanic',
    isHighConcept: false,
    status: 'active',
    x: 320,
    y: 90,
    tags: ['rage'],
  },
  {
    id: 'node-unhaunter-3',
    artifactId: 'art-unhaunter-vignette-shaders',
    projectId: 'proj-unhaunter',
    title: 'Spectral Post-Processing Vignette',
    type: 'architecture',
    isHighConcept: false,
    status: 'active',
    x: 560,
    y: 90,
    tags: ['vfx'],
  },
  {
    id: 'node-unhaunter-4',
    artifactId: 'art-unhaunter-enemy-ai',
    projectId: 'proj-unhaunter',
    title: 'Haunter Perception & Ambush AI',
    type: 'architecture',
    isHighConcept: false,
    status: 'active',
    x: 320,
    y: 280,
    tags: ['ai'],
  },
];

const unhaunterEdges: GraphEdge[] = [
  {
    id: 'edge-un-1',
    sourceNodeId: 'node-unhaunter-1',
    targetNodeId: 'node-unhaunter-2',
    sourceProjectId: 'proj-unhaunter',
    targetProjectId: 'proj-unhaunter',
    label: 'feeds-rage',
    strength: 1.2,
  },
  {
    id: 'edge-un-2',
    sourceNodeId: 'node-unhaunter-2',
    targetNodeId: 'node-unhaunter-3',
    sourceProjectId: 'proj-unhaunter',
    targetProjectId: 'proj-unhaunter',
    label: 'modulates-vfx',
    strength: 0.9,
  },
  {
    id: 'edge-un-3',
    sourceNodeId: 'node-unhaunter-1',
    targetNodeId: 'node-unhaunter-4',
    sourceProjectId: 'proj-unhaunter',
    targetProjectId: 'proj-unhaunter',
    label: 'stagger-timing',
    strength: 1.0,
  },
];

const unhaunterChapters: Chapter[] = [
  {
    id: 'chap-un-1',
    projectId: 'proj-unhaunter',
    title: 'Chapter 1: Real-time Combat Simulation & Tick Alignment',
    summary:
      'Architected the 60Hz deterministic combat tick rate. Established hitstop pause constraints (40ms) and dodge invulnerability window.',
    keyPoints: [
      'Tick rate decoupled from rendering display refresh',
      'Hitstop pauses local simulation without desyncing world clock',
      'Input buffer window set to 120ms',
    ],
    isSummarized: true,
    compressionMode: 'summary',
    status: 'completed',
    createdAt: '2026-10-09T09:00:00.000Z',
    messages: [
      {
        id: 'msg-un-1',
        chapterId: 'chap-un-1',
        role: 'user',
        content: 'Let’s design the combat loop for Unhaunter. It needs to feel snappy and responsive on mobile touch controls with reliable dodge timing.',
        timestamp: '2026-10-09T09:01:00.000Z',
      },
      {
        id: 'msg-un-2',
        chapterId: 'chap-un-1',
        role: 'assistant',
        content: 'To achieve responsive mobile touch combat, we decouple the simulation clock (locked 60Hz tick) from the display refresh (which might be 60Hz or 120Hz ProMotion). We will enforce a 120ms input buffer and a 14-frame dodge invulnerability window.',
        timestamp: '2026-10-09T09:02:00.000Z',
      },
    ],
  },
  {
    id: 'chap-un-2',
    projectId: 'proj-unhaunter',
    title: 'Chapter 2: Rage Mechanics & Frenzy Thresholds',
    summary:
      'Formulated the 4-tier rage momentum accumulator and Frenzy state penalties. Dispatched shader and acoustic triggers.',
    keyPoints: [
      'Rage decays after 4 seconds of inactivity at 12.5% per second',
      'Frenzy activates secondary spectral attack and cuts stamina regen by 50%',
      'Screen vignette and 800Hz low-pass audio filters trigger automatically on Frenzy',
    ],
    isSummarized: true,
    compressionMode: 'summary',
    status: 'completed',
    createdAt: '2026-10-09T11:00:00.000Z',
    messages: [
      {
        id: 'msg-un-3',
        chapterId: 'chap-un-2',
        role: 'user',
        content: 'How should rage build and decay so players feel rewarded for aggressive play without ignoring defense?',
        timestamp: '2026-10-09T11:01:00.000Z',
      },
      {
        id: 'msg-un-4',
        chapterId: 'chap-un-2',
        role: 'assistant',
        content: 'We use a 4-tier momentum system. Dealing damage grants +18% rage, taking damage grants +25%. Reaching 100% unleashes Frenzy with bonus damage and spectral reach, but stamina recovery is penalized 50%, forcing players to stay sharp.',
        timestamp: '2026-10-09T11:03:00.000Z',
      },
    ],
  },
  {
    id: 'chap-un-3',
    projectId: 'proj-unhaunter',
    title: 'Chapter 3: Haunter Perception & Acoustic Cones',
    summary:
      'Designing enemy sensory raycasting and auditory vibration detection when the player enters high-rage states.',
    keyPoints: [
      'Haunters track floor vibrations within 15 meters during sprint or Frenzy',
      'Acoustic cones penetrate thin partition walls',
    ],
    isSummarized: false,
    compressionMode: 'full',
    status: 'active',
    createdAt: '2026-10-10T06:30:00.000Z',
    messages: [
      {
        id: 'msg-un-5',
        chapterId: 'chap-un-3',
        role: 'user',
        content: 'Now let’s work out how the haunters track the player. If the player is in Frenzy, can enemies hear them through walls?',
        timestamp: '2026-10-10T06:31:00.000Z',
      },
      {
        id: 'msg-un-6',
        chapterId: 'chap-un-3',
        role: 'assistant',
        content: 'Yes! In Frenzy state, player footstep decibels increase from 28dB to 62dB, allowing haunter hearing cones to detect vibration vectors through wood and drywall partitions up to 15 meters away. This turns maximum offense into an immediate beacon for lurking stalkers.',
        timestamp: '2026-10-10T06:33:00.000Z',
      },
    ],
  },
];

// 2. PROJECT: MarkBrain
const markBrainArtifacts: Artifact[] = [
  createSeedArtifact({
    id: 'art-mb-yaml-spec',
    projectId: 'proj-markbrain',
    code: 'yaml-frontmatter-spec',
    title: 'Single-File YAML Frontmatter + Markdown Engine',
    type: 'architecture',
    category: 'system-spec',
    description: 'Unified single-file artifact persistence encoding metadata, relationships, and pages of markdown.',
    summary:
      'Combines YAML frontmatter (title, description, summary, graph relationships, history) with arbitrary Markdown specification bodies in a single pristine file. Enables zero-overhead parsing, import from raw documents via LLM extraction, and seamless portability.',
    content: `# Single-File YAML Frontmatter + Markdown Engine

## Overview
Every architectural artifact in MarkBrain is represented as a single self-describing document.

\`\`\`yaml
---
id: art-01
code: spatial-node-topology
title: Spatial Node Topology
type: architecture
category: system-spec
description: Interactive 2D graph engine with physics stabilization.
summary: Comprehensive summary paragraph...
graph:
  parent: core-engine
  children: [force-layout, viewport-pan]
  relationships:
    - target: token-budget
      type: cost-metering
  is_high_concept: true
resolution: full
history:
  - version: 1
    timestamp: 2026-10-10T00:00:00Z
    change_summary: Initial specification
---
# Spatial Node Topology
[Markdown specification pages here...]
\`\`\`

## Invariants
1. Frontmatter parsing must fail gracefully into plain markdown heading extraction if YAML syntax is malformed.
2. Version history is recorded append-only with opt-in diff inspection.`,
    isHighConcept: true,
    resolution: 'full',
    graph: {
      parent: undefined,
      children: ['context-abstraction-engine', 'tree-chapters-protocol'],
      relationships: [
        { target: 'context-abstraction-engine', type: 'regulates-payload', note: 'Provides abstraction resolution' },
      ],
      is_high_concept: true,
      x: 100,
      y: 100,
    },
    tags: ['yaml', 'markdown', 'unified-facade'],
    createdAt: '2026-10-10T01:00:00.000Z',
    updatedAt: '2026-10-10T07:00:00.000Z',
  }),
  createSeedArtifact({
    id: 'art-mb-abstraction-engine',
    projectId: 'proj-markbrain',
    code: 'context-abstraction-engine',
    title: '5-Tier Context Abstraction Slider Matrix',
    type: 'architecture',
    category: 'system-spec',
    description: 'Dynamic resolution ladder scaling from Title-only to Full Document with real-time token ledger.',
    summary:
      'Enables granular context control per artifact: Full (100%), Summary (~25%), Description (~10%), Title (~2%), and Excluded (0%). Prevents context explosion during long architectural brainstorming sessions.',
    content: `# 5-Tier Context Abstraction Slider Matrix

## Abstraction Tiers
- **Excluded (0 tokens):** Completely omitted from prompt assembly.
- **Title (~2% tokens):** Reference identifier only.
- **Description (~10% tokens):** 1-2 sentence orientation.
- **Summary (~25% tokens):** Core architecture & invariants.
- **Full (100% tokens):** Complete markdown body and schema definitions.`,
    isHighConcept: true,
    resolution: 'full',
    graph: {
      parent: 'yaml-frontmatter-spec',
      children: [],
      relationships: [],
      is_high_concept: true,
      x: 350,
      y: 90,
    },
    tags: ['tokens', 'abstraction', 'sliders'],
    createdAt: '2026-10-10T02:00:00.000Z',
    updatedAt: '2026-10-10T07:00:00.000Z',
  }),
  createSeedArtifact({
    id: 'art-mb-tree-chapters',
    projectId: 'proj-markbrain',
    code: 'chapters-protocol',
    title: 'Episodic Chapter Timeline & Continuous Canvas',
    type: 'architecture',
    category: 'chat-chapter',
    description: 'Conversational chapters grouping chat blocks with inline summarization and optical depth-of-field.',
    summary:
      'Chapters group related blocks of conversation. Past chapters compress into executive summaries while the active chapter flows seamlessly into ongoing ideation.',
    content: `# Episodic Chapter Timeline & Continuous Canvas

## Chapter Structure
- **Active Chapter:** Ongoing conversation block rendered at full fidelity, with an open bottom boundary connecting directly to live input.
- **Completed Chapters:** Sealed historical blocks compressed to executive summaries and key invariants to protect the context window.
- **Dynamic Splitting:** Tactile split points dividing conversation turns without artificial sub-hierarchies.`,
    isHighConcept: false,
    resolution: 'summary',
    graph: {
      parent: 'yaml-frontmatter-spec',
      children: [],
      relationships: [],
      is_high_concept: false,
      x: 350,
      y: 260,
    },
    tags: ['chapters', 'timeline', 'continuous-canvas'],
    createdAt: '2026-10-10T03:00:00.000Z',
    updatedAt: '2026-10-10T07:00:00.000Z',
  }),
];

const markBrainNodes: GraphNode[] = [
  {
    id: 'node-mb-1',
    artifactId: 'art-mb-yaml-spec',
    projectId: 'proj-markbrain',
    title: 'Single-File YAML Frontmatter + Markdown Engine',
    type: 'architecture',
    isHighConcept: true,
    status: 'active',
    x: 80,
    y: 100,
    tags: ['yaml-engine'],
  },
  {
    id: 'node-mb-2',
    artifactId: 'art-mb-abstraction-engine',
    projectId: 'proj-markbrain',
    title: '5-Tier Context Abstraction Slider Matrix',
    type: 'architecture',
    isHighConcept: true,
    status: 'active',
    x: 340,
    y: 90,
    tags: ['tokens'],
  },
  {
    id: 'node-mb-3',
    artifactId: 'art-mb-tree-chapters',
    projectId: 'proj-markbrain',
    title: 'Episodic Chapter Timeline & Continuous Canvas',
    type: 'architecture',
    isHighConcept: false,
    status: 'active',
    x: 340,
    y: 260,
    tags: ['chapters'],
  },
];

const markBrainEdges: GraphEdge[] = [
  {
    id: 'edge-mb-1',
    sourceNodeId: 'node-mb-1',
    targetNodeId: 'node-mb-2',
    sourceProjectId: 'proj-markbrain',
    targetProjectId: 'proj-markbrain',
    label: 'feeds-payload',
    strength: 1.1,
  },
  {
    id: 'edge-mb-2',
    sourceNodeId: 'node-mb-1',
    targetNodeId: 'node-mb-3',
    sourceProjectId: 'proj-markbrain',
    targetProjectId: 'proj-markbrain',
    label: 'chapter-facade',
    strength: 0.9,
  },
];

const markBrainChapters: Chapter[] = [
  {
    id: 'chap-mb-1',
    projectId: 'proj-markbrain',
    title: 'Chapter 1: The Unified YAML + Markdown Artifact Standard',
    summary:
      'Designed the single-file specification standard combining YAML frontmatter metadata (graph parent/children, relationships, history) with rich Markdown bodies.',
    keyPoints: [
      'Metadata and markdown stored together in one portable file',
      'LLM extraction endpoint structures incoming raw .md/.txt files',
      'Version history recorded automatically without blocking approval gates',
    ],
    isSummarized: true,
    compressionMode: 'summary',
    status: 'completed',
    createdAt: '2026-10-10T00:30:00.000Z',
    messages: [
      {
        id: 'msg-mb-1',
        chapterId: 'chap-mb-1',
        role: 'user',
        content: 'Let’s make all artifacts YAML with Markdown in a single file. Title, short description, summary of contents, and Markdown pages. Plus graph data with parent, children, and relationships.',
        timestamp: '2026-10-10T00:31:00.000Z',
      },
      {
        id: 'msg-mb-2',
        chapterId: 'chap-mb-1',
        role: 'assistant',
        content: 'This gives MarkBrain a pristine, transparent data model. We format each document with YAML frontmatter containing `id`, `code`, `title`, `type`, `category`, `description`, `summary`, and a `graph` block with `parent`, `children`, and `relationships`. Below the frontmatter divider (`---`), the full multi-page markdown content lives cleanly.',
        timestamp: '2026-10-10T00:34:00.000Z',
      },
    ],
  },
  {
    id: 'chap-mb-2',
    projectId: 'proj-markbrain',
    title: 'Chapter 2: Mobile First Flow & Conversational Canvas',
    summary:
      'Established the initial mobile viewport: Projects first ("What project do you want to open?"). From project selection, navigate straight to one continuous chat with structured chapters.',
    keyPoints: [
      'Mobile entry point displays Project selector with "+ New Project"',
      'Selecting a project immediately opens Chat',
      'Chapters group related turns into coherent milestones',
    ],
    isSummarized: false,
    compressionMode: 'full',
    status: 'active',
    createdAt: '2026-10-10T04:00:00.000Z',
    messages: [
      {
        id: 'msg-mb-3',
        chapterId: 'chap-mb-2',
        role: 'user',
        content: 'What should be on the phone screen when opening the app? Project! What project do you want to open, or create a new project. Then straight into chat.',
        timestamp: '2026-10-10T04:01:00.000Z',
      },
      {
        id: 'msg-mb-4',
        chapterId: 'chap-mb-2',
        role: 'assistant',
        content: 'Exactly. One screen, one job. When you launch MarkBrain on mobile, you see your Project Deck: Unhaunter Game, MarkBrain, or a button to spawn a new project. Tapping a project takes you immediately into its continuous chat timeline.',
        timestamp: '2026-10-10T04:03:00.000Z',
      },
    ],
  },
];

// Initial Projects
export const INITIAL_PROJECTS: Project[] = [
  {
    id: 'proj-unhaunter',
    name: 'Unhaunter Game',
    codeName: 'unhaunter',
    description: 'Real-time combat engine, adrenaline rage momentum, haunter acoustic perception AI, and spectral shaders.',
    color: '#be3a49', // crimson ruby
    icon: 'Flame',
    boundaryRules: 'Core combat ticks and haunter acoustic models are bounded within the game loop.',
    currentChapterId: 'chap-un-3',
    chapters: unhaunterChapters,
    artifacts: unhaunterArtifacts,
    nodes: unhaunterNodes,
    edges: unhaunterEdges,
    lastActivity: '2026-10-10T06:33:00.000Z',
  },
  {
    id: 'proj-markbrain',
    name: 'MarkBrain',
    codeName: 'markbrain',
    description: 'Spatial architectural brainstorming studio, single-file YAML+Markdown engine, and tree-form chapter timelines.',
    color: '#8c52ff', // royal purple
    icon: 'Brain',
    boundaryRules: 'Cross-repo linking bridges high-concept architecture specs while detail tokens remain localized.',
    currentChapterId: 'chap-mb-2',
    chapters: markBrainChapters,
    artifacts: markBrainArtifacts,
    nodes: markBrainNodes,
    edges: markBrainEdges,
    lastActivity: '2026-10-10T04:03:00.000Z',
  },
];
