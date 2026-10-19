import type { Express, Request, Response } from 'express';
import { DEFAULT_MODEL_ID, getModelCatalog } from '../lib/models';

// API: server-owned model catalog — single source of truth for which models
// this deployment offers. Shape: { models: [...], default: '<id>' }.
export function registerModelsRoutes(app: Express): void {
  app.get('/api/models', (_req: Request, res: Response) => {
    res.json({
      models: getModelCatalog(),
      default: DEFAULT_MODEL_ID,
    });
  });
}