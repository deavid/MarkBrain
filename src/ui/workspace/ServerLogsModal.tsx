import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Trash2, Copy, Check, X, ArrowDown, ArrowLeft } from 'lucide-react';
import { logger } from '../../utils/logger';
import { serverLogs, clearServerLogs, listApiCallLogs, getApiCallLog } from '../../gateway/api';
import { getWorkspaceMode } from '../../services/workspaceSession';
import { listCallLogs as listLocalCallLogs, getCallLog as getLocalCallLog } from '../../services/callLogStore';
import { callDurations, type ApiCallLog } from '../../domains/callLogTypes';

export interface ServerLogItem {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  tag: string;
  message: string;
  meta?: any;
}

interface ServerLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-filter the API Calls tab to one chat job (per-message receipts). */
  initialJobFilter?: string;
}

/* ── API Calls tab (flight recorder, design-docs/28 §4.4) ────────────────── */

function formatMs(ms: number | null): string {
  return ms === null ? '—' : `${ms} ms`;
}

function formatCallTime(t: number): string {
  const d = new Date(t);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

const STATUS_STYLE: Record<string, string> = {
  ok: 'text-[#34d399] bg-[#064e3b]',
  error: 'text-[#f87171] bg-[#451214]',
  aborted: 'text-[#fbbf24] bg-[#422006]',
  pending: 'text-[#38bdf8] bg-[#0c2e4e]',
};

const CopySection: React.FC<{ label: string; text: string; copied: boolean; onCopy: () => void }> = ({
  label,
  text,
  copied,
  onCopy,
}) => (
  <div className="px-3 py-2.5 rounded-lg bg-surface-1 shadow-well">
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-10 uppercase tracking-wider text-[#6b82a3] font-semibold">{label}</span>
      <button
        onClick={onCopy}
        className="p-1 rounded hover:bg-surface-3 text-[#7187a5] hover:text-ink transition-colors cursor-pointer"
        title={`Copy ${label.toLowerCase()}`}
      >
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
    <pre className="text-10 text-[#c9d8ef] whitespace-pre-wrap break-all max-h-64 overflow-y-auto font-mono">
      {text || '—'}
    </pre>
  </div>
);

/** One call's full detail: request, raw unparsed response, timings, usage, error. */
const ApiCallDetail: React.FC<{ call: ApiCallLog; onBack: () => void }> = ({ call, onBack }) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };
  const d = callDurations(call);
  const req = call.request ?? ({} as ApiCallLog['request']);
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-xs text-[#8ab1e0] transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>All calls</span>
      </button>

      <div className="flex flex-wrap items-center gap-2 text-11 text-[#8ab1e0]">
        <span className={`px-1.5 py-0.2 rounded text-9 font-semibold uppercase tracking-wider ${STATUS_STYLE[call.status] ?? STATUS_STYLE.pending}`}>
          {call.status}
        </span>
        <span className="font-semibold">{call.kind}</span>
        <span>{call.model}</span>
        <span className="text-[#556985]">{call.provider}</span>
        <span className="text-[#556985]">{formatCallTime(call.tSend)}</span>
        <span className="text-[#556985]">
          ack {formatMs(d.ackMs)} · first token {formatMs(d.ttftMs)} · total {formatMs(d.totalMs)}
        </span>
        {call.jobId && <span className="text-[#556985]">job {call.jobId}</span>}
        {call.turnId && <span className="text-[#556985]">turn {call.turnId}</span>}
      </div>

      {call.error && (
        <CopySection
          label="Error"
          text={call.error}
          copied={copiedKey === 'error'}
          onCopy={() => copy('error', call.error ?? '')}
        />
      )}
      <CopySection
        label="System instruction"
        text={req.systemInstruction ?? ''}
        copied={copiedKey === 'system'}
        onCopy={() => copy('system', req.systemInstruction ?? '')}
      />
      <CopySection
        label="Prompt sent"
        text={req.compiledPrompt ?? (req.messages ? JSON.stringify(req.messages, null, 2) : '')}
        copied={copiedKey === 'prompt'}
        onCopy={() => copy('prompt', req.compiledPrompt ?? (req.messages ? JSON.stringify(req.messages, null, 2) : ''))}
      />
      {req.params && Object.keys(req.params).length > 0 && (
        <CopySection
          label="Parameters"
          text={JSON.stringify(req.params, null, 2)}
          copied={copiedKey === 'params'}
          onCopy={() => copy('params', JSON.stringify(req.params, null, 2))}
        />
      )}
      <CopySection
        label="Raw response (unparsed)"
        text={call.responseText ?? ''}
        copied={copiedKey === 'response'}
        onCopy={() => copy('response', call.responseText ?? '')}
      />
      {call.usage != null && (
        <CopySection
          label="Usage"
          text={JSON.stringify(call.usage, null, 2)}
          copied={copiedKey === 'usage'}
          onCopy={() => copy('usage', JSON.stringify(call.usage, null, 2))}
        />
      )}
    </div>
  );
};

