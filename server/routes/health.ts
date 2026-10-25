import type { Express, Request, Response } from 'express';
import { serverLogsBuffer } from '../lib/log';
import { resolveServerMode } from '../lib/mode';

export function registerHealthRoutes(app: Express): void {
app.get('/api/health', (_req: Request, res: Response) => {
  const mode = resolveServerMode(process.env);
  res.json({
    status: 'ok',
    mode,
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString(),
    logsCount: serverLogsBuffer.length,
  });
});
}
