import './lib/env'; // layered dotenv loading — must evaluate before any process.env reads

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { logServer } from './lib/log';
import './providers/gemini'; // eager Gemini client init (same timing as the monolith: after log infra, before routes)
import { resolveServerMode, SHELL_MODE_ERROR } from './lib/mode';
import { cspHeader } from './lib/csp';
import { registerServerLogsRoutes } from './routes/logs';
import { registerHealthRoutes } from './routes/health';
import { registerModelsRoutes } from './routes/models';
import { registerChatRoutes } from './routes/chat';
import { registerSummarizeRoutes } from './routes/summarize';
import { registerTitleRoutes } from './routes/title';
import { registerTtsRoutes } from './routes/tts';
import { registerExtractRoutes } from './routes/extract';
import { registerSearchIndexRoutes } from './routes/searchIndex';


// Project root, not server/. This file lives one level down, so __dirname is
// re-derived here; path.join(__dirname, 'dist') below depends on that.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(path.dirname(__filename));

export const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

const serverMode = resolveServerMode(process.env);
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));

// CSP on every response (design-docs/16 §4.2 Tier 2.3). Strict in production,
// relaxed in dev only for Vite HMR + React Fast Refresh inline scripts.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Content-Security-Policy', cspHeader(!isProd));
  next();
});

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

// Health + models always mount: static-shell and proxy agree on them.
registerServerLogsRoutes(app);
registerHealthRoutes(app);
registerModelsRoutes(app); // GET /api/models — server-owned model catalog

if (serverMode === 'proxy') {
  registerChatRoutes(app);
  registerSummarizeRoutes(app);
  registerTitleRoutes(app);
  registerTtsRoutes(app);
  registerExtractRoutes(app);
  registerSearchIndexRoutes(app);
  logServer('success', 'SERVER', `Mode: PROXY — content routes mounted (server key ${process.env.GEMINI_API_KEY ? 'present' : 'absent; canned fallbacks only'})`);
} else {
  // Static shell (D1/D5/D6): no content route mounts, nothing a user types
  // ever reaches this process. The 404 body is the honest empty state —
  // every call site surfaces `error` already; no canned reply (§2).
  const contentPaths = [
    '/api/chat/stream',
    '/api/chat/cancel',
    '/api/summarize-chapter',
    '/api/title-thread',
    '/api/tts',
    '/api/extract-artifact-from-file',
    '/api/search-index/generate-qa',
    '/api/search-index/embed',
  ];
  for (const p of contentPaths) {
    app.all(p, (_req: Request, res: Response) => {
      res.status(501).json({ error: SHELL_MODE_ERROR, shellMode: true });
    });
  }
  logServer('success', 'SERVER', 'Mode: SHELL — static hosting only, content routes not mounted');
}

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
