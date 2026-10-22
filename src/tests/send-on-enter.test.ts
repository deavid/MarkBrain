/**
 * The composer's keyboard contract.
 *
 * Three keys, three fixed truths, and one preference:
 *   Shift+Enter    never sends — always a new line.
 *   Ctrl/Cmd+Enter always sends — on every keyboard, whatever the preference.
 *   Enter          obeys the `enterSend` preference (default: send).
 *
 * A slip here is silent and expensive: a swallowed Enter loses a message draft,
 * and Enter-that-seems-to-send inside an IME fires half-typed text. So the
 * decision is one pure function, pinned corner by corner, and the two composers
 * are asserted to actually call it rather than keep their own inline rule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseEnterSendMode,
  composerKeyAction,
  enterSendHint,
} from '../ui/chat/sendOnEnter';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('parseEnterSendMode', () => {
  it('defaults to send when nothing is stored', () => {
    expect(parseEnterSendMode(null)).toBe('send');
    expect(parseEnterSendMode(undefined)).toBe('send');
    expect(parseEnterSendMode('')).toBe('send');
  });

  it('restores the explicit new-line choice', () => {
    expect(parseEnterSendMode('newline')).toBe('newline');
  });

  it('ignores junk instead of guessing', () => {
    expect(parseEnterSendMode('NEWLINE')).toBe('send');
    expect(parseEnterSendMode('newLine')).toBe('send');
    expect(parseEnterSendMode(' newline')).toBe('send');
  });
});

describe('composerKeyAction', () => {
  it('sends a bare Enter under the default preference', () => {
    expect(composerKeyAction({ key: 'Enter' }, 'send')).toBe('send');
  });

  it('makes a new line from a bare Enter when the preference says so', () => {
    expect(composerKeyAction({ key: 'Enter' }, 'newline')).toBe('newline');
  });

  it('never sends on Shift+Enter — in either mode', () => {
    expect(composerKeyAction({ key: 'Enter', shiftKey: true }, 'send')).toBe('newline');
    expect(composerKeyAction({ key: 'Enter', shiftKey: true }, 'newline')).toBe('newline');
  });

  it('always sends on Ctrl+Enter — even when Enter is set to new line', () => {
    expect(composerKeyAction({ key: 'Enter', ctrlKey: true }, 'send')).toBe('send');
    expect(composerKeyAction({ key: 'Enter', ctrlKey: true }, 'newline')).toBe('send');
  });

  it('always sends on Cmd+Enter (the Mac equivalent)', () => {
    expect(composerKeyAction({ key: 'Enter', metaKey: true }, 'newline')).toBe('send');
  });

  it('lets Shift override Ctrl when both are held', () => {
    // Chorded by accident; the non-destructive reading wins.
    expect(composerKeyAction({ key: 'Enter', shiftKey: true, ctrlKey: true }, 'send')).toBe(
      'newline'
    );
  });

  it('never sends mid-IME composition, whatever the mode', () => {
    expect(composerKeyAction({ key: 'Enter', isComposing: true }, 'send')).toBe('ignore');
    expect(composerKeyAction({ key: 'Enter', ctrlKey: true, isComposing: true }, 'send')).toBe(
      'ignore'
    );
  });

  it('ignores every other key', () => {
    expect(composerKeyAction({ key: 'a' }, 'send')).toBe('ignore');
    expect(composerKeyAction({ key: 'Escape' }, 'send')).toBe('ignore');
    expect(composerKeyAction({ key: 'Enter ' }, 'send')).toBe('ignore');
  });
});

describe('enterSendHint', () => {
  it('names the key that actually sends', () => {
    expect(enterSendHint('send')).toContain('Enter sends');
    expect(enterSendHint('newline')).toContain('Ctrl+Enter sends');
  });
});

describe('the composers are wired to the one rule', () => {
  const chatView = read('src/ui/chat/ChatView.tsx');

  it('routes both composers through the shared handler', () => {
    // Hero composer + in-thread composer.
    expect(chatView.match(/onKeyDown=\{handleComposerKeyDown\}/g) ?? []).toHaveLength(2);
  });

  it('keeps no inline Enter rule of its own', () => {
    // The old bug shape: `e.key === 'Enter' && !e.shiftKey` — which sends on
    // Ctrl+Enter's behalf by accident and can't be configured at all. (The
    // thread-title input's own Enter-to-rename is not a composer and is fine.)
    expect(chatView).not.toMatch(/e\.key === 'Enter' && !e\.shiftKey/);
  });

  it('shows the hint that matches the current preference', () => {
    expect(chatView).toMatch(/enterSend === 'send' \? 'Enter sends' : 'Ctrl\+Enter sends'/);
    expect(chatView).toContain('title={enterSendHint(enterSend)}');
  });
});

describe('the sidebar offers the switch (on every viewport)', () => {
  const sidebar = read('src/ui/workspace/Sidebar.tsx');
  const app = read('src/App.tsx');

  it('renders both choices', () => {
    expect(sidebar).toContain('ENTER_SEND_CHOICES');
    expect(sidebar).toContain('data-testid={`enter-send-${choice.mode}`}');
  });

  it('is not hidden behind a width condition', () => {
    // The whole point of the option: it must be reachable on a phone. The
    // drawer carries the same panel, so no `hidden`/viewport guard may wrap it.
    const block = sidebar.slice(sidebar.indexOf('Send-on-Enter preference'));
    const panel = block.slice(0, block.indexOf('Read-aloud voice'));
    expect(panel).not.toMatch(/hidden|sm:|md:|lg:|min-width|matchMedia/);
  });

  it('persists through App, like the other reading preferences', () => {
    expect(app).toContain('loadEnterSendMode');
    expect(app).toContain('saveEnterSendMode');
    expect(app).toMatch(/enterSend=\{enterSend\}/);
  });
});