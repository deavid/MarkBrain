/**
 * Core journey suite (the honest survivors).
 *
 * 2026-10-18 purge — see design-docs/05_CLEANSE_DECISIONS.md:
 * Journeys 5, 6, 7, 9 were tautologies (test-local reimplementations of App
 * logic / constructor roundtrips) and were deleted. Journey 3 was misnamed
 * and renamed. What remains: J1 timeline smoke, J2 parser (load-bearing),
 * J3 abort-before-dispatch contract, J4 chapter seal (load-bearing),
 * J8 workspace load smoke.
 */
import { describe, it, expect, vi } from 'vitest';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline/DialogueTimelineDomain';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation/ChapterSegmentationDomain';
import { StreamProtocolDomain } from '../domains/03-stream-protocol';
import { WorkspaceDomain } from '../domains/00-workspace';

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
  // JOURNEY 3: Abort before dispatch (honest name — this does NOT test
  // mid-stream partial-text preservation; that test doesn't exist yet)
  // ---------------------------------------------------------------------------
  describe('Journey 3: Abort before dispatch returns stub result', () => {
    it('returns a stub result with estimated tokens when aborted before fetch', async () => {
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

      // Invariant: abort-before-fetch returns a stub with estimated telemetry, never throws
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
  // JOURNEY 8: Workspace Domain Cloud Project Isolation & Loading
  // ---------------------------------------------------------------------------
  describe('Journey 8: Workspace Domain Cloud Project Isolation & Loading', () => {
    it('clears all projects when cloud has zero projects, and mounts user projects dynamically', () => {
      const ws = new WorkspaceDomain();

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

});
