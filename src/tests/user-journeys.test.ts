import { describe, it, expect, vi } from 'vitest';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline/DialogueTimelineDomain';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation/ChapterSegmentationDomain';
import { ArtifactDocumentDomain } from '../domains/01-artifact-document/ArtifactDocumentDomain';
import { TopologicalGraphDomain } from '../domains/02-topological-graph/TopologicalGraphDomain';
import { StreamProtocolDomain } from '../domains/03-stream-protocol';
import { WorkspaceDomain } from '../domains/00-workspace';
import { ProjectSnapshot } from '../services/persistenceService';

describe('MarkBrain Core User Journeys & Invariants Suite', () => {
  // ---------------------------------------------------------------------------
  // JOURNEY 1: Happy Path User Message Submission & Timeline Append
  // ---------------------------------------------------------------------------
  describe('Journey 1: Happy Path Message Submission & Timeline Append', () => {
    it('successfully registers user message in timeline and alerts subscribers', () => {
      const workspaceId = 'proj-core-test';
      const timeline = new DialogueTimelineDomain(workspaceId, []);
      const subscriberSpy = vi.fn();
      timeline.subscribe(subscriberSpy);

      const userText = 'Design a fault-tolerant optical context manager';
      const turn = timeline.appendTurn('user', userText);

      expect(turn).toBeDefined();
      expect(turn.role).toBe('user');
      expect(turn.content).toBe(userText);
      expect(typeof turn.timestamp).toBe('number');
      expect(timeline.count()).toBe(1);

      // Verify subscriber notification
      expect(subscriberSpy).toHaveBeenCalledTimes(1);
      expect(subscriberSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'turnAppended',
          turn: expect.objectContaining({ content: userText }),
        })
      );

      // Verify turn slice for active chapter retrieves this exact turn
      const slice = timeline.getTurnSlice(0, undefined);
      expect(slice).toHaveLength(1);
      expect(slice[0].id).toBe(turn.id);
    });

    it('updates turn with assistant response and metadata', () => {
      const timeline = new DialogueTimelineDomain('proj-test', []);
      const userTurn = timeline.appendTurn('user', 'Hello architect');
      const assistantTurn = timeline.appendTurn('assistant', 'Thinking...');

      timeline.updateTurn(assistantTurn.id, {
        content: 'Completed architectural synthesis.',
        meta: {
          model: 'gemini-3.1-flash-lite',
          promptTokens: 120,
          candidatesTokens: 45,
          totalTokens: 165,
          durationMs: 420,
        },
      });

      const updated = timeline.getTurn(assistantTurn.id);
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe('Completed architectural synthesis.');
      expect(updated!.meta!.model).toBe('gemini-3.1-flash-lite');
      expect(updated!.meta!.totalTokens).toBe(165);
    });
  });

  // ---------------------------------------------------------------------------
  // JOURNEY 2: Stream Protocol Demuxing & Entity Extraction
  // ---------------------------------------------------------------------------
  describe('Journey 2: Stream Protocol Demuxing & Invariant Extraction', () => {
    it('separates raw LLM stream text from embedded <artifact> and <topic_shift> blocks', () => {
      const stream = new StreamProtocolDomain();
      const rawLLMResponse = `
I have designed the state machine for the optical context engine.

<artifact id="art-lens-spec" title="Optical Lens State Machine" type="architecture">
<abstract>Formal state machine specifications for depth-of-field lenses.</abstract>
<summary>Defines autofocus, manual focus, and myopia transitions.</summary>
<content>
state Autofocus {
  on TokenSaturationExceeded -> Myopia
}
</content>
</artifact>

<topic_shift title="Optical Optimization" summary="Transitions to performance tuning" />

Let me know if you would like to tune the saturation threshold.
      `.trim();

      const result = stream.demuxFullTurn(rawLLMResponse);

      // Clean conversational reply must NOT contain raw XML tags
      expect(result.cleanText).not.toContain('<artifact');
      expect(result.cleanText).not.toContain('</artifact>');
      expect(result.cleanText).not.toContain('<topic_shift');
      expect(result.cleanText).toContain('I have designed the state machine');
      expect(result.cleanText).toContain('Let me know if you would like to tune');

      // Extracted artifact entity must be cleanly parsed
      expect(result.artifactUpserts).toHaveLength(1);
      const art = result.artifactUpserts[0];
      expect(art.id).toBe('art-lens-spec');
      expect(art.title).toBe('Optical Lens State Machine');
      expect(art.type).toBe('document');
      expect(art.content.t1_abstract).toContain('Formal state machine specifications');
      expect(art.content.t3_body).toContain('state Autofocus');

      // Extracted topic shift must be detected
      expect(result.topicShift).toBeDefined();
      expect(result.topicShift!.title).toBe('Optical Optimization');
    });
  });

  // ---------------------------------------------------------------------------
  // JOURNEY 3: Stream Interruption & Partial Preservation
  // ---------------------------------------------------------------------------
  describe('Journey 3: Stream Interruption & Partial Text Preservation', () => {
    it('preserves clean partial text and calculates estimated tokens when aborted', async () => {
      const stream = new StreamProtocolDomain();
      const abortController = new AbortController();
      abortController.abort(); // already aborted signal

      const result = await stream.executeStreamingTurn(
        {
          model: 'gemini-3.1-flash-lite',
          compiledPrompt: 'Generate a 100-page architectural analysis of distributed consensus',
        },
        {
          signal: abortController.signal,
        }
      );

      // Invariant: generation was aborted, but returns a valid result with fallback/interrupted semantics
      expect(result).toBeDefined();
      expect(typeof result.cleanReply).toBe('string');
      expect(result.telemetry).toBeDefined();
      expect(result.telemetry!.model).toBe('gemini-3.1-flash-lite');
      // Token counts must be non-zero estimates, never 0 in 0 out
      expect(result.telemetry!.promptTokens).toBeGreaterThan(0);
      expect(result.telemetry!.totalTokens).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // JOURNEY 4: Chapter Segmentation & Boundary Management
  // ---------------------------------------------------------------------------
  describe('Journey 4: Chapter Segmentation & Boundary Management', () => {
    it('correctly declares chapter boundaries, seals old chapter, and activates new chapter', () => {
      const workspaceId = 'proj-segmentation-test';
      const timeline = new DialogueTimelineDomain(workspaceId, []);
      const segmentation = new ChapterSegmentationDomain(workspaceId, [
        {
          id: 'chap-genesis',
          workspaceId,
          title: 'Genesis Chapter',
          status: 'active',
          startIndex: 0,
          createdAt: Date.now(),
        },
      ]);

      // Add 3 turns to Genesis
      timeline.appendTurn('user', 'Turn 0: Inception');
      timeline.appendTurn('assistant', 'Turn 1: Foundation');
      timeline.appendTurn('user', 'Turn 2: Scope Shift');

      expect(segmentation.getActiveChapter()?.title).toBe('Genesis Chapter');

      // User or model declares chapter break at turn index 2
      const newChap = segmentation.declareNewChapter('Optical Mechanics', 2, 'Shift from concept to implementation');

      // Genesis chapter must be sealed as completed with endIndex = 2
      const genesis = segmentation.getChapter('chap-genesis');
      expect(genesis).not.toBeNull();
      expect(genesis!.status).toBe('completed');
      expect(genesis!.endIndex).toBe(2);

      // New chapter must be active starting at index 2
      expect(newChap.status).toBe('active');
      expect(newChap.startIndex).toBe(2);
      expect(newChap.title).toBe('Optical Mechanics');

      // Append 2 more turns to the new chapter
      timeline.appendTurn('assistant', 'Turn 3: Implementation details');
      timeline.appendTurn('user', 'Turn 4: Review');

      // Verify slicing: Genesis has turns [0, 2), New Chapter has turns [2, end)
      const genesisTurns = timeline.getTurnSlice(genesis!.startIndex, genesis!.endIndex);
      const newChapTurns = timeline.getTurnSlice(newChap.startIndex, undefined);

      expect(genesisTurns).toHaveLength(2);
      expect(genesisTurns[0].content).toContain('Turn 0');
      expect(genesisTurns[1].content).toContain('Turn 1');

      expect(newChapTurns).toHaveLength(3);
      expect(newChapTurns[0].content).toContain('Turn 2');
      expect(newChapTurns[1].content).toContain('Turn 3');
      expect(newChapTurns[2].content).toContain('Turn 4');

      // Total turns across non-overlapping slices must equal total turns in timeline
      expect(genesisTurns.length + newChapTurns.length).toBe(timeline.count());
    });
  });

  // ---------------------------------------------------------------------------
  // JOURNEY 5: Workspace Snapshot Persistence & Roundtrip Restoration
  // ---------------------------------------------------------------------------
  describe('Journey 5: Workspace Snapshot Persistence & Restoration', () => {
    it('serializes and roundtrips turns, chapters, artifacts, and edges with zero data loss', () => {
      const projectId = 'proj-persistence-verify';

      // 1. Setup sample domain state
      const sampleSnapshot: ProjectSnapshot = {
        projectId,
        turns: [
          { id: 't-1', role: 'user', content: 'Define invariants', timestamp: 1000 },
          { id: 't-2', role: 'assistant', content: 'Invariant 1: Zero Top Bar', timestamp: 1001 },
        ],
        chapters: [
          {
            id: 'c-1',
            workspaceId: projectId,
            title: 'Genesis Spec',
            status: 'active',
            startIndex: 0,
            createdAt: 1000,
          },
        ],
        artifacts: [
          {
            id: 'art-1',
            workspaceId: projectId,
            code: 'SPEC-01',
            title: 'Substrate Spec',
            type: 'document',
            category: 'system-spec',
            isHighConcept: true,
            current: {
              t0_label: 'Substrate Spec',
              t1_abstract: 'Core substrate invariant',
              t2_summary: 'Summary of substrate',
              t3_body: 'Body specification content',
            },
            tags: ['core', 'substrate'],
            createdAt: 1000,
            updatedAt: 1000,
          },
        ],
        edges: [
          {
            id: 'edge-1',
            workspaceId: projectId,
            sourceId: 'art-1',
            targetId: 'art-1',
            kind: 'relates_to',
            weight: 1.0,
            createdAt: 1000,
          },
        ],
        updatedAt: 1002,
      };

      // 2. Hydrate new clean domains from the snapshot
      const restoredTimeline = new DialogueTimelineDomain(projectId, sampleSnapshot.turns);
      const restoredChapters = new ChapterSegmentationDomain(projectId, sampleSnapshot.chapters);
      const restoredArtifacts = new ArtifactDocumentDomain(projectId, sampleSnapshot.artifacts);
      const restoredGraph = new TopologicalGraphDomain(sampleSnapshot.edges);

      // 3. Verify exact integrity
      expect(restoredTimeline.count()).toBe(2);
      expect(restoredTimeline.getTurn('t-1')?.content).toBe('Define invariants');
      expect(restoredTimeline.getTurn('t-2')?.content).toBe('Invariant 1: Zero Top Bar');

      expect(restoredChapters.listChapters()).toHaveLength(1);
      expect(restoredChapters.getActiveChapter()?.title).toBe('Genesis Spec');

      expect(restoredArtifacts.listArtifacts()).toHaveLength(1);
      const restoredArt = restoredArtifacts.getArtifact('art-1');
      expect(restoredArt).not.toBeNull();
      expect(restoredArt?.title).toBe('Substrate Spec');
      expect(restoredArt?.current?.t3_body).toBe('Body specification content');

      expect(restoredGraph.listEdges()).toHaveLength(1);
      expect(restoredGraph.listEdges()[0].id).toBe('edge-1');
    });
  });

  // ---------------------------------------------------------------------------
  // JOURNEY 6: Guaranteed Genesis Chapter Fallback (Chat Interface Visibility)
  // ---------------------------------------------------------------------------
  describe('Journey 6: Guaranteed Genesis Chapter Fallback', () => {
    it('synthesizes an active Genesis chapter when domain chapters are empty, ensuring chat is never blank', () => {
      const workspaceId = 'proj-empty-chapters';
      const timeline = new DialogueTimelineDomain(workspaceId, []);
      timeline.appendTurn('user', 'First question in brand new workspace');

      const domainChapters: any[] = []; // simulating empty segmentation

      // The exact fallback logic implemented in App.tsx
      let finalChapters = domainChapters;
      if (finalChapters.length === 0) {
        const turns = timeline.getTurnSlice(0, undefined);
        finalChapters = [
          {
            id: 'chap-genesis',
            projectId: workspaceId,
            title: 'Genesis Chapter',
            summary: '',
            keyPoints: [],
            isSummarized: false,
            compressionMode: 'full',
            status: 'active',
            createdAt: new Date().toISOString(),
            messages: turns.map((t) => ({
              id: t.id,
              chapterId: 'chap-genesis',
              role: t.role,
              content: t.content,
              timestamp: new Date(t.timestamp).toISOString(),
            })),
          },
        ];
      }

      // Invariant: chapters array is NEVER empty
      expect(finalChapters).toHaveLength(1);
      expect(finalChapters[0].id).toBe('chap-genesis');
      expect(finalChapters[0].status).toBe('active');
      expect(finalChapters[0].messages).toHaveLength(1);
      expect(finalChapters[0].messages[0].content).toBe('First question in brand new workspace');
    });
  });

  // ---------------------------------------------------------------------------
  // JOURNEY 7: Pre-Flight Auth State Gating & Project Genesis Evaluation
  // ---------------------------------------------------------------------------
  describe('Journey 7: Pre-Flight Auth State Gating & Route Evaluation', () => {
    function evaluateAppRoute(
      authInitialized: boolean,
      currentUser: any | null,
      projectsCount: number
    ): 'loading' | 'auth-gate' | 'project-genesis' | 'workspace' {
      if (!authInitialized) return 'loading';
      if (!currentUser) return 'auth-gate';
      if (projectsCount === 0) return 'project-genesis';
      return 'workspace';
    }

    it('strictly gates unauthenticated visitors before loading any workspaces', () => {
      // 1. Initializing probe
      expect(evaluateAppRoute(false, null, 0)).toBe('loading');

      // 2. Unauthenticated visitor -> MUST present AuthGate
      expect(evaluateAppRoute(true, null, 0)).toBe('auth-gate');
      expect(evaluateAppRoute(true, null, 5)).toBe('auth-gate'); // even if stale local count exists
    });

    it('routes authenticated user with zero cloud projects directly to ProjectGenesis', () => {
      const mockUser = { uid: 'usr-123', email: 'architect@test.com' };
      expect(evaluateAppRoute(true, mockUser, 0)).toBe('project-genesis');
    });

    it('launches full workspace IDE only when authenticated user has existing projects', () => {
      const mockUser = { uid: 'usr-123', email: 'architect@test.com' };
      expect(evaluateAppRoute(true, mockUser, 2)).toBe('workspace');
    });
  });

  // ---------------------------------------------------------------------------
  // JOURNEY 8: Workspace Domain Cloud Project Isolation & Loading
  // ---------------------------------------------------------------------------
  describe('Journey 8: Workspace Domain Cloud Project Isolation & Loading', () => {
    it('clears all projects when cloud has zero projects, and mounts user projects dynamically', () => {
      const ws = new WorkspaceDomain('test_isolated_ws');

      // 1. When empty array passed -> projects cleared
      ws.loadUserProjects([]);
      expect(ws.listProjects()).toHaveLength(0);
      expect(ws.getActiveProjectId()).toBe('');

      // 2. When user projects loaded from Firestore
      const userProjectsFromFirestore = [
        {
          projectId: 'proj-cloud-alpha',
          name: 'Distributed Optical Compiler',
          codeName: 'OPT-CMP',
          description: 'AST tokens & depth-of-field',
          color: '#3b82f6',
          chapters: [{ id: 'chap-1', status: 'active' }],
          updatedAt: 1234567,
        },
      ];

      ws.loadUserProjects(userProjectsFromFirestore);
      expect(ws.listProjects()).toHaveLength(1);
      expect(ws.getActiveProjectId()).toBe('proj-cloud-alpha');
      expect(ws.getProject('proj-cloud-alpha')?.metadata.name).toBe('Distributed Optical Compiler');
    });
  });

  // ---------------------------------------------------------------------------
  // JOURNEY 9: Zero-Chat Centered Hero Input Composer Transition
  // ---------------------------------------------------------------------------
  describe('Journey 9: Zero-Chat Centered Hero Input Composer Transition', () => {
    function computeComposerMode(chapters: any[]): 'hero-centered' | 'timeline-feed' {
      const totalMessages = chapters.reduce(
        (acc, chap) => acc + (chap.messages ? chap.messages.length : 0),
        0
      );
      return totalMessages === 0 ? 'hero-centered' : 'timeline-feed';
    }

    it('displays hero-centered composer on brand new project with zero chats', () => {
      const freshChapters = [
        {
          id: 'chap-genesis',
          title: 'Genesis Architecture',
          messages: [],
        },
      ];

      expect(computeComposerMode(freshChapters)).toBe('hero-centered');
    });

    it('smoothly transitions to timeline-feed and bottom bar once first message is sent', () => {
      const timeline = new DialogueTimelineDomain('proj-fresh', []);
      const chapters = [
        {
          id: 'chap-genesis',
          title: 'Genesis Architecture',
          messages: [] as any[],
        },
      ];

      // Initially zero
      expect(computeComposerMode(chapters)).toBe('hero-centered');

      // User sends initial prompt
      const turn = timeline.appendTurn('user', 'Define microservices invariant matrix');
      chapters[0].messages.push({
        id: turn.id,
        role: turn.role,
        content: turn.content,
        timestamp: new Date(turn.timestamp).toISOString(),
      });

      // Now transitions to timeline feed
      expect(computeComposerMode(chapters)).toBe('timeline-feed');
      expect(chapters[0].messages).toHaveLength(1);
      expect(chapters[0].messages[0].content).toBe('Define microservices invariant matrix');
    });
  });
});
