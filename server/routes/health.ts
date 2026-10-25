import type { Express, Request, Response } from 'express';
import { serverLogsBuffer } from '../lib/log';

export function registerHealthRoutes(app: Express): void {
app.get('/api/health', (_req: Request, res: Response) => {
  // Shell/proxy mode split is gone (design-docs/21B §7): keys are per-user
  // vault entries now, never process.env. Health stays public + honest.
  res.json({
    status: 'ok',
    authRequired: true,
    time: new Date().toISOString(),
    logsCount: serverLogsBuffer.length,
  });
});
}
