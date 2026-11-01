/**
 * BUG-010: the Chat behavior popover closes when you click or focus outside
 * it (e.g. into the composer textarea) — not only on Escape.
 *
 * No DOM env in this repo's vitest, so this pins the real seam at source
 * level: the open-state effect must wire document-level pointerdown +
 * focusin outside-close handlers and clean them up.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/ui/chat/CapabilitiesPopover.tsx', 'utf8');

describe('CapabilitiesPopover outside-close', () => {
  it('listens for pointerdown outside the popover to close', () => {
    expect(src).toMatch(/['"]pointerdown['"]/);
    expect(src).toMatch(/contains\(/);
    expect(src).toMatch(/setOpen\(false\)/);
  });

  it('listens for focusin outside the popover to close', () => {
    expect(src).toMatch(/['"]focusin['"]/);
  });

  it('cleans up all listeners when the popover closes or unmounts', () => {
    expect(src).toMatch(/removeEventListener/);
  });
});
