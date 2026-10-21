/**
 * Cleanup suite: the deletion law (pure planner), the artifact lifecycle flag,
 * and the purge cascade that must leave no dangling reference behind.
 */
import { describe, it, expect } from 'vitest';
import { planCleanup, planIsEmpty, blockingThreadIds } from '../application/cleanupPlan';
import { ThreadRegistry, makeNewThread, type ChatThread } from '../domains/06-chat-threads';
import { ArtifactDocumentDomain } from '../domains/01-artifact-document';
import type { UniversalArtifactDocument } from '../domains/01-artifact-document';
import { ArtifactVersioningDomain } from '../domains/01-artifact-versioning';
import { TopologicalGraphDomain } from '../domains/02-topological-graph';
import { purgeArtifact } from '../ui/artifacts/purgeArtifact';

const thread = (
  id: string,
  lifecycle: 'active' | 'archived',
  attached: string[] = []
): ChatThread =>
  makeNewThread({
    id,
    title: `thread ${id}`,
    lifecycle,
    attachments: attached.map((artifactId) => ({
      artifactId,
      granularity: 'full' as const,
      addedAt: 1,
      turnIndex: 0,
    })),
  });

const artifact = (
  id: string,
  lifecycle?: 'active' | 'archived'
): UniversalArtifactDocument => ({
  id,
  workspaceId: 'p1',
  code: id,
  title: `artifact ${id}`,
  type: 'document',
  category: 'note',
  isHighConcept: false,
  current: { description: '', summary: '', body: '' },
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  ...(lifecycle ? { lifecycle } : {}),
});

describe('cleanup planner — the deletion law', () => {
  it('deletes archived chats only', () => {
    const threads = [thread('t-arch', 'archived'), thread('t-live', 'active')];
    const plan = planCleanup({
      threadIds: ['t-arch', 't-live'],
      artifactIds: [],
      threads,
      artifacts: [],
      deleteReferencingArchivedChats: false,
    });
    expect(plan.threadsToDelete).toEqual(['t-arch']);
    expect(plan.skipped).toEqual([
      { kind: 'thread', id: 't-live', title: 'thread t-live', reason: 'not-archived' },
    ]);
  });

  it('refuses an active artifact and says why', () => {
    const plan = planCleanup({
      threadIds: [],
      artifactIds: ['a-live'],
      threads: [],
      artifacts: [artifact('a-live')],
      deleteReferencingArchivedChats: false,
    });
    expect(plan.artifactsToDelete).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ kind: 'artifact', reason: 'not-archived' });
  });

  it('deletes an archived artifact nobody points at', () => {
    const plan = planCleanup({
      threadIds: [],
      artifactIds: ['a1'],
      threads: [thread('t1', 'active')],
      artifacts: [artifact('a1', 'archived')],
      deleteReferencingArchivedChats: false,
    });
    expect(plan.artifactsToDelete).toEqual(['a1']);
    expect(plan.detach).toEqual([]);
  });

  it('blocks an artifact an ACTIVE chat still points at, and names the blockers', () => {
    const plan = planCleanup({
      threadIds: [],
      artifactIds: ['a1', 'a2'],
      threads: [thread('t1', 'active', ['a1']), thread('t2', 'active', ['a1'])],
      artifacts: [artifact('a1', 'archived'), artifact('a2', 'archived')],
      deleteReferencingArchivedChats: true,
    });
    expect(plan.artifactsToDelete).toEqual(['a2']);
    expect(plan.skipped[0]).toMatchObject({
      kind: 'artifact',
      id: 'a1',
      reason: 'referenced-by-active-chat',
      blockers: [
        { threadId: 't1', title: 'thread t1' },
        { threadId: 't2', title: 'thread t2' },
      ],
    });
    expect(blockingThreadIds(plan)).toEqual(['t1', 't2']);
  });

  it('detaches an archived chat by default instead of deleting it', () => {
    const plan = planCleanup({
      threadIds: [],
      artifactIds: ['a1'],
      threads: [thread('t1', 'archived', ['a1'])],
      artifacts: [artifact('a1', 'archived')],
      deleteReferencingArchivedChats: false,
    });
    expect(plan.artifactsToDelete).toEqual(['a1']);
    expect(plan.detach).toEqual([{ artifactId: 'a1', title: 'artifact a1', threadIds: ['t1'] }]);
    expect(plan.cascadeThreads).toEqual([]);
  });

  it('cascades into archived referencing chats when asked', () => {
    const plan = planCleanup({
      threadIds: [],
      artifactIds: ['a1'],
      threads: [thread('t1', 'archived', ['a1'])],
      artifacts: [artifact('a1', 'archived')],
      deleteReferencingArchivedChats: true,
    });
    expect(plan.detach).toEqual([]);
    expect(plan.cascadeThreads).toEqual(['t1']);
  });

  it('a chat dying in the same pass stops counting as a reference', () => {
    const plan = planCleanup({
      threadIds: ['t1'],
      artifactIds: ['a1'],
      threads: [thread('t1', 'archived', ['a1'])],
      artifacts: [artifact('a1', 'archived')],
      deleteReferencingArchivedChats: false,
    });
    expect(plan.threadsToDelete).toEqual(['t1']);
    expect(plan.artifactsToDelete).toEqual(['a1']);
    expect(plan.detach).toEqual([]);
    expect(plan.cascadeThreads).toEqual([]);
  });

  it('never lets the cascade re-list a chat that was already selected', () => {
    const plan = planCleanup({
      threadIds: ['t1'],
      artifactIds: ['a1'],
      threads: [thread('t1', 'archived', ['a1'])],
      artifacts: [artifact('a1', 'archived')],
      deleteReferencingArchivedChats: true,
    });
    expect(plan.cascadeThreads).toEqual([]);
  });

  it('skips unknown ids instead of throwing, and reports an empty plan', () => {
    const plan = planCleanup({
      threadIds: ['ghost'],
      artifactIds: ['ghost'],
      threads: [],
      artifacts: [],
      deleteReferencingArchivedChats: false,
    });
    expect(planIsEmpty(plan)).toBe(true);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['missing', 'missing']);
  });
});

