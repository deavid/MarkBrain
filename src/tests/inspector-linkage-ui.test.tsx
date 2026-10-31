/**
 * Inspector linkage — the UI (David 2026-10-30, approved 6-tab design).
 *
 * The wire already carries the call id (call-linkage.test.ts) and drafts
 * persist it. These tests pin the last mile: the CLICK on a message or a
 * failed/stopped draft opens the inspector on the EXACT recorded call —
 * and the ServerLogs modal goes back to being ONLY server logs.
 *
 * Rendered through react-dom/server (no DOM needed) — same pattern as
 * message-body / draft-reasoning-chip tests.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';

/* ── 1. ServerLogsModal goes back to ONLY server logs ─────────────────────── */

describe('ServerLogsModal — the API Calls tab is gone (inspector owns calls)', () => {
  it('renders no "API Calls (last 7d)" tab and no api-calls machinery', async () => {
    const { ServerLogsModal } = await import('../ui/workspace/ServerLogsModal');
    const html = renderToStaticMarkup(
      React.createElement(ServerLogsModal, { isOpen: true, onClose: () => {} })
    );
    expect(html).not.toContain('API Calls');
    expect(html).not.toContain('Live logs');
    expect(html).toContain('Live Server Telemetry');
  });

  it('does not even mention the flight-recorder tab machinery in the source', () => {
    // The tab list is a static string we can assert on directly.
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'ui', 'workspace', 'ServerLogsModal.tsx'),
      'utf-8'
    );
    expect(source).not.toContain("setTab('calls')");
    expect(source).not.toContain('ApiCallsTab');
    expect(source).not.toContain('ApiCallDetail');
  });
});

/* ── 2. The inspector modal: the 6-tab full-screen layout ────────────────── */

const CALL = {
  id: 'call-777',
  userId: 1,
  kind: 'chat',
  provider: 'gemini',
  model: 'gemini-3.5-flash-lite',
  tSend: 1730000000000,
  tAck: 1730000000200,
  tFirstReasoning: 1730000000250,
  tFirstToken: 1730000001900,
  tEnd: 1730000006900,
  status: 'ok',
  request: {
    endpoint: 'generateContentStream',
    model: 'gemini-3.5-flash-lite',
    systemInstruction: 'Be helpful.',
    compiledPrompt: 'The compiled payload.',
    params: { thinkingConfig: { includeThoughts: true } },
    wire: { contents: [{ parts: [{ text: 'The compiled payload.' }] }] },
  },
  responseText: 'The answer.',
  reasoningText: 'Let me think about it carefully...',
  textChunks: 12,
  reasoningChunks: 5,
  httpStatus: 200,
  usage: { promptTokenCount: 11, candidatesTokenCount: 3 },
  error: null,
  jobId: 'job-abc',
  turnId: 'turn-ai-job-abc',
} as unknown as Parameters<typeof import('../ui/workspace/ApiCallInspectorModal').ApiCallInspectorModal>[0]['call'];

const renderModal = async (props: Record<string, unknown>) => {
  const { ApiCallInspectorModal } = await import('../ui/workspace/ApiCallInspectorModal');
  return renderToStaticMarkup(React.createElement(ApiCallInspectorModal, props as any));
};

const inspectorProps = { isOpen: true, onClose: () => {}, call: CALL } as any;

