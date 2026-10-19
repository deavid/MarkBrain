/**
 * Attachments — the unit that carries granularity (per chat).
 *
 * Locks the rules David settled 2026-10-19: attach at Full, same artifact in
 * two chats can differ, re-attaching never resets a user's choice, no detach
 * exists, and artifact deletion garbage-collects dangling attachments.
 */
import { describe, it, expect } from 'vitest';
import { ThreadRegistry } from '../domains/06-chat-threads';

function registryWithTwoChats() {
  const registry = new ThreadRegistry();
  const a = registry.createThread({ title: 'Chat A' });
  const b = registry.createThread({ title: 'Chat B' });
  // createThread leaves the first created thread active; make it deterministic.
  registry.hydrate({
    projectId: 'p',
    threads: [
      { ...a, attachments: [] },
      { ...b, attachments: [] },
    ],
    turns: [],
    chapters: [],
    activeThreadId: a.id,
  });
  return { registry, a: a.id, b: b.id };
}

describe('attachments', () => {
  it('attaches at full by default and records attach order', () => {
    const { registry, a } = registryWithTwoChats();
    registry.attachArtifact(a, 'art-1');
    registry.attachArtifact(a, 'art-2');
    const list = registry.getAttachments(a);
    expect(list.map((x) => [x.artifactId, x.granularity])).toEqual([
      ['art-1', 'full'],
      ['art-2', 'full'],
    ]);
  });

  it('is idempotent — re-attaching keeps the granularity the user chose', () => {
    const { registry, a } = registryWithTwoChats();
    registry.attachArtifact(a, 'art-1', 'title');
    registry.attachArtifact(a, 'art-1', 'full');
    expect(registry.getAttachments(a)).toHaveLength(1);
    expect(registry.getAttachments(a)[0].granularity).toBe('title');
  });

  it('the same artifact can sit at different granularities in two chats', () => {
    const { registry, a, b } = registryWithTwoChats();
    registry.attachArtifact(a, 'art-1', 'title');
    registry.attachArtifact(b, 'art-1', 'full');
    expect(registry.getAttachments(a)[0].granularity).toBe('title');
    expect(registry.getAttachments(b)[0].granularity).toBe('full');
  });

  it('changing granularity touches only that chat', () => {
    const { registry, a, b } = registryWithTwoChats();
    registry.attachArtifact(a, 'art-1', 'full');
    registry.attachArtifact(b, 'art-1', 'full');
    registry.setAttachmentGranularity(a, 'art-1', 'summary');
    expect(registry.getAttachments(a)[0].granularity).toBe('summary');
    expect(registry.getAttachments(b)[0].granularity).toBe('full');
  });

  it('purging a deleted artifact drops the dangling attachment everywhere', () => {
    const { registry, a, b } = registryWithTwoChats();
    registry.attachArtifact(a, 'art-1');
    registry.attachArtifact(a, 'art-2');
    registry.attachArtifact(b, 'art-1');
    registry.purgeArtifact('art-1');
    expect(registry.getAttachments(a).map((x) => x.artifactId)).toEqual(['art-2']);
    expect(registry.getAttachments(b)).toHaveLength(0);
  });

  it('legacy snapshots (no attachments field) hydrate to an empty list', () => {
    const registry = new ThreadRegistry();
    registry.hydrate({
      projectId: 'p',
      threads: [
        {
          id: 'thread-old',
          folderId: null,
          title: 'Old',
          titleState: 'auto',
          titleVersion: 2,
          createdAt: 0,
          updatedAt: 0,
          lastActivityAt: 0,
          lifecycle: 'active',
          lastOutcome: 'ok',
          preview: '',
        } as any,
      ],
      turns: [],
      chapters: [],
      activeThreadId: 'thread-old',
    });
    expect(registry.getAttachments('thread-old')).toEqual([]);
  });

  it('unknown threads/artifacts never create half-formed attachments', () => {
    const { registry, a } = registryWithTwoChats();
    expect(registry.attachArtifact('nope', 'art-1')).toBeNull();
    expect(registry.attachArtifact(a, '')).toBeNull();
    expect(registry.getAttachments(a)).toHaveLength(0);
  });
});
