/**
 * The approved six tabs (plan doc 30 Phase 3).
 *
 * The implemented tab set had drifted from the approved design: a generic
 * "Request" tab crammed system instruction + compiled prompt together, the
 * timings lived in their own tab without wall-clock timestamps or per-phase
 * durations, and the compiled prompt had no By-Section view. The approved
 * contract is:
 *
 *   Overview & Timings / System Instruction / Compiled Prompt / Wire /
 *   Thinking (Raw) / Response (Raw vs Processed — Phase 5)
 *
 * Each tab gets the full height; content-heavy tabs carry their char/token
 * weight IN THE TAB HEADER so the context cost is visible at a glance.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/* ── 1. The phase math — pure, shared ─────────────────────────────────────── */

describe('callPhases — wall clock + durations + throughput per phase', () => {
  it('derives every milestone, duration and chars/sec from the recorded row', async () => {
    const { callPhases } = await import('../../shared/types/callLog');
    const p = callPhases({
      tSend: 1730000000000,
      tAck: 1730000001200,
      tFirstReasoning: 1730000001850,
      tFirstToken: 1730000001900,
      tEnd: 1730000006900,
      reasoningText: 'abcdefghij', // 10 chars
      responseText: 'abcde', // 5 chars
    } as any);
    // Wall-clock timestamps per phase (the inspector shows WHEN each phase began).
    expect(p.ackMs).toBe(1200);
    expect(p.firstReasoningMs).toBe(1850);
    expect(p.ttftMs).toBe(1900);
    expect(p.totalMs).toBe(6900);
    // Phase durations: thinking = firstReasoning → firstToken; writing = firstToken → end.
    expect(p.thinkingMs).toBe(50);
    expect(p.writingMs).toBe(5000);
    // Throughput: chars per second over each phase's duration.
    expect(p.reasoningChars).toBe(10);
    expect(p.responseChars).toBe(5);
    expect(p.reasoningCharsPerSec).toBeCloseTo(10 / (50 / 1000), 5);
  });

  it('a row with no reasoning never divides by zero', async () => {
    const { callPhases } = await import('../../shared/types/callLog');
    const p = callPhases({
      tSend: 1000,
      tAck: 1100,
      tFirstReasoning: null,
      tFirstToken: 2000,
      tEnd: 3000,
      reasoningText: null,
      responseText: 'hello',
    } as any);
    expect(p.thinkingMs).toBeNull();
    expect(p.reasoningCharsPerSec).toBeNull();
    expect(p.writingMs).toBe(1000);
  });
});

/* ── 2. The compiled-prompt section parser — pure, shared ─────────────────── */

const CLIENT_COMPILED = [
  '<knowledge_substrate>',
  '  <artifact file="roman-empire.md" granularity="summary">',
  '    <title>Roman Empire</title>',
  '  </artifact>',
  '  <artifact file="coin-debasement.md" granularity="full">',
  '    <title>Coin debasement</title>',
  '    <content>Long body...</content>',
  '  </artifact>',
  '</knowledge_substrate>',
  '',
  '<existing_links>',
  '<link source="roman-empire.md" target="coin-debasement.md" kind="relates_to" />',
  '</existing_links>',
  '',
  '<conversation_chapters>',
  '  <chapter name="the-crisis" granularity="summary" status="active">',
  '    <title>The Crisis</title>',
  '  </chapter>',
  '</conversation_chapters>',
  '',
  'User: tell me about the silver mines',
].join('\n');

describe('parseCompiledSections — what ate the context window', () => {
  it('splits the client-compiler payload into named sections with char weights', async () => {
    const { parseCompiledSections } = await import('../../shared/prompts/compiledSections');
    const sections = parseCompiledSections(CLIENT_COMPILED);
    const titles = sections.map((s) => s.title);
    expect(titles).toEqual([
      'Knowledge substrate — attached notes',
      'Existing links (graph)',
      'Conversation chapters',
      'Conversation transcript & ask',
    ]);
    const substrate = sections[0];
    expect(substrate.items.map((i) => i.title)).toEqual(['roman-empire.md', 'coin-debasement.md']);
    // Every section knows its char weight.
    for (const s of sections) expect(s.chars).toBe(s.text.length);
  });

  it('reads the server fallback markers (--- ACTIVE-IN-MEMORY ARTIFACTS --- style) too', async () => {
    const { parseCompiledSections } = await import('../../shared/prompts/compiledSections');
    const text = [
      'Project: Rome',
      'Current Focus: general',
      '',
      '--- PREVIOUS CHAPTER SUMMARIES (Compressed Memory) ---',
      '[Chapter: The Crisis]',
      'Summary: things fell apart',
      '',
      '--- ACTIVE-IN-MEMORY ARTIFACTS ---',
      'note payload here',
      '',
      '--- CONVERSATION TRANSCRIPT ---',
      'User: hello',
    ].join('\n');
    const sections = parseCompiledSections(text);
    expect(sections.map((s) => s.title)).toEqual([
      'Header',
      'PREVIOUS CHAPTER SUMMARIES (Compressed Memory)',
      'ACTIVE-IN-MEMORY ARTIFACTS',
      'CONVERSATION TRANSCRIPT',
    ]);
  });

  it('an unrecognised payload stays ONE raw section — never silently chopped', async () => {
    const { parseCompiledSections } = await import('../../shared/prompts/compiledSections');
    const sections = parseCompiledSections('just some text with no markers at all');
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Raw compiled prompt');
    expect(sections[0].text).toBe('just some text with no markers at all');
  });
});

