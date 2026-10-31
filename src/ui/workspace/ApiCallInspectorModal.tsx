/**
 * The API call inspector (design-docs/28 §4.4, David 2026-10-30).
 *
 * The ONE place for inspecting a recorded flight-recorder call. Full-screen,
 * six tabs, and it renders the recorded data VERBATIM — never a paraphrase:
 *
 *   1. Overview   — status, provider/model, the ids (row, job, turn) and the
 *                   headline timings.
 *   2. Request    — what we compiled: system instruction, prompt, parameters.
 *   3. Wire       — the EXACT payload the provider call received (request.wire),
 *                   scrubbed of secrets at the recorder.
 *   4. Response   — the raw UNPARSED provider text, before any demuxer strips
 *                   sentinel blocks.
 *   5. Reasoning  — the model's thinking stream (same 7-day TTL as the row).
 *   6. Timings    — the phase breakdown: send→ack→first reasoning→first
 *                   token→end, plus the chunk counts (reasoning vs text).
 *
 * Pure presentational + verbatim: the rows are the truth, the inspector is a
 * window. Nothing here writes back.
 */
import React, { useState } from 'react';
import { ArrowLeft, Copy, Check, X } from 'lucide-react';
import type { ApiCallLog } from '../../domains/callLogTypes';
import { callDurations } from '../../domains/callLogTypes';

const STATUS_STYLE: Record<string, string> = {
  ok: 'text-[#34d399] bg-[#064e3b]',
  error: 'text-[#f87171] bg-[#451214]',
  aborted: 'text-[#fbbf24] bg-[#422006]',
  pending: 'text-[#38bdf8] bg-[#0c2e4e]',
};

export type InspectorTab = 'overview' | 'request' | 'wire' | 'response' | 'reasoning' | 'timings';

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'request', label: 'Request' },
  { id: 'wire', label: 'Wire payload' },
  { id: 'response', label: 'Response' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'timings', label: 'Timings' },
];

const formatMs = (ms: number | null): string => (ms === null ? '—' : `${Math.round(ms).toLocaleString()} ms`);

/** A verbatim read-only block: label, copy button, the raw text as-is. */
const VerbatimBlock: React.FC<{ label: string; text: string; mono?: boolean }> = ({ label, text, mono = true }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <section className="rounded-lg bg-surface-1 shadow-well px-3 py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-10 uppercase tracking-wider text-[#6b82a3] font-semibold">{label}</span>
        <button
          onClick={copy}
          className="p-1 rounded hover:bg-surface-3 text-[#7187a5] hover:text-ink transition-colors cursor-pointer"
          title={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <pre className={`${mono ? 'font-mono' : ''} text-10 text-[#c9d8ef] whitespace-pre-wrap break-all max-h-72 overflow-y-auto`}>
        {text || '—'}
      </pre>
    </section>
  );
};

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start gap-2 text-11 py-1">
    <span className="text-[#556985] uppercase tracking-wider text-10 font-semibold shrink-0 w-40">{label}</span>
    <span className="text-[#e1ebf7] break-all tabular-nums">{value}</span>
  </div>
);

