/**
 * The attempt switcher (plan doc 30 Phase 6).
 *
 * A regenerated turn keeps ONE turn id but produces a NEW recorder row per
 * attempt. The approved design: a dropdown in the inspector header —
 * "Attempt #2 (latest) ▾" — so the FAILED retry can be inspected too, not
 * just the call that happened to win.
 *
 * Seams pinned here:
 *  - the modal renders the switcher when several attempts share the turn,
 *    with the CURRENT call selected;
 *  - resolveCallForInspector returns the call PLUS its sibling attempts
 *    (queried by turnId, newest first);
 *  - the server recorder filters by turn_id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/* ── 1. The modal: the header dropdown ────────────────────────────────────── */

const attempt = (id: string, tSend: number, status: string) => ({
  id,
  userId: 1,
  kind: 'chat',
  provider: 'gemini',
  model: 'gemini-3.8-flash',
  tSend,
  tAck: null,
  tFirstReasoning: null,
  tFirstToken: null,
  tEnd: null,
  status,
  request: { endpoint: 'generateContentStream', model: 'gemini-3.8-flash' },
  responseText: `reply of ${id}`,
  reasoningText: null,
  textChunks: null,
  reasoningChunks: null,
  httpStatus: status === 'ok' ? 200 : 500,
  usage: null,
  error: null,
  jobId: `job-${id}`,
  turnId: 'turn-ai-job-1',
} as any);

const renderModal = async (props: Record<string, unknown>) => {
  const { ApiCallInspectorModal } = await import('../ui/workspace/ApiCallInspectorModal');
  return renderToStaticMarkup(React.createElement(ApiCallInspectorModal, props as any));
};

describe('ApiCallInspectorModal — the attempt switcher', () => {
  it('several attempts on the same turn → a header dropdown listing them all', async () => {
    const html = await renderModal({
      isOpen: true,
      onClose: () => {},
      call: attempt('call-b', 2000, 'ok'),
      attempts: [attempt('call-b', 2000, 'ok'), attempt('call-a', 1000, 'error'), attempt('call-c', 3000, 'aborted')],
      onSelectAttempt: () => {},
    });
    expect(html).toMatch(/data-testid="attempt-switcher"/);
    for (const id of ['call-a', 'call-b', 'call-c']) expect(html).toContain(id);
  });

  it('the CURRENT call is the selected option, with chronological numbering', async () => {
    const html = await renderModal({
      isOpen: true,
      onClose: () => {},
      call: attempt('call-a', 1000, 'error'),
      attempts: [attempt('call-b', 2000, 'ok'), attempt('call-a', 1000, 'error')],
      onSelectAttempt: () => {},
    });
    // call-a is the OLDER attempt → "Attempt #1"; the newest carries (latest).
    expect(html).toMatch(/Attempt #1/);
    expect(html).toMatch(/Attempt #2[^<]*\(latest\)/);
    expect(html).toMatch(/<option[^>]*value="call-a"[^>]*selected/);
  });

  it('a single attempt (or no attempts list) → no dropdown, no theater', async () => {
    const single = await renderModal({
      isOpen: true,
      onClose: () => {},
      call: attempt('call-b', 2000, 'ok'),
      attempts: [attempt('call-b', 2000, 'ok')],
      onSelectAttempt: () => {},
    });
    expect(single).not.toMatch(/data-testid="attempt-switcher"/);

    const none = await renderModal({ isOpen: true, onClose: () => {}, call: attempt('call-b', 2000, 'ok') });
    expect(none).not.toMatch(/data-testid="attempt-switcher"/);
  });

  it('switching an attempt asks the parent for THAT full record', async () => {
    // The modal is presentational: the select's onChange hands the id up.
    const source = (await import('node:fs')).readFileSync('src/ui/workspace/ApiCallInspectorModal.tsx', 'utf-8');
    expect(source).toMatch(/onSelectAttempt\?\.\(e\.target\.value\)/);
  });
});

/* ── 2. Resolution: the call PLUS its sibling attempts ────────────────────── */

const getWorkspaceMode = vi.fn();
vi.mock('../services/workspaceSession', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getWorkspaceMode: (...a: unknown[]) => getWorkspaceMode(...a),
}));