describe('ApiCallInspectorModal — the one true place for calls (6 tabs)', () => {
  it('renders the six tabs in order', async () => {
    const html = await renderModal(inspectorProps);
    for (const tab of ['Overview &amp; Timings', 'System instruction', 'Compiled prompt', 'Wire payload', 'Thinking', 'Response']) {
      expect(html).toContain(tab);
    }
  });

  it('shows the recorded data verbatim: prompt, wire payload, raw response', async () => {
    // Each tab renders only ITS content — assert per-tab with initialTab.
    const system = await renderModal({ ...inspectorProps, initialTab: 'system' });
    expect(system).toContain('System instruction');
    expect(system).toContain('Be helpful.');

    const prompt = await renderModal({ ...inspectorProps, initialTab: 'prompt' });
    expect(prompt).toContain('Compiled prompt');
    expect(prompt).toContain('The compiled payload.');

    const wire = await renderModal({ ...inspectorProps, initialTab: 'wire' });
    expect(wire).toContain('Wire payload (what the provider received)');
    expect(wire).toContain('The compiled payload.');

    const response = await renderModal({ ...inspectorProps, initialTab: 'response' });
    expect(response).toContain('Raw response (unparsed)');
    expect(response).toContain('The answer.');

    const thinking = await renderModal({ ...inspectorProps, initialTab: 'thinking' });
    expect(thinking).toContain('Reasoning (the model&#x27;s raw thinking stream)');
    expect(thinking).toContain('Let me think about it carefully...');
  });

  it('shows the timing breakdown: ack, first reasoning, first token, total', async () => {
    // The Overview tab has a headline timings row; the Timings tab has the
    // full phase breakdown. Both must show the same numbers.
    const overview = await renderModal({ ...inspectorProps, initialTab: 'overview' });
    expect(overview).toMatch(/200\s*ms/); // ack = tAck - tSend
    expect(overview).toMatch(/1,?900\s*ms/); // first token = tFirstToken - tSend
    expect(overview).toMatch(/6,?900\s*ms/); // total

    const timings = await renderModal({ ...inspectorProps, initialTab: 'overview' });
    expect(timings).toContain('Ack');
    expect(timings).toContain('First reasoning');
    expect(timings).toContain('First token');
    expect(timings).toContain('End');
    expect(timings).toMatch(/200\s*ms/);
    expect(timings).toMatch(/6,?900\s*ms/);
  });

  it('shows the processing breakdown: reasoning vs text chunk counts', async () => {
    const timings = await renderModal({ ...inspectorProps, initialTab: 'overview' });
    expect(timings).toContain('Thinking phase');
    expect(timings).toContain('5');
    expect(timings).toContain('Writing phase');
    expect(timings).toContain('12');
  });

  it('hidden when closed or with no call selected', async () => {
    const { ApiCallInspectorModal } = await import('../ui/workspace/ApiCallInspectorModal');
    expect(renderToStaticMarkup(React.createElement(ApiCallInspectorModal, { ...inspectorProps, isOpen: false }))).toBe('');
    expect(renderToStaticMarkup(React.createElement(ApiCallInspectorModal, { ...inspectorProps, call: null }))).toBe('');
  });
});

/* ── 3. The click: messages and drafts that know their call id ───────────── */

const MessageBubble = (await import('../ui/chat/MessageBubble')).MessageBubble;

const bubbleBase = {
  message: { id: 'turn-ai-1', role: 'ai', content: 'The answer.', meta: { callId: 'call-777' } } as any,
  globalTurnIndex: 0,
  chatRender: 'standard',
  online: true,
  offlineReplica: false,
  chosenVoice: '',
  playingMessageId: null,
  ttsLoadingId: null,
  cachedIds: new Set(),
  ttsFailedIds: new Set(),
  handlePlayTTS: () => {},
  declaringMessageId: null,
  setDeclaringMessageId: () => {},
  newChapterTitle: '',
  setNewChapterTitle: () => {},
  handleDeclareSubmit: () => {},
  chapters: [],
  artifactTitles: {},
  attachmentsOfTurn: () => [],
  titleFor: () => '',
  subtitleFor: () => '',
  tokensFor: () => 0,
  isLoading: false,
  lastAssistantMessageId: null,
  draftCount: 0,
} as any;

describe('MessageBubble — the receipts icon opens the inspector on the exact call', () => {
  it('an assistant turn with meta.callId shows the inspect affordance even in local mode', async () => {
    const html = renderToStaticMarkup(
      React.createElement(MessageBubble, {
        ...bubbleBase,
        onInspectCall: () => {},
      } as any)
    );
    expect(html).toMatch(/data-testid="inspect-call"/);
  });

  it('without a call id the affordance stays hidden (old job-guess path is gone)', async () => {
    const noCall = { ...bubbleBase, message: { id: 'turn-ai-job-abc', role: 'ai', content: 'x', meta: {} } } as any;
    const html = renderToStaticMarkup(
      React.createElement(MessageBubble, { ...noCall, onInspectCall: () => {} } as any)
    );
    expect(html).not.toMatch(/data-testid="inspect-call"/);
  });
});
