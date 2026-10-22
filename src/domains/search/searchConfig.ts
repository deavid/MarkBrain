/**
 * searchConfig — the switchable flags of the draft-proximity testbed.
 *
 * The whole point of this feature is that David cannot tell on paper which
 * retrieval method is better for his 10–200 KiB documents. So all four signals
 * are stored, all four are queryable independently, and these flags decide
 * which ones score right now. They persist in localStorage so a reload keeps
 * the last experiment, and URL params override so a probe or a bookmark can
 * force a combination.
 */

export interface SearchTestbedConfig {
  /** Local BM25 over markdown sections + title/subtitle/tags/layers. */
  ftsSections: boolean;
  /** Local BM25 over LLM-generated Q&A pairs. */
  ftsQa: boolean;
  /** gemini-embedding-001 cosine similarity over markdown sections. */
  vecSections: boolean;
  /** gemini-embedding-001 cosine similarity over generated Q&A pairs. */
  vecQa: boolean;
  /** Split multi-sentence drafts so one topic can't average the others away. */
  splitClauses: boolean;
  /** Normalized score (0.20 .. 0.85) required to light the Attach badge. */
  threshold: number;
}

export const SEARCH_CONFIG_KEY = 'markbrain:searchConfig';

export const DEFAULT_SEARCH_CONFIG: SearchTestbedConfig = {
  ftsSections: true,
  ftsQa: true,
  vecSections: true,
  vecQa: true,
  splitClauses: true,
  threshold: 0.55,
};

export const SEARCH_METHOD_FLAGS = [
  'ftsSections',
  'ftsQa',
  'vecSections',
  'vecQa',
  'splitClauses',
] as const;

export type SearchMethodFlag = (typeof SEARCH_METHOD_FLAGS)[number];

export const THRESHOLD_MIN = 0.2;
export const THRESHOLD_MAX = 0.85;

const isFlag = (v: unknown): v is boolean =>
  v === true || v === false;

function clampThreshold(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SEARCH_CONFIG.threshold;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, Math.round(n * 100) / 100));
}

/** Merge any partial/junk object onto the defaults; unknown keys are dropped. */
export function normalizeSearchConfig(raw: unknown): SearchTestbedConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: SearchTestbedConfig = { ...DEFAULT_SEARCH_CONFIG };
  for (const flag of SEARCH_METHOD_FLAGS) {
    if (isFlag(src[flag])) out[flag] = src[flag];
  }
  out.threshold = clampThreshold(src.threshold);
  return out;
}

/**
 * URL wins over localStorage: `?searchMethods=ftsSections,vecQa&searchThreshold=0.6`
 * is how a probe pins one experiment without fighting the saved state.
 */
function readUrlOverride(): Partial<SearchTestbedConfig> {
  try {
    if (typeof window === 'undefined') return {};
    const params = new URLSearchParams(window.location.search);
    const out: Partial<SearchTestbedConfig> = {};
    const methods = params.get('searchMethods');
    if (methods !== null) {
      const wanted = new Set(
        methods.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
      );
      for (const flag of SEARCH_METHOD_FLAGS) out[flag] = wanted.has(flag);
    }
    const threshold = params.get('searchThreshold');
    if (threshold !== null) out.threshold = clampThreshold(threshold);
    return out;
  } catch {
    return {};
  }
}

export function loadSearchConfig(): SearchTestbedConfig {
  let stored: SearchTestbedConfig = { ...DEFAULT_SEARCH_CONFIG };
  try {
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem(SEARCH_CONFIG_KEY);
      if (raw) stored = normalizeSearchConfig(JSON.parse(raw));
    }
  } catch {
    stored = { ...DEFAULT_SEARCH_CONFIG };
  }
  return normalizeSearchConfig({ ...stored, ...readUrlOverride() });
}

export function saveSearchConfig(config: SearchTestbedConfig): void {
  try {
    if (typeof window === 'undefined') return;
    const normalized = normalizeSearchConfig(config);
    // Default state is the absence of a key — same contract as chatRenderMode.
    const isDefault =
      SEARCH_METHOD_FLAGS.every((f) => normalized[f] === DEFAULT_SEARCH_CONFIG[f]) &&
      normalized.threshold === DEFAULT_SEARCH_CONFIG.threshold;
    if (isDefault) window.localStorage.removeItem(SEARCH_CONFIG_KEY);
    else window.localStorage.setItem(SEARCH_CONFIG_KEY, JSON.stringify(normalized));
  } catch {
    // Private-mode storage failure must not break the sidebar toggle.
  }
}
