/**
 * direct.ts — the browser→provider lane logic (design-docs/16 Phase 1).
 *
 * `providers/` speaks provider dialect and answers with raw-ish envelopes.
 * This module owns the lane vocabulary: it builds prompts (src/prompts/) and
 * parses model text into the exact JSON shapes the server routes return, so
 * gateway/api.ts can answer identically whether the request went direct or
 * through the proxy. Call sites never learn which happened.
 */
import { geminiAdapter } from './providers/gemini';
import { openrouterAdapter } from './providers/openrouter';
import type { ProviderAdapter } from './providers/types';
import { errorResponse, jsonResponse } from './providers/types';
import {
  buildTitlePrompt,
  cleanupTitle,
  buildQaPrompt,
  parseQaPairs,
  fallbackQaPairs,
  cleanTtsText,
  clampTtsVoice,
  type QaSectionPayload,
} from '../prompts/lanes';
import {
  buildExtractPrompt,
  buildSummarizePrompt,
  readSentinelArtifact,
  EXTRACT_READ_CHAR_CAP,
} from '../prompts/prompt';
import { parseSentinelBlocks } from '../utils/sentinelParser';
import type { ResolvedKey } from '../data/keySlots';

export function adapterFor(key: ResolvedKey): ProviderAdapter {
  return key.provider === 'openrouter' ? openrouterAdapter : geminiAdapter;
}

/** Mirror of server/lib/tokens.ts — direct mode has no server to ask. */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

async function textFrom(res: Response): Promise<{ text: string; usage?: { input: number; output: number }; error?: Response }> {
  if (!res.ok) return { text: '', error: res };
  const body = await res.json().catch(() => ({}));
  return { text: body?.text ?? '', usage: body?.usage };
}

/* --------------------------------------------------------------------- chat */

export function directChatStream(
  key: ResolvedKey,
  params: {
    model: string;
    compiledPrompt: string;
    systemInstruction?: string;
  }
): Promise<Response> {
  return adapterFor(key).streamChat({
    apiKey: key.apiKey,
    model: params.model,
    contents: params.compiledPrompt,
    systemInstruction: params.systemInstruction,
    temperature: 0.7,
  });
}

/* -------------------------------------------------------------------- title */

export async function directTitleThread(
  key: ResolvedKey,
  params: { messages: Array<{ role: string; content: string }>; version: number; model: string }
): Promise<Response> {
  const { text, error } = await textFrom(
    await adapterFor(key).generate({
      apiKey: key.apiKey,
      model: params.model,
      prompt: buildTitlePrompt(params.messages, params.version),
      temperature: 0.4,
    })
  );
  // Best-effort lane: never 5xx — the client keeps its current title.
  if (error) return jsonResponse({ title: null });
  return jsonResponse({ title: cleanupTitle(text) });
}

/* ------------------------------------------------------------------ extract */

export async function directExtractArtifact(
  key: ResolvedKey,
  params: {
    content: string;
    filename: string;
    projectTitle: string;
    fileType: 'gdoc' | 'doc';
    previousError?: string;
    previousOutput?: string;
    model: string;
  }
): Promise<Response> {
  const { text, error } = await textFrom(
    await adapterFor(key).generate({
      apiKey: key.apiKey,
      model: params.model,
      prompt: buildExtractPrompt({
        content: params.content,
        filename: params.filename,
        projectTitle: params.projectTitle,
        fileType: params.fileType,
        previousError: params.previousError,
        previousOutput: params.previousOutput,
      }),
      temperature: 0.2,
    })
  );
  if (error) return error;
  void EXTRACT_READ_CHAR_CAP; // cap warning is a server-log concern; see route

  const read = readSentinelArtifact(text, params.filename.replace(/\.[^/.]+$/, ''));
  if (!read.hasLayers) {
    return errorResponse('Model output did not contain === SECTION === blocks', 502, {
      raw: text.slice(0, 20000),
    });
  }
  return jsonResponse({
    artifact: {
      title: read.title,
      code: read.code,
      type: read.type,
      category: read.type,
      subtitle: read.subtitle,
      description: read.description,
      summary: read.summary,
      tags: read.tags,
      graph: {
        parent: read.parent,
        children: [],
        relationships: read.relationships,
        is_high_concept: read.isHighConcept,
      },
      // The body is the file, not the model's retelling (same splice as the route).
      content: params.content,
    },
  });
}

