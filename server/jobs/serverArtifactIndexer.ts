/**
 * Server-side artifact indexer (design-docs/21F Part A §2).
 *
 * Single FIFO queue per process. Enqueued whenever an artifact row is
 * upserted (projectRepo / chat-job commits); deletions remove index rows
 * immediately. Section diffing by `content_hash` means a no-change save
 * costs ZERO provider calls. Vault locked / no key → status pauses with an
 * honest lastError instead of crashing the queue.
 */
import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { OpenRouterClient, isOpenRouterModel } from '../providers/openrouter';
import { getDb } from '../db/index';
import { resolveServerLaneKey, isVaultUnlocked, VaultLockedError, NoKeyError } from '../lib/accountVault';
import { requireModelId, defaultModelFor } from '../lib/models';
import { readSettings } from '../lib/settings';
import { logServer } from '../lib/log';
import { splitArtifactIntoSections } from '../../shared/utils/sectionChunker';
import { buildQaPrompt, parseQaPairs, type QaSectionPayload } from '../../shared/prompts/lanes';
import type { UniversalArtifactDocument } from '../../shared/types/artifact';

const EMBED_BATCH_LIMIT = 80;
const QA_MODEL_ID = 'gemini-3.5-flash-lite';

export interface IndexStatus {
  indexedArtifacts: number;
  totalArtifacts: number;
  state: 'idle' | 'indexing' | 'error';
  lastError?: string;
}

type Job = { userId: number; projectId: string; artifactId: string };

const queue: Job[] = [];
const queued = new Set<string>(); // `${userId}:${projectId}:${artifactId}`
let processing = false;
let state: IndexStatus['state'] = 'idle';
let lastError: string | undefined;

function jobKey(j: Job): string {
  return `${j.userId}:${j.projectId}:${j.artifactId}`;
}

/** Enqueue (deduped) — safe to call inside a transaction (queue is RAM only). */
export function enqueueIndex(userId: number, projectId: string, artifactId: string): void {
  const key = `${userId}:${projectId}:${artifactId}`;
  if (queued.has(key)) return;
  queued.add(key);
  queue.push({ userId, projectId, artifactId });
  state = 'indexing';
  void drain();
}

/** Artifact deleted → its index rows go immediately (21F §2.1). */
export function deleteIndexRows(userId: number, projectId: string, artifactId: string): void {
  try {
    getDb()
      .prepare('DELETE FROM artifact_index_sections WHERE user_id = ? AND project_id = ? AND artifact_id = ?')
      .run(userId, projectId, artifactId);
  } catch {
    /* table missing pre-boot — nothing to delete */
  }
}

export function getIndexStatus(userId: number, projectId: string): IndexStatus {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE user_id = ? AND project_id = ?').get(userId, projectId) as { n: number }).n;
  const indexed = (
    db
      .prepare('SELECT COUNT(DISTINCT artifact_id) AS n FROM artifact_index_sections WHERE user_id = ? AND project_id = ?')
      .get(userId, projectId) as { n: number }
  ).n;
  return { indexedArtifacts: indexed, totalArtifacts: total, state, lastError };
}

async function drain(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      queued.delete(jobKey(job));
      try {
        await indexOne(job.userId, job.projectId, job.artifactId);
        lastError = undefined;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logServer('warn', 'INDEX', `Index failed for ${job.artifactId}: ${lastError}`);
      }
    }
    state = lastError ? 'error' : 'idle';
  } finally {
    processing = false;
  }
}

