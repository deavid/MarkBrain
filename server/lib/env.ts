import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
// Project root is two levels up from server/lib/env.ts.
const __dirname = path.resolve(path.dirname(__filename), '../..');

// Layered env loading (env files have no native "import" — we layer them).
// Precedence = load order; earlier loads win, real OS/runtime env beats all:
//   1. .env                                   per worktree (PORT only, gitignored)
//   2. .env.shared                            per worktree extras, e.g. flags (gitignored)
//   3. ../MarkBrain/.env.markbrain-main.shared canonical credentials shared by all
//      sibling worktrees (resolved from THIS file's dir, not cwd; gitignored via
//      .env*; silently skipped when absent — nothing breaks before it exists).
dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '.env.shared'), quiet: true });
dotenv.config({
  path: path.resolve(__dirname, '../MarkBrain/.env.markbrain-main.shared'),
  quiet: true,
});