export const ApiCallInspectorModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** The recorded call — the inspector renders it verbatim. */
  call: ApiCallLog | null;
  initialTab?: InspectorTab;
}> = ({ isOpen, onClose, call, initialTab = 'overview' }) => {
  const [tab, setTab] = useState<InspectorTab>(initialTab);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  if (!isOpen || !call) return null;
  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };
  const d = callDurations(call);
  const req = call.request ?? ({} as ApiCallLog['request']);
  const wire = req.wire != null ? (typeof req.wire === 'string' ? req.wire : JSON.stringify(req.wire, null, 2)) : '';
  const prompt = req.compiledPrompt ?? (req.messages ? JSON.stringify(req.messages, null, 2) : '');

  const copyTextFor = (key: string, text: string) => {
    copy(key, text);
  };

  const firstReasoningMs = call.tFirstReasoning !== null && call.tSend !== null ? call.tFirstReasoning - call.tSend : null;
  const ttftMs = call.tFirstToken !== null ? call.tFirstToken - call.tSend : null;
  const totalMs = call.tEnd !== null ? call.tEnd - call.tSend : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md" data-testid="api-call-inspector">
      <div className="relative w-full max-w-5xl h-[85vh] bg-surface-0 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-ink font-mono animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-5 py-3.5 bg-surface-1 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center text-[#38bdf8] text-13">
              ⌕
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ink tracking-wide">API call</h2>
              <p className="text-10 text-[#6b82a3] font-mono">
                {call.provider} · {call.model} · {call.kind}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-3 text-[#7187a5] hover:text-ink transition-colors cursor-pointer"
            title="Close inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="px-5 py-2 bg-surface-1 flex items-center gap-1 shrink-0 border-b border-line-soft">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-2.5 py-1 rounded text-11 font-semibold transition-colors cursor-pointer ${
                tab === t.id ? 'bg-surface-4 text-[#38bdf8]' : 'text-[#506684] hover:text-[#9bb0d1]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {tab === 'overview' && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-11 text-[#8ab1e0] mb-2">
                <span
                  className={`px-1.5 py-0.5 rounded text-9 font-semibold uppercase tracking-wider ${STATUS_STYLE[call.status] ?? STATUS_STYLE.pending}`}
                >
                  {call.status}
                </span>
                <span className="text-[#556985]">{new Date(call.tSend).toLocaleString()}</span>
                <span className="text-[#556985]">http {call.httpStatus ?? '—'}</span>
              </div>
              <Row label="Call id" value={call.id} />
              <Row label="Job id" value={call.jobId ?? '—'} />
              <Row label="Turn id" value={call.turnId ?? '—'} />
              <Row label="Provider" value={call.provider} />
              <Row label="Model" value={call.model} />
              <Row label="Kind" value={call.kind} />
              <Row
                label="Timings"
                value={`ack ${formatMs(d.ackMs)} · first token ${formatMs(ttftMs)} · total ${formatMs(totalMs)}`}
              />
              {call.error && <VerbatimBlock label="Error" text={call.error} />}
            </>
          )}

          {tab === 'request' && (
            <>
              <VerbatimBlock label="System instruction" text={req.systemInstruction ?? ''} />
              <VerbatimBlock label="Prompt sent" text={prompt} />
              {req.params && Object.keys(req.params).length > 0 && (
                <VerbatimBlock label="Parameters" text={JSON.stringify(req.params, null, 2)} />
              )}
            </>
          )}

          {tab === 'wire' && (
            <VerbatimBlock label="Wire payload (what the provider received)" text={wire} />
          )}

          {tab === 'response' && <VerbatimBlock label="Raw response (unparsed)" text={call.responseText ?? ''} />}

          {tab === 'reasoning' && (
            <VerbatimBlock label="Reasoning (model thinking)" text={call.reasoningText ?? ''} />
          )}

          {tab === 'timings' && (
            <>
              <Row label="Sent" value={new Date(call.tSend).toLocaleString()} />
              <Row label="Ack" value={formatMs(d.ackMs)} />
              <Row label="First reasoning" value={formatMs(firstReasoningMs)} />
              <Row label="First token" value={formatMs(ttftMs)} />
              <Row label="Total" value={formatMs(totalMs)} />
              <Row label="Reasoning chunks" value={call.reasoningChunks ?? '—'} />
              <Row label="Text chunks" value={call.textChunks ?? '—'} />
            </>
          )}
        </div>

        {/* Footer: the ids again, for pasting into tickets */}
        <div className="px-5 py-2 bg-surface-1 flex items-center justify-between text-10 text-[#556985] shrink-0">
          <span className="font-mono">{call.id}</span>
          <button
            onClick={() => copyTextFor('ids', `${call.id}${call.jobId ? ` job=${call.jobId}` : ''}${call.turnId ? ` turn=${call.turnId}` : ''}`)}
            className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-surface-3 text-[#7187a5] hover:text-ink cursor-pointer"
            title="Copy ids"
          >
            {copiedKey === 'ids' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            Copy ids
          </button>
        </div>
      </div>
    </div>
  );
};
