import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Trash2, Copy, Check, X, ArrowDown } from 'lucide-react';
import { logger } from '../utils/logger';

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
}

export const ServerLogsModal: React.FC<ServerLogsModalProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<ServerLogItem[]>([]);
  const [filterText, setFilterText] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Connect to SSE Log stream
  useEffect(() => {
    if (!isOpen) return;

    // Fetch initial logs
    fetch('/api/server-logs')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
      })
      .catch((err) => logger.error('ServerLogs', 'Failed to load initial server logs', err));

    // Connect to live SSE stream
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
  }, [isOpen]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && isOpen) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isOpen]);

  if (!isOpen) return null;

  const handleClear = async () => {
    try {
      await fetch('/api/server-logs/clear', { method: 'POST' });
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
        return 'text-[#f87171] bg-[#451214] border-[#7f1d1d]';
      case 'warn':
        return 'text-[#fbbf24] bg-[#422006] border-[#854d0e]';
      case 'success':
        return 'text-[#34d399] bg-[#064e3b] border-[#047857]';
      default:
        return 'text-[#38bdf8] bg-[#0c2e4e] border-[#075985]';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="relative w-full max-w-5xl h-[85vh] bg-[#070b12] border border-[#1b2a40] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#d6e3f5] font-mono animate-in fade-in zoom-in-95 duration-200">
        {/* Header Bar */}
        <div className="px-5 py-3.5 bg-[#0b121e] border-b border-[#162338] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#142338] border border-[#1e3555] flex items-center justify-center text-[#38bdf8]">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white tracking-wide">Live Server Telemetry & Logs</h2>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>
              <p className="text-[10px] text-[#6b82a3]">Real-time backend streaming logs from Express & Gemini API</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-2.5 py-1.5 rounded-lg bg-[#111a2a] hover:bg-[#18263e] border border-[#1d2d47] text-xs text-[#8ab1e0] transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Copy all logs"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              onClick={handleClear}
              className="px-2.5 py-1.5 rounded-lg bg-[#111a2a] hover:bg-[#2e1518] hover:text-[#f87171] border border-[#1d2d47] text-xs text-[#8ab1e0] transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Clear log buffer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[#18263e] text-[#7187a5] hover:text-white transition-colors cursor-pointer"
              title="Close log viewer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar: Filters & Controls */}
        <div className="px-5 py-2.5 bg-[#090e18] border-b border-[#141e2e] flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter logs by tag or keyword (e.g. STREAM, GEMINI, REQ)..."
              className="w-full max-w-md bg-[#05080f] border border-[#162338] rounded-lg px-3 py-1.5 text-xs text-[#eef4fc] placeholder-[#4f6480] focus:outline-none focus:border-[#38bdf8]"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-[#05080f] p-1 rounded-lg border border-[#162338]">
              {['all', 'info', 'warn', 'error', 'success'].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setSelectedLevel(lvl)}
                  className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold transition-colors cursor-pointer ${
                    selectedLevel === lvl
                      ? 'bg-[#1b2b44] text-[#38bdf8]'
                      : 'text-[#506684] hover:text-[#9bb0d1]'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>

            <button
              onClick={() => setAutoScroll((prev) => !prev)}
              className={`px-2.5 py-1 rounded-lg border text-[11px] flex items-center gap-1 transition-colors cursor-pointer ${
                autoScroll
                  ? 'bg-[#12243d] border-[#1e3c66] text-[#38bdf8]'
                  : 'bg-[#080d16] border-[#162338] text-[#556c8c]'
              }`}
            >
              <ArrowDown className="w-3 h-3" />
              <span>Auto-scroll</span>
            </button>
          </div>
        </div>

        {/* Log Viewer Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1.5 text-[11px] leading-relaxed selection:bg-[#203657]">
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[#556985] space-y-2 py-16">
              <Terminal className="w-8 h-8 opacity-40" />
              <p>No server log events recorded yet matching your filter.</p>
              <p className="text-[10px] text-[#3e5068]">Interact with chat or trigger an action to generate live backend events.</p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const time = log.timestamp.split('T')[1]?.slice(0, 12) || '';
              return (
                <div
                  key={log.id}
                  className="group flex items-start gap-2.5 px-2.5 py-1.5 rounded hover:bg-[#0c1422] transition-colors border-l-2 border-transparent hover:border-[#22395b]"
                >
                  <span className="text-[#4f6480] tabular-nums shrink-0">{time}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] font-semibold uppercase tracking-wider shrink-0 border ${getLevelStyle(
                      log.level
                    )}`}
                  >
                    {log.tag}
                  </span>
                  <span className="flex-1 text-[#e1ebf7] break-all">
                    {log.message}
                    {log.meta && (
                      <span className="text-[#7c9bc2] block text-[10px] mt-0.5 opacity-90">
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

        {/* Footer Status Bar */}
        <div className="px-5 py-2 bg-[#080c14] border-t border-[#131d2d] flex items-center justify-between text-[10px] text-[#556a88] shrink-0">
          <div>
            Showing <span className="text-[#a4bad6]">{filteredLogs.length}</span> of{' '}
            <span className="text-[#a4bad6]">{logs.length}</span> total entries
          </div>
          <div>Endpoint: <span className="text-[#38bdf8]">/api/chat/stream</span> • SSE Active</div>
        </div>
      </div>
    </div>
  );
};