function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function l2(v: number[]): number[] {
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/** The user's own embed slot (Model Settings), falling back to the lane default. */
function userEmbedModel(userId: number): string {
  try {
    // lib/settings is the shared home for the user_settings storage — the old
    // lazy require('../routes/account') here existed only to dodge a circular
    // import and is dead. Kept in try/catch — if settings are unreadable the
    // lane default is the honest fallback, never a crash.
    const { modelSlots } = readSettings(userId);
    const id = modelSlots['embed'];
    return typeof id === 'string' && id ? requireModelId(id, 'embed') : defaultModelFor('embed');
  } catch {
    return defaultModelFor('embed');
  }
}

function clientForEmbed(model: string, apiKey: string): GoogleGenAI | OpenRouterClient {
  return isOpenRouterModel(model) ? new OpenRouterClient(apiKey) : new GoogleGenAI({ apiKey });
}

/**
 * Provider-neutral embed. GoogleGenAI uses models.embedContent with taskType +
 * outputDimensionality; OpenRouter ids go through the facade's embedContent
 * (/embeddings, OpenAI shape). Both return L2-normalized vectors (LAW 6) in
 * input order.
 */
async function embedTextsAnyProvider(
  client: GoogleGenAI | OpenRouterClient,
  model: string,
  texts: string[],
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_LIMIT) {
    const batch = texts.slice(i, i + EMBED_BATCH_LIMIT);
    if (isOpenRouterModel(model)) {
      // OpenRouter: taskType/outputDimensionality don't exist on /embeddings.
      const response = await (client as OpenRouterClient).models.embedContent({
        model,
        contents: batch,
      });
      for (const emb of response.embeddings) out.push(emb.values);
    } else {
      const response = await (client as GoogleGenAI).models.embedContent({
        model,
        contents: batch,
        config: { taskType, outputDimensionality: 768 },
      });
      for (const emb of response.embeddings || []) out.push(l2(emb.values || []));
    }
    if (i + EMBED_BATCH_LIMIT < texts.length) await new Promise((r) => setTimeout(r, 150));
  }
  return out;
}

