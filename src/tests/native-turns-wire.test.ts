/**
 * BUG-013 §2 wire mapping: the provider-neutral turns map to Gemini contents
 * (thought parts) and OpenRouter messages (reasoning fields) — on BOTH the
 * client gateway and the server lane providers.
 */
import { describe, it, expect } from 'vitest';

const MESSAGES = [
  { role: 'user' as const, content: 'the ask' },
  { role: 'assistant' as const, content: 'the answer', thinking: 'I thought hard.' },
  { role: 'user' as const, content: 'follow-up' },
];

describe('gemini wire mapping', () => {
  it('client provider maps assistant turns with a thought part', async () => {
    const { geminiWireContents } = await import('../gateway/providers/geminiWire');
    const contents = geminiWireContents(MESSAGES);
    expect(contents).toHaveLength(3);
    expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'the ask' }] });
    expect(contents[1].role).toBe('model');
    expect(contents[1].parts[0]).toEqual({ text: 'I thought hard.', thought: true });
    expect(contents[1].parts[1]).toEqual({ text: 'the answer' });
    expect(contents[2]).toEqual({ role: 'user', parts: [{ text: 'follow-up' }] });
  });

  it('server lane mapping uses the same shape', async () => {
    const { geminiWireContents } = await import('../../shared/stream/turnsWire');
    const contents = geminiWireContents(MESSAGES);
    expect(contents[1].parts).toEqual([
      { text: 'I thought hard.', thought: true },
      { text: 'the answer' },
    ]);
  });
});

describe('openrouter wire mapping', () => {
  it('maps thinking to reasoning + reasoning_content, system first', async () => {
    const { openrouterWireMessages } = await import('../../shared/stream/turnsWire');
    const msgs = openrouterWireMessages('system instruction', MESSAGES);
    expect(msgs[0]).toEqual({ role: 'system', content: 'system instruction' });
    expect(msgs[2]).toEqual({
      role: 'assistant',
      content: 'the answer',
      reasoning: 'I thought hard.',
      reasoning_content: 'I thought hard.',
    });
    expect(msgs[3]).toEqual({ role: 'user', content: 'follow-up' });
  });
});
