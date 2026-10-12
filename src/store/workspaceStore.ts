import { create } from 'zustand';
import {
  Artifact,
  ChapterArtifact,
  WorkspaceState,
  MultiResolutionContent,
  ArtifactRevision,
  ArtifactRelation,
  Turn,
  OpticalMode,
  ResolutionTier,
  ContextTelemetry,
  ModelOption,
} from '../types';
import { AVAILABLE_MODELS } from '../data/initialData';

const STORAGE_WORKSPACES_KEY = 'optical_context_workspaces_v1';
const STORAGE_ACTIVE_ID_KEY = 'optical_context_active_workspace_id_v1';

// Seed initial workspace with multi-resolution Universal Artifacts
export function createSeedMultiResolution(
  label: string,
  abstract: string,
  summaryBullets: string[],
  bodyMarkdown: string
): MultiResolutionContent {
  return {
    t0_label: label,
    t1_abstract: abstract,
    t2_summary: summaryBullets.map((b) => `- ${b.replace(/^- /, '')}`).join('\n'),
    t3_body: bodyMarkdown,
  };
}

// Initial Sample Workspaces with full t0, t1, t2, t3 multi-resolution content
const INITIAL_SEED_WORKSPACES: WorkspaceState[] = [
  {
    workspace_id: 'ws-unhaunter',
    name: 'Unhaunter Game Engine',
    description: 'Deterministic 60Hz physics, rage momentum, and fear post-processing architecture.',
    color: '#e05a66',
    created_at: 1773000000000,
    updated_at: 1773100000000,
    active_chapter_id: 'chap-combat-kinematics',
    focal_artifact_ids: ['chap-combat-kinematics'],
    optical_mode: 'autofocus',
    tier_overrides: {},
    artifacts: {
      'chap-architecture-foundations': {
        id: 'chap-architecture-foundations',
        workspace_id: 'ws-unhaunter',
        type: 'chapter',
        status: 'closed',
        created_at: 1773010000000,
        updated_at: 1773020000000,
        current: createSeedMultiResolution(
          'Architecture Foundations',
          'Established fundamental architectural principles for deterministic simulation and decoupled render loops.',
          [
            'Decoupled 60Hz tick simulation from variable refresh rate display interpolation.',
            'Fixed-point math chosen for determinism across cross-play clients.',
            'Identified combat loop and rage state machine as foundational pillars.'
          ],
          '# Chapter 1: Architecture Foundations\nInitial session defining fixed-point math and state arbitration requirements.'
        ),
        revisions: [
          {
            revision_id: 'rev-chap-1',
            timestamp: 1773010000000,
            content: createSeedMultiResolution(
              'Architecture Foundations',
              'Established fundamental architectural principles for deterministic simulation.',
              ['Decoupled 60Hz tick simulation.', 'Fixed-point math chosen.'],
              '# Chapter 1: Architecture Foundations\nInitial session...'
            ),
          },
        ],
        relations: [
          { target_artifact_id: 'art-combat-loop', kind: 'parent_of' },
        ],
        provenance: {
          origin_chapter_id: 'chap-architecture-foundations',
          mutation_chapter_ids: [],
        },
        turns: [
          {
            id: 'turn-1',
            role: 'user',
            timestamp: 1773010100000,
            content: 'How should we decouple the simulation clock from variable refresh displays?',
          },
          {
            id: 'turn-2',
            role: 'assistant',
            timestamp: 1773010150000,
            content: 'We implement a fixed timestep accumulator: the engine consumes time in strict 16.66ms chunks while the renderer linearly interpolates transform matrices between current and previous tick states.',
          },
        ],
      } as ChapterArtifact,

      'chap-combat-kinematics': {
        id: 'chap-combat-kinematics',
        workspace_id: 'ws-unhaunter',
        type: 'chapter',
        status: 'active',
        created_at: 1773050000000,
        updated_at: 1773090000000,
        current: createSeedMultiResolution(
          'Combat Kinematics & Recoil',
          'Active deep-dive into hitstop timings, dodge invulnerability frames, and rage feedback curves.',
          [
            'Calibrating 40ms micro-freeze on heavy impacts to give tactile weight.',
            '14 invulnerability frames starting on frame 2 of dodge animations.',
            'Rage decay curve uses exponential falloff after 4.0s of combat disengagement.'
          ],
          '# Chapter 2: Combat Kinematics & Recoil\nActive working thread on fine-tuning player movement and tactile arbitration.'
        ),
        revisions: [],
        relations: [
          { target_artifact_id: 'chap-architecture-foundations', kind: 'born_from' },
          { target_artifact_id: 'art-combat-loop', kind: 'relates_to' },
          { target_artifact_id: 'art-rage-mechanic', kind: 'refines' },
        ],
        provenance: {
          origin_chapter_id: 'chap-combat-kinematics',
          mutation_chapter_ids: [],
        },
        turns: [
          {
            id: 'turn-3',
            role: 'user',
            timestamp: 1773050100000,
            content: 'What hitstop duration provides punchy weight without disrupting the deterministic 60Hz tick?',
          },
          {
            id: 'turn-4',
            role: 'assistant',
            timestamp: 1773050200000,
            content: 'A 40ms (2.4 tick) micro-freeze on the attacker and defender animations creates satisfying impact crunch. Crucially, the internal tick counter must continue running while visual animation time scales to zero.',
          },
          {
            id: 'turn-5',
            role: 'user',
            timestamp: 1773050300000,
            content: 'How should the rage meter interact with this hitstop? Does frenzy grant hyper-armor?',
          },
          {
            id: 'turn-6',
            role: 'assistant',
            timestamp: 1773050400000,
            content: 'When in Tier 3 Frenzy Overload, the player receives hyper-armor through the hitstop: incoming attacks cannot interrupt active attack animations, but damage taken is increased by 20% to preserve high stakes.',
          },
        ],
      } as ChapterArtifact,

      'art-combat-loop': {
        id: 'art-combat-loop',
        workspace_id: 'ws-unhaunter',
        type: 'document',
        created_at: 1773020000000,
        updated_at: 1773080000000,
        current: createSeedMultiResolution(
          'Core Combat Loop & Cadence',
          'Central real-time combat arbitration engine governing deterministic 60Hz simulation and priority events.',
          [
            '120ms sliding intake window for input buffering (light, heavy, dodge).',
            'State arbitration checks stamina, poise break thresholds, and status effects.',
            'Swept capsule collider collision detection against registered enemy hurtboxes.',
            'Dispatches events to Rage System, Spatial Audio, and Camera Shaders.'
          ],
          `# Core Combat Loop & Tick Cadence

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
- Dodges grant 14 invulnerability frames starting on frame 2.`
        ),
        revisions: [
          {
            revision_id: 'rev-combat-1',
            timestamp: 1773020000000,
            content: createSeedMultiResolution(
              'Core Combat Loop Baseline',
              'Initial draft of combat loop.',
              ['Basic tick rate and buffered input.'],
              '# Core Combat Loop\nInitial specification.'
            ),
            author_note: 'Initial baseline created from Chapter 1',
          },
        ],
        relations: [
          { target_artifact_id: 'art-rage-mechanic', kind: 'parent_of' },
          { target_artifact_id: 'art-post-shaders', kind: 'relates_to' },
        ],
        provenance: {
          origin_chapter_id: 'chap-architecture-foundations',
          turn_range: [1, 2],
          mutation_chapter_ids: ['chap-combat-kinematics'],
        },
        tags: ['combat', 'core-engine', 'physics', 'deterministic'],
        isHighConcept: true,
      },

      'art-rage-mechanic': {
        id: 'art-rage-mechanic',
        workspace_id: 'ws-unhaunter',
        type: 'document',
        created_at: 1773030000000,
        updated_at: 1773085000000,
        current: createSeedMultiResolution(
          'Adrenaline & Rage State Machine',
          'Dynamic momentum accumulator unlocking frenzy abilities while multiplying stamina penalties.',
          [
            'Accumulates rage when dealing or taking damage within a 3.0s window.',
            'Reaching 100% triggers Frenzy Overload with spectral strikes and doubled stamina drain.',
            'Exponential decay at 12.5 units/sec after 4.0s of inactivity.',
            'Audio low-pass filter at 800Hz triggers during Frenzy.'
          ],
          `# Adrenaline & Rage State Machine

## Functional Specification
Rage serves as Unhaunter's core risk/reward mechanic. Players walk the line between heightened spectral potency and deadly stamina exhaustion.

### Tier Thresholds
- **Tier 0 (0-25%):** Latent. Standard stamina regen (45 units/sec).
- **Tier 1 (26-70%):** Primed. +15% melee damage, subtle chromatic aberration screen edge.
- **Tier 2 (71-99%):** Volatile. +30% attack speed, stamina drain +25%.
- **Tier 3 (100%):** **Frenzy Overload.** Unleashes spectral tear attack; stamina regen cut by 50%. Lasts 8 seconds.

\`\`\`yaml
decay_parameters:
  grace_period_sec: 4.0
  decay_rate_per_sec: 12.5
  combat_hit_bonus: 18.0
  damage_taken_bonus: 25.0
\`\`\``
        ),
        revisions: [],
        relations: [
          { target_artifact_id: 'art-combat-loop', kind: 'child_of' },
          { target_artifact_id: 'art-post-shaders', kind: 'relates_to' },
        ],
        provenance: {
          origin_chapter_id: 'chap-combat-kinematics',
          turn_range: [5, 6],
          mutation_chapter_ids: [],
        },
        tags: ['rage', 'risk-reward', 'state-machine'],
      },

      'art-post-shaders': {
        id: 'art-post-shaders',
        workspace_id: 'ws-unhaunter',
        type: 'document',
        created_at: 1773040000000,
        updated_at: 1773080000000,
        current: createSeedMultiResolution(
          'Spectral Post-Processing Vignette',
          'Screen-space HLSL/GLSL shader pipeline visualizing fear, sanity loss, and frenzy aura.',
          [
            'Full-screen post-processing pass rendering dynamic chromatic distortion.',
            'Vignette blood-rush modulated by rage meter and sanity values.',
            'Executes within strict 0.4ms mobile GPU budget.',
            'Decoupled from simulation clock; runs in visual composite stage.'
          ],
          `# Spectral Post-Processing Vignette

## Shader Pipeline Contract
The shader runs as a composite pass prior to UI rendering, taking normalized float inputs for rage (0..1) and fear (0..1).

\`\`\`hlsl
float4 PsVignette(VertexOutput input) : SV_Target {
  float2 uv = input.uv;
  float dist = distance(uv, float2(0.5, 0.5));
  float vignette = smoothstep(0.5, 0.9, dist * (1.0 + _RageLevel * 0.4));
  return lerp(_NormalScene, _SpectralTint, vignette);
}
\`\`\``
        ),
        revisions: [],
        relations: [
          { target_artifact_id: 'art-rage-mechanic', kind: 'child_of' },
        ],
        provenance: {
          origin_chapter_id: 'chap-architecture-foundations',
          mutation_chapter_ids: [],
        },
        tags: ['shaders', 'vfx', 'graphics'],
      },
    },
  },
];

