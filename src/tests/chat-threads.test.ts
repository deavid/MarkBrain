/**
 * Chat-threads suite (06-chat-threads): registry partition/flush semantics,
 * legacy-snapshot migration, title pipeline decisions, runtime derivation,
 * and the compiler's historyTurns override (background-thread context).
 */
import { describe, it, expect } from 'vitest';
import {
  ThreadRegistry,
  makeDefaultThread,
  makeGenesisChapter,
  placeholderTitle,
  titlePipelineStep,
  sampleTurnsForTitle,
  deriveThreadRuntime,
  queuePositionOf,
  ChatThread,
} from '../domains/06-chat-threads';
import type { Turn } from '../domains/01-dialogue-timeline';
import type { ChapterPartition } from '../domains/02-chapter-segmentation';
import { OpticalCompilerDomain } from '../domains/03-optical-compiler';
import { TopologicalGraphDomain } from '../domains/02-topological-graph';
import { ArtifactDocumentDomain } from '../domains/01-artifact-document';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline';

const turn = (id: string, role: 'user' | 'assistant', content: string, threadId?: string): Turn => ({
  id,
  role,
  content,
  timestamp: Date.now(),
  threadId,
});

const chapter = (id: string, threadId?: string, startIndex = 0): ChapterPartition => ({
  id,
  workspaceId: 'proj-1',
  threadId,
  title: 'Genesis Chapter',
  status: 'active',
  startIndex,
  createdAt: Date.now(),
});

