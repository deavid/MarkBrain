/**
 * CSP contract (design-docs/16 §4.2 Tier 2.3, hardened by design-docs/19).
 *
 * The shell/proxy mode split (server/lib/mode.ts) was removed in Phase 2
 * (design-docs/21B §7): every content route now mounts behind requireAuth and
 * serves authenticated callers from their own vault key. This file now pins
 * the CSP laws only.
 */
import { describe, it, expect } from 'vitest';
import { cspHeader } from '../../server/lib/csp';

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