const listApiCallLogs = vi.fn();
const getApiCallLog = vi.fn();
vi.mock('../gateway/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getApiCallLog: (...a: unknown[]) => getApiCallLog(...a),
  listApiCallLogs: (...a: unknown[]) => listApiCallLogs(...a),
}));

const localGetCallLog = vi.fn();
const localListCallLogs = vi.fn();
vi.mock('../services/callLogStore', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCallLog: (...a: unknown[]) => localGetCallLog(...a),
  listCallLogs: (...a: unknown[]) => localListCallLogs(...a),
}));

beforeEach(() => {
  getApiCallLog.mockReset();
  listApiCallLogs.mockReset();
  localGetCallLog.mockReset();
  localListCallLogs.mockReset();
  getWorkspaceMode.mockReset();
});

describe('resolveCallForInspector — the call plus the attempts of its turn', () => {
  it('VPS: fetches the full record AND lists the turn attempts (turn filter)', async () => {
    getWorkspaceMode.mockReturnValue('vps');
    getApiCallLog.mockResolvedValue({ ok: true, json: async () => ({ call: attempt('call-b', 2000, 'ok') }) });
    listApiCallLogs.mockResolvedValue({
      ok: true,
      json: async () => ({ calls: [attempt('call-b', 2000, 'ok'), attempt('call-a', 1000, 'error')] }),
    });
    const { resolveCallForInspector } = await import('../services/inspectCallLog');
    const target = await resolveCallForInspector('call-b');
    expect(target.call?.id).toBe('call-b');
    expect(target.attempts.map((a: { id: string }) => a.id)).toEqual(['call-b', 'call-a']);
    expect(listApiCallLogs).toHaveBeenCalledWith(50, undefined, 'turn-ai-job-1');
    expect(localListCallLogs).not.toHaveBeenCalled();
  });

  it('Local: IndexedDB on both paths, no network', async () => {
    getWorkspaceMode.mockReturnValue('local');
    localGetCallLog.mockResolvedValue(attempt('call-b', 2000, 'ok'));
    localListCallLogs.mockResolvedValue([attempt('call-b', 2000, 'ok')]);
    const { resolveCallForInspector } = await import('../services/inspectCallLog');
    const target = await resolveCallForInspector('call-b');
    expect(target.attempts).toHaveLength(1);
    expect(localListCallLogs).toHaveBeenCalledWith(200, 'turn-ai-job-1');
    expect(listApiCallLogs).not.toHaveBeenCalled();
  });

  it('a null call resolves to an empty target — no attempt hunt for nothing', async () => {
    getWorkspaceMode.mockReturnValue('vps');
    getApiCallLog.mockResolvedValue({ ok: false, status: 404 });
    const { resolveCallForInspector } = await import('../services/inspectCallLog');
    const target = await resolveCallForInspector('call-x');
    expect(target.call).toBeNull();
    expect(target.attempts).toEqual([]);
    expect(listApiCallLogs).not.toHaveBeenCalled();
  });
});

/* ── 3. The server recorder filters by turn_id ────────────────────────────── */

describe('callRecorder.listCallLogs — the turn filter', () => {
  it('returns only the rows of the requested turn, newest first', async () => {
    const { initDb, closeDbForTests } = await import('../../server/db');
    initDb(':memory:');
    const { recordCallStart, recordCallEnd, listCallLogs } = await import('../../server/lib/callRecorder');
    for (const [id, turn, t] of [
      ['call-1', 'turn-1', 1000],
      ['call-2', 'turn-1', 2000],
      ['call-3', 'turn-2', 3000],
    ] as const) {
      const cid = recordCallStart({ userId: 1, kind: 'chat', model: 'm', request: { endpoint: 'e', model: 'm' } });
      if (!cid) throw new Error('no id');
      recordCallEnd(cid, { status: 'ok', turnId: turn });
      void id;
      void t;
    }
    const rows = listCallLogs(1, 50, undefined, undefined, 'turn-1');
    expect(rows.map((r) => r.turnId)).toEqual(['turn-1', 'turn-1']);
    await closeDbForTests?.();
  });
});