describe('artifact lifecycle', () => {
  it('parks an artifact and keeps it parked through content edits', () => {
    const domain = new ArtifactDocumentDomain('p1');
    domain.upsertArtifact({ id: 'a1', title: 'First' });
    domain.setArtifactLifecycle('a1', 'archived');
    expect(domain.getArtifact('a1')?.lifecycle).toBe('archived');
    // The trap: every edit re-enters upsertArtifact, which rebuilds the object.
    domain.upsertArtifact({
      id: 'a1',
      title: 'Second',
      current: { description: '', summary: '', body: 'edited' },
    });
    expect(domain.getArtifact('a1')?.lifecycle).toBe('archived');
    expect(domain.getArtifact('a1')?.title).toBe('Second');
  });

  it('is a no-op for unknown ids, and unarchive returns to active', () => {
    const domain = new ArtifactDocumentDomain('p1');
    domain.setArtifactLifecycle('ghost', 'archived');
    expect(domain.getArtifact('ghost')).toBeNull();
    domain.upsertArtifact({ id: 'a1', title: 'A' });
    domain.setArtifactLifecycle('a1', 'archived');
    domain.setArtifactLifecycle('a1', 'active');
    expect(domain.getArtifact('a1')?.lifecycle).toBe('active');
  });
});

describe('purge cascade', () => {
  it('leaves no edge, attachment or revision pointing at the dead artifact', () => {
    const artifactsDomain = new ArtifactDocumentDomain('p1');
    const versioning = new ArtifactVersioningDomain();
    const graph = new TopologicalGraphDomain();
    const threadRegistry = new ThreadRegistry();

    artifactsDomain.upsertArtifact({ id: 'a1', title: 'Doomed' });
    artifactsDomain.upsertArtifact({ id: 'a2', title: 'Survivor' });
    artifactsDomain.upsertArtifact({
      id: 'a3',
      title: 'Pointer',
      graph: { relationships: [{ target: 'a1', type: 'depends_on' }, { target: 'a2', type: 'bridges' }] },
    });
    graph.addEdge('a1', 'a2', 'related');
    graph.addEdge('a2', 'a3', 'related');
    versioning.recordRevision('a1', 'body', 'initial');
    threadRegistry.hydrate({
      projectId: 'p1',
      activeThreadId: 't1',
      threads: [thread('t1', 'active', ['a1', 'a2']), thread('t2', 'archived', ['a1'])],
    });

    purgeArtifact({ artifactsDomain, versioning, graph, threadRegistry }, 'a1');

    expect(artifactsDomain.getArtifact('a1')).toBeNull();
    expect(artifactsDomain.getArtifact('a3')?.graph?.relationships).toEqual([
      { target: 'a2', type: 'bridges' },
    ]);
    expect(graph.listEdges().map((e) => e.id)).toHaveLength(1);
    expect(graph.getNeighbors('a1')).toEqual([]);
    expect(versioning.getHistory('a1')).toEqual([]);
    expect(threadRegistry.getAttachments('t1').map((a) => a.artifactId)).toEqual(['a2']);
    expect(threadRegistry.getAttachments('t2')).toEqual([]);
  });
});
