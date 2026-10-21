/**
 * Copy must fail *loudly* (return false, which the caller logs) rather than
 * silently doing nothing — and it must still work where `navigator.clipboard`
 * does not exist, which is every plain-http LAN address this app is opened on.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { copyText } from '../utils/clipboard';

type Any = Record<string, unknown>;

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

function setGlobal(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

interface FallbackSpy {
  written: string[];
  copied: string[];
  execResult: boolean;
  detached: number;
}

/**
 * The legacy route: a readonly textarea is mounted, selected, copied, removed.
 * Stubbed down to exactly the parts clipboard.ts touches.
 */
function installLegacyDom(execResult = true): FallbackSpy {
  const spy: FallbackSpy = { written: [], copied: [], detached: 0, execResult };
  setGlobal('document', {
    createElement: () => {
      const area: Any = { style: {}, setAttribute: () => {}, select() { spy.copied.push(String(area.value)); } };
      return area;
    },
    body: {
      appendChild: (area: Any) => { spy.written.push(String(area.value)); },
      removeChild: () => { spy.detached++; },
    },
    execCommand: () => execResult,
  });
  return spy;
}

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete (globalThis as Any).document;
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('writes the exact markdown source through the async API', async () => {
    const writes: string[] = [];
    setGlobal('navigator', { clipboard: { writeText: async (t: string) => { writes.push(t); } } });

    const source = '# Title\n\n- **one**\n- two\n';
    await expect(copyText(source)).resolves.toBe(true);
    expect(writes).toEqual([source]);
  });

  it('falls back to the legacy route when the async API is missing', async () => {
    setGlobal('navigator', {}); // plain-http LAN: no navigator.clipboard at all
    const dom = installLegacyDom(true);

    const source = 'a fence:\n\n```ts\nconst x = 1;\n```';
    await expect(copyText(source)).resolves.toBe(true);
    expect(dom.copied).toEqual([source]);
    expect(dom.detached, 'the textarea must not be left in the document').toBe(1);
  });

  it('falls back when the async API rejects (permission denied)', async () => {
    setGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
    const dom = installLegacyDom(true);

    await expect(copyText('text')).resolves.toBe(true);
    expect(dom.copied).toEqual(['text']);
  });

  it('reports failure when both routes are unavailable', async () => {
    setGlobal('navigator', {});
    await expect(copyText('text')).resolves.toBe(false); // no `document` in node
  });

  it('reports failure when execCommand refuses', async () => {
    setGlobal('navigator', {});
    installLegacyDom(false);
    await expect(copyText('text')).resolves.toBe(false);
  });
});
