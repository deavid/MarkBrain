import type { Express, Request, Response } from 'express';
import { serverLogsBuffer } from '../lib/log';

export function registerHealthRoutes(app: Express): void {
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString(),
    logsCount: serverLogsBuffer.length,
  });
});
}
