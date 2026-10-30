import type { Express, Request, Response } from 'express';
import { logServer, serverLogsBuffer, logSubscribers, type ServerLogEntry } from '../lib/log';
import { requireAuth, requireOwner } from './account';
import { listCallLogs, getCallLog } from '../lib/callRecorder';

export function registerServerLogsRoutes(app: Express): void {
// Flight recorder read paths (design-docs/28 §4.2): own-user only, enforced
// by requireAuth + the user_id filter inside the recorder.
app.get('/api/logs/calls', requireAuth, (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 50;
  const beforeRaw = req.query.before;
  const before = beforeRaw ? Number(beforeRaw) : undefined;
  // Optional per-job filter: the chat receipts open this view pre-filtered to
  // the job that produced a given reply (raw sent/received for THAT message).
  const jobRaw = req.query.job;
  const job = typeof jobRaw === 'string' && jobRaw.length > 0 ? jobRaw : undefined;
  res.json({ calls: listCallLogs(req.user!.id, limit, Number.isFinite(before) ? before : undefined, job) });
});

app.get('/api/logs/calls/:id', requireAuth, (req: Request, res: Response) => {
  const call = getCallLog(req.user!.id, req.params.id);
  if (!call) return res.status(404).json({ error: 'Call log not found' });
  res.json({ call });
});

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
