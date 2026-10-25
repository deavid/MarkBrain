/**
 * Server-jobs → drafts reconciliation (design-docs/23 §4).
 *
 * The deadlock that "killed chat": one vault-locked job as the thread's FIFO
 * head, three sends queued behind it forever, and NO client draft to retry or
 * discard — because the server remembers sends the client forgot (reload).
 * Reconcile materializes every non-completed job as a draft with its exits.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SendQueue } from '../application/sendQueue';
import type { SendQueueDeps } from '../application/sendQueue';
import { clearWorkspaceMode, clearVpsSession, saveVpsSession, setWorkspaceMode } from '../services/workspaceSession';

const VPS_STORAGE_SEED = {
  'markbrain:workspaceMode': 'vps',
  'markbrain:vpsSession': JSON.stringify({
    baseUrl: '',
    token: 'tok',
    userId: 1,
    email: 'owner@example.com',
    isOwner: true,
    vaultUnlocked: true,
  }),
};

function stubWindow(seed: Record<string, string> = VPS_STORAGE_SEED) {
  const storage = new Map(Object.entries(seed));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
    },
    location: { origin: 'http://localhost:3032' },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  return storage;
}

function stubJobsFetch(jobs: unknown[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ jobs }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
  return calls;
}

function makeQueue() {
  const deps = { triggerReRender: () => {} } as unknown as SendQueueDeps;
  return new SendQueue(() => deps);
}

beforeEach(() => {
  stubWindow();
});

afterEach(() => {
  clearWorkspaceMode();
  clearVpsSession();
  vi.unstubAllGlobals();
});

describe('reconcileServerJobs (design 23 §4)', () => {
  it('materializes the vault-locked FAILED head with its exits + errorCode, and queued jobs as queued drafts', async () => {
    stubJobsFetch([
      {
        jobId: 'job-failed-1',
        threadId: 'thread-1',
        kind: 'send',
        state: 'failed',
        askText: 'the ask that lost its keys',
        partialText: '',
        errorReason: 'Server session keys are locked after a server restart. Enter your password to unlock.',
        model: 'gemini-3.5-flash-lite',
      },
      {
        jobId: 'job-queued-1',
        threadId: 'thread-1',
        kind: 'send',
        state: 'queued',
        askText: 'send behind the head',
        partialText: '',
        errorReason: null,
        model: 'gemini-3.5-flash-lite',
      },
      {
        jobId: 'job-sending-1',
        threadId: 'thread-1',
        kind: 'send',
        state: 'sending',
        askText: 'in flight server-side',
        partialText: 'partial…',
        errorReason: null,
        model: 'gemini-3.5-flash-lite',
      },
    ]);

    const queue = makeQueue();
    await queue.reconcileServerJobs('proj-1');

    const items = queue.getQueue();
    expect(items.length).toBe(3);

    const failed = items.find((i) => i.serverJobId === 'job-failed-1')!;
    expect(failed.state).toBe('failed');
    expect(failed.text).toBe('the ask that lost its keys');
    expect(failed.errorCode).toBe('VAULT_LOCKED');
    expect(failed.reason).toContain('locked');

    const queued = items.find((i) => i.serverJobId === 'job-queued-1')!;
    expect(queued.state).toBe('queued');

    const sending = items.find((i) => i.serverJobId === 'job-sending-1')!;
    expect(sending.state).toBe('queued'); // materialized as queued → executeVpsAttempt ATTACHES, never re-sends
    expect(sending.partial).toBe('partial…');
  });

  it('never duplicates: a draft that already owns the job is not re-materialized', async () => {
    stubJobsFetch([
      {
        jobId: 'job-failed-1',
        threadId: 'thread-1',
        kind: 'send',
        state: 'failed',
        askText: 'the ask',
        partialText: '',
        errorReason: 'boom',
        model: 'gemini-3.5-flash-lite',
      },
    ]);
    const queue = makeQueue();
    await queue.reconcileServerJobs('proj-1');
    await queue.reconcileServerJobs('proj-1'); // second load
    expect(queue.getQueue().length).toBe(1);
  });

  it('stays silent outside vps mode', async () => {
    clearWorkspaceMode(); // absent mode = local semantics
    stubWindow({ 'markbrain:workspaceMode': 'local' });
    const calls = stubJobsFetch([]);
    const queue = makeQueue();
    await queue.reconcileServerJobs('proj-1');
    expect(queue.getQueue().length).toBe(0);
    expect(calls.length).toBe(0); // no request at all
  });
});