/* ---------------------------------------------------------------- summarize */

export async function directSummarizeChapter(
  key: ResolvedKey,
  params: {
    title: string;
    messages: Array<{ role: string; content: string }>;
    steeringPrompt?: string;
    model: string;
  }
): Promise<Response> {
  if (!params.messages || params.messages.length === 0) {
    return jsonResponse({
      subtitle: `An empty chapter${params.title ? ` titled "${params.title}"` : ''}.`,
      description: '',
      summary: '',
    });
  }
  const { text, error } = await textFrom(
    await adapterFor(key).generate({
      apiKey: key.apiKey,
      model: params.model,
      prompt: buildSummarizePrompt({
        title: params.title,
        messages: params.messages,
        steeringPrompt: params.steeringPrompt,
      }),
      temperature: 0.3,
    })
  );
  if (error) return error;

  const blocks = parseSentinelBlocks(text);
  let subtitleText = blocks.subtitle || '';
  let descriptionText = blocks.description || '';
  let summaryText = blocks.summary || '';
  // Failure-tolerant, same as the route: a model that ignored the sentinels
  // still gets read rather than losing the whole call.
  if (!subtitleText && !descriptionText && !summaryText) {
    const descMatch = text.match(/DESCRIPTION:\s*([\s\S]*?)(?=SUMMARY:|$)/i);
    const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*)$/i);
    descriptionText = descMatch ? descMatch[1].trim() : '';
    summaryText = summaryMatch ? summaryMatch[1].trim() : text.trim().slice(0, 4000);
  }
  return jsonResponse({
    subtitle: subtitleText,
    description: descriptionText,
    summary: summaryText,
    tokens: estimateTokens(subtitleText + descriptionText + summaryText),
  });
}

/* --------------------------------------------------------------- search QA */

export async function directGenerateQa(
  key: ResolvedKey,
  params: {
    title: string;
    subtitle?: string;
    sections: QaSectionPayload[];
    model: string;
  }
): Promise<Response> {
  const { text, error } = await textFrom(
    await adapterFor(key).generate({
      apiKey: key.apiKey,
      model: params.model,
      prompt: buildQaPrompt(params.title, params.subtitle, params.sections),
      temperature: 0.2,
    })
  );
  if (error) return error;
  const qaPairs = parseQaPairs(text, params.sections);
  if (qaPairs.length === 0) {
    return jsonResponse({ qaPairs: fallbackQaPairs(params.sections), offline: true });
  }
  return jsonResponse({ qaPairs });
}

/* --------------------------------------------------------------- embeddings */

export function directEmbed(
  key: ResolvedKey,
  params: { texts: string[]; taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'; title?: string; model: string }
): Promise<Response> {
  return adapterFor(key).embed({
    apiKey: key.apiKey,
    model: params.model,
    texts: params.texts,
    taskType: params.taskType,
    title: params.title,
  });
}

/* ---------------------------------------------------------------------- tts */

export function directTts(
  key: ResolvedKey,
  params: { text: string; voice: string; model: string }
): Promise<Response> {
  return adapterFor(key).tts({
    apiKey: key.apiKey,
    model: params.model,
    text: cleanTtsText(params.text),
    voice: clampTtsVoice(params.voice),
  });
}

/* ----------------------------------------------------------------- catalog */

export function directListModels(key: ResolvedKey): Promise<Response> {
  return adapterFor(key).listModels(key.apiKey);
}
