/**
 * The API call inspector (design-docs/28 §4.4, plan doc 30) — David 2026-10-30/31.
 *
 * The ONE place for inspecting a recorded flight-recorder call. Full-screen,
 * the six approved tabs, and it renders the recorded data VERBATIM — never a
 * paraphrase:
 *
 *   1. Overview & Timings — status/outcome, ids, the full phase timeline
 *                           (wall clock + deltas + throughput), request
 *                           parameters, token accounting, error detail.
 *   2. System Instruction — the exact rules we gave the model.
 *   3. Compiled Prompt    — what context & history we sent (Full raw ↔ By
 *                           section, with per-section char weights).
 *   4. Wire payload       — the EXACT JSON the provider call received
 *                           (scrubbed at the recorder).
 *   5. Thinking           — the model's raw reasoning stream.
 *   6. Response           — what came back (raw vs processed, Phase 5).
 *
 * Pure presentational + verbatim: the rows are the truth, the inspector is a
 * window. Nothing here writes back.
 */
import React, { useEffect, useState } from 'react';
import { Copy, Check, X } from 'lucide-react';
import type { ApiCallLog } from '../../domains/callLogTypes';
import { callPhases, usageTokens } from '../../domains/callLogTypes';
import { parseCompiledSections, type CompiledSection } from '../../../shared/prompts/compiledSections';
import { estimateTokens } from '../../utils/estimateTokens';

const STATUS_STYLE: Record<string, string> = {
  ok: 'text-[#34d399] bg-[#064e3b]',
  error: 'text-[#f87171] bg-[#451214]',
  aborted: 'text-[#fbbf24] bg-[#422006]',
  pending: 'text-[#38bdf8] bg-[#0c2e4e]',
};

export type InspectorTab = 'overview' | 'system' | 'prompt' | 'wire' | 'thinking' | 'response';

const formatMs = (ms: number | null): string => (ms === null ? '—' : `${Math.round(ms).toLocaleString()} ms`);
const formatRate = (rate: number | null): string => (rate === null ? '—' : `${Math.round(rate).toLocaleString()} chars/sec`);
const formatAt = (ts: number | null): string => (ts === null ? '—' : new Date(ts).toLocaleString());

/** A verbatim read-only block: label, copy button, the raw text as-is. */
const VerbatimBlock: React.FC<{
  label: string;
  text: string;
  mono?: boolean;
  full?: boolean;
  children?: React.ReactNode;
}> = ({ label, text, mono = true, full = false, children }) => {
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
      <pre
        className={`${mono ? 'font-mono' : ''} text-10 text-[#c9d8ef] whitespace-pre-wrap break-all ${
          full ? '' : 'max-h-72'
        } overflow-y-auto`}
      >
        {children ?? (text || '—')}
      </pre>
    </section>
  );
};

/* The sentinel tags the demuxer strips — highlighted IN PLACE inside the
   raw provider text, so the raw view shows exactly where the machine data
   rode inside the prose. */
const SENTINEL_PREFIX_RE = /^<(topic_shift|link|unlink|artifact_upsert)/i;
const SENTINEL_SPLIT_RE = /(<topic_shift[\s\S]*?\/>|<link[\s\S]*?\/>|<unlink[\s\S]*?\/>|<artifact_upsert[\s\S]*?<\/artifact_upsert>)/gi;

const RawWithSentinels: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(SENTINEL_SPLIT_RE).map((part, i) =>
      SENTINEL_PREFIX_RE.test(part) ? (
        <span key={i} data-testid="sentinel-tag" className="text-[#e0b96c] bg-[#422006] rounded px-0.5">
          {part}
        </span>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      )
    )}
  </>
);

