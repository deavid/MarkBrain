/**
 * Project sync routes (design-docs/21D §3) — every route behind requireAuth
 * (mounted gated in server/app.ts). Body shapes mirror the ProjectStore port;
 * responses carry `{ revision }` so clients can advance their delta cursor.
 */
import type { Express, Request, Response } from 'express';
import {
  listProjectsForUser,
  loadProjectForUser,
  applyProjectSnapshotDiff,
  applyAtomicMutation,
  getProjectDelta,
  deleteProjectForUser,
  replaceAllProjectsForUser,
  createProjectForUser,
  type AtomicMutation,
} from '../db/projectRepo';
import type { ProjectSnapshot } from '../../shared/types/projectSnapshot';

function isSnapshot(body: unknown): body is ProjectSnapshot {
  const s = body as ProjectSnapshot;
  return Boolean(s && typeof s.projectId === 'string' && Array.isArray(s.turns));
}

/** Route-level guard: every failure answers JSON with an honest message. */
function fail(res: Response, err: unknown, fallback: string): void {
  const message = err instanceof Error && err.message.trim() ? err.message.trim() : fallback;
  res.status(500).json({ error: message });
}

export function registerProjectRoutes(app: Express): void {
  app.get('/api/projects', (req: Request, res: Response) => {
    res.json({ projects: listProjectsForUser(req.user!.id) });
  });

  app.post('/api/projects', (req: Request, res: Response) => {
    const snap = req.body?.project ?? req.body;
    if (!isSnapshot(snap)) {
      res.status(400).json({ error: 'body must be a ProjectSnapshot (or { project })' });
      return;
    }
    try {
      const { revision, project } = createProjectForUser(req.user!.id, snap);
      res.status(201).json({ project, revision });
    } catch (err) {
      fail(res, err, 'Project create failed.');
    }
  });

  app.get('/api/projects/:projectId', (req: Request, res: Response) => {
    const project = loadProjectForUser(req.user!.id, req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ project });
  });

  app.put('/api/projects/:projectId', (req: Request, res: Response) => {
    const snap = req.body as ProjectSnapshot;
    if (!isSnapshot(snap) || snap.projectId !== req.params.projectId) {
      res.status(400).json({ error: 'body must be the ProjectSnapshot for :projectId' });
      return;
    }
    const { revision } = applyProjectSnapshotDiff(req.user!.id, snap);
    res.json({ ok: true, revision });
  });

  app.post('/api/projects/:projectId/mutate', (req: Request, res: Response) => {
    const mutations = req.body?.mutations ?? (req.body?.op ? req.body : undefined);
    if (!mutations || (typeof mutations !== 'object')) {
      res.status(400).json({ error: 'body must carry a mutation ({ op, ... } or { mutations })' });
      return;
    }
    try {
      const { revision } = applyAtomicMutation(req.user!.id, req.params.projectId, mutations as AtomicMutation | AtomicMutation[]);
      res.json({ ok: true, revision });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Mutation failed.' });
    }
  });

  app.get('/api/projects/:projectId/delta', (req: Request, res: Response) => {
    const since = Number(req.query.since ?? 0);
    if (!Number.isFinite(since) || since < 0) {
      res.status(400).json({ error: 'since must be a non-negative number' });
      return;
    }
    const delta = getProjectDelta(req.user!.id, req.params.projectId, since);
    if (!delta) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json(delta);
  });

  app.delete('/api/projects/:projectId', (req: Request, res: Response) => {
    const removed = deleteProjectForUser(req.user!.id, req.params.projectId);
    if (!removed) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/projects/replace-all', (req: Request, res: Response) => {
    const projects = req.body?.projects ?? req.body;
    if (!Array.isArray(projects) || !projects.every(isSnapshot)) {
      res.status(400).json({ error: 'body must be { projects: ProjectSnapshot[] }' });
      return;
    }
    try {
      const { revision } = replaceAllProjectsForUser(req.user!.id, projects as ProjectSnapshot[]);
      res.json({ ok: true, revision });
    } catch (err) {
      fail(res, err, 'replaceAll failed.');
    }
  });
}
