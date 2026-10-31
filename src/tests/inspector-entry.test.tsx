/**
 * Inspector ENTRY points (David 2026-10-31, plan doc 30 Phase 1).
 *
 * The linkage wire exists (call-linkage.test.ts) but the click path was
 * broken: App resolved the call from LOCAL IndexedDB only — in VPS mode the
 * row lives server-side, so getCallLog returned null and the modal silently
 * rendered nothing. And the draft tray — where failed/stopped/in-flight
 * sends live — had NO inspect affordance at all, even though the draft
 * carries its callId.
 *
 * These tests pin the fix: mode-aware resolution and the tray affordance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';

const getWorkspaceMode = vi.fn();
vi.mock('../services/workspaceSession', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getWorkspaceMode: (...a: unknown[]) => getWorkspaceMode(...a),
}));

const getApiCallLog = vi.fn();
vi.mock('../gateway/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getApiCallLog: (...a: unknown[]) => getApiCallLog(...a),
}));

const localGetCallLog = vi.fn();
vi.mock('../services/callLogStore', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCallLog: (...a: unknown[]) => localGetCallLog(...a),
}));

const CALL = {
  id: 'call-9',
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
  request: { endpoint: 'generateContentStream', model: 'gemini-3.8-flash' },
  responseText: 'The answer.',
  reasoningText: null,
  textChunks: null,
  reasoningChunks: null,
  httpStatus: 200,
  usage: null,
  error: null,
  jobId: 'job-1',
  turnId: 'turn-ai-job-1',
} as any;

beforeEach(() => {
  getApiCallLog.mockReset();
  localGetCallLog.mockReset();
  getWorkspaceMode.mockReset();
});

/* ── 1. Mode-aware call resolution ────────────────────────────────────────── */

describe('resolveCallForInspector — the right store per workspace mode', () => {
  it('VPS mode: fetches the SERVER record (GET /api/logs/calls/:id) and unwraps {call}', async () => {
    getWorkspaceMode.mockReturnValue('vps');
    getApiCallLog.mockResolvedValue({ ok: true, json: async () => ({ call: CALL }) });
    const { resolveCallForInspector } = await import('../services/inspectCallLog');
    const target = await resolveCallForInspector('call-9');
    expect(target.call).toEqual(CALL);
    expect(getApiCallLog).toHaveBeenCalledWith('call-9');
    expect(localGetCallLog).not.toHaveBeenCalled();
  });

  it('VPS mode: a 404 (gone or someone else\'s call) resolves null, never throws', async () => {
    getWorkspaceMode.mockReturnValue('vps');
    getApiCallLog.mockResolvedValue({ ok: false, status: 404 });
    const { resolveCallForInspector } = await import('../services/inspectCallLog');
    expect((await resolveCallForInspector('call-9')).call).toBeNull();
  });

  it('Local mode: reads the IndexedDB store — no network call', async () => {
    getWorkspaceMode.mockReturnValue('local');
    localGetCallLog.mockResolvedValue(CALL);
    const { resolveCallForInspector } = await import('../services/inspectCallLog');
    expect((await resolveCallForInspector('call-9')).call).toEqual(CALL);
    expect(localGetCallLog).toHaveBeenCalledWith('call-9');
    expect(getApiCallLog).not.toHaveBeenCalled();
  });
});

/* ── 2. The draft tray affordance ─────────────────────────────────────────── */

const { DraftQueueTray } = await import('../ui/chat/DraftQueueTray');

const trayBase = {
  offlineReplica: false,
  tokensFor: () => 0,
  titleFor: () => '',
  onInspectCall: () => {},
} as any;

const draft = (over: Record<string, unknown>) => ({
  id: 'd1',
  threadId: 't1',
  createdAt: 1,
  state: 'failed',
  text: 'the ask',
  ...over,
});

describe('DraftQueueTray — every card that knows its call offers the inspector', () => {
  it('a FAILED draft with a callId shows the inspect button', () => {
    const html = renderToStaticMarkup(
      React.createElement(DraftQueueTray, { ...trayBase, drafts: [draft({ callId: 'call-9' })] } as any)
    );
    expect(html).toMatch(/data-testid="draft-inspect-call"/);
  });

  it('a SENDING (in-flight) draft with a callId shows it too — inspection while it hangs', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        DraftQueueTray,
        { ...trayBase, drafts: [draft({ state: 'sending', callId: 'call-9' })] } as any
      )
    );
    expect(html).toMatch(/data-testid="draft-inspect-call"/);
  });

  it('a draft WITHOUT a callId (queued, stream never started) shows none', () => {
    const html = renderToStaticMarkup(
      React.createElement(DraftQueueTray, { ...trayBase, drafts: [draft({ state: 'queued' })] } as any)
    );
    expect(html).not.toMatch(/data-testid="draft-inspect-call"/);
  });

  it('offline replica stays read-only: no affordance', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        DraftQueueTray,
        { ...trayBase, offlineReplica: true, drafts: [draft({ callId: 'call-9' })] } as any
      )
    );
    expect(html).not.toMatch(/data-testid="draft-inspect-call"/);
  });
});

/* ── 3. ChatView passes the affordance through to the tray ────────────────── */

describe('ChatView — the tray receives the same inspector opener as the bubbles', () => {
  it('wires onInspectCall into DraftQueueTray', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'chat', 'ChatView.tsx'), 'utf-8');
    expect(source).toMatch(/<DraftQueueTray[\s\S]*?onInspectCall=\{onInspectCall\}/);
  });
});
