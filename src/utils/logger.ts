/**
 * MarkBrain centralized logger.
 *
 * The instrumentation law (design-docs/05_CLEANSE_DECISIONS.md). Every line of
 * console output has to be earned:
 * - `action`  — exactly one per human gesture (tap send, toggle, confirm). NEVER
 *               from domain internals, NEVER from stream chunks, NEVER in loops.
 * - `info`    — lifecycle that is not a gesture (boot, load, turn completed).
 *               Guideline: ~1 per human action.
 * - `warn`    — EVERY fallback / silent-degradation branch, by definition.
 *               If a branch recovers from something unexpected, it warns.
 * - `error`   — user-visible failure, data-loss risk, contract violation.
 * - HARD RULE — max 16 events per human action. If honoring that is hard,
 *               do NOT add the logging. Never log hot loops.
 */

export type LogCategory =
  | 'App'
  | 'ChatView'
  | 'Sidebar'
  | 'DomainRegistry'
  | 'Timeline'
  | 'Segmentation'
  | 'Stream'
  | 'Persistence'
  | 'Auth'
  | 'AuthGate'
  | 'ProjectGenesis'
  | 'ErrorBoundary'
  // Open tail — any module may log without widening this union first.
  | (string & {});

export interface LogEntry {
  timestamp: string;
  category: LogCategory;
  level: 'info' | 'warn' | 'error' | 'action';
  message: string;
  details?: any;
}

const MAX_IN_MEMORY_LOGS = 200;
const logHistory: LogEntry[] = [];

function formatPrefix(category: LogCategory, level: string): string {
  const time = new Date().toISOString().substring(11, 23);
  return `[${time}] [MarkBrain:${category}] [${level.toUpperCase()}]`;
}

export const logger = {
  info(category: LogCategory, message: string, details?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      category,
      level: 'info',
      message,
      details,
    };
    logHistory.push(entry);
    if (logHistory.length > MAX_IN_MEMORY_LOGS) logHistory.shift();

    const prefix = formatPrefix(category, 'info');
    if (details !== undefined) {
      console.log(`%c${prefix}%c ${message}`, 'color: #38bdf8; font-weight: bold;', 'color: inherit;', details);
    } else {
      console.log(`%c${prefix}%c ${message}`, 'color: #38bdf8; font-weight: bold;', 'color: inherit;');
    }
  },

  action(category: LogCategory, actionName: string, payload?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      category,
      level: 'action',
      message: `User Action: ${actionName}`,
      details: payload,
    };
    logHistory.push(entry);
    if (logHistory.length > MAX_IN_MEMORY_LOGS) logHistory.shift();

    const prefix = formatPrefix(category, 'action');
    if (payload !== undefined) {
      console.log(`%c${prefix}%c User Action: ${actionName}`, 'color: #a855f7; font-weight: bold;', 'color: #e9d5ff;', payload);
    } else {
      console.log(`%c${prefix}%c User Action: ${actionName}`, 'color: #a855f7; font-weight: bold;', 'color: #e9d5ff;');
    }
  },

  warn(category: LogCategory, message: string, details?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      category,
      level: 'warn',
      message,
      details,
    };
    logHistory.push(entry);
    if (logHistory.length > MAX_IN_MEMORY_LOGS) logHistory.shift();

    const prefix = formatPrefix(category, 'warn');
    if (details !== undefined) {
      console.warn(`%c${prefix}%c ${message}`, 'color: #f59e0b; font-weight: bold;', 'color: inherit;', details);
    } else {
      console.warn(`%c${prefix}%c ${message}`, 'color: #f59e0b; font-weight: bold;', 'color: inherit;');
    }
  },

  error(category: LogCategory, message: string, error?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      category,
      level: 'error',
      message,
      details: error,
    };
    logHistory.push(entry);
    if (logHistory.length > MAX_IN_MEMORY_LOGS) logHistory.shift();

    const prefix = formatPrefix(category, 'error');
    console.error(`%c${prefix}%c ${message}`, 'color: #ef4444; font-weight: bold;', 'color: #fca5a5;', error || '');
  },

  getHistory(): LogEntry[] {
    return [...logHistory];
  },
};