async function indexOne(userId: number, projectId: string, artifactId: string): Promise<void> {
  const db = getDb();
  const artRow = db
    .prepare('SELECT doc_json FROM artifacts WHERE user_id = ? AND project_id = ? AND artifact_id = ?')
    .get(userId, projectId, artifactId) as { doc_json: string } | undefined;
  if (!artRow) {
    deleteIndexRows(userId, projectId, artifactId);
    return;
  }
  let doc: UniversalArtifactDocument;
  try {
    doc = JSON.parse(artRow.doc_json);
  } catch {
    return;
  }

  const sections = splitArtifactIntoSections(doc).map((s) => ({
    ...s,
    hash: sha1(s.text),
  }));
  if (sections.length === 0) {
    deleteIndexRows(userId, projectId, artifactId);
    return;
  }

  const qaModel = requireModelId(QA_MODEL_ID, 'qaGen');
  // The user's own embed slot (Model Settings). A flip makes rows built with
  // the old model a different model — the model-gated diff re-embeds them.
  const embedModel = requireModelId(userEmbedModel(userId), 'embed');

  // Diff by content_hash AND by model: rows built with another embed model
  // count as stale, they get re-embedded instead of being reused.
  const existing = db
    .prepare(
      'SELECT section_id, content_hash FROM artifact_index_sections WHERE user_id = ? AND project_id = ? AND artifact_id = ? AND model = ?'
    )
    .all(userId, projectId, artifactId, embedModel) as Array<{ section_id: string; content_hash: string }>;
  const existingByHash = new Map(existing.map((r) => [r.section_id, r.content_hash]));
  const staleIds = existing.filter((r) => !sections.some((s) => s.id === r.section_id)).map((r) => r.section_id);
  const changed = sections.filter((s) => existingByHash.get(s.id) !== s.hash);
  const freshCount = sections.length - changed.length;
  // Section vectors must exist; empty QA vectors are LEGAL (a note with no
  // Q&A pairs is fresh, not stale — same law as the client-side isIndexStale).
  const vectorsPresent = db
    .prepare(
      `SELECT COUNT(*) AS n FROM artifact_index_sections
       WHERE user_id = ? AND project_id = ? AND artifact_id = ? AND section_vec_json != '[]'`
    )
    .get(userId, projectId, artifactId) as { n: number };

  if (staleIds.length === 0 && changed.length === 0 && freshCount > 0 && vectorsPresent.n === freshCount) {
    return; // 0 API calls — every section hash matches with vectors in place
  }

  if (!isVaultUnlocked(userId)) throw new VaultLockedError();

  let apiKey: string;
  try {
    apiKey = resolveServerLaneKey(userId, 'qaGen', qaModel);
  } catch (err) {
    if (err instanceof NoKeyError) throw new Error('paused: no API key configured for gemini');
    throw err;
  }
  const embedKey = resolveServerLaneKey(userId, 'embed', embedModel);
  const qaClient = new GoogleGenAI({ apiKey });
  const embedClient: GoogleGenAI | OpenRouterClient = clientForEmbed(embedModel, embedKey);

  // ONE generate-qa call for the whole note (only when something changed).
  const payloads: QaSectionPayload[] = sections.map((s) => ({ id: s.id, heading: s.heading, text: s.text }));
  const qaResponse = await qaClient.models.generateContent({
    model: qaModel,
    contents: buildQaPrompt(doc.title, doc.current?.subtitle, payloads),
    config: { temperature: 0.2 },
  });
  const qaPairs = parseQaPairs(qaResponse.text || '', payloads);

  // Embed section texts + generated QA questions/answers (changed set only —
  // whole-note embed is one batched call, still far cheaper than re-LLM).
  const sectionVecs = await embedTextsAnyProvider(embedClient, embedModel, sections.map((s) => s.text), 'RETRIEVAL_DOCUMENT');
  const qaByHeading = new Map<string, typeof qaPairs>();
  for (const qa of qaPairs) {
    const list = qaByHeading.get(qa.sectionHeading) ?? [];
    list.push(qa);
    qaByHeading.set(qa.sectionHeading, list);
  }
  const allQaTexts = qaPairs.map((q) => `${q.question} ${q.answer}`);
  const qaVecs = allQaTexts.length ? await embedTextsAnyProvider(embedClient, embedModel, allQaTexts, 'RETRIEVAL_DOCUMENT') : [];
  let qaCursor = 0;
  const qaVecByHeading = new Map<string, number[][]>();
  for (const [heading, list] of qaByHeading) {
    qaVecByHeading.set(heading, qaVecs.slice(qaCursor, qaCursor + list.length));
    qaCursor += list.length;
  }

  // Persist: drop stale, upsert fresh (hash-gated rows keep their vectors).
  const tx = db.transaction(() => {
    for (const id of staleIds) {
      db.prepare('DELETE FROM artifact_index_sections WHERE user_id = ? AND project_id = ? AND artifact_id = ? AND section_id = ?').run(
        userId,
        projectId,
        artifactId,
        id
      );
    }
    const upsert = db.prepare(
      `INSERT INTO artifact_index_sections (user_id, project_id, artifact_id, section_id, content_hash, heading, text,
         qa_json, section_vec_json, qa_vecs_json, model, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, project_id, artifact_id, section_id) DO UPDATE SET
         content_hash = excluded.content_hash, heading = excluded.heading, text = excluded.text,
         qa_json = excluded.qa_json, section_vec_json = excluded.section_vec_json,
         qa_vecs_json = excluded.qa_vecs_json, model = excluded.model, updated_at = excluded.updated_at`
    );
    sections.forEach((s, i) => {
      const sectionQa = qaByHeading.get(s.heading) ?? [];
      const sectionQaVecs = qaVecByHeading.get(s.heading) ?? [];
      // Reuse prior vectors for untouched sections (embed calls are whole-note,
      // but rows only rewrite when their hash changed OR vectors were missing).
      const prior = existingByHash.get(s.id);
      let secVec = sectionVecs[i] ?? [];
      let qaVecJson = JSON.stringify(sectionQaVecs);
      if (prior === s.hash) {
        const priorRow = db
          .prepare(
            'SELECT section_vec_json, qa_vecs_json FROM artifact_index_sections WHERE user_id = ? AND project_id = ? AND artifact_id = ? AND section_id = ?'
          )
          .get(userId, projectId, artifactId, s.id) as { section_vec_json: string; qa_vecs_json: string } | undefined;
        if (priorRow && priorRow.section_vec_json !== '[]') {
          secVec = JSON.parse(priorRow.section_vec_json);
          if (priorRow.qa_vecs_json !== '[]') qaVecJson = priorRow.qa_vecs_json;
        }
      }
      upsert.run(
        userId,
        projectId,
        artifactId,
        s.id,
        s.hash,
        s.heading,
        s.text,
        JSON.stringify(sectionQa),
        JSON.stringify(secVec),
        qaVecJson,
        embedModel,
        Date.now()
      );
    });
  });
  tx();
  logServer('info', 'INDEX', `Indexed ${artifactId}: ${sections.length} sections, ${qaPairs.length} QA`);
}

/** Test seam: drain synchronously-awaited queue state. */
export async function flushIndexerForTests(): Promise<void> {
  // Wait until the queue is empty and no drain is in flight.
  for (let i = 0; i < 200; i++) {
    if (queue.length === 0 && !processing) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('indexer did not flush');
}
