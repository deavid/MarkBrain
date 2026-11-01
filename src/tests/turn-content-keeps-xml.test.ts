/**
 * BUG-011: past turns compile for the model with the operations KEPT in place
 * — <link>/<unlink>/<topic_shift> verbatim, and <artifact_upsert> bodies
 * replaced by the self-documenting MarkBrain compiler comment.
 * BUG-007 root cause seam: turn.content keeps the inline tags at all.
 */
import { describe, it, expect } from 'vitest';
import { planTurnCommit, type TurnCommitRequest } from '../../shared/turnCommit/planTurnCommit';
import { compileTurnContentForPrompt } from '../../shared/stream/compilerStub';

const baseReq = (over: Partial<TurnCommitRequest>): TurnCommitRequest => ({
  kind: 'send',
  threadId: 't1',
  pairKey: 'p1',
  projectId: 'proj',
  askText: 'ask',
  cleanReply: '',
  artifactUpserts: [],
  topicShift: null,
  links: [],
  unlinks: [],
  stagedAttachments: [],
  capabilities: { writeArtifacts: true, autoChapter: true, graphLinks: true },
  now: 1000,
  ids: { userTurnId: 'u1', assistantTurnId: 'a1' },
  state: { artifacts: [], edges: [], threadTurnsCount: 0, chapters: [] },
  ...over,
});

describe('turn.content keeps the inline operations (BUG-007 root cause)', () => {
  const raw =
    'Here are the links:\n\n<link source="a.md" target="b.md" kind="relates_to" />\n\nDone.';
  const plan = planTurnCommit(
    baseReq({
      cleanReply: 'Here are the links:\n\n\nDone.',
      rawReply: raw,
      links: [{ source: 'a.md', target: 'b.md', kind: 'relates_to' }],
    })
  );
  it('the assistant turn stores the raw text with the tag in place', () => {
    const content = plan.assistantTurn.content ?? '';
    expect(content).toContain('<link source="a.md" target="b.md" kind="relates_to" />');
    expect(content).toContain('Here are the links:');
    expect(content).toContain('Done.');
  });
});

describe('compileTurnContentForPrompt (BUG-011)', () => {
  const content = [
    'Thinking about the design.',
    '<link source="a.md" target="b.md" kind="relates_to" />',
    '<artifact_upsert file="the-hook.md" title="The Hook">',
    '<subtitle>s</subtitle>',
    '<content>' + 'word '.repeat(400) + '</content>',
    '</artifact_upsert>',
    '<topic_shift title="Next" />',
  ].join('\n');

  const compiled = compileTurnContentForPrompt(content);

  it('keeps link and topic_shift tags verbatim, in place', () => {
    expect(compiled).toContain('<link source="a.md" target="b.md" kind="relates_to" />');
    expect(compiled).toContain('<topic_shift title="Next" />');
  });

  it('replaces the artifact body with the self-documenting compiler comment', () => {
    expect(compiled).toContain('<artifact_upsert file="the-hook.md" title="The Hook">');
    expect(compiled).toMatch(/<!-- MarkBrain compiler: Artifact body \([\d,]+ words\) was saved into "the-hook\.md"/);
    // The MODEL'S layer tags are gone (the comment mentions them, the body doesn't).
    expect(compiled).not.toContain('<subtitle>s</subtitle>');
    expect(compiled).not.toContain('word word word');
    // The comment teaches the model never to emit it itself.
    expect(compiled).toContain('Never emit this compiler comment yourself.');
  });
});