/** The extracted actions: what the demuxer found, what the planner did. */
const OutcomeView: React.FC<{ outcome: NonNullable<ApiCallLog['outcome']> }> = ({ outcome }) => (
  <>
    {outcome.topicShift && (
      <div className="rounded-lg bg-surface-1 shadow-well px-3 py-2.5">
        <Row
          label="Topic shift"
          value={
            <>
              <span className={outcome.topicShift.applied ? 'text-[#34d399]' : 'text-[#e0b96c]'}>
                {outcome.topicShift.applied ? 'APPLIED' : 'IGNORED'}
              </span>{' '}
              “{outcome.topicShift.title}” — {outcome.topicShift.reason}
            </>
          }
        />
      </div>
    )}
    {outcome.artifacts.length > 0 && (
      <div className="rounded-lg bg-surface-1 shadow-well px-3 py-2.5">
        <span className="text-10 uppercase tracking-wider text-[#6b82a3] font-semibold">Artifact upserts</span>
        <div className="mt-1">
          {outcome.artifacts.map((a, i) => (
            <Row
              key={i}
              label={a.file}
              value={
                <>
                  <span
                    className={
                      a.result === 'dropped' ? 'text-[#e0b96c]' : 'text-[#34d399]'
                    }
                  >
                    {a.result.toUpperCase()}
                  </span>{' '}
                  {a.reason}
                </>
              }
            />
          ))}
        </div>
      </div>
    )}
    {outcome.links.length > 0 && (
      <div className="rounded-lg bg-surface-1 shadow-well px-3 py-2.5">
        <span className="text-10 uppercase tracking-wider text-[#6b82a3] font-semibold">Links & unlinks</span>
        <div className="mt-1">
          {outcome.links.map((l, i) => (
            <Row
              key={i}
              label={`${l.action}: ${l.sourceFile} → ${l.targetFile}`}
              value={
                <>
                  <span className={l.applied ? 'text-[#34d399]' : 'text-[#e0b96c]'}>
                    {l.applied ? 'APPLIED' : 'IGNORED'}
                  </span>{' '}
                  {l.kind ? `[${l.kind}] ` : ''}
                  {l.reason}
                </>
              }
            />
          ))}
        </div>
      </div>
    )}
  </>
);

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start gap-2 text-11 py-1">
    <span className="text-[#556985] uppercase tracking-wider text-10 font-semibold shrink-0 w-40">{label}</span>
    <span className="text-[#e1ebf7] break-all tabular-nums">{value}</span>
  </div>
);

/** The "By section" view: named sections, char weight up front, artifacts and
 *  chapters collapsible so a 30k-char payload stays navigable. */
const SectionsView: React.FC<{ sections: CompiledSection[] }> = ({ sections }) => (
  <div className="space-y-1.5">
    {sections.map((s, i) => (
      <section key={i} className="rounded-lg bg-surface-1 shadow-well px-3 py-2">
        <div className="flex items-center justify-between text-11">
          <span className="text-[#8ab1e0] font-semibold">{s.title}</span>
          <span className="text-10 text-[#556985] tabular-nums">
            {s.chars.toLocaleString()} chars · ~{estimateTokens(s.text).toLocaleString()} tok
          </span>
        </div>
        {s.items.length > 0 && (
          <div className="mt-1 space-y-1">
            {s.items.map((item, j) => (
              <details key={j} className="rounded bg-recess-1 px-2 py-1">
                <summary className="cursor-pointer text-10 text-[#9bb0d1] flex justify-between gap-3">
                  <span className="truncate">{item.title}</span>
                  <span className="tabular-nums shrink-0">
                    {item.chars.toLocaleString()} chars · ~{estimateTokens(item.text).toLocaleString()} tok
                  </span>
                </summary>
                <pre className="font-mono text-10 text-[#c9d8ef] whitespace-pre-wrap break-all max-h-64 overflow-y-auto mt-1">
                  {item.text}
                </pre>
              </details>
            ))}
          </div>
        )}
        {s.items.length === 0 && s.chars > 0 && (
          <pre className="font-mono text-10 text-[#c9d8ef] whitespace-pre-wrap break-all max-h-64 overflow-y-auto mt-1">
            {s.text}
          </pre>
        )}
      </section>
    ))}
  </div>
);

