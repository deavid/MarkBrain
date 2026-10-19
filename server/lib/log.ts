// Server Telemetry & Ring Buffer Logging Subsystem
export interface ServerLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  tag: string;
  message: string;
  meta?: any;
}

export const serverLogsBuffer: ServerLogEntry[] = [];
export const logSubscribers: Set<(entry: ServerLogEntry) => void> = new Set();

export function logServer(level: 'info' | 'warn' | 'error' | 'success', tag: string, message: string, meta?: any) {
  const timestamp = new Date().toISOString();
  const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const entry: ServerLogEntry = { id, timestamp, level, tag, message, meta };

  serverLogsBuffer.push(entry);
  if (serverLogsBuffer.length > 350) {
    serverLogsBuffer.shift();
  }

  // Colored terminal logs
  const colors = {
    info: '\x1b[36m', // Cyan
    warn: '\x1b[33m', // Yellow
    error: '\x1b[31m', // Red
    success: '\x1b[32m', // Green
  };
  const reset = '\x1b[0m';
  const timeShort = timestamp.split('T')[1].slice(0, 8);
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`${colors[level]}[${timeShort}] [${tag}]${reset} ${message}${metaStr}`);

  // Broadcast to connected web clients
  logSubscribers.forEach((sub) => {
    try {
      sub(entry);
    } catch {
      // client disconnected
    }
  });
}
