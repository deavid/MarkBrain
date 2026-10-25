/**
 * Attachments — the unit that carries granularity (per chat).
 *
 * The rules: attach at Full by default, the same artifact can sit at different
 * cuts in two chats, re-attaching never resets a user's choice, there is no
 * detach, and deleting an artifact garbage-collects its dangling attachments.
 */
import { describe, it, expect } from 'vitest';
import { ThreadRegistry, reconcileThreadAttachments } from '../domains/06-chat-threads';
import type { ChatAttachment } from '../domains/06-chat-threads/types';

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

/**
 * The timeline half (design-docs/10_ATTACHMENT_TIMELINE.md): staged → committed.
 * You can unstage; you cannot unsend. The dot verb cycles when committed.
 */
describe('attachment timeline (staged → committed)', () => {
  it('staging is reversible and never reaches the committed set', () => {
    const { registry, a } = registryWithTwoChats();
    registry.stageArtifact(a, 'art-1');
    expect(registry.getStagedAttachments(a).map((x) => x.artifactId)).toEqual(['art-1']);
    expect(registry.unstageArtifact(a, 'art-1')).toBe(true);
    expect(registry.getStagedAttachments(a)).toHaveLength(0);
  });

  it('committing welds every staged item to the turn and empties the staged set', () => {
    const { registry, a } = registryWithTwoChats();
    registry.stageArtifact(a, 'art-1');
    registry.stageArtifact(a, 'art-2');
    const n = registry.commitStagedAttachments(a, 3, 'turn-3');
    expect(n).toBe(2);
    expect(registry.getStagedAttachments(a)).toHaveLength(0);
    const committed = registry.getAttachments(a);
    expect(committed.every((x) => x.turnIndex === 3 && x.turnId === 'turn-3')).toBe(true);
  });

  it('commitAttachment welds ONE staged entry (VPS delta mirror); committed entries are untouched', () => {
    const { registry, a } = registryWithTwoChats();
    registry.stageArtifact(a, 'art-1');
    registry.attachArtifact(a, 'art-2', 'full', 0, 'turn-0'); // already committed

    expect(registry.commitAttachment(a, 'art-1', 5, 'turn-5')).toBe(true);
    expect(registry.getStagedAttachments(a)).toHaveLength(0);
    const att1 = registry.getAttachments(a).find((x) => x.artifactId === 'art-1')!;
    expect(att1.turnIndex).toBe(5);
    expect(att1.turnId).toBe('turn-5');
    // The committed neighbor keeps its own provenance.
    const att2 = registry.getAttachments(a).find((x) => x.artifactId === 'art-2')!;
    expect(att2.turnIndex).toBe(0);
    expect(att2.turnId).toBe('turn-0');

    // Unknown artifact / unknown thread / already-committed → no-op.
    expect(registry.commitAttachment(a, 'art-ghost', 6, 'turn-6')).toBe(false);
    expect(registry.commitAttachment(a, 'art-2', 6, 'turn-6')).toBe(false);
    expect(registry.commitAttachment('thread-nope', 'art-1', 6, 'turn-6')).toBe(false);
  });

  it('unstage on a committed attachment is a no-op — history has no delete key', () => {
    const { registry, a } = registryWithTwoChats();
    registry.attachArtifact(a, 'art-1', 'full', 0, 'turn-0');
    expect(registry.unstageArtifact(a, 'art-1')).toBe(false);
    expect(registry.getAttachments(a)).toHaveLength(1);
  });

  it('granularity stays steerable after commit', () => {
    const { registry, a } = registryWithTwoChats();
    registry.attachArtifact(a, 'art-1', 'full', 2, 'turn-2');
    registry.setAttachmentGranularity(a, 'art-1', 'title');
    expect(registry.getAttachments(a)[0].granularity).toBe('title');
    expect(registry.getAttachments(a)[0].turnIndex).toBe(2);
  });

  it('the dot verb: none → staged → none, then cycles the cut once committed', () => {
    const { registry, a } = registryWithTwoChats();
    registry.toggleStageOrCycleAttachment(a, 'art-1');
    expect(registry.getStagedAttachments(a)).toHaveLength(1);
    expect(registry.getStagedAttachments(a)[0].granularity).toBe('full');

    registry.toggleStageOrCycleAttachment(a, 'art-1');
    expect(registry.getAttachments(a)).toHaveLength(0);

    // Commit, then cycle: full → title → description → summary → full
    registry.stageArtifact(a, 'art-1', 'full');
    registry.commitStagedAttachments(a, 1, 'turn-1');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      registry.toggleStageOrCycleAttachment(a, 'art-1');
      seen.push(registry.getAttachments(a)[0].granularity);
    }
    expect(seen).toEqual(['title', 'description', 'summary', 'full']);
    expect(registry.getAttachments(a)[0].turnIndex).toBe(1);
  });

  it('ensureAttached: the AI-attachment law — committed, idempotent, never re-staged', () => {
    const { registry, a } = registryWithTwoChats();
    // Fresh attach: Full by default, welded to the reply's turn.
    expect(registry.ensureAttached(a, 'art-ai-1', 3, 'turn-3')).toBe(true);
    const att = registry.getAttachments(a).find((x) => x.artifactId === 'art-ai-1')!;
    expect(att.turnIndex).toBe(3);
    expect(att.turnId).toBe('turn-3');
    expect(att.granularity).toBe('full');
    expect(registry.getStagedAttachments(a)).toHaveLength(0);

    // Idempotent: re-weld (delta re-delivery, regenerate) is a no-op and
    // keeps the user's granularity choice.
    registry.setAttachmentGranularity(a, 'art-ai-1', 'summary');
    expect(registry.ensureAttached(a, 'art-ai-1', 3, 'turn-3')).toBe(false);
    expect(registry.getAttachments(a).find((x) => x.artifactId === 'art-ai-1')!.granularity).toBe('summary');

    // A STAGED entry (user armed it before the reply landed) is welded, not duplicated.
    registry.stageArtifact(a, 'art-user-armed');
    expect(registry.ensureAttached(a, 'art-user-armed', 4, 'turn-4')).toBe(true);
    const welded = registry.getAttachments(a).find((x) => x.artifactId === 'art-user-armed')!;
    expect(welded.turnIndex).toBe(4);
    expect(welded.turnId).toBe('turn-4');
    expect(registry.getStagedAttachments(a)).toHaveLength(0);

    // Granularity stays steerable after the weld (same code as user attachments).
    registry.setAttachmentGranularity(a, 'art-user-armed', 'title');
    expect(registry.getAttachments(a).find((x) => x.artifactId === 'art-user-armed')!.granularity).toBe('title');
  });

  it('hydrate attaches AI-extracted artifacts from the turns (refresh never drops the AI attachment)', () => {
    const registry = new ThreadRegistry();
    registry.hydrate({
      projectId: 'p',
      threads: [
        {
          id: 'thread-ai',
          folderId: null,
          title: 'AI',
          titleState: 'auto',
          titleVersion: 1,
          createdAt: 0,
          updatedAt: 0,
          lastActivityAt: 0,
          lifecycle: 'active' as const,
          lastOutcome: 'ok' as const,
          preview: '',
          attachments: [], // registry cache lost it — the turns are the truth
        },
      ],
      turns: [
        { id: 't0', role: 'user' as const, content: 'ask', timestamp: 1, threadId: 'thread-ai' },
        {
          id: 't1',
          role: 'assistant' as const,
          content: 'reply',
          timestamp: 2,
          threadId: 'thread-ai',
          extractedArtifacts: [{ id: 'art-from-ai', title: 'From AI', type: 'document', turnIndex: 1 }],
        },
        // Another thread's extraction must NOT attach here.
        {
          id: 't9',
          role: 'assistant' as const,
          content: 'other',
          timestamp: 3,
          threadId: 'thread-other',
          extractedArtifacts: [{ id: 'art-foreign', title: 'Foreign', type: 'document', turnIndex: 1 }],
        },
      ],
    });
    const att = registry.getAttachments('thread-ai').find((x) => x.artifactId === 'art-from-ai')!;
    expect(att).toBeTruthy();
    expect(att.turnIndex).toBe(1);
    expect(att.turnId).toBe('t1');
    expect(att.granularity).toBe('full');
    expect(registry.getStagedAttachments('thread-ai')).toHaveLength(0);
    expect(registry.getAttachments('thread-ai').some((x) => x.artifactId === 'art-foreign')).toBe(false);
  });

  it('committing with no staged items is a zero-cost no-op', () => {
    const { registry, a } = registryWithTwoChats();
    registry.attachArtifact(a, 'art-1', 'full', 0, 'turn-0');
    expect(registry.commitStagedAttachments(a, 1, 'turn-1')).toBe(0);
    expect(registry.getAttachments(a)[0].turnIndex).toBe(0);
  });

  it('hydrate welds staged entries named in turns meta.attachments (refresh never resurrects the staged tray)', () => {
    // Live 2026-10-25: after a refresh, the thread doc (client's last save)
    // still said staged, so the tray repopulated and the chips never rendered.
    const registry = new ThreadRegistry();
    registry.hydrate({
      projectId: 'p',
      threads: [
        {
          id: 'thread-x',
          folderId: null,
          title: 'X',
          titleState: 'auto',
          titleVersion: 1,
          createdAt: 0,
          updatedAt: 0,
          lastActivityAt: 0,
          lifecycle: 'active' as const,
          lastOutcome: 'ok' as const,
          preview: '',
          attachments: [
            { artifactId: 'art-a', granularity: 'full' as const, addedAt: 1, turnIndex: null, turnId: null },
            { artifactId: 'art-b', granularity: 'full' as const, addedAt: 1, turnIndex: null, turnId: null },
          ],
        },
      ],
      turns: [
        {
          id: 'turn-1',
          role: 'user' as const,
          content: 'ask',
          timestamp: 1,
          threadId: 'thread-x',
          meta: { attachments: [{ artifactId: 'art-a', turnIndex: 0, turnId: 'turn-1' }] },
        },
      ],
    });
    const atts = registry.getAttachments('thread-x');
    const a = atts.find((x) => x.artifactId === 'art-a')!;
    expect(a.turnIndex).toBe(0);
    expect(a.turnId).toBe('turn-1');
    // Not named in any turn → stays staged (it genuinely arms the next send).
    const b = atts.find((x) => x.artifactId === 'art-b')!;
    expect(b.turnIndex).toBeNull();
    expect(registry.getStagedAttachments('thread-x').map((x) => x.artifactId)).toEqual(['art-b']);
  });

  it('reconcileThreadAttachments never downgrades committed provenance to staged', () => {
    const committed: ChatAttachment = {
      artifactId: 'art-1',
      granularity: 'full',
      addedAt: 1,
      turnIndex: 2,
      turnId: 'turn-2',
    };
    const staleStaged: ChatAttachment = {
      artifactId: 'art-1',
      granularity: 'full',
      addedAt: 1,
      turnIndex: null,
      turnId: null,
    };
    const other: ChatAttachment = {
      artifactId: 'art-new',
      granularity: 'full',
      addedAt: 1,
      turnIndex: null,
      turnId: null,
    };
    expect(reconcileThreadAttachments([committed], [staleStaged])).toEqual([committed]);
    expect(reconcileThreadAttachments([], [staleStaged, other])).toEqual([staleStaged, other]);
    expect(reconcileThreadAttachments([committed], [])).toEqual([committed]);
  });

  it('legacy snapshots without a turnIndex hydrate as committed at turnIndex -1 (never staged, never a fake turn)', () => {
    const registry = new ThreadRegistry();
    registry.hydrate({
      projectId: 'p',
      threads: [
        {
          id: 'thread-old',
          title: 'Old',
          titleState: 'auto',
          titleVersion: 2,
          createdAt: 0,
          updatedAt: 0,
          lastActivityAt: 0,
          lifecycle: 'active',
          lastOutcome: 'ok',
          preview: '',
          attachments: [{ artifactId: 'art-legacy', granularity: 'summary', addedAt: 1 }],
        } as any,
      ],
      turns: [],
      chapters: [],
      activeThreadId: 'thread-old',
    });
    const att = registry.getAttachments('thread-old')[0];
    // Committed, but honest: no turn was ever recorded for it (-1 = "in chat").
    expect(att.turnIndex).toBe(-1);
    expect(registry.getStagedAttachments('thread-old')).toHaveLength(0);
    expect(registry.getAttachments('thread-old').every((x) => x.turnIndex !== null)).toBe(true);
  });
});
