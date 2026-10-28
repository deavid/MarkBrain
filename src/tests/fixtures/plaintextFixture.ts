/**
 * Package 3 §3.4 round-trip fixture — shared by plaintext-roundtrip.test.ts
 * and plaintext-cli.test.ts (Package 6) so both exercise the exact same data.
 */

import type { ProjectSnapshot } from '../../services/stores/projectStore';


// ---------------------------------------------------------------------------
// The rot detector
// ---------------------------------------------------------------------------

export function walkForUndefined(obj: unknown, path: string, errors: string[]): void {
  if (obj === undefined) {
    errors.push(`undefined value at ${path}`);
    return;
  }
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkForUndefined(item, `${path}[${i}]`, errors));
    return;
  }
  for (const [key, value] of Object.entries(obj)) {
    walkForUndefined(value, `${path}.${key}`, errors);
  }
}

// ---------------------------------------------------------------------------
// Fixture — every field of every type, zero nulls/empties
// ---------------------------------------------------------------------------

export const P_ID = 'proj-fixture';
export const THREAD_A = 'thread-aaa-1111';
export const THREAD_B = 'thread-bbb-2222';

export function makeSnapshot(): ProjectSnapshot {
  const turn1 = {
    id: 'turn-1',
    role: 'user' as const,
    content: 'Explique le concepto 🧠 — héllo wörld — 你好\n\nSecond line.',
    timestamp: 1700000000000,
    threadId: THREAD_A,
    extractedArtifacts: [
      {
        id: 'art-extracted-1',
        title: 'Extracted chip',
        type: 'document',
        code: 'CHIP-1',
        category: 'concept',
        subtitle: 'chip subtitle',
        description: 'chip description',
        summary: 'chip summary',
        content: 'chip raw content',
        isHighConcept: true,
        turnIndex: 0,
      },
    ],
    meta: {
      model: 'gemini-2.0-flash',
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      latencyMs: 812,
      timeToFirstChunkMs: 240,
      isStreaming: false,
      streamState: 'done',
      isFallback: false,
      attachments: [
        { artifactId: 'art-1', granularity: 'title', addedAt: 1700000001000, turnIndex: 0, turnId: 'turn-1' },
        { artifactId: 'art-2', granularity: 'full', addedAt: 1700000002000, turnIndex: null, turnId: null },
      ],
    },
  };

  const turn2 = {
    id: 'turn-2',
    role: 'assistant' as const,
    content: 'Résponse de l’IA — with émojis ✅ and --- inside text.\n\nLine after ---.',
    timestamp: 1700000010000,
    threadId: THREAD_A,
    meta: {
      model: 'openrouter:anthropic/claude',
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
      latencyMs: 2400,
      timeToFirstChunkMs: 310,
      isStreaming: true,
      streamState: 'working',
      isFallback: true,
    },
  };

  const orphanTurn = {
    id: 'turn-orphan',
    role: 'system' as const,
    content: 'A turn with no threadId (legacy shape).',
    timestamp: 1700000020000,
  };

  const chapter1 = {
    id: 'chap-1',
    workspaceId: P_ID,
    threadId: THREAD_A,
    title: 'Chapter One',
    subtitle: 'chapter subtitle hook',
    description: 'chapter description text',
    summary: 'chapter summary text',
    granularity: 'full' as const,
    status: 'active' as const,
    startIndex: 0,
    endIndex: 1,
    createdAt: 1700000005000,
  };

  const chapter2 = {
    id: 'chap-2',
    workspaceId: P_ID,
    threadId: THREAD_B,
    title: 'Chapter Two',
    subtitle: 'second hook',
    description: 'second description',
    summary: 'second summary',
    granularity: 'summary' as const,
    status: 'completed' as const,
    startIndex: 0,
    createdAt: 1700000060000,
  };

  const artifact1 = {
    id: 'art-1',
    workspaceId: P_ID,
    code: 'CORE',
    title: 'Core Document — héllo ünïcode',
    type: 'document' as const,
    category: 'concept',
    isHighConcept: true,
    color: '#5ad49b',
    current: {
      subtitle: 'The index-card hook',
      description: 'Core thesis. Pillars. Conclusions.\n\nSecond paragraph.',
      summary: 'Every section, rule, number, rejection — substantive digest.\nWith a newline.',
      body: '# Core Document\n\nRaw markdown **body** with `code`, lists:\n\n- item one\n- item two\n\nA rule:\n\n---\n\nA horizontal rule above. End of body.\n',
    },
    tags: ['core', '文档', 'emoji-🎉'],
    createdAt: 1690000000000,
    updatedAt: 1700000100000,
    layersStaleAt: 1700000090000,
    graph: {
      x: 120,
      y: 340,
      is_high_concept: true,
      parent: 'art-parent-0',
      children: ['art-2', 'art-extracted-1'],
      relationships: [
        { target: 'art-2', type: 'refines', note: 'refines the draft' },
        { target: 'art-extracted-1', type: 'relates_to' },
      ],
      customKey: 'arbitrary graph payload',
    },
    yamlDocument: '---\ncode: CORE\nlegacyField: true\n',
    lifecycle: 'active' as const,
  };

  const artifact2 = {
    id: 'art-2',
    workspaceId: P_ID,
    code: 'DRAFT',
    title: 'Draft Note',
    type: 'document' as const,
    category: 'draft',
    isHighConcept: false,
    current: {
      subtitle: '',
      description: '',
      summary: '',
      body: 'Body only, no layers.',
    },
    tags: [],
    createdAt: 1690000010000,
    updatedAt: 1700000110000,
    lifecycle: 'archived' as const,
  };

  const artifact3 = {
    id: 'art-3',
    workspaceId: P_ID,
    code: 'NO-CODE',
    title: 'No-Graph Document',
    type: 'document' as const,
    category: 'note',
    isHighConcept: false,
    current: {
      subtitle: 'nogo sub',
      description: 'nogo desc',
      summary: 'nogo sum',
      body: 'Body without graph.\n',
    },
    tags: ['note'],
    createdAt: 1690000020000,
    updatedAt: 1700000120000,
  };

  const revisions = {
    'art-1': [
      {
        version: 1,
        timestamp: 1690000005000,
        actor: 'user' as const,
        changeSummary: 'Initial hand-written draft',
        provenance: { threadId: THREAD_A, turnId: 'turn-1', turnIndex: 0 },
        title: 'Core Document — héllo ünïcode',
        layers: {
          subtitle: 'The index-card hook',
          description: 'Core thesis.',
          summary: 'Digest.',
          body: '# Core Document\n\nFirst body.',
        },
      },
      {
        version: 2,
        timestamp: 1700000100000,
        actor: 'ai' as const,
        changeSummary: 'AI upsert',
        provenance: { threadId: THREAD_B, turnId: 'turn-2', turnIndex: null },
        title: 'Core Document — héllo ünïcode',
        layers: {
          subtitle: 'The index-card hook',
          description: 'Core thesis. Pillars. Conclusions.',
          summary: 'Digest with rule 42.',
          body: '# Core Document\n\nRaw markdown **body** with `code`, lists:\n\n- item one\n- item two\n\nA rule:\n\n---\n\nA horizontal rule above. End of body.\n',
        },
      },
    ],
    'art-2': [
      {
        version: 1,
        timestamp: 1700000110000,
        actor: 'user' as const,
        changeSummary: 'Body-only edit',
        title: 'Draft Note',
        layers: { subtitle: '', description: '', summary: '', body: 'Body only, no layers.' },
      },
    ],
  };

  return {
    projectId: P_ID,
    turns: [turn1, turn2, orphanTurn],
    chapters: [chapter1, chapter2],
    artifacts: [artifact1, artifact2, artifact3],
    edges: [
      { id: 'edge-1', sourceId: 'art-1', targetId: 'art-2', kind: 'parent_of', weight: 0.8 },
      { id: 'edge-2', sourceId: 'art-2', targetId: 'art-3', kind: 'custom_kind', weight: 1 },
    ],
    updatedAt: 1700000200000,
    threads: [
      {
        id: THREAD_A,
        folderId: 'folder-1',
        title: 'Main Thread — main 🧵',
        titleState: 'auto',
        titleVersion: 2,
        createdAt: 1680000000000,
        updatedAt: 1700000010000,
        lastActivityAt: 1700000010000,
        lifecycle: 'active',
        lastOutcome: 'ok',
        preview: 'Résponse de l’IA — with émojis',
        attachments: [
          { artifactId: 'art-1', granularity: 'title', addedAt: 1700000001000, turnIndex: 0, turnId: 'turn-1' },
          { artifactId: 'art-2', granularity: 'full', addedAt: 1700000002000, turnIndex: null, turnId: null },
        ],
        capabilities: { autoChapter: true, writeArtifacts: false, graphLinks: true },
      },
      {
        id: THREAD_B,
        folderId: null,
        title: 'Second thread',
        titleState: 'manual',
        titleVersion: 1,
        createdAt: 1680000010000,
        updatedAt: 1700000060000,
        lastActivityAt: 1700000060000,
        lifecycle: 'archived',
        lastOutcome: 'interrupted',
        preview: 'preview text',
        attachments: [],
      },
    ],
    folders: [
      { id: 'folder-1', name: 'Folder One', order: 0 },
      { id: 'folder-2', name: 'Folder Two', order: 1 },
    ],
    activeThreadId: THREAD_A,
    name: 'Fixture Project — fïxture',
    codeName: 'FIXTURE',
    description: 'Project description with émojis 🧠 and --- inside.',
    color: '#e05a66',
    granularityLaw: 'user-only',
    revisions,
    capabilities: { autoChapter: false, writeArtifacts: true, graphLinks: false },
  };
}
