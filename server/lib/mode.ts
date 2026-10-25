/**
 * Server mode — static shell vs content proxy (design-docs/16 §3.3, Phase 2).
 *
 * SHELL MODE is the public default: the server serves static files, health,
 * auth config and the public model catalog, and mounts NONE of the
 * content-bearing routes (chat/summarize/title/tts/extract/search-index).
 * Nothing a user types ever reaches this process. That is D1/D5/D6 made
 * mechanical: no server-side keys to abuse, no content in RAM.
 *
 * PROXY MODE (the dev convenience) keeps today's server-key behavior: routes
 * mount and the server's GEMINI_API_KEY can answer. It is opt-in where it
 * could cost money and opt-out where it can't:
 *
 *   MARKBRAIN_SHELL=1        → shell, always (wins over everything)
 *   production               → shell, unless MARKBRAIN_PROXY=1 (explicit opt-in)
 *   dev (NODE_ENV != prod)   → proxy when GEMINI_API_KEY is set, else shell
 *
 * The production default is the FAIL-SAFE direction on purpose (D5: "as long
 * as it does not cost me money or trouble"). A stray GEMINI_API_KEY on a
 * public box must NOT silently open a free proxy for the internet; the
 * operator has to type MARKBRAIN_PROXY=1 and mean it.
 */

export type ServerMode = 'shell' | 'proxy';

/** All fields optional on purpose — tests pass partials, process.env is huge. */
export interface ServerModeEnv {
  NODE_ENV?: string;
  GEMINI_API_KEY?: string;
  MARKBRAIN_SHELL?: string;
  MARKBRAIN_PROXY?: string;
}

export function resolveServerMode(env: ServerModeEnv): ServerMode {
  if (env.MARKBRAIN_SHELL === '1') return 'shell';
  if (env.NODE_ENV === 'production') return env.MARKBRAIN_PROXY === '1' ? 'proxy' : 'shell';
  return env.GEMINI_API_KEY ? 'proxy' : 'shell';
}

/** Content routes that mount only in proxy mode. Health/models/auth/logs always mount. */
export const CONTENT_ROUTE_MARKERS = [
  '/api/chat',
  '/api/summarize-chapter',
  '/api/title-thread',
  '/api/tts',
  '/api/extract-artifact-from-file',
  '/api/search-index',
] as const;

/**
 * The honest answer when a content endpoint is asked for in shell mode.
 * Every call site already surfaces `error` from a JSON body — so the client
 * gets words, not a canned reply (§2: the demo note dies here).
 */
export const SHELL_MODE_ERROR =
  'This deployment runs in static-shell mode: no server-side API key and no proxy. ' +
  'Add your own key in Model Settings (gear icon next to the model picker) to use this feature.';