/** List of recorded API calls (last 7 days), click a row for the full record. */
const ApiCallsTab: React.FC<{ jobFilter?: string }> = ({ jobFilter }) => {
  const [calls, setCalls] = useState<ApiCallLog[]>([]);
  const [selected, setSelected] = useState<ApiCallLog | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (getWorkspaceMode() === 'local') {
      listLocalCallLogs(200).then((rows) => {
        if (!cancelled) setCalls(jobFilter ? rows.filter((r) => r.jobId === jobFilter) : rows);
      });
    } else {
      listApiCallLogs(50, jobFilter)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) setCalls(Array.isArray(data.calls) ? data.calls : []);
        })
        .catch(() => {
          if (!cancelled) setLoadError(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [jobFilter]);

  const openDetail = async (id: string) => {
    try {
      if (getWorkspaceMode() === 'local') {
        setSelected(await getLocalCallLog(id));
      } else {
        const data = await (await getApiCallLog(id)).json();
        setSelected(data.call ?? null);
      }
    } catch {
      /* record gone (pruned) or not ours — stay on the list */
    }
  };

  if (selected) return <ApiCallDetail call={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-1.5 text-11 leading-relaxed">
      {loadError && <p className="text-[#f87171]">Could not load the API call log.</p>}
      {!loadError && calls.length === 0 && (
        <div className="h-full flex flex-col items-center justify-center text-[#556985] space-y-2 py-16">
          <Terminal className="w-8 h-8 opacity-40" />
          <p>{jobFilter ? 'No API calls recorded for this message.' : 'No API calls recorded in the last 7 days.'}</p>
        </div>
      )}
      {calls.map((c) => {
        const d = callDurations(c);
        return (
          <button
            key={c.id}
            onClick={() => void openDetail(c.id)}
            className="w-full flex flex-wrap items-center gap-2.5 px-2.5 py-1.5 rounded hover:bg-surface-1 transition-colors text-left cursor-pointer"
          >
            <span className={`px-1.5 py-0.2 rounded text-9 font-semibold uppercase tracking-wider shrink-0 ${STATUS_STYLE[c.status] ?? STATUS_STYLE.pending}`}>
              {c.status}
            </span>
            <span className="text-[#e1ebf7] font-semibold shrink-0">{c.kind}</span>
            <span className="text-[#8ab1e0] shrink-0">{c.model}</span>
            <span className="text-[#4f6480] shrink-0">{formatCallTime(c.tSend)}</span>
            <span className="text-[#4f6480] ml-auto tabular-nums">
              ack {formatMs(d.ackMs)} · ttft {formatMs(d.ttftMs)} · total {formatMs(d.totalMs)}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export const ServerLogsModal: React.FC<ServerLogsModalProps> = ({ isOpen, onClose, initialJobFilter }) => {
  const jobFilter = initialJobFilter;
  const [logs, setLogs] = useState<ServerLogItem[]>([]);
  const [filterText, setFilterText] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'logs' | 'calls'>(initialJobFilter ? 'calls' : 'logs');
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || tab !== 'logs') return;

    serverLogs()
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
      })
      .catch((err) => logger.error('ServerLogs', 'Failed to load initial server logs', err));

    const eventSource = new EventSource('/api/server-logs/stream');

    eventSource.addEventListener('log_init', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
      } catch (err) {
        logger.warn('ServerLogs', 'Error parsing log_init event', err);
      }
    });

    eventSource.addEventListener('log', (e) => {
      try {
        const item = JSON.parse(e.data);
        setLogs((prev) => [...prev.slice(-300), item]);
      } catch (err) {
        logger.warn('ServerLogs', 'Error parsing SSE log event', err);
      }
    });

    return () => {
      eventSource.close();
    };
  }, [isOpen, tab]);

  useEffect(() => {
    if (autoScroll && isOpen) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isOpen]);

  if (!isOpen) return null;

  const handleClear = async () => {
    try {
      await clearServerLogs();
      setLogs([]);
    } catch (e) {
      logger.error('ServerLogs', 'Failed to clear server logs', e);
    }
  };

  const handleCopy = () => {
    const text = logs
      .map((l) => `[${l.timestamp.split('T')[1]?.slice(0, 8) || ''}] [${l.tag}] ${l.message} ${l.meta ? JSON.stringify(l.meta) : ''}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredLogs = logs.filter((l) => {
    if (selectedLevel !== 'all' && l.level !== selectedLevel) return false;
    if (filterText) {
      const q = filterText.toLowerCase();
      return (
        l.tag.toLowerCase().includes(q) ||
        l.message.toLowerCase().includes(q) ||
        (l.meta && JSON.stringify(l.meta).toLowerCase().includes(q))
      );
    }
    return true;
  });

  const getLevelStyle = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-[#f87171] bg-[#451214] ';
      case 'warn':
        return 'text-[#fbbf24] bg-[#422006] ';
      case 'success':
        return 'text-[#34d399] bg-[#064e3b] ';
      default:
        return 'text-[#38bdf8] bg-[#0c2e4e] ';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="relative w-full max-w-5xl h-[85vh] bg-surface-0 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-ink font-mono animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-3.5 bg-surface-1 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center text-[#38bdf8]">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-ink tracking-wide">Live Server Telemetry & Logs</h2>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>
              <p className="text-10 text-[#6b82a3]">Real-time backend streaming logs from Express & Gemini API</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-surface-0 p-1 rounded-lg mr-1">
              <button
                onClick={() => setTab('logs')}
                className={`px-2 py-0.5 rounded text-10 font-semibold transition-colors cursor-pointer ${
                  tab === 'logs' ? 'bg-surface-4 text-[#38bdf8]' : 'text-[#506684] hover:text-[#9bb0d1]'
                }`}
              >
                Live logs
              </button>
              <button
                onClick={() => setTab('calls')}
                className={`px-2 py-0.5 rounded text-10 font-semibold transition-colors cursor-pointer ${
                  tab === 'calls' ? 'bg-surface-4 text-[#38bdf8]' : 'text-[#506684] hover:text-[#9bb0d1]'
                }`}
              >
                API Calls (last 7d)
              </button>
            </div>
            <button
              onClick={handleCopy}
              className="px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-xs text-[#8ab1e0] transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Copy all logs"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              onClick={handleClear}
              className="px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2 hover:text-[#f87171] text-xs text-[#8ab1e0] transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Clear log buffer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-3 text-[#7187a5] hover:text-ink transition-colors cursor-pointer"
              title="Close log viewer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {tab === 'calls' ? (
          <ApiCallsTab jobFilter={jobFilter} />
        ) : (
        <>
        <div className="px-5 py-2.5 bg-surface-0 flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter logs by tag or keyword (e.g. STREAM, GEMINI, REQ)..."
              className="w-full max-w-md bg-recess-1 rounded-lg px-3 py-1.5 text-xs text-ink placeholder-[#4f6480] focus:outline-none shadow-well"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-surface-0 p-1 rounded-lg ">
              {['all', 'info', 'warn', 'error', 'success'].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setSelectedLevel(lvl)}
                  className={`px-2 py-0.5 rounded text-10 uppercase font-semibold transition-colors cursor-pointer ${
                    selectedLevel === lvl
                      ? 'bg-surface-4 text-[#38bdf8]'
                      : 'text-[#506684] hover:text-[#9bb0d1]'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>

            <button
              onClick={() => setAutoScroll((prev) => !prev)}
              className={`px-2.5 py-1 rounded-lg  text-11 flex items-center gap-1 transition-colors cursor-pointer ${
                autoScroll
                  ? 'bg-surface-3  text-[#38bdf8]'
                  : 'bg-surface-0  text-[#556c8c]'
              }`}
            >
              <ArrowDown className="w-3 h-3" />
              <span>Auto-scroll</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-1.5 text-11 leading-relaxed selection:bg-[#203657]">
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[#556985] space-y-2 py-16">
              <Terminal className="w-8 h-8 opacity-40" />
              <p>No server log events recorded yet matching your filter.</p>
              <p className="text-10 text-[#3e5068]">Interact with chat or trigger an action to generate live backend events.</p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const time = log.timestamp.split('T')[1]?.slice(0, 12) || '';
              return (
                <div
                  key={log.id}
                  className="group flex items-start gap-2.5 px-2.5 py-1.5 rounded hover:bg-surface-1 transition-colors border-l-2 border-transparent "
                >
                  <span className="text-[#4f6480] tabular-nums shrink-0">{time}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-9 font-semibold uppercase tracking-wider shrink-0  ${getLevelStyle(
                      log.level
                    )}`}
                  >
                    {log.tag}
                  </span>
                  <span className="flex-1 text-[#e1ebf7] break-all">
                    {log.message}
                    {log.meta && (
                      <span className="text-[#7c9bc2] block text-10 mt-0.5 opacity-90">
                        {JSON.stringify(log.meta)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>

        <div className="px-5 py-2 bg-surface-0 flex items-center justify-between text-10 text-[#556a88] shrink-0">
          <div>
            Showing <span className="text-[#a4bad6]">{filteredLogs.length}</span> of{' '}
            <span className="text-[#a4bad6]">{logs.length}</span> total entries
          </div>
          <div>Endpoint: <span className="text-[#38bdf8]">/api/chat/stream</span> • SSE Active</div>
        </div>
        </>
        )}
      </div>
    </div>
  );
};
