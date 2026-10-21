/**
 * Chat bubble view preference and per-message overrides.
 *
 * The rule these guard: the global switch must be TOTAL (an unflipped bubble
 * always follows it), and a hand-flipped bubble must stay where the hand put
 * it until the switch moves again. Both bugs are silent — the feed simply
 * shows the wrong thing — so they are asserted rather than trusted.
 */
import { describe, it, expect } from 'vitest';
import {
  parseChatRenderMode,
  messageIsRaw,
  flipMessageView,
} from '../ui/chat/chatRenderMode';

describe('parseChatRenderMode', () => {
  it('defaults to markdown when nothing is stored', () => {
    expect(parseChatRenderMode(null)).toBe('markdown');
    expect(parseChatRenderMode(undefined)).toBe('markdown');
    expect(parseChatRenderMode('')).toBe('markdown');
  });

  it('restores an explicit raw choice', () => {
    expect(parseChatRenderMode('raw')).toBe('raw');
  });

  it('ignores junk instead of guessing', () => {
    expect(parseChatRenderMode('RAW')).toBe('markdown');
    expect(parseChatRenderMode('rendered')).toBe('markdown');
    expect(parseChatRenderMode(' raw')).toBe('markdown');
  });
});

describe('messageIsRaw', () => {
  it('follows the global switch until the bubble is flipped', () => {
    expect(messageIsRaw({}, 'turn-1', 'markdown')).toBe(false);
    expect(messageIsRaw({}, 'turn-1', 'raw')).toBe(true);
  });

  it('lets one flipped bubble disagree with the switch in both directions', () => {
    expect(messageIsRaw({ 'turn-1': true }, 'turn-1', 'markdown')).toBe(true);
    expect(messageIsRaw({ 'turn-1': false }, 'turn-1', 'raw')).toBe(false);
  });

  it('is per message, not per feed', () => {
    const overrides = { 'turn-1': true };
    expect(messageIsRaw(overrides, 'turn-1', 'markdown')).toBe(true);
    expect(messageIsRaw(overrides, 'turn-2', 'markdown')).toBe(false);
  });
});

describe('flipMessageView', () => {
  it('flips the effective view, not a guess at it', () => {
    // Global raw, never flipped → the bubble is already raw, so a click must
    // *unraw* it. Flipping `undefined` naively would leave it raw and the
    // button would look dead.
    const fromGlobalRaw = flipMessageView({}, 'turn-1', 'raw');
    expect(fromGlobalRaw['turn-1']).toBe(false);

    const fromGlobalMarkdown = flipMessageView({}, 'turn-1', 'markdown');
    expect(fromGlobalMarkdown['turn-1']).toBe(true);
  });

  it('flips back to the original view on a second click', () => {
    const once = flipMessageView({}, 'turn-1', 'markdown');
    const twice = flipMessageView(once, 'turn-1', 'markdown');
    expect(twice['turn-1']).toBe(false);
    expect(messageIsRaw(twice, 'turn-1', 'markdown')).toBe(false);
  });

  it('does not mutate the previous overrides', () => {
    const before = { 'turn-1': true };
    const after = flipMessageView(before, 'turn-2', 'markdown');
    expect(before).toEqual({ 'turn-1': true });
    expect(after).toEqual({ 'turn-1': true, 'turn-2': true });
  });

  it('leaves other bubbles untouched', () => {
    const before = { 'turn-1': true, 'turn-2': false };
    const after = flipMessageView(before, 'turn-2', 'markdown');
    expect(after['turn-1']).toBe(true);
    expect(after['turn-2']).toBe(true);
  });
});
