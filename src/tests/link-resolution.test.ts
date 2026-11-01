/**
 * §6: <link> endpoints resolve by code.md, plain code, exact title, slug-of-
 * title, previousCodes, and artifact id — so the model can mix forms without
 * producing `?` unresolved chips or dropped graph edges.
 */
import { describe, it, expect } from 'vitest';
import { planTurnCommit, type TurnCommitRequest } from '../../shared/turnCommit/planTurnCommit';

const req = (links: Array<{ source: string; target: string; kind: string }>): any => ({
  kind: 'send',
  threadId: 't1',
  pairKey: 'p1',
  projectId: 'proj',
  askText: 'ask',
  cleanReply: 'reply',
  rawReply: 'reply',
  artifactUpserts: [],
  topicShift: null,
  links,
  unlinks: [],
  stagedAttachments: [],
  capabilities: { writeArtifacts: true, autoChapter: true, graphLinks: true },
  now: 1000,
  ids: { userTurnId: 'u1', assistantTurnId: 'a1' },
  state: {
    artifacts: [
      {
        id: 'art-1',
        code: 'unhaunter-design-and-systems-spec-2',
        title: 'Unhaunter Development Design Notes',
        previousCodes: ['unhaunter-design-spec-old'],
      },
    ],
    edges: [],
    threadTurnsCount: 0,
    chapters: [],
  },
});

const resolve = (source: string, target: string) => {
  const plan = planTurnCommit(req([{ source, target, kind: 'relates_to' }]));
  const r = plan.assistantTurn.extractedLinks?.[0];
  return { sourceId: r?.sourceId ?? null, targetId: r?.targetId ?? null, applied: r?.applied };
};

describe('link endpoint resolution', () => {
  it('resolves title on one side and code.md on the other (the live bug)', () => {
    const r = resolve(
      'Unhaunter Development Design Notes',
      'unhaunter-design-and-systems-spec-2.md'
    );
    expect(r.sourceId).toBe('art-1');
    expect(r.targetId).toBe('art-1');
    // Distinct endpoints only apply — same artifact on both sides is a noop.
    expect(r.applied).toBe(false);
  });

  it('resolves slug-of-title and plain code', () => {
    expect(resolve('unhaunter-development-design-notes', 'unhaunter-design-and-systems-spec-2').targetId).toBe('art-1');
    expect(resolve('unhaunter-design-and-systems-spec-2', 'unhaunter-design-and-systems-spec-2.md').targetId).toBe('art-1');
  });

  it('resolves a renamed slug through previousCodes and the artifact id itself', () => {
    expect(resolve('unhaunter-design-spec-old.md', 'unhaunter-design-and-systems-spec-2.md').sourceId).toBe('art-1');
    expect(resolve('art-1', 'unhaunter-design-and-systems-spec-2.md').sourceId).toBe('art-1');
  });
});
