import './lib/env'; // layered dotenv loading — must evaluate before any process.env reads

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { logServer } from './lib/log';
import { cspHeader } from './lib/csp';
import { getDb } from './db';
import { ensureOwnerBootstrap } from './lib/users';
import { registerAccountRoutes, requireAuth } from './routes/account';
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

const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));

// Small CORS seam (design-docs/21B §7.2): custom server URLs + Caddy
// same-origin both work; only the headers auth needs are allowed through.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

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

// Public: health + model catalog (the static shell and proxy agree on them).
registerHealthRoutes(app);
registerModelsRoutes(app); // GET /api/models — server-owned model catalog

// Auth/admin/account: public login + session-scoped routes (own middleware).
registerAccountRoutes(app);

// Content + log routes: ONE law now (design-docs/21B §7) — unauthenticated
// requests get 401; authenticated requests use the caller's own vault key.
// The old shell/proxy mode split (server/lib/mode.ts) is gone.
const GATED_PATHS = [
  '/api/chat',
  '/api/summarize-chapter',
  '/api/title-thread',
  '/api/tts',
  '/api/extract-artifact-from-file',
  '/api/search-index',
  '/api/server-logs',
];
for (const p of GATED_PATHS) {
  app.use(p, requireAuth);
}

registerServerLogsRoutes(app);
registerChatRoutes(app);
registerSummarizeRoutes(app);
registerTitleRoutes(app);
registerTtsRoutes(app);
registerExtractRoutes(app);
registerSearchIndexRoutes(app);
logServer('success', 'SERVER', 'Content routes mounted behind requireAuth (per-user vault keys)');

export async function startServer() {
  // SQLite + immutable Owner #1 (design-docs/21B §4.1).
  getDb();
  const owner = ensureOwnerBootstrap();
  if (owner) logServer('success', 'USERS', `Owner account bootstrapped: ${owner.email} (id=${owner.id})`);

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