/* ── 3. The tab set + per-tab rendering ───────────────────────────────────── */

const CALL = {
  id: 'call-777',
  userId: 1,
  kind: 'chat',
  provider: 'gemini',
  model: 'gemini-3.8-flash',
  tSend: 1730000000000,
  tAck: 1730000001200,
  tFirstReasoning: 1730000001850,
  tFirstToken: 1730000001900,
  tEnd: 1730000006900,
  status: 'ok',
  request: {
    endpoint: 'generateContentStream',
    model: 'gemini-3.8-flash',
    systemInstruction: 'RULE ONE. RULE TWO. RULE THREE.',
    compiledPrompt: CLIENT_COMPILED,
    params: { temperature: 0.7 },
  },
  responseText: 'The answer.',
  reasoningText: 'Let me think about it carefully...',
  textChunks: 12,
  reasoningChunks: 5,
  httpStatus: 200,
  usage: { promptTokenCount: 11, candidatesTokenCount: 3 },
  error: null,
  jobId: 'job-abc',
  turnId: 'turn-ai-job-abc',
} as any;

const renderModal = async (props: Record<string, unknown>) => {
  const { ApiCallInspectorModal } = await import('../ui/workspace/ApiCallInspectorModal');
  return renderToStaticMarkup(React.createElement(ApiCallInspectorModal, props as any));
};

const inspectorProps = { isOpen: true, onClose: () => {}, call: CALL } as any;

describe('ApiCallInspectorModal — the approved six tabs', () => {
  it('renders exactly the approved tabs in order', async () => {
    const html = await renderModal(inspectorProps);
    for (const tab of ['Overview &amp; Timings', 'System instruction', 'Compiled prompt', 'Wire payload', 'Thinking', 'Response']) {
      expect(html).toContain(tab);
    }
  });

  it('the content-heavy tabs carry their char weight in the tab header', async () => {
    const html = await renderModal(inspectorProps);
    // system instruction is 30 chars
    expect(html).toMatch(/System instruction · 31 chars/);
    // compiled prompt is CLIENT_COMPILED's length
    expect(html).toMatch(new RegExp(`Compiled prompt · ${CLIENT_COMPILED.length.toLocaleString()} chars`));
    // thinking is 33 chars
    expect(html).toMatch(/Thinking · 34 chars/);
  });

  it('Overview & Timings shows the wall clock of EVERY phase plus durations and throughput', async () => {
    const html = await renderModal({ ...inspectorProps, initialTab: 'overview' });
    // milestone rows (deltas)
    expect(html).toMatch(/1,?200\s*ms/); // ack
    expect(html).toMatch(/1,?850\s*ms/); // first reasoning
    expect(html).toMatch(/1,?900\s*ms/); // ttft
    expect(html).toMatch(/6,?900\s*ms/); // total
    // wall-clock timestamps per phase
    expect(html).toContain(new Date(1730000001850).toLocaleString());
    // thinking duration = firstToken - firstReasoning = 50 ms; writing = 5000 ms
    expect(html).toMatch(/50\s*ms/);
    expect(html).toMatch(/5,?000\s*ms/);
    // throughput rows
    expect(html).toMatch(/chars\/sec/);
  });

  it('System instruction is its own full-height tab', async () => {
    const html = await renderModal({ ...inspectorProps, initialTab: 'system' });
    expect(html).toContain('RULE ONE. RULE TWO. RULE THREE.');
    expect(html).not.toContain('The compiled payload.'); // prompt does NOT share the tab
  });

  it('Compiled prompt: Full raw by default, By section splits with char weights + collapsible artifacts', async () => {
    const raw = await renderModal({ ...inspectorProps, initialTab: 'prompt' });
    expect(raw).toContain('&lt;knowledge_substrate&gt;'); // raw view is the literal text, escaped for display
    expect(raw).toContain('Full raw text');
    expect(raw).toContain('By section');
  });

  it('Thinking shows the raw stream with char count, chunk count and duration', async () => {
    const html = await renderModal({ ...inspectorProps, initialTab: 'thinking' });
    expect(html).toContain('Let me think about it carefully...');
    expect(html).toContain('5'); // reasoning chunks
    expect(html).toMatch(/50\s*ms/); // thinking duration
  });
});
