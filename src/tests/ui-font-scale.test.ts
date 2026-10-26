/**
 * uiFontScale — interface text size preference (sidebar → Text size).
 * Same contract as the other reading preferences: junk falls back to the
 * default, the default is the ABSENCE of the localStorage key, and the scale
 * reaches the document through the root font size + the --ui-scale variable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  applyUiFontScale,
  loadUiFontScale,
  parseUiFontScale,
  saveUiFontScale,
} from '../ui/uiFontScale';

function stubWindow(seed: Record<string, string> = {}) {
  const storage = new Map(Object.entries(seed));
  vi.stubGlobal('window', {
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
  const style = new Map<string, string>();
  const dataset: Record<string, string> = {};
  vi.stubGlobal('document', {
    documentElement: {
      dataset,
      style: {
        setProperty: (k: string, v: string) => style.set(k, v),
        removeProperty: (k: string) => style.delete(k),
      },
    },
  });
  return { storage, style, dataset };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uiFontScale parsing', () => {
  it('junk falls back to the default', () => {
    expect(parseUiFontScale(null)).toBe(1);
    expect(parseUiFontScale('')).toBe(1);
    expect(parseUiFontScale('big')).toBe(1);
    expect(parseUiFontScale('1.31')).toBe(1);
    expect(parseUiFontScale('0')).toBe(1);
  });

  it('every offered step round-trips', () => {
    expect(parseUiFontScale('1')).toBe(1);
    expect(parseUiFontScale('1.15')).toBe(1.15);
    expect(parseUiFontScale('1.3')).toBe(1.3);
    expect(parseUiFontScale('1.5')).toBe(1.5);
  });

  it('no window at all degrades to the default', () => {
    vi.stubGlobal('window', undefined as unknown as Window);
    expect(loadUiFontScale()).toBe(1);
  });
});

describe('uiFontScale storage', () => {
  it('the default is stored as absence of the key', () => {
    const { storage } = stubWindow();
    saveUiFontScale(1.3);
    expect(storage.get('markbrain:fontScale')).toBe('1.3');
    expect(loadUiFontScale()).toBe(1.3);
    saveUiFontScale(1);
    expect(storage.has('markbrain:fontScale')).toBe(false);
    expect(loadUiFontScale()).toBe(1);
  });
});

describe('applyUiFontScale', () => {
  it('the default removes the attribute and pins --ui-scale to 1', () => {
    const { style, dataset } = stubWindow();
    applyUiFontScale(1);
    expect(dataset.fontScale).toBeUndefined();
    expect(style.get('--ui-scale')).toBe('1');
  });

  it('a step sets the data attribute that drives the token table', () => {
    const { dataset, style } = stubWindow();
    applyUiFontScale(1.15);
    expect(dataset.fontScale).toBe('115');
    expect(style.get('--ui-scale')).toBe('1.15');
    applyUiFontScale(1);
    expect(dataset.fontScale).toBeUndefined();
  });
});