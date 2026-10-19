import './lib/env'; // layered dotenv loading — must evaluate before any process.env reads

import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { logServer } from './lib/log';
import './providers/gemini'; // eager Gemini client init (same timing as the monolith: after log infra, before routes)
import { registerServerLogsRoutes } from './routes/logs';
import { registerHealthRoutes } from './routes/health';
import { registerModelsRoutes } from './routes/models';
import { registerAuthRoutes } from './routes/auth';
import { registerChatRoutes } from './routes/chat';
import { registerSummarizeRoutes } from './routes/summarize';
import { registerTitleRoutes } from './routes/title';
import { registerTtsRoutes } from './routes/tts';
import { registerExtractRoutes } from './routes/extract';

// Project root (this file lives in server/), so __dirname keeps the same
// meaning it had in the old top-level server.ts — path.join(__dirname, 'dist')
// below resolves identically.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(path.dirname(__filename));

export const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '10mb' }));

// Global request counter & middleware instrumentation
let globalReqCounter = 0;
app.use((req, res, next) => {
  if (req.path.startsWith('/api') && !req.path.includes('/server-logs')) {
    const reqId = ++globalReqCounter;
    (req as any).reqId = reqId;
    const start = Date.now();
    logServer('info', 'API:REQ', `#${reqId} ${req.method} ${req.path}`);

    res.on('finish', () => {
      const dur = Date.now() - start;
      const level = res.statusCode >= 400 ? 'error' : 'success';
      logServer(level, 'API:RES', `#${reqId} ${req.method} ${req.path} -> HTTP ${res.statusCode} (${dur}ms)`);
    });
  }
  next();
});

// Route modules — mounted in the original registration order.
registerServerLogsRoutes(app);
registerHealthRoutes(app);
registerModelsRoutes(app); // GET /api/models — server-owned model catalog
registerAuthRoutes(app);
registerChatRoutes(app);
registerSummarizeRoutes(app);
registerTitleRoutes(app);
registerTtsRoutes(app);
registerExtractRoutes(app);

// Dev vs Prod Vite Mounting
const isProd = process.env.NODE_ENV === 'production';

export async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    logServer('info', 'SERVER', `Server listening on http://0.0.0.0:${port}`);
  });
}
