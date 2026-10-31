/**
 * Mode-aware call resolution for the inspector (plan doc 30 Phases 1 + 6).
 *
 * The inspector must open the EXACT recorded call from wherever the click
 * came. In Local Workspace the row lives in IndexedDB (callLogStore); in VPS
 * mode it lives server-side (api_call_logs, served by GET /api/logs/calls/:id
 * with the own-user filter). Previously App.tsx only ever read IndexedDB, so
 * every VPS-mode click resolved null and the modal silently showed nothing.
 *
 * Phase 6: the resolution also gathers the turn's OTHER attempts (queried by
 * turnId, newest first) so the inspector header can offer the attempt
 * switcher — a regenerated turn keeps one turn id but writes a new row per
 * attempt, and the failed retry deserves inspection too.
 *
 * Two GETs per click at most (detail + turn list) — no prefetching, no
 * polling, no open/close-cycle calls (external-system stress law).
 */
import { getWorkspaceMode } from './workspaceSession';
import { getCallLog, listCallLogs } from './callLogStore';
import { getApiCallLog, listApiCallLogs } from '../gateway/api';
import type { ApiCallLog } from '../domains/callLogTypes';

export interface InspectorTarget {
  /** The FULL record the click asked for — null when gone or not ours. */
  call: ApiCallLog | null;
  /** Every recorded attempt of the same turn, newest first (the clicked one included). */
  attempts: ApiCallLog[];
}

export async function fetchCallRecord(callId: string): Promise<ApiCallLog | null> {
  if (getWorkspaceMode() === 'vps') {
    try {
      const res = await getApiCallLog(callId);
      if (!res.ok) return null;
      const body = (await res.json()) as { call?: ApiCallLog };
      return body.call ?? null;
    } catch {
      return null;
    }
  }
  return getCallLog(callId);
}

export async function resolveCallForInspector(callId: string): Promise<InspectorTarget> {
  const call = await fetchCallRecord(callId);
  if (!call) return { call: null, attempts: [] };
  if (!call.turnId) return { call, attempts: [call] };

  let attempts: ApiCallLog[];
  if (getWorkspaceMode() === 'vps') {
    try {
      const res = await listApiCallLogs(50, undefined, call.turnId);
      attempts = res.ok ? ((await res.json()) as { calls?: ApiCallLog[] }).calls ?? [] : [];
    } catch {
      attempts = [];
    }
  } else {
    attempts = await listCallLogs(200, call.turnId);
  }
  if (!attempts.some((a) => a.id === call.id)) attempts.unshift(call);
  return { call, attempts };
}