describe('ThreadRegistry', () => {
  it('migrates a legacy snapshot: no threads → default Main thread, turns tagged', () => {
    const reg = new ThreadRegistry();
    const active = reg.hydrate({
      projectId: 'proj-1',
      turns: [turn('t1', 'user', 'hello'), turn('t2', 'assistant', 'hi')],
      chapters: [chapter('c1')],
    });

    const threads = reg.getThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe('Main');
    expect(threads[0].titleVersion).toBe(2); // pipeline exhausted — never re-titled
    expect(reg.getActiveThreadId()).toBe(threads[0].id);
    expect(active.turns).toHaveLength(2);
    expect(active.turns.every((t) => t.threadId === threads[0].id)).toBe(true);
    expect(active.chapters[0].threadId).toBe(threads[0].id);
  });

  it('partitions multiple threads and honors persisted activeThreadId', () => {
    const reg = new ThreadRegistry();
    const tA: ChatThread = { ...makeDefaultThread(), id: 'A', lastActivityAt: 100 };
    const tB: ChatThread = { ...makeDefaultThread(), id: 'B', lastActivityAt: 200, title: 'Beta' };
    const active = reg.hydrate({
      projectId: 'proj-1',
      threads: [tA, tB],
      turns: [
        turn('a1', 'user', 'in A', 'A'),
        turn('b1', 'user', 'in B', 'B'),
        turn('orphan', 'user', 'lost'), // unknown threadId → fallback
      ],
      chapters: [chapter('cA', 'A'), chapter('cB', 'B')],
      activeThreadId: 'B',
    });

    expect(reg.getActiveThreadId()).toBe('B');
    expect(active.turns.map((t) => t.id)).toEqual(['b1']);
    expect(reg.getInactiveContent('A')!.turns.map((t) => t.id)).toEqual(['a1', 'orphan']);
  });

  it('falls back to the most recently active thread when persisted id is unknown', () => {
    const reg = new ThreadRegistry();
    reg.hydrate({
      projectId: 'proj-1',
      threads: [
        { ...makeDefaultThread(), id: 'old', lastActivityAt: 1 },
        { ...makeDefaultThread(), id: 'new', lastActivityAt: 9 },
      ],
      turns: [],
      chapters: [],
      activeThreadId: 'deleted-thread',
    });
    expect(reg.getActiveThreadId()).toBe('new');
  });

  it('select() round-trips: flush live → cache, pop incoming', () => {
    const reg = new ThreadRegistry();
    reg.hydrate({ projectId: 'proj-1', threads: [], turns: [turn('t1', 'user', 'main')], chapters: [chapter('c1')] });
    const firstId = reg.getActiveThreadId();

    const second = reg.createThread({ title: 'Second' });
    const incoming = reg.select(second.id, {
      turns: [turn('t1', 'user', 'main')],
      chapters: [chapter('c1')],
    });
    expect(incoming).not.toBeNull();
    expect(incoming!.turns).toHaveLength(0); // fresh thread: empty content
    expect(incoming!.chapters[0].title).toBe('Genesis Chapter');
    expect(reg.getActiveThreadId()).toBe(second.id);

    // Switch back: second thread's (empty) live content flushed, first popped.
    const back = reg.select(firstId, { turns: [], chapters: [chapter('cX')] });
    expect(back!.turns.map((t) => t.id)).toEqual(['t1']);
    expect(reg.getInactiveContent(second.id)!.turns).toHaveLength(0);
  });

  it('compose() merges live + cached content and tags every row with threadId', () => {
    const reg = new ThreadRegistry();
    reg.hydrate({ projectId: 'proj-1', threads: [], turns: [turn('live', 'user', 'x')], chapters: [chapter('c1')] });
    const other = reg.createThread({ title: 'Other' });
    // background content for the inactive thread
    reg.appendInactiveTurn(other.id, 'user', 'background msg');

    const composed = reg.compose([turn('live', 'user', 'x')], [chapter('c1')]);
    expect(composed.threads).toHaveLength(2);
    expect(composed.activeThreadId).toBe(reg.getActiveThreadId());
    expect(composed.turns).toHaveLength(2);
    expect(composed.turns.every((t) => !!t.threadId)).toBe(true);
    expect(composed.turns.map((t) => t.content).sort()).toEqual(['background msg', 'x']);
    expect(composed.chapters.every((c) => !!c.threadId)).toBe(true);
  });

  it('background append/update/declareChapter work off the live domains', () => {
    const reg = new ThreadRegistry();
    reg.hydrate({ projectId: 'proj-1', threads: [], turns: [], chapters: [] });
    const t = reg.createThread({ title: 'Bg' });

    const appended = reg.appendInactiveTurn(t.id, 'user', 'queued thought');
    expect(appended).not.toBeNull();
    reg.updateInactiveTurn(t.id, appended!.id, { content: 'edited' });
    expect(reg.getInactiveContent(t.id)!.turns[0].content).toBe('edited');

    // second turn so the chapter boundary has an index to seal at
    reg.appendInactiveTurn(t.id, 'assistant', 'reply');
    const chap = reg.declareChapterInactive(t.id, 'New Chapter', 2, 'topic');
    expect(chap).not.toBeNull();
    const content = reg.getInactiveContent(t.id)!;
    expect(content.chapters).toHaveLength(2);
    expect(content.chapters[0].status).toBe('completed');
    expect(content.chapters[0].endIndex).toBe(2);
    expect(content.chapters[1].startIndex).toBe(2);

    // active-thread guards: mutations routed at the live thread are no-ops
    expect(reg.appendInactiveTurn(reg.getActiveThreadId(), 'user', 'x')).toBeNull();
  });

  it('deleteThread: inactive deletion keeps active; active deletion falls back + discards live', () => {
    const reg = new ThreadRegistry();
    reg.hydrate({ projectId: 'proj-1', threads: [], turns: [turn('t1', 'user', 'keep')], chapters: [chapter('c1')] });
    const activeId = reg.getActiveThreadId();
    const second = reg.createThread({ title: 'Second' });

    // delete inactive → no switch
    expect(reg.deleteThread(second.id)).toBeNull();
    expect(reg.getThread(second.id)).toBeNull();
    expect(reg.getActiveThreadId()).toBe(activeId);

    // delete active → fallback, live content discarded (not flushed)
    const incoming = reg.deleteThread(activeId);
    expect(incoming).not.toBeNull();
    expect(reg.getThread(activeId)).toBeNull();
    expect(reg.getActiveThreadId()).not.toBe(activeId);
    expect(incoming!.turns).toHaveLength(0);
  });

  it('applyAutoTitle: respects manual lock and version monotonicity', () => {
    const reg = new ThreadRegistry();
    reg.hydrate({ projectId: 'proj-1', threads: [], turns: [], chapters: [] });
    const t = reg.createThread({ title: 'First', titleState: 'placeholder', titleVersion: 0 });

    expect(reg.applyAutoTitle(t.id, 'Stage One Title', 1)).toBe(true);
    expect(reg.getThread(t.id)!.title).toBe('Stage One Title');
    expect(reg.getThread(t.id)!.titleState).toBe('auto');
    expect(reg.getThread(t.id)!.titleVersion).toBe(1);

    // stale/lower version must not downgrade
    expect(reg.applyAutoTitle(t.id, 'Stale', 1)).toBe(false);
    expect(reg.getThread(t.id)!.title).toBe('Stage One Title');

    expect(reg.applyAutoTitle(t.id, 'Stage Two Title', 2)).toBe(true);

    // manual rename locks forever
    reg.rename(t.id, 'My Title');
    expect(reg.getThread(t.id)!.titleState).toBe('manual');
    expect(reg.applyAutoTitle(t.id, 'Hacked', 3)).toBe(false);
    expect(reg.getThread(t.id)!.title).toBe('My Title');

    // user-initiated force overrides the manual lock and retires the pipeline
    expect(reg.forceAutoTitle(t.id, 'Suggested Title')).toBe(true);
    expect(reg.getThread(t.id)!.title).toBe('Suggested Title');
    expect(reg.getThread(t.id)!.titleState).toBe('auto');
    expect(reg.getThread(t.id)!.titleVersion).toBe(2);
    expect(reg.forceAutoTitle('missing', 'nope')).toBe(false);
    expect(reg.forceAutoTitle(t.id, '   ')).toBe(false);
  });
});

