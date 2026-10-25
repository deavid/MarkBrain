/**
 * Static-shell mode + CSP (design-docs/16 §3.3, §4.2 Tier 2.3).
 * Pins the fail-safe direction: a stray GEMINI_API_KEY on a production box
 * must NOT open a public proxy — proxy in prod is explicit opt-in (D5).
 */
import { describe, it, expect } from 'vitest';
import { resolveServerMode, SHELL_MODE_ERROR, CONTENT_ROUTE_MARKERS } from '../../server/lib/mode';
import { cspHeader } from '../../server/lib/csp';

describe('resolveServerMode', () => {
  it('MARKBRAIN_SHELL=1 forces shell over everything', () => {
    expect(
      resolveServerMode({ NODE_ENV: 'production', GEMINI_API_KEY: 'x', MARKBRAIN_SHELL: '1', MARKBRAIN_PROXY: '1' })
    ).toBe('shell');
    expect(
      resolveServerMode({ NODE_ENV: 'development', GEMINI_API_KEY: 'x', MARKBRAIN_SHELL: '1' })
    ).toBe('shell');
  });

  it('production defaults to SHELL — a stray key must not open a public proxy (D5)', () => {
    expect(resolveServerMode({ NODE_ENV: 'production', GEMINI_API_KEY: 'x' })).toBe('shell');
    expect(resolveServerMode({ NODE_ENV: 'production' })).toBe('shell');
  });

  it('production proxy is explicit opt-in', () => {
    expect(
      resolveServerMode({ NODE_ENV: 'production', GEMINI_API_KEY: 'x', MARKBRAIN_PROXY: '1' })
    ).toBe('proxy');
  });

  it('dev is proxy when a key exists, shell otherwise', () => {
    expect(resolveServerMode({ NODE_ENV: 'development', GEMINI_API_KEY: 'x' })).toBe('proxy');
    expect(resolveServerMode({ NODE_ENV: 'development' })).toBe('shell');
    expect(resolveServerMode({ GEMINI_API_KEY: 'x' })).toBe('proxy');
    expect(resolveServerMode({})).toBe('shell');
  });

  it('proxy without a key is allowed only when explicitly asked (dev demo)', () => {
    // Explicitly opting in without a key = canned-fallback mode for the
    // evidence harness; still fine, still explicit.
    expect(resolveServerMode({ NODE_ENV: 'production', MARKBRAIN_PROXY: '1' })).toBe('proxy');
  });
});

describe('shell-mode error surface', () => {
  it('names the fix (key in Model Settings), never a canned reply', () => {
    expect(SHELL_MODE_ERROR).toContain('key');
    expect(SHELL_MODE_ERROR).toContain('Model Settings');
  });

  it('covers exactly the content-bearing endpoints', () => {
    expect([...CONTENT_ROUTE_MARKERS]).toEqual([
      '/api/chat',
      '/api/summarize-chapter',
      '/api/title-thread',
      '/api/tts',
      '/api/extract-artifact-from-file',
      '/api/search-index',
    ]);
  });
});

describe('cspHeader', () => {
  it('production script-src is exactly self — no Google script origins (design-docs/19)', () => {
    const csp = cspHeader(false);
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).toBe("script-src 'self'");
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
    expect(scriptSrc).not.toContain('apis.google.com');
  });

  it('connect-src allows exactly the two model providers, no firebase/google families', () => {
    for (const csp of [cspHeader(false), cspHeader(true)]) {
      expect(csp).toContain('https://generativelanguage.googleapis.com');
      expect(csp).toContain('https://openrouter.ai');
      expect(csp).not.toContain('firebaseapp.com');
      expect(csp).not.toContain('firebaseio.com');
      expect(csp).not.toContain('apis.google.com');
    }
  });

  it('dev relaxes only what HMR + Fast Refresh need', () => {
    const csp = cspHeader(true);
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(csp).toContain('ws:');
  });

  it('frame-src is self — markdown never emits iframes', () => {
    expect(cspHeader(false)).toContain("frame-src 'self'");
  });

  it('containment directives that kill the cheap bypasses', () => {
    const csp = cspHeader(false);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('*;');
    const withoutStars = csp.replace(/[a-z-]+ \*'[^']*'?/g, '');
    expect(csp).not.toMatch(/https:\/\/\*/);
  });
});
