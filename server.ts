// Thin entry point (package.json runs `tsx server.ts`).
// Layered env loading + all app/route/provider code lives under server/.
import './server/lib/env';
import { startServer } from './server/app';
import { logServer } from './server/lib/log';

startServer().catch((err) => {
  logServer('error', 'SERVER', `Failed to start server: ${err instanceof Error ? err.message : err}`, err);
  process.exit(1);
});