describe('Title pipeline decisions', () => {
  const base: ChatThread = {
    ...makeDefaultThread(),
    id: 'x',
    title: 'New thread',
    titleState: 'placeholder',
    titleVersion: 0,
  };

  it('stage1 after first substantive reply; stage2 once after third', () => {
    expect(titlePipelineStep(base, 0)).toBeNull();
    expect(titlePipelineStep(base, 1)).toBe('stage1');
    expect(titlePipelineStep({ ...base, titleVersion: 1 }, 1)).toBeNull();
    expect(titlePipelineStep({ ...base, titleVersion: 1 }, 2)).toBeNull();
    expect(titlePipelineStep({ ...base, titleVersion: 1 }, 3)).toBe('stage2');
    expect(titlePipelineStep({ ...base, titleVersion: 2 }, 5)).toBeNull();
  });

  it('manual rename opts out permanently', () => {
    expect(titlePipelineStep({ ...base, titleState: 'manual' }, 5)).toBeNull();
  });

  it('placeholderTitle truncates at a word boundary with ellipsis', () => {
    expect(placeholderTitle('Short idea')).toBe('Short idea');
    const long = 'This is a much longer first message that keeps going and going';
    const title = placeholderTitle(long);
    expect(title.length).toBeLessThanOrEqual(41);
    expect(title.endsWith('…')).toBe(true);
    expect(placeholderTitle('   ')).toBe('New thread');
  });

  it('sampleTurnsForTitle keeps first 2 + last 4 and trims long content', () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const sample = sampleTurnsForTitle(turns);
    expect(sample).toHaveLength(6);
    expect(sample[0].content).toBe('msg-0');
    expect(sample[sample.length - 1].content).toBe('msg-9');

    const few = sampleTurnsForTitle(turns.slice(0, 3));
    expect(few).toHaveLength(3);
  });
});

describe('Runtime derivation', () => {
  const thread: ChatThread = { ...makeDefaultThread(), id: 'T', lastOutcome: 'ok' };

  it('precedence: working > queued > flags > idle', () => {
    expect(deriveThreadRuntime(thread, 'T', [])).toBe('working');
    expect(deriveThreadRuntime(thread, 'OTHER', [{ threadId: 'T' }])).toBe('queued');
    expect(
      deriveThreadRuntime({ ...thread, lastOutcome: 'error' }, 'OTHER', [{ threadId: 'T' }])
    ).toBe('queued'); // queued beats error flag
    expect(deriveThreadRuntime({ ...thread, lastOutcome: 'error' }, null, [])).toBe('error');
    expect(deriveThreadRuntime({ ...thread, lastOutcome: 'interrupted' }, null, [])).toBe(
      'interrupted'
    );
    expect(deriveThreadRuntime(thread, null, [])).toBe('idle');
  });

  it('queuePositionOf is 1-based and 0 when absent', () => {
    const q = [{ threadId: 'A' }, { threadId: 'B' }, { threadId: 'A' }];
    expect(queuePositionOf('A', q)).toBe(1);
    expect(queuePositionOf('B', q)).toBe(2);
    expect(queuePositionOf('C', q)).toBe(0);
  });
});