export const ApiCallInspectorModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** The recorded call — the inspector renders it verbatim. */
  call: ApiCallLog | null;
  initialTab?: InspectorTab;
  /** Every recorded attempt of the same turn, newest first (Phase 6).
   *  Rendered as the header switcher only when there is more than one. */
  attempts?: ApiCallLog[];
  /** The parent fetches the FULL record of the picked attempt. */
  onSelectAttempt?: (callId: string) => void;
}> = ({ isOpen, onClose, call, initialTab = 'overview', attempts, onSelectAttempt }) => {
  const [tab, setTab] = useState<InspectorTab>(initialTab);
  const [promptView, setPromptView] = useState<'raw' | 'sections'>('raw');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Esc closes — a full-screen window without a keyboard exit is a trap.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !call) return null;
  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };
  const p = callPhases(call);
  const req = call.request ?? ({} as ApiCallLog['request']);
  const wire = req.wire != null ? (typeof req.wire === 'string' ? req.wire : JSON.stringify(req.wire, null, 2)) : '';
  const prompt = req.compiledPrompt ?? (req.messages ? JSON.stringify(req.messages, null, 2) : '');
  const system = req.systemInstruction ?? '';
  const reasoning = call.reasoningText ?? '';
  const response = call.responseText ?? '';
  const tokens = usageTokens(call.usage);

  const count = (text: string) => ` · ${text.length.toLocaleString()} chars · ~${estimateTokens(text).toLocaleString()} tok`;
  const TABS: Array<{ id: InspectorTab; label: string }> = [
    { id: 'overview', label: 'Overview & Timings' },
    { id: 'system', label: `System instruction${count(system)}` },
    { id: 'prompt', label: `Compiled prompt${count(prompt)}` },
    { id: 'wire', label: `Wire payload${wire ? count(wire) : ''}` },
    { id: 'thinking', label: `Thinking${count(reasoning)}` },
    { id: 'response', label: 'Response' },
  ];
  const sections = parseCompiledSections(prompt);

  const copyTextFor = (key: string, text: string) => {
    copy(key, text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md" data-testid="api-call-inspector">
      <div className="relative w-[96vw] h-[94vh] bg-surface-0 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-ink font-mono animate-in fade-in zoom-in-95 duration-200">
        {/* Header: identity + outcome + the summary strip — always visible
            across tabs (plan doc 30 §Phase 2). */}
        <div className="px-5 py-3 bg-surface-1 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center text-[#38bdf8] text-13 shrink-0">
              ⌕
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-ink tracking-wide shrink-0">API call</h2>
                <span
                  className={`px-1.5 py-0.5 rounded text-9 font-semibold uppercase tracking-wider ${STATUS_STYLE[call.status] ?? STATUS_STYLE.pending}`}
                >
                  {call.status}{call.httpStatus != null ? ` · http ${call.httpStatus}` : ''}
                </span>
              </div>
              <p className="text-10 text-[#6b82a3] font-mono truncate">
                {call.provider} · {call.model} · {call.kind} · {req.endpoint || '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* Attempt switcher (plan doc 30 Phase 6): a regenerated turn
                keeps one turn id but writes a row per attempt — the failed
                retry deserves inspection too. Chronological numbering, the
                newest marked (latest). */}
            {attempts && attempts.length > 1 && (
              <select
                data-testid="attempt-switcher"
                value={call.id}
                onChange={(e) => onSelectAttempt?.(e.target.value)}
                className="bg-surface-3 text-10 text-ink rounded px-1.5 py-1 font-mono cursor-pointer focus:outline-none"
                title="Every recorded attempt of this turn"
              >
                {attempts.map((a, i) => {
                  const chronological = attempts.length - i; // newest first → last chronologically
                  const isLatest = i === 0;
                  return (
                    <option key={a.id} value={a.id}>
                      {`Attempt #${chronological}${isLatest ? ' (latest)' : ''} · ${a.status} · ${new Date(a.tSend).toLocaleTimeString()}`}
                    </option>
                  );
                })}
              </select>
            )}
            <p className="text-10 text-[#8ab1e0] font-mono tabular-nums whitespace-nowrap">
              total {formatMs(p.totalMs)} · ttft {formatMs(p.ttftMs)} · tokens{' '}
              {tokens.in?.toLocaleString() ?? '—'} → {tokens.out?.toLocaleString() ?? '—'} · chunks{' '}
              {call.reasoningChunks ?? 0} reasoning + {call.textChunks ?? 0} text
            </p>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-3 text-[#7187a5] hover:text-ink transition-colors cursor-pointer"
              title="Close inspector (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="px-5 py-2 bg-surface-1 flex items-center gap-1 shrink-0 border-b border-line-soft overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-2.5 py-1 rounded text-11 font-semibold transition-colors cursor-pointer whitespace-nowrap ${
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

              {/* The phase timeline: WHEN each phase began (wall clock) and
                  HOW LONG it lasted (delta) — the approved design's exact
                  wording: what we sent, how and when; what we received, when,
                  in what manner. */}
              <div className="rounded-lg bg-surface-1 shadow-well px-3 py-2.5 mt-2">
                <span className="text-10 uppercase tracking-wider text-[#6b82a3] font-semibold">Phase timeline</span>
                <div className="mt-1">
                  <Row label="Sent" value={<>{formatAt(call.tSend)} <span className="text-[#556985]">· t0</span></>} />
                  <Row label="Ack" value={<>{formatAt(call.tAck)} <span className="text-[#556985]">· +{formatMs(p.ackMs)}</span></>} />
                  <Row
                    label="First reasoning"
                    value={<>{formatAt(call.tFirstReasoning)} <span className="text-[#556985]">· +{formatMs(p.firstReasoningMs)}</span></>}
                  />
                  <Row
                    label="First token"
                    value={<>{formatAt(call.tFirstToken)} <span className="text-[#556985]">· +{formatMs(p.ttftMs)}</span></>}
                  />
                  <Row
                    label="End"
                    value={<>{formatAt(call.tEnd)} <span className="text-[#556985]">· +{formatMs(p.totalMs)}</span></>}
                  />
                </div>
              </div>
              <div className="rounded-lg bg-surface-1 shadow-well px-3 py-2.5">
                <span className="text-10 uppercase tracking-wider text-[#6b82a3] font-semibold">Phase durations & throughput</span>
                <div className="mt-1">
                  <Row
                    label="Thinking phase"
                    value={`${formatMs(p.thinkingMs)} · ${call.reasoningChunks ?? '—'} chunks · ${p.reasoningChars.toLocaleString()} chars · ${formatRate(p.reasoningCharsPerSec)}`}
                  />
                  <Row
                    label="Writing phase"
                    value={`${formatMs(p.writingMs)} · ${call.textChunks ?? '—'} chunks · ${p.responseChars.toLocaleString()} chars · ${formatRate(p.responseCharsPerSec)}`}
                  />
                </div>
              </div>

              {/* Request parameters & capabilities — what we tuned, verbatim. */}
              {req.params && Object.keys(req.params).length > 0 && (
                <VerbatimBlock label="Request parameters" text={JSON.stringify(req.params, null, 2)} />
              )}

              {/* Token & usage accounting: the provider's own numbers when
                  the wire carried them, an explicit estimate otherwise. */}
              <div className="rounded-lg bg-surface-1 shadow-well px-3 py-2.5">
                <span className="text-10 uppercase tracking-wider text-[#6b82a3] font-semibold">Token & usage accounting</span>
                {/* Provider-reported vs estimated: honor the recorded flag
                    when the row carries one (Phase 4); rows from before the
                    flag fall back to "usage present = provider-reported". */}
                {call.usage != null && call.usageEstimated !== true ? (                  <>
                    <div className="mt-1">
                      <Row
                        label="Source"
                        value={<span className="text-[#34d399]">Provider-reported (the provider's own usage telemetry)</span>}
                      />
                      <Row
                        label="Tokens"
                        value={`${tokens.in?.toLocaleString() ?? '—'} in → ${tokens.out?.toLocaleString() ?? '—'} out`}
                      />
                    </div>
                    <pre className="font-mono text-10 text-[#c9d8ef] whitespace-pre-wrap break-all mt-1">
                      {JSON.stringify(call.usage, null, 2)}
                    </pre>
                  </>
                ) : (
                  <div className="mt-1">
                    <Row
                      label="Source"
                      value={<span className="text-[#e0b96c]">Estimated — no provider usage telemetry reached the recorder</span>}
                    />
                    <Row
                      label="Tokens (est.)"
                      value={`~${estimateTokens(prompt || '').toLocaleString()} in → ~${estimateTokens(response).toLocaleString()} out`}
                    />
                  </div>
                )}
              </div>

              {call.error && <VerbatimBlock label="Error / termination" text={call.error} />}
            </>
          )}

          {tab === 'system' && (
            <VerbatimBlock label="System instruction (the exact rules we gave the model)" text={system} full />
          )}

          {tab === 'prompt' && (
            <>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPromptView('raw')}
                  data-testid="prompt-view-raw"
                  className={`px-2 py-1 rounded text-11 font-semibold transition-colors cursor-pointer ${
                    promptView === 'raw' ? 'bg-surface-4 text-[#38bdf8]' : 'text-[#506684] hover:text-[#9bb0d1]'
                  }`}
                >
                  Full raw text
                </button>
                <button
                  onClick={() => setPromptView('sections')}
                  data-testid="prompt-view-sections"
                  className={`px-2 py-1 rounded text-11 font-semibold transition-colors cursor-pointer ${
                    promptView === 'sections' ? 'bg-surface-4 text-[#38bdf8]' : 'text-[#506684] hover:text-[#9bb0d1]'
                  }`}
                >
                  By section
                </button>
              </div>
              {promptView === 'raw' ? (
                <VerbatimBlock label="Compiled prompt (what context & history we sent)" text={prompt} full />
              ) : (
                <SectionsView sections={sections} />
              )}
            </>
          )}

          {tab === 'wire' && (
            <VerbatimBlock label="Wire payload (what the provider received)" text={wire} full />
          )}

          {tab === 'thinking' && (
            <>
              <Row
                label="Thinking phase"
                value={`${reasoning.length.toLocaleString()} chars · ${call.reasoningChunks ?? '—'} chunks · ${formatMs(p.thinkingMs)} · ${formatRate(p.reasoningCharsPerSec)}`}
              />
              <VerbatimBlock label="Reasoning (the model's raw thinking stream)" text={reasoning} full />
            </>
          )}

          {tab === 'response' && (
            <>
              <VerbatimBlock
                label="Raw response (unparsed) — sentinel tags highlighted"
                text={response}
                full
              >
                <RawWithSentinels text={response} />
              </VerbatimBlock>
              {call.outcome && (
                <>
                  <VerbatimBlock label="Clean chat reply (what landed in the bubble)" text={call.outcome.cleanReply} full />
                  <div className="rounded-lg bg-surface-1 shadow-well px-3 py-2.5">
                    <span className="text-10 uppercase tracking-wider text-[#6b82a3] font-semibold">Extracted actions</span>
                    <div className="mt-1.5">
                      <OutcomeView outcome={call.outcome} />
                    </div>
                  </div>
                </>
              )}
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
