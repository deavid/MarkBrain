/**
 * Search testbed config — persistence, junk resilience, URL overrides.
 *
 * The whole testbed is only useful if a reload keeps the last experiment and
 * a bookmarked probe can force a combination without fighting saved state.
 * Node has no window by default, so each test stubs exactly the surface the
 * module touches and nothing more.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DEFAULT_SEARCH_CONFIG,
  SEARCH_CONFIG_KEY,
  SEARCH_METHOD_FLAGS,
  THRESHOLD_MIN,
  THRESHOLD_MAX,
  loadSearchConfig,
  saveSearchConfig,
  normalizeSearchConfig,
} from '../domains/search/searchConfig';

function stubWindow(search = '', seed: Record<string, string> = {}) {
  const storage = new Map<string, string>(Object.entries(seed));
  vi.stubGlobal('window', {
    location: { search },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
    },
  });
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadSearchConfig', () => {
  it('defaults when nothing is stored', () => {
    stubWindow();
    expect(loadSearchConfig()).toEqual(DEFAULT_SEARCH_CONFIG);
  });

  it('round-trips a non-default config through localStorage', () => {
    const storage = stubWindow();
    const saved = { ...DEFAULT_SEARCH_CONFIG, ftsQa: false, vecSections: false, threshold: 0.7 };
    saveSearchConfig(saved);
    expect(storage.has(SEARCH_CONFIG_KEY)).toBe(true);
    expect(loadSearchConfig()).toEqual(saved);
  });

  it('treats the default state as the absence of a key', () => {
    const storage = stubWindow();
    storage.set(SEARCH_CONFIG_KEY, JSON.stringify({ ...DEFAULT_SEARCH_CONFIG, threshold: 0.9 }));
    saveSearchConfig({ ...DEFAULT_SEARCH_CONFIG });
    expect(storage.has(SEARCH_CONFIG_KEY)).toBe(false);
    expect(loadSearchConfig()).toEqual(DEFAULT_SEARCH_CONFIG);
  });

  it('falls back field-by-field on junk values', () => {
    stubWindow('', {
      [SEARCH_CONFIG_KEY]: JSON.stringify({
        ftsSections: 'yes', // not a boolean → default stands
        vecQa: false, // valid → honoured
        threshold: 'banana', // not a number → default stands
        notAFlag: true, // unknown → dropped
      }),
    });
    const cfg = loadSearchConfig();
    expect(cfg.ftsSections).toBe(DEFAULT_SEARCH_CONFIG.ftsSections);
    expect(cfg.vecQa).toBe(false);
    expect(cfg.threshold).toBe(DEFAULT_SEARCH_CONFIG.threshold);
    expect('notAFlag' in cfg).toBe(false);
  });

  it('falls back to pure defaults on malformed JSON', () => {
    stubWindow('', { [SEARCH_CONFIG_KEY]: '{nope' });
    expect(loadSearchConfig()).toEqual(DEFAULT_SEARCH_CONFIG);
  });

  it('clamps threshold into the slider range', () => {
    expect(normalizeSearchConfig({ threshold: 0.99 }).threshold).toBe(THRESHOLD_MAX);
    expect(normalizeSearchConfig({ threshold: -3 }).threshold).toBe(THRESHOLD_MIN);
    expect(normalizeSearchConfig({ threshold: 0.61 }).threshold).toBeCloseTo(0.61, 5);
    expect(normalizeSearchConfig({ threshold: Number.NaN }).threshold).toBe(
      DEFAULT_SEARCH_CONFIG.threshold
    );
  });

  it('lets URL overrides win over stored state', () => {
    stubWindow('?searchMethods=ftsSections,vecQa&searchThreshold=0.6', {
      // Stored state disagrees on every axis — the URL must still win.
      [SEARCH_CONFIG_KEY]: JSON.stringify({
        ...DEFAULT_SEARCH_CONFIG,
        ftsSections: false,
        vecQa: false,
        splitClauses: false,
        threshold: 0.8,
      }),
    });
    const cfg = loadSearchConfig();
    expect(cfg.ftsSections).toBe(true);
    expect(cfg.vecQa).toBe(true);
    expect(cfg.ftsQa).toBe(false); // named methods only
    expect(cfg.vecSections).toBe(false);
    expect(cfg.splitClauses).toBe(false);
    expect(cfg.threshold).toBeCloseTo(0.6, 5);
  });

  it('honours a single-method URL without clobbering the threshold', () => {
    stubWindow('?searchMethods=ftsQa', {
      [SEARCH_CONFIG_KEY]: JSON.stringify({ ...DEFAULT_SEARCH_CONFIG, threshold: 0.75 }),
    });
    const cfg = loadSearchConfig();
    for (const flag of SEARCH_METHOD_FLAGS) {
      expect(cfg[flag]).toBe(flag === 'ftsQa');
    }
    // No searchThreshold param → stored threshold survives under the URL flags.
    expect(cfg.threshold).toBeCloseTo(0.75, 5);
  });
});

describe('normalizeSearchConfig', () => {
  it('accepts a non-object without throwing', () => {
    expect(normalizeSearchConfig(null)).toEqual(DEFAULT_SEARCH_CONFIG);
    expect(normalizeSearchConfig('nonsense')).toEqual(DEFAULT_SEARCH_CONFIG);
    expect(normalizeSearchConfig(42)).toEqual(DEFAULT_SEARCH_CONFIG);
  });
});