describe('Folders & archive lifecycle', () => {
  const reg = () => {
    const r = new ThreadRegistry();
    r.hydrate({ projectId: 'proj-1', threads: [], turns: [], chapters: [] });
    return r;
  };

  it('create/rename/delete folder; delete rehomes threads to Inbox', () => {
    const r = reg();
    const f = r.createFolder('Research');
    expect(r.getFolders()).toHaveLength(1);
    expect(f.order).toBe(0);
    const f2 = r.createFolder('Outlines');
    expect(f2.order).toBe(1);

    r.renameFolder(f.id, 'Deep Research');
    expect(r.getFolders().find((x) => x.id === f.id)!.name).toBe('Deep Research');

    const t = r.createThread({ title: 'T1' });
    r.moveThreadToFolder(t.id, f.id);
    expect(r.getThread(t.id)!.folderId).toBe(f.id);

    // Folder dies → thread survives, returns to Inbox
    r.deleteFolder(f.id);
    expect(r.getThread(t.id)!.folderId).toBeNull();
    expect(r.getFolders()).toHaveLength(1);
    expect(r.getThread(t.id)).not.toBeNull();
  });

  it('moveThreadToFolder rejects unknown folders and supports null (Inbox)', () => {
    const r = reg();
    const f = r.createFolder('F');
    const t = r.createThread();
    r.moveThreadToFolder(t.id, 'nope');
    expect(r.getThread(t.id)!.folderId).toBeNull();
    r.moveThreadToFolder(t.id, f.id);
    expect(r.getThread(t.id)!.folderId).toBe(f.id);
    r.moveThreadToFolder(t.id, null);
    expect(r.getThread(t.id)!.folderId).toBeNull();
  });

  it('reorderFolderBefore renumbers contiguously', () => {
    const r = reg();
    const a = r.createFolder('A'); // order 0
    const b = r.createFolder('B'); // order 1
    const c = r.createFolder('C'); // order 2
    r.reorderFolderBefore(c.id, a.id); // C A B
    expect(r.getFolders().sort((x, y) => x.order - y.order).map((f) => f.name)).toEqual([
      'C',
      'A',
      'B',
    ]);
    expect(r.getFolders().sort((x, y) => x.order - y.order).map((f) => f.order)).toEqual([0, 1, 2]);
    expect(b.order).toBeGreaterThanOrEqual(0); // b still tracked
  });

  it('archive/unarchive flips lifecycle and hydrate normalizes dangling folders', () => {
    const r = reg();
    const t = r.createThread({ title: 'Archivable' });
    r.setThreadLifecycle(t.id, 'archived');
    expect(r.getThread(t.id)!.lifecycle).toBe('archived');
    r.setThreadLifecycle(t.id, 'active');
    expect(r.getThread(t.id)!.lifecycle).toBe('active');

    // hydrate: thread pointing at a folder that doesn't exist → Inbox
    const r2 = new ThreadRegistry();
    r2.hydrate({
      projectId: 'proj-1',
      threads: [{ ...makeDefaultThread(), id: 'X', folderId: 'ghost-folder' }],
      folders: [],
      turns: [],
      chapters: [],
    });
    expect(r2.getThread('X')!.folderId).toBeNull();
  });
});

describe('Compiler historyTurns override (background-thread context)', () => {
  it('compiles against explicit turns/chapters instead of the live domains', () => {
    const artifacts = new ArtifactDocumentDomain('proj-1', []);
    const segmentation = new ChapterSegmentationDomain('proj-1', [
      chapter('live-chapter', 'ACTIVE'),
    ]);
    const timeline = new DialogueTimelineDomain('proj-1', [
      turn('live-1', 'user', 'VISIBLE-THREAD-CONTENT'),
    ]);
    const compiler = new OpticalCompilerDomain(artifacts, segmentation, timeline);

    const historyTurns = [turn('bg-1', 'user', 'BACKGROUND-THREAD-CONTENT')];
    const historyChapters = [chapter('bg-chapter', 'BG', 0)];

    const compiled = compiler.compile({
      attachments: [],
      historyTurns,
      historyChapters,
    });

    expect(compiled.compiledPrompt).toContain('BACKGROUND-THREAD-CONTENT');
    expect(compiled.compiledPrompt).not.toContain('VISIBLE-THREAD-CONTENT');
    expect(compiled.compiledPrompt).toContain('bg-chapter');
    expect(compiled.compiledPrompt).not.toContain('live-chapter');

    // Without overrides the live domains still win (unchanged behavior)
    const liveCompiled = compiler.compile({ attachments: [] });
    expect(liveCompiled.compiledPrompt).toContain('VISIBLE-THREAD-CONTENT');
  });

  it('makeGenesisChapter always covers index 0 of its thread', () => {
    const c = makeGenesisChapter('proj-1', 'thread-1');
    expect(c.startIndex).toBe(0);
    expect(c.threadId).toBe('thread-1');
    expect(c.status).toBe('active');
  });
});