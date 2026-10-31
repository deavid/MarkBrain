/**
 * Inspector chrome (plan doc 30 Phase 2): the approved design is a
 * FULL-SCREEN window with a real header — identity, outcome, summary strip —
 * and Esc as a first-class close. It was a max-w-5xl dialog with none of that.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';

const CALL = {
  id: 'call-777',
  userId: 1,
  kind: 'chat',
  provider: 'openrouter',
  model: 'z-ai/glm-5.3-flash',
  tSend: 1730000000000,
  tAck: 1730000001200,
  tFirstReasoning: 1730000001850,
  tFirstToken: 1730002041000,
  tEnd: 1730000296400,
  status: 'ok',
  request: {
    endpoint: 'POST https://openrouter.ai/api/v1/chat/completions',
    model: 'z-ai/glm-5.3-flash',
    systemInstruction: 'Be helpful.',
    compiledPrompt: 'The compiled payload.',
    params: { temperature: 0.7 },
  },
  responseText: 'The answer.',
  reasoningText: 'Thinking...',
  textChunks: 89,
  reasoningChunks: 142,
  httpStatus: 200,
  usage: { prompt_tokens: 14210, completion_tokens: 1890, total_tokens: 16100 },
  error: null,
  jobId: 'job-abc',
  turnId: 'turn-ai-job-abc',
} as any;

const renderModal = async (props: Record<string, unknown>) => {
  const { ApiCallInspectorModal } = await import('../ui/workspace/ApiCallInspectorModal');
  return renderToStaticMarkup(React.createElement(ApiCallInspectorModal, props as any));
};

const inspectorProps = { isOpen: true, onClose: () => {}, call: CALL } as any;

describe('ApiCallInspectorModal — built for a big screen', () => {
  it('is a full-screen window (~96vw × 94vh), not a cramped dialog', async () => {
    const html = await renderModal(inspectorProps);
    expect(html).toContain('w-[96vw]');
    expect(html).toContain('h-[94vh]');
    expect(html).not.toContain('max-w-5xl');
  });

  it('the header names the endpoint and the outcome (status + HTTP code)', async () => {
    const html = await renderModal(inspectorProps);
    expect(html).toContain('POST https://openrouter.ai/api/v1/chat/completions');
    // The outcome badge lives IN THE HEADER, not buried in a tab body.
    const header = html.slice(0, html.indexOf('Overview'));
    expect(header).toContain('200');
    expect(header).toMatch(/ok/i);
  });

  it('the header carries the summary strip: total · TTFT · tokens in → out · chunks', async () => {
    const html = await renderModal(inspectorProps);
    const header = html.slice(0, html.indexOf('Overview'));
    expect(header).toMatch(/296,?400\s*s?ms|296\.4s/); // total
    expect(header).toMatch(/2,?041,?000|2,041/); // ttft ms
    expect(header).toMatch(/14,?210/); // tokens in
    expect(header).toMatch(/1,?890/); // tokens out
    expect(header).toMatch(/142/); // reasoning chunks
    expect(header).toMatch(/89/); // text chunks
  });

  it('token counting reads the provider shapes (gemini + openrouter) — pure helper', async () => {
    const { usageTokens } = await import('../../shared/types/callLog');
    expect(usageTokens({ promptTokenCount: 11, candidatesTokenCount: 3 })).toEqual({ in: 11, out: 3 });
    expect(usageTokens({ prompt_tokens: 5, completion_tokens: 7 })).toEqual({ in: 5, out: 7 });
    expect(usageTokens({ inputTokens: 9, outputTokens: 4 })).toEqual({ in: 9, out: 4 });
    expect(usageTokens(null)).toEqual({ in: null, out: null });
  });

  it('Esc closes the inspector — not only the X button', async () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'ui', 'workspace', 'ApiCallInspectorModal.tsx'),
      'utf-8'
    );
    expect(source).toContain("key === 'Escape'");
  });
});
