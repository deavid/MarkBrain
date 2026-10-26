/**
 * Send-and-forget job routes (design-docs/21E §3) — all behind requireAuth
 * (gated in server/app.ts via /api/projects + /api/jobs prefixes).
 *
 * The SSE stream is a WATCH channel: `req.on('close')` never aborts the job —
 * only POST /:jobId/stop does (Pair Law exits: retry / store-as-is / discard).
 */
import type { Express, Request, Response } from 'express';
import { requireModelId } from '../lib/models';
import {
  enqueueJob,
  attachSubscriber,
  stopJob,
  retryJob,
  storeJobAsIs,
  discardJob,
  getJobRow,
  listActiveJobSummaries,
} from '../jobs/chatJobRunner';
import { loadProjectForUser, bumpProjectRevision } from '../db/projectRepo';

export function registerJobRoutes(app: Express): void {
  // Enqueue a send/regenerate job (fire-and-forget: runner outlives this request).
  app.post('/api/projects/:projectId/jobs/send', (req: Request, res: Response) => {
    // Ownership before enqueue (audit 26 L6): a caller could otherwise create
    // ghost jobs pointing at projects they don't own. 404 mirrors the rest of
    // the surface (no existence leak). Checked before body validation so it
    // answers 404 regardless of payload shape.
    const project = loadProjectForUser(req.user!.id, req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const {
      threadId,
      kind = 'send',
      askText,
      compiledPrompt,
      systemInstruction,
      model,
      stagedAttachments,
      targetTurnId,
    } = req.body ?? {};
    if (typeof threadId !== 'string' || !threadId) {
      res.status(400).json({ error: 'threadId is required' });
      return;
    }
    if (kind !== 'send' && kind !== 'regenerate') {
      res.status(400).json({ error: "kind must be 'send' or 'regenerate'" });
      return;
    }
    if (typeof askText !== 'string' || typeof compiledPrompt !== 'string') {
      res.status(400).json({ error: 'askText and compiledPrompt are required' });
      return;
    }
    let modelId: string;
    try {
      modelId = requireModelId(model, 'chat');
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Bad model' });
      return;
    }
    if (kind === 'regenerate' && typeof targetTurnId !== 'string') {
      res.status(400).json({ error: 'targetTurnId is required for regenerate' });
      return;
    }

    const job = enqueueJob({
      userId: req.user!.id,
      projectId: req.params.projectId,
      threadId,
      kind,
      askText,
      compiledPrompt,
      systemInstruction,
      model: modelId,
      stagedAttachments,
      targetTurnId: targetTurnId ?? null,
    });
    res.status(201).json({ job: { jobId: job.job_id, state: job.state, threadId: job.thread_id }, revision: project.revision });
  });

  // Non-completed jobs for a project.
  app.get('/api/projects/:projectId/jobs', (req: Request, res: Response) => {
    res.json({ jobs: listActiveJobSummaries(req.user!.id, req.params.projectId) });
  });

  // SSE watch channel — disconnect NEVER cancels the job (21E §1 law 3).
  app.get('/api/jobs/:jobId/stream', (req: Request, res: Response) => {
    const job = getJobRow(req.params.jobId);
    if (!job || job.user_id !== req.user!.id) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    attachSubscriber(req.params.jobId, res);
  });

  app.post('/api/jobs/:jobId/stop', (req: Request, res: Response) => {
    const job = getJobRow(req.params.jobId);
    if (!job || job.user_id !== req.user!.id) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    stopJob(req.params.jobId);
    res.json({ ok: true, state: 'stopped' });
  });

  app.post('/api/jobs/:jobId/retry', (req: Request, res: Response) => {
    const job = getJobRow(req.params.jobId);
    if (!job || job.user_id !== req.user!.id) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (!retryJob(
    req.params.jobId,
    // Body overrides (design 23 §2.5): the client recompiles the prompt and
    // passes the CURRENTLY selected model — a retry after a model change must
    // use the new model, never re-run the failed one.
    typeof req.body === 'object' && req.body !== null
      ? {
          model: typeof req.body.model === 'string' ? req.body.model : undefined,
          compiledPrompt: typeof req.body.compiledPrompt === 'string' ? req.body.compiledPrompt : undefined,
          systemInstruction: typeof req.body.systemInstruction === 'string' ? req.body.systemInstruction : undefined,
        }
      : undefined
  )) {
      res.status(400).json({ error: 'Only failed or stopped jobs can be retried.' });
      return;
    }
    res.json({ ok: true, state: 'queued' });
  });

  app.post('/api/jobs/:jobId/store-as-is', (req: Request, res: Response) => {
    const job = getJobRow(req.params.jobId);
    if (!job || job.user_id !== req.user!.id) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    const result = storeJobAsIs(req.params.jobId);
    if (!result) {
      res.status(400).json({ error: 'Job is not in a storable state.' });
      return;
    }
    res.json({ ok: true, revision: result.revision });
  });

  app.delete('/api/jobs/:jobId', (req: Request, res: Response) => {
    const job = getJobRow(req.params.jobId);
    if (!job || job.user_id !== req.user!.id) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    discardJob(req.params.jobId);
    res.json({ ok: true, revision: bumpProjectRevision(job.user_id, job.project_id) });
  });
}