function loadStoredWorkspaces(): WorkspaceState[] {
  try {
    const raw = localStorage.getItem(STORAGE_WORKSPACES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load workspaces from localStorage:', e);
  }
  return INITIAL_SEED_WORKSPACES;
}

function loadStoredActiveId(workspaces: WorkspaceState[]): string {
  try {
    const saved = localStorage.getItem(STORAGE_ACTIVE_ID_KEY);
    if (saved && workspaces.some((w) => w.workspace_id === saved)) {
      return saved;
    }
  } catch (e) {
    // ignore
  }
  return workspaces[0]?.workspace_id || INITIAL_SEED_WORKSPACES[0].workspace_id;
}

export interface WorkspaceStoreState {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string;
  selectedModel: ModelOption;
  
  // Optical Viewport State
  opticalMode: OpticalMode;
  focalArtifactIds: string[];
  tierOverrides: Record<string, ResolutionTier>;
  sidebarOpen: boolean;
  selectedInspectorArtifactId: string | null;

  // Actions
  setActiveWorkspace: (id: string) => void;
  createWorkspace: (name: string, description: string, color?: string) => string;
  deleteWorkspace: (id: string) => void;
  setSelectedModel: (model: ModelOption) => void;

  // Optical Controls
  setOpticalMode: (mode: OpticalMode) => void;
  setFocalArtifacts: (ids: string[]) => void;
  toggleFocalArtifact: (id: string) => void;
  setTierOverride: (artifactId: string, tier: ResolutionTier | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setSelectedInspectorArtifactId: (id: string | null) => void;

  // Artifact Management
  addArtifact: (artifact: Artifact) => void;
  updateArtifact: (id: string, updates: Partial<Artifact>) => void;
  createArtifactRevision: (
    id: string,
    content: MultiResolutionContent,
    authorNote?: string
  ) => void;
  addRelation: (sourceId: string, relation: ArtifactRelation) => void;
  removeRelation: (sourceId: string, targetId: string) => void;

  // Chapter Management (Single-Turn & Provenance)
  addTurnToActiveChapter: (turn: Turn) => void;
  splitChapter: (
    splitTurnIndex: number,
    newChapterTitle: string,
    closedChapterSummary?: Partial<MultiResolutionContent>
  ) => string;
  recalibrateChapter: (
    chapterId: string,
    updatedContent: Partial<MultiResolutionContent>
  ) => void;

  // Selectors & Graph Computation
  getActiveWorkspace: () => WorkspaceState;
  getActiveChapter: () => ChapterArtifact | undefined;
  getArtifact: (id: string) => (Artifact | ChapterArtifact) | undefined;
  getAllArtifacts: () => (Artifact | ChapterArtifact)[];
  getDocumentArtifacts: () => Artifact[];
  getChapterArtifacts: () => ChapterArtifact[];
  computeGraphDistance: (targetId: string, focalIds: string[]) => number;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => {
  const initialWorkspaces = loadStoredWorkspaces();
  const initialActiveId = loadStoredActiveId(initialWorkspaces);

  const saveToStorage = (workspaces: WorkspaceState[], activeId: string) => {
    try {
      localStorage.setItem(STORAGE_WORKSPACES_KEY, JSON.stringify(workspaces));
      localStorage.setItem(STORAGE_ACTIVE_ID_KEY, activeId);
    } catch (e) {
      console.warn('Failed to persist workspaces to localStorage:', e);
    }
  };

  return {
    workspaces: initialWorkspaces,
    activeWorkspaceId: initialActiveId,
    selectedModel: AVAILABLE_MODELS[1], // Gemini 3.8 Flash
    opticalMode: 'autofocus',
    focalArtifactIds: ['chap-combat-kinematics'],
    tierOverrides: {},
    sidebarOpen: false,
    selectedInspectorArtifactId: null,

    setActiveWorkspace: (id: string) => {
      set({ activeWorkspaceId: id });
      const ws = get().workspaces.find((w) => w.workspace_id === id);
      if (ws) {
        set({
          focalArtifactIds: ws.focal_artifact_ids.length > 0
            ? ws.focal_artifact_ids
            : [ws.active_chapter_id],
          opticalMode: ws.optical_mode || 'autofocus',
          tierOverrides: ws.tier_overrides || {},
        });
      }
      saveToStorage(get().workspaces, id);
    },

    createWorkspace: (name: string, description: string, color = '#e05a66') => {
      const newWsId = `ws-${Date.now()}`;
      const firstChapId = `chap-init-${Date.now()}`;

      const initialChapter: ChapterArtifact = {
        id: firstChapId,
        workspace_id: newWsId,
        type: 'chapter',
        status: 'active',
        created_at: Date.now(),
        updated_at: Date.now(),
        current: createSeedMultiResolution(
          'Architectural Foundations',
          `Initial architectural session for ${name}.`,
          ['Establish domain invariants, boundaries, and primary abstractions.'],
          `# Architectural Foundations\nWelcome to ${name}. All discussion here crystallizes into revision-controlled artifacts.`
        ),
        revisions: [],
        relations: [],
        provenance: {
          origin_chapter_id: firstChapId,
          mutation_chapter_ids: [],
        },
        turns: [
          {
            id: `turn-init-${Date.now()}`,
            role: 'assistant',
            timestamp: Date.now(),
            content: `Welcome to **${name}**! This workspace uses the Optical Context Engine.\n\nEvery turn is evaluated against the living knowledge graph. What core system or architecture shall we design first?`,
          },
        ],
      };

      const newWorkspace: WorkspaceState = {
        workspace_id: newWsId,
        name,
        description,
        color,
        created_at: Date.now(),
        updated_at: Date.now(),
        active_chapter_id: firstChapId,
        focal_artifact_ids: [firstChapId],
        optical_mode: 'autofocus',
        tier_overrides: {},
        artifacts: {
          [firstChapId]: initialChapter,
        },
      };

      const updatedWorkspaces = [...get().workspaces, newWorkspace];
      set({
        workspaces: updatedWorkspaces,
        activeWorkspaceId: newWsId,
        focalArtifactIds: [firstChapId],
      });
      saveToStorage(updatedWorkspaces, newWsId);
      return newWsId;
    },

    deleteWorkspace: (id: string) => {
      const remaining = get().workspaces.filter((w) => w.workspace_id !== id);
      if (remaining.length === 0) return;
      const nextActiveId = remaining[0].workspace_id;
      set({
        workspaces: remaining,
        activeWorkspaceId: nextActiveId,
      });
      saveToStorage(remaining, nextActiveId);
    },

    setSelectedModel: (model: ModelOption) => {
      set({ selectedModel: model });
    },

    setOpticalMode: (mode: OpticalMode) => {
      set({ opticalMode: mode });
      // persist mode in active workspace
      const activeId = get().activeWorkspaceId;
      set((state) => ({
        workspaces: state.workspaces.map((w) =>
          w.workspace_id === activeId ? { ...w, optical_mode: mode } : w
        ),
      }));
      saveToStorage(get().workspaces, activeId);
    },

    setFocalArtifacts: (ids: string[]) => {
      set({ focalArtifactIds: ids });
      const activeId = get().activeWorkspaceId;
      set((state) => ({
        workspaces: state.workspaces.map((w) =>
          w.workspace_id === activeId ? { ...w, focal_artifact_ids: ids } : w
        ),
      }));
      saveToStorage(get().workspaces, activeId);
    },

    toggleFocalArtifact: (id: string) => {
      const current = get().focalArtifactIds;
      const exists = current.includes(id);
      const updated = exists ? current.filter((x) => x !== id) : [...current, id];
      const nextIds = updated.length === 0 ? [get().getActiveWorkspace().active_chapter_id] : updated;
      get().setFocalArtifacts(nextIds);
    },

    setTierOverride: (artifactId: string, tier: ResolutionTier | null) => {
      set((state) => {
        const nextOverrides = { ...state.tierOverrides };
        if (tier === null) {
          delete nextOverrides[artifactId];
        } else {
          nextOverrides[artifactId] = tier;
        }
        const activeId = state.activeWorkspaceId;
        const updatedWorkspaces = state.workspaces.map((w) =>
          w.workspace_id === activeId ? { ...w, tier_overrides: nextOverrides } : w
        );
        saveToStorage(updatedWorkspaces, activeId);
        return {
          tierOverrides: nextOverrides,
          workspaces: updatedWorkspaces,
        };
      });
    },

    setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),

    setSelectedInspectorArtifactId: (id: string | null) =>
      set({ selectedInspectorArtifactId: id }),

    addArtifact: (artifact: Artifact) => {
      const activeId = get().activeWorkspaceId;
      set((state) => {
        const updatedWorkspaces = state.workspaces.map((w) => {
          if (w.workspace_id !== activeId) return w;
          return {
            ...w,
            updated_at: Date.now(),
            artifacts: {
              ...w.artifacts,
              [artifact.id]: artifact,
            },
          };
        });
        saveToStorage(updatedWorkspaces, activeId);
        return { workspaces: updatedWorkspaces };
      });
    },

    updateArtifact: (id: string, updates: Partial<Artifact>) => {
      const activeId = get().activeWorkspaceId;
      set((state) => {
        const updatedWorkspaces = state.workspaces.map((w) => {
          if (w.workspace_id !== activeId) return w;
          const existing = w.artifacts[id];
          if (!existing) return w;
          const updated = {
            ...existing,
            ...updates,
            updated_at: Date.now(),
          } as Artifact;
          return {
            ...w,
            updated_at: Date.now(),
            artifacts: {
              ...w.artifacts,
              [id]: updated,
            },
          };
        });
        saveToStorage(updatedWorkspaces, activeId);
        return { workspaces: updatedWorkspaces };
      });
    },

    createArtifactRevision: (
      id: string,
      content: MultiResolutionContent,
      authorNote?: string
    ) => {
      const activeId = get().activeWorkspaceId;
      set((state) => {
        const updatedWorkspaces = state.workspaces.map((w) => {
          if (w.workspace_id !== activeId) return w;
          const existing = w.artifacts[id];
          if (!existing) return w;

          const newRev: ArtifactRevision = {
            revision_id: `rev-${Date.now()}`,
            timestamp: Date.now(),
            content,
            author_note: authorNote,
          };

          const updated = {
            ...existing,
            updated_at: Date.now(),
            current: content,
            revisions: [newRev, ...existing.revisions],
          } as Artifact;

          return {
            ...w,
            updated_at: Date.now(),
            artifacts: {
              ...w.artifacts,
              [id]: updated,
            },
          };
        });
        saveToStorage(updatedWorkspaces, activeId);
        return { workspaces: updatedWorkspaces };
      });
    },

    addRelation: (sourceId: string, relation: ArtifactRelation) => {
      const activeId = get().activeWorkspaceId;
      set((state) => {
        const updatedWorkspaces = state.workspaces.map((w) => {
          if (w.workspace_id !== activeId) return w;
          const existing = w.artifacts[sourceId];
          if (!existing) return w;

          const existingRelations = existing.relations || [];
          const exists = existingRelations.some(
            (r) => r.target_artifact_id === relation.target_artifact_id && r.kind === relation.kind
          );
          if (exists) return w;

          const updated = {
            ...existing,
            relations: [...existingRelations, relation],
          } as Artifact;

          return {
            ...w,
            artifacts: {
              ...w.artifacts,
              [sourceId]: updated,
            },
          };
        });
        saveToStorage(updatedWorkspaces, activeId);
        return { workspaces: updatedWorkspaces };
      });
    },

    removeRelation: (sourceId: string, targetId: string) => {
      const activeId = get().activeWorkspaceId;
      set((state) => {
        const updatedWorkspaces = state.workspaces.map((w) => {
          if (w.workspace_id !== activeId) return w;
          const existing = w.artifacts[sourceId];
          if (!existing) return w;

          const updated = {
            ...existing,
            relations: (existing.relations || []).filter(
              (r) => r.target_artifact_id !== targetId
            ),
          } as Artifact;

          return {
            ...w,
            artifacts: {
              ...w.artifacts,
              [sourceId]: updated,
            },
          };
        });
        saveToStorage(updatedWorkspaces, activeId);
        return { workspaces: updatedWorkspaces };
      });
    },

    addTurnToActiveChapter: (turn: Turn) => {
      const activeId = get().activeWorkspaceId;
      const ws = get().getActiveWorkspace();
      const chapId = ws.active_chapter_id;

      set((state) => {
        const updatedWorkspaces = state.workspaces.map((w) => {
          if (w.workspace_id !== activeId) return w;
          const chap = w.artifacts[chapId] as ChapterArtifact | undefined;
          if (!chap || chap.type !== 'chapter') return w;

          const nextTurns = [...chap.turns, turn];
          const updatedChap: ChapterArtifact = {
            ...chap,
            turns: nextTurns,
            updated_at: Date.now(),
            current: {
              ...chap.current,
              t3_body: nextTurns.map((t) => `**${t.role.toUpperCase()}**: ${t.content}`).join('\n\n'),
            },
          };

          return {
            ...w,
            updated_at: Date.now(),
            artifacts: {
              ...w.artifacts,
              [chapId]: updatedChap,
            },
          };
        });
        saveToStorage(updatedWorkspaces, activeId);
        return { workspaces: updatedWorkspaces };
      });
    },

    splitChapter: (
      splitTurnIndex: number,
      newChapterTitle: string,
      closedSummary?: Partial<MultiResolutionContent>
    ) => {
      const activeId = get().activeWorkspaceId;
      const ws = get().getActiveWorkspace();
      const oldChapId = ws.active_chapter_id;
      const oldChap = ws.artifacts[oldChapId] as ChapterArtifact | undefined;
      if (!oldChap || oldChap.type !== 'chapter') return oldChapId;

      const turnsToKeepInOld = oldChap.turns.slice(0, splitTurnIndex);
      const turnsToMoveToNew = oldChap.turns.slice(splitTurnIndex);

      const newChapId = `chap-${Date.now()}`;

      // Update old chapter to closed with frozen summary
      const closedOldChap: ChapterArtifact = {
        ...oldChap,
        status: 'closed',
        updated_at: Date.now(),
        turns: turnsToKeepInOld,
        current: {
          ...oldChap.current,
          ...(closedSummary || {}),
          t3_body: turnsToKeepInOld.map((t) => `**${t.role.toUpperCase()}**: ${t.content}`).join('\n\n'),
        },
      };

      // Create new active chapter inheriting turns
      const newActiveChap: ChapterArtifact = {
        id: newChapId,
        workspace_id: activeId,
        type: 'chapter',
        status: 'active',
        created_at: Date.now(),
        updated_at: Date.now(),
        current: createSeedMultiResolution(
          newChapterTitle,
          `Topic shift to: ${newChapterTitle}`,
          ['Continuing ideation thread branching from ' + oldChap.current.t0_label],
          turnsToMoveToNew.map((t) => `**${t.role.toUpperCase()}**: ${t.content}`).join('\n\n')
        ),
        revisions: [],
        relations: [
          { target_artifact_id: oldChapId, kind: 'born_from' },
        ],
        provenance: {
          origin_chapter_id: newChapId,
          mutation_chapter_ids: [],
        },
        turns: turnsToMoveToNew,
      };

      set((state) => {
        const updatedWorkspaces = state.workspaces.map((w) => {
          if (w.workspace_id !== activeId) return w;
          return {
            ...w,
            updated_at: Date.now(),
            active_chapter_id: newChapId,
            focal_artifact_ids: [newChapId],
            artifacts: {
              ...w.artifacts,
              [oldChapId]: closedOldChap,
              [newChapId]: newActiveChap,
            },
          };
        });
        saveToStorage(updatedWorkspaces, activeId);
        return {
          workspaces: updatedWorkspaces,
          focalArtifactIds: [newChapId],
        };
      });

      return newChapId;
    },

    recalibrateChapter: (
      chapterId: string,
      updatedContent: Partial<MultiResolutionContent>
    ) => {
      const activeId = get().activeWorkspaceId;
      set((state) => {
        const updatedWorkspaces = state.workspaces.map((w) => {
          if (w.workspace_id !== activeId) return w;
          const target = w.artifacts[chapterId];
          if (!target) return w;

          const updated: Artifact = {
            ...target,
            updated_at: Date.now(),
            current: {
              ...target.current,
              ...updatedContent,
            },
          };

          return {
            ...w,
            artifacts: {
              ...w.artifacts,
              [chapterId]: updated,
            },
          };
        });
        saveToStorage(updatedWorkspaces, activeId);
        return { workspaces: updatedWorkspaces };
      });
    },

    getActiveWorkspace: () => {
      const { workspaces, activeWorkspaceId } = get();
      return (
        workspaces.find((w) => w.workspace_id === activeWorkspaceId) ||
        workspaces[0] ||
        INITIAL_SEED_WORKSPACES[0]
      );
    },

    getActiveChapter: () => {
      const ws = get().getActiveWorkspace();
      const chap = ws.artifacts[ws.active_chapter_id];
      if (chap && chap.type === 'chapter') {
        return chap as ChapterArtifact;
      }
      return undefined;
    },

    getArtifact: (id: string) => {
      const ws = get().getActiveWorkspace();
      return ws.artifacts[id];
    },

    getAllArtifacts: () => {
      const ws = get().getActiveWorkspace();
      return Object.values(ws.artifacts);
    },

    getDocumentArtifacts: () => {
      const ws = get().getActiveWorkspace();
      return Object.values(ws.artifacts).filter((a) => a.type === 'document');
    },

    getChapterArtifacts: () => {
      const ws = get().getActiveWorkspace();
      return Object.values(ws.artifacts).filter(
        (a): a is ChapterArtifact => a.type === 'chapter'
      );
    },

    computeGraphDistance: (targetId: string, focalIds: string[]) => {
      if (focalIds.includes(targetId)) return 0;
      const ws = get().getActiveWorkspace();

      // BFS traversal across relations
      const visited = new Set<string>();
      const queue: Array<{ id: string; distance: number }> = focalIds.map((id) => ({
        id,
        distance: 0,
      }));
      focalIds.forEach((id) => visited.add(id));

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.id === targetId) return current.distance;
        if (current.distance >= 4) continue; // max 4 hops

        const art = ws.artifacts[current.id];
        if (!art) continue;

        // Neighbor IDs: outgoing relations
        const neighbors: string[] = [];
        if (art.relations) {
          art.relations.forEach((r) => neighbors.push(r.target_artifact_id));
        }
        // Also check incoming relations from other artifacts
        Object.values(ws.artifacts).forEach((other) => {
          if (other.relations?.some((r) => r.target_artifact_id === current.id)) {
            neighbors.push(other.id);
          }
        });

        for (const nId of neighbors) {
          if (!visited.has(nId)) {
            visited.add(nId);
            queue.push({ id: nId, distance: current.distance + 1 });
          }
        }
      }

      return 999; // unreachable within graph
    },
  };
});
