/**
 * Response: Raw vs Processed (plan doc 30 Phase 5).
 *
 * The response tab showed ONLY the raw text. The approved design wants the
 * full story side by side: the raw provider text with the sentinel tags
 * HIGHLIGHTED in place, the clean reply that actually landed in the bubble,
 * and the extracted actions — what the demuxer found and what the planner
 * did with it (recorded in Phase 4).
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const RAW = [
  'Moving on to the silver mines.',
  '<topic_shift title="The Silver Mines" subtitle="Where the money came from" />',
  'The mines of Laurion funded the fleet.',
  '<link source="laurion.md" target="silver-mines.md" kind="relates_to" />',
  '<artifact_upsert file="laurion.md" title="Laurion" type="document"><subtitle>s</subtitle><description>d</description><summary>sum</summary><content>b</content></artifact_upsert>',
].join('\n');

const CALL = {
  id: 'call-out',
  userId: 1,
  kind: 'chat',
  provider: 'gemini',
  model: 'gemini-3.8-flash',
  tSend: 1730000000000,
  tAck: null,
  tFirstReasoning: null,
  tFirstToken: null,
  tEnd: null,
  status: 'ok',
  request: { endpoint: 'generateContentStream', model: 'gemini-3.8-flash', compiledPrompt: 'p' },
  responseText: RAW,
  reasoningText: null,
  textChunks: 9,
  reasoningChunks: 0,
  httpStatus: 200,
  usage: null,
  usageEstimated: true,
  error: null,
  jobId: 'job-1',
  turnId: 'turn-ai-job-1',
  outcome: {
    topicShift: { title: 'The Silver Mines', applied: true, reason: 'opened a new chapter' },
    artifacts: [
      { file: 'laurion.md', title: 'Laurion', result: 'created', reason: 'created as "Laurion"' },
    ],
    links: [
      {
        action: 'link',
        sourceFile: 'laurion.md',
        targetFile: 'silver-mines.md',
        kind: 'relates_to',
        applied: false,
        reason: 'graphLinks is off',
      },
    ],
    cleanReply: 'Moving on to the silver mines. The mines of Laurion funded the fleet.',
    rawChars: RAW.length,
    cleanChars: 70,
  },
} as any;

const renderModal = async (props: Record<string, unknown>) => {
  const { ApiCallInspectorModal } = await import('../ui/workspace/ApiCallInspectorModal');
  return renderToStaticMarkup(React.createElement(ApiCallInspectorModal, props as any));
};

describe('Response tab — raw vs processed', () => {
  it('highlights the sentinel tags IN PLACE inside the raw text', async () => {
    const html = await renderModal({ isOpen: true, onClose: () => {}, call: CALL, initialTab: 'response' });
    expect((html.match(/data-testid="sentinel-tag"/g) ?? []).length).toBe(3); // shift + link + upsert
    expect(html).toContain('The Silver Mines');
    expect(html).toContain('laurion.md');
  });

  it('shows the CLEAN reply that landed in the chat bubble', async () => {
    const html = await renderModal({ isOpen: true, onClose: () => {}, call: CALL, initialTab: 'response' });
    expect(html).toContain('Clean chat reply');
    expect(html).toContain('Moving on to the silver mines. The mines of Laurion funded the fleet.');
    expect(html).not.toContain('sentinel-stripped-lie'); // sanity
  });

  it('shows the extracted actions: topic shift applied + reason', async () => {
    const html = await renderModal({ isOpen: true, onClose: () => {}, call: CALL, initialTab: 'response' });
    expect(html).toContain('Extracted actions');
    expect(html).toContain('The Silver Mines');
    expect(html).toContain('opened a new chapter');
  });

  it('shows each artifact op: created / updated / dropped', async () => {
    const html = await renderModal({ isOpen: true, onClose: () => {}, call: CALL, initialTab: 'response' });
    expect(html).toContain('laurion.md');
    expect(html).toMatch(/created/i);
  });

  it('shows each link/unlink with its outcome and reason', async () => {
    const html = await renderModal({ isOpen: true, onClose: () => {}, call: CALL, initialTab: 'response' });
    expect(html).toContain('silver-mines.md');
    expect(html).toContain('graphLinks is off');
  });

  it('a row recorded BEFORE outcome capture stays honest: no fabricated actions', async () => {
    const legacy = { ...CALL, outcome: undefined };
    const html = await renderModal({ isOpen: true, onClose: () => {}, call: legacy, initialTab: 'response' });
    expect(html).not.toContain('Extracted actions');
    expect(html).toContain('Raw response (unparsed)'); // raw still renders
  });
});
