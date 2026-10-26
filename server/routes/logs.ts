import type { Express, Request, Response } from 'express';
import { logServer, serverLogsBuffer, logSubscribers, type ServerLogEntry } from '../lib/log';
import { requireAuth, requireOwner } from './account';

export function registerServerLogsRoutes(app: Express): void {
app.get('/api/server-logs', requireOwner, (_req: Request, res: Response) => {
  res.json({ logs: serverLogsBuffer });
});

app.get('/api/server-logs/stream', requireOwner, (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const initial = JSON.stringify({ type: 'init', logs: serverLogsBuffer.slice(-60) });
  res.write(`event: log_init\ndata: ${initial}\n\n`);

  const handler = (entry: ServerLogEntry) => {
    res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
  };

  logSubscribers.add(handler);
  req.on('close', () => {
    logSubscribers.delete(handler);
  });
});

app.post('/api/server-logs/clear', requireOwner, (_req: Request, res: Response) => {
  serverLogsBuffer.length = 0;
  logServer('info', 'LOGS:CLEAR', 'Server logs buffer cleared by client');
  res.json({ success: true });
});
}
