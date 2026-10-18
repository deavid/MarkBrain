import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '10mb' }));

// Server Telemetry & Ring Buffer Logging Subsystem
export interface ServerLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  tag: string;
  message: string;
  meta?: any;
}

const serverLogsBuffer: ServerLogEntry[] = [];
const logSubscribers: Set<(entry: ServerLogEntry) => void> = new Set();

export function logServer(level: 'info' | 'warn' | 'error' | 'success', tag: string, message: string, meta?: any) {
  const timestamp = new Date().toISOString();
  const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const entry: ServerLogEntry = { id, timestamp, level, tag, message, meta };

  serverLogsBuffer.push(entry);
  if (serverLogsBuffer.length > 350) {
    serverLogsBuffer.shift();
  }

  // Colored terminal logs
  const colors = {
    info: '\x1b[36m', // Cyan
    warn: '\x1b[33m', // Yellow
    error: '\x1b[31m', // Red
    success: '\x1b[32m', // Green
  };
  const reset = '\x1b[0m';
  const timeShort = timestamp.split('T')[1].slice(0, 8);
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`${colors[level]}[${timeShort}] [${tag}]${reset} ${message}${metaStr}`);

  // Broadcast to connected web clients
  logSubscribers.forEach((sub) => {
    try {
      sub(entry);
    } catch {
      // client disconnected
    }
  });
}

// Global request counter & middleware instrumentation
let globalReqCounter = 0;
app.use((req, res, next) => {
  if (req.path.startsWith('/api') && !req.path.includes('/server-logs')) {
    const reqId = ++globalReqCounter;
    (req as any).reqId = reqId;
    const start = Date.now();
    logServer('info', 'API:REQ', `#${reqId} ${req.method} ${req.path}`);

    res.on('finish', () => {
      const dur = Date.now() - start;
      const level = res.statusCode >= 400 ? 'error' : 'success';
      logServer(level, 'API:RES', `#${reqId} ${req.method} ${req.path} -> HTTP ${res.statusCode} (${dur}ms)`);
    });
  }
  next();
});

// Shared Gemini Client
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI();
  logServer('success', 'GEMINI:INIT', `Gemini SDK initialized successfully with API key (length: ${apiKey.length})`);
} else {
  logServer('warn', 'GEMINI:INIT', 'GEMINI_API_KEY not found in environment; running in local synthesis fallback mode');
}

// API: Server Logs for Browser Terminal / Drawer
app.get('/api/server-logs', (_req: Request, res: Response) => {
  res.json({ logs: serverLogsBuffer });
});

app.get('/api/server-logs/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send initial recent logs
  const initial = JSON.stringify({ type: 'init', logs: serverLogsBuffer.slice(-60) });
  res.write(`event: log_init\ndata: ${initial}\n\n`);

  const handler = (entry: ServerLogEntry) => {
    res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
  };

  logSubscribers.add(handler);
  req.on('close', () => {
    logSubscribers.delete(handler);
  });
});

app.post('/api/server-logs/clear', (_req: Request, res: Response) => {
  serverLogsBuffer.length = 0;
  logServer('info', 'LOGS:CLEAR', 'Server logs buffer cleared by client');
  res.json({ success: true });
});

// Helper to count rough tokens
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

// API: Check status
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString(),
    logsCount: serverLogsBuffer.length,
  });
});

// API: Firebase / OAuth client configuration from runtime environment
app.get('/api/auth/config', (_req: Request, res: Response) => {
  res.json({
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '',
    appId: process.env.FIREBASE_APP_ID || '',
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || (process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com` : ''),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    firestoreDatabaseId: process.env.FIRESTORE_DB_ID || process.env.FIREBASE_FIRESTORE_DATABASE_ID || '',
    oAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
  });
});

// Helper to parse artifacts, topic shifts, and clean reply text from raw LLM output
function parseModelResponse(replyText: string) {
  const artifacts: Array<{
    title: string;
    type: string;
    abstract: string;
    highConcept: boolean;
    content: string;
  }> = [];

  // 1. Extract markdown ```artifact ... ``` blocks
  const artifactRegex = /```artifact\s*([\s\S]*?)```/g;
  let match;
  while ((match = artifactRegex.exec(replyText)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/title:\s*(.*)/i);
    const typeMatch = block.match(/type:\s*(.*)/i);
    const abstractMatch = block.match(/abstract:\s*(.*)/i);
    const highConceptMatch = block.match(/highConcept:\s*(true|false)/i);

    const bodyLines = block
      .replace(/title:.*\n/i, '')
      .replace(/type:.*\n/i, '')
      .replace(/abstract:.*\n/i, '')
      .replace(/highConcept:.*\n/i, '')
      .trim();

    artifacts.push({
      title: titleMatch ? titleMatch[1].trim() : 'Extracted note',
      type: typeMatch ? typeMatch[1].trim() : 'note',
      abstract: abstractMatch ? abstractMatch[1].trim() : 'Generated note.',
      highConcept: highConceptMatch ? highConceptMatch[1].toLowerCase() === 'true' : false,
      content: bodyLines || block,
    });
  }

  // 2. Extract XML <artifact_upsert> or <artifact> tags (attributes in any order)
  const xmlArtifactRegex = /<(?:artifact_upsert|artifact)\b([^>]*)>([\s\S]*?)<\/(?:artifact_upsert|artifact)>/gi;
  let upMatch;
  while ((upMatch = xmlArtifactRegex.exec(replyText)) !== null) {
    const attrs = upMatch[1];
    const inner = upMatch[2];
    const titleAttr = /title=["']([^"']+)["']/i.exec(attrs);
    const typeAttr = /type=["']([^"']+)["']/i.exec(attrs);
    const idAttr = /id=["']([^"']+)["']/i.exec(attrs);

    const upTitle = titleAttr ? titleAttr[1] : (idAttr ? idAttr[1] : 'Extracted note');
    const upType = typeAttr ? typeAttr[1] : 'document';
    const absMatch = /<abstract>([\s\S]*?)<\/abstract>/i.exec(inner);
    const contentMatch = /<content>([\s\S]*?)<\/content>/i.exec(inner);
    const sumMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(inner);

    artifacts.push({
      title: upTitle,
      type: upType,
      abstract: absMatch ? absMatch[1].trim() : (sumMatch ? sumMatch[1].trim() : upTitle),
      highConcept: false,
      content: contentMatch ? contentMatch[1].trim() : inner.trim(),
    });
  }

  // 3. Extract topic shifts (JSON or XML)
  let topicShift: { shiftDetected: boolean; newChapterTitle: string; reason: string } | null = null;
  const topicShiftRegex = /```topic_shift\s*([\s\S]*?)```/i;
  const topicMatch = replyText.match(topicShiftRegex);
  if (topicMatch) {
    try {
      topicShift = JSON.parse(topicMatch[1].trim());
    } catch {
      // ignore parse error
    }
  }

  const topicShiftXml = /<topic_shift\s+([^>]*?)\/?>/i.exec(replyText);
  if (topicShiftXml && !topicShift) {
    const titleM = /title=["']([^"']+)["']/i.exec(topicShiftXml[1]);
    const summaryM = /summary=["']([^"']+)["']/i.exec(topicShiftXml[1]);
    if (titleM) {
      topicShift = {
        shiftDetected: true,
        newChapterTitle: titleM[1],
        reason: summaryM ? summaryM[1] : 'Topic progression',
      };
    }
  }

  // Clean reply text of artifact/topic_shift raw blocks for display
  const cleanedReply = replyText
    .replace(/```topic_shift[\s\S]*?```/gi, '')
    .replace(/<topic_shift[\s\S]*?\/>/gi, '')
    .replace(/<(?:artifact_upsert|artifact)\b[^>]*>[\s\S]*?<\/(?:artifact_upsert|artifact)>/gi, '')
    .replace(/```artifact\s*[\s\S]*?```/gi, '')
    .replace(/<link[\s\S]*?\/>/gi, '')
    .trim();

  return {
    cleanedReply,
    artifacts,
    topicShift,
  };
}

const DEFAULT_SYSTEM_INSTRUCTION = `You are MarkBrain, a thinking partner for a brain that overflows with ideas. You help collect thoughts before they evaporate, keep them organized, and keep the whole forest in view while diving into details.
Talk WITH the user — curious, direct, plain-spoken. No corporate filler. It's fine to say you don't know something.

CRITICAL INSTRUCTIONS:
1. Ground your response in the provided notes and conversation chapters.
2. When the user crystallizes an idea worth keeping on its own, output it inside a dedicated artifact block:
\`\`\`artifact
title: [Short Note Title]
type: [note | decision | summary | reference | topic]
abstract: [1-sentence summary of this idea]
highConcept: [true | false - true if it's a core thread tying many other thoughts together, false for a regular note]
[Markdown content here]
\`\`\`
3. Keep prose honest and high-signal.
4. If the conversation shifts into a substantially new topic, declare it via:
<topic_shift title="New Chapter Title" abstract="1-sentence essence" summary="Key points of this shift" />
or conclude with a JSON block:
\`\`\`topic_shift
{"shiftDetected": true, "newChapterTitle": "Suggested New Chapter Title", "reason": "What changed"}
\`\`\`
otherwise omit that block.`;

function buildCompiledPrompt(payload: any): string {
  const {
    compiledPrompt: clientCompiledPrompt,
    projectTitle = 'Untitled',
    currentTopic = '',
    chapterSummaries = [],
    contextPayload = '',
    messages = [],
  } = payload;

  if (clientCompiledPrompt) return clientCompiledPrompt;

  let prompt = `Project: ${projectTitle}\nCurrent Focus: ${currentTopic || 'General'}\n\n`;

  if (chapterSummaries && chapterSummaries.length > 0) {
    prompt += `--- PREVIOUS CHAPTER SUMMARIES (Compressed Memory) ---\n`;
    for (const chap of chapterSummaries) {
      prompt += `[Chapter: ${chap.title}]\nSummary: ${chap.summary}\nKey Points: ${(chap.keyPoints || []).join('; ')}\n\n`;
    }
  }

  if (contextPayload && contextPayload.trim().length > 0) {
    prompt += `--- ACTIVE IN-MEMORY ARTIFACTS ---\n${contextPayload}\n\n`;
  }

  prompt += `--- CONVERSATION TRANSCRIPT ---\n`;
  for (const msg of messages) {
    prompt += `${msg.role === 'user' ? 'User' : 'MarkBrain'}: ${msg.content}\n`;
  }

  prompt += `\nMarkBrain:`;
  return prompt;
}

// API: Explicit Chat Cancellation
app.post('/api/chat/cancel', (req: Request, res: Response) => {
  const { reason = 'User pressed stop' } = req.body;
  logServer('warn', 'CHAT:CANCEL', `Client canceled operation: ${reason}`);
  res.json({ success: true, message: 'Stream canceled' });
});

// API: Real-Time Server-Sent Events (SSE) Streaming Endpoint
app.post('/api/chat/stream', async (req: Request, res: Response) => {
  const reqId = (req as any).reqId || Math.floor(Math.random() * 10000);
  const startTime = Date.now();
  let isClientAborted = false;

  // Setup SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Detect premature client disconnect (socket closed before response ended)
  res.on('close', () => {
    if (!res.writableEnded) {
      isClientAborted = true;
      logServer('warn', 'STREAM:CLIENT_ABORT', `#${reqId} Client connection closed prematurely / aborted`);
    }
  });

  const sendSSE = (event: string, data: any) => {
    if (isClientAborted) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      logServer('error', 'STREAM:WRITE_ERR', `#${reqId} Failed to write SSE event: ${event}`);
    }
  };

  try {
    const {
      model = 'gemini-3.1-flash-lite',
      projectTitle = 'Untitled',
      systemInstruction: clientSystemInstruction,
    } = req.body;

    const systemInstruction = clientSystemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
    const compiledPrompt = buildCompiledPrompt(req.body);

    const validModels = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-pro-preview'];
    let targetModel = validModels.includes(model) ? model : 'gemini-3.1-flash-lite';

    logServer('info', 'STREAM:INIT', `#${reqId} Initiating stream for project="${projectTitle}", model=${targetModel}, promptChars=${compiledPrompt.length}`);

    // Step 1: Connecting Status
    sendSSE('status', {
      state: 'connecting',
      message: `Connecting to ${targetModel}...`,
      timestamp: Date.now(),
      model: targetModel,
    });

    if (ai) {
      sendSSE('status', {
        state: 'thinking',
        message: `Thinking with ${targetModel}...`,
        timestamp: Date.now(),
        model: targetModel,
      });

      // Helper function to stream from a given model
      const streamFromModel = async (modelName: string) => {
        logServer('info', 'GEMINI:STREAM_CALL', `#${reqId} Calling ai.models.generateContentStream(${modelName})`);
        return await ai!.models.generateContentStream({
          model: modelName,
          contents: compiledPrompt,
          config: {
            systemInstruction,
            temperature: 0.7,
          },
        });
      };

      let responseStream: any = null;
      let usedModel = targetModel;

      // Smart watchdog: if non-lite model is requested, race with a 9-second watchdog
      if (targetModel !== 'gemini-3.1-flash-lite') {
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('FIRST_CHUNK_TIMEOUT_9S')), 9000)
          );
          responseStream = await Promise.race([streamFromModel(targetModel), timeoutPromise]);
        } catch (streamErr: any) {
          logServer('warn', 'STREAM:WATCHDOG', `#${reqId} Upstream model ${targetModel} delayed (${streamErr?.message || 'timeout'}). Failing over to gemini-3.1-flash-lite.`);
          sendSSE('status', {
            state: 'thinking',
            message: `Optimizing latency: routed to Gemini 3.1 Flash Lite...`,
            timestamp: Date.now(),
            model: 'gemini-3.1-flash-lite',
          });
          usedModel = 'gemini-3.1-flash-lite';
          responseStream = await streamFromModel('gemini-3.1-flash-lite');
        }
      } else {
        responseStream = await streamFromModel(targetModel);
      }

      let fullText = '';
      let chunkCount = 0;
      let timeToFirstChunkMs: number | null = null;
      let lastStatusTick = Date.now();
      let lastLogTick = Date.now();
      let usageMetadata: any = null;

      for await (const chunk of responseStream) {
        if (isClientAborted) {
          logServer('warn', 'STREAM:BREAK', `#${reqId} Generator loop exited due to client abort.`);
          break;
        }

        if (timeToFirstChunkMs === null) {
          timeToFirstChunkMs = Date.now() - startTime;
          logServer('success', 'STREAM:TTFC', `#${reqId} First chunk received in ${timeToFirstChunkMs}ms from ${usedModel}`);
          sendSSE('status', {
            state: 'writing',
            message: `Writing response with ${usedModel}...`,
            timestamp: Date.now(),
            timeToFirstChunkMs,
            model: usedModel,
          });
        }

        const chunkText = chunk.text || '';
        if (chunkText) {
          fullText += chunkText;
          chunkCount++;

          sendSSE('chunk', {
            delta: chunkText,
            accumulatedLength: fullText.length,
            timestamp: Date.now(),
          });

          const now = Date.now();
          // Client status tick every ~900ms
          if (now - lastStatusTick >= 900) {
            lastStatusTick = now;
            sendSSE('status', {
              state: 'writing',
              message: `Writing response (${chunkCount} chunks, ${fullText.length} chars)...`,
              bytesReceived: fullText.length,
              chunks: chunkCount,
              elapsedMs: now - startTime,
              timestamp: now,
              model: usedModel,
            });
          }

          // Server console log every ~2.5s to avoid flood while maintaining high observability
          if (now - lastLogTick >= 2500) {
            lastLogTick = now;
            logServer('info', 'STREAM:PROGRESS', `#${reqId} Chunk #${chunkCount}, totalChars=${fullText.length}, elapsed=${now - startTime}ms`);
          }
        }

        if (chunk.usageMetadata) {
          usageMetadata = chunk.usageMetadata;
        }
      }

      if (isClientAborted) {
        res.end();
        return;
      }

      // Step 3: Indexing and extracting artifacts from the complete stream
      sendSSE('status', {
        state: 'indexing',
        message: 'Reading reply and extracting notes...',
        timestamp: Date.now(),
      });

      const { cleanedReply, artifacts, topicShift } = parseModelResponse(fullText);

      // Raw 1:1 Gemini API token usage
      const promptTokens = usageMetadata?.promptTokenCount ?? estimateTokens(compiledPrompt);
      const candidatesTokens = usageMetadata?.candidatesTokenCount ?? estimateTokens(fullText);
      const totalTokens = usageMetadata?.totalTokenCount ?? (promptTokens + candidatesTokens);
      const durationMs = Date.now() - startTime;

      logServer('success', 'STREAM:DONE', `#${reqId} Completed in ${durationMs}ms`, {
        model: usedModel,
        promptTokens,
        candidatesTokens,
        totalTokens,
        artifactsExtracted: artifacts.length,
        topicShiftDetected: Boolean(topicShift),
      });

      const telemetry = {
        model: usedModel,
        promptTokens,
        candidatesTokens,
        totalTokens,
        durationMs,
        timeToFirstChunkMs: timeToFirstChunkMs ?? durationMs,
        rawMetadata: usageMetadata,
        isFallback: false,
      };

      sendSSE('complete', {
        reply: cleanedReply || fullText,
        rawReply: fullText,
        artifacts,
        topicShift,
        telemetry,
      });

      sendSSE('done', { success: true });
      res.end();
    } else {
      // High-fidelity fallback streaming simulation when GEMINI_API_KEY is not set
      logServer('info', 'STREAM:FALLBACK', `#${reqId} Running in local simulation fallback`);
      sendSSE('status', {
        state: 'thinking',
        message: 'Demo mode (no API key) — streaming a canned reply...',
        timestamp: Date.now(),
      });

      await new Promise((r) => setTimeout(r, 350));

      sendSSE('status', {
        state: 'writing',
        message: 'Writing reply...',
        timestamp: Date.now(),
      });

      const sampleChunks = [
        `### Offline demo\n\nThe server is running without a GEMINI_API_KEY, so this is a canned reply — but it exercises the real pipeline: streaming, tag stripping, and note extraction.\n\n`,
        `\`\`\`artifact\ntitle: Example Note\ntype: note\nabstract: A canned note produced by the local simulation fallback.\nhighConcept: false\n# Example Note\n\nThis note exists so the extraction pipeline can be exercised without an API key. Put a real key in .env to talk to an actual model.\n\`\`\`\n\n`,
        `Prose stays clean, and the block above becomes a note in your graph. That's the whole loop.\n\n`,
      ];

      let accumulated = '';
      for (const c of sampleChunks) {
        if (isClientAborted) break;
        accumulated += c;
        sendSSE('chunk', {
          delta: c,
          accumulatedLength: accumulated.length,
          timestamp: Date.now(),
        });
        await new Promise((r) => setTimeout(r, 250));
      }

      const { cleanedReply, artifacts, topicShift } = parseModelResponse(accumulated);
      const promptTokens = estimateTokens(compiledPrompt);
      const candidatesTokens = estimateTokens(accumulated);

      const telemetry = {
        model: targetModel,
        promptTokens,
        candidatesTokens,
        totalTokens: promptTokens + candidatesTokens,
        durationMs: Date.now() - startTime,
        timeToFirstChunkMs: 350,
        rawMetadata: null,
        isFallback: true,
      };

      sendSSE('complete', {
        reply: cleanedReply || accumulated,
        rawReply: accumulated,
        artifacts,
        topicShift,
        telemetry,
      });

      sendSSE('done', { success: true });
      res.end();
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Internal Server Error';
    logServer('error', 'STREAM:FAIL', `#${reqId} Fatal streaming error: ${errorMessage}`);
    sendSSE('error', { error: errorMessage });
    res.end();
  }
});

// API: Summarize a Chapter
app.post('/api/summarize-chapter', async (req: Request, res: Response) => {
  try {
    const { title, messages = [] } = req.body;

    if (!messages || messages.length === 0) {
      return res.json({
        summary: `Empty chapter on ${title || 'Topic'}`,
        keyPoints: [],
      });
    }

    const conversationTranscript = messages
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join('\n');

    let summaryText = '';
    let keyPoints: string[] = [];

    if (ai) {
      const prompt = `Summarize the following conversation chapter titled "${title}".
Provide:
1. A short summary (2-3 sentences) capturing what was actually discussed and decided.
2. Up to 4 key points worth remembering from this stretch of conversation.

Output format:
SUMMARY: [summary]
KEY POINTS:
- [point 1]
- [point 2]

Transcript:
${conversationTranscript}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          temperature: 0.3,
        },
      });

      const raw = response.text || '';
      const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]*?)(?=KEY POINTS:|$)/i);
      summaryText = summaryMatch ? summaryMatch[1].trim() : raw.slice(0, 300);

      const bulletMatches = raw.match(/- (.*)/g);
      if (bulletMatches) {
        keyPoints = bulletMatches.map((b) => b.replace(/^- \s*/, '').trim());
      }
    } else {
      summaryText = `Chapter: ${title}.`;
      keyPoints = [
        'No API key set — this summary is a placeholder, not a real one.',
      ];
    }

    res.json({
      summary: summaryText,
      keyPoints,
      tokens: estimateTokens(summaryText + keyPoints.join(' ')),
    });
  } catch (err: unknown) {
    logServer('error', 'API:SUMMARIZE', `Error in /api/summarize-chapter: ${err instanceof Error ? err.message : err}`, err);
    const errorMessage = err instanceof Error ? err.message : 'Summarization error';
    res.status(500).json({ error: errorMessage });
  }
});

// API: Text-to-Speech (TTS) using gemini-3.8-flash-lite-tts
app.post('/api/tts', async (req: Request, res: Response) => {
  try {
    const { text, voice = 'Kore' } = req.body;
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required for TTS' });
    }

    // Clean markdown code blocks / markdown links to make spoken audio fluid
    const cleanSpokenText = text
      .replace(/```[\s\S]*?```/g, ' [code specification block omitted] ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/[#*_~]/g, '')
      .slice(0, 1500); // keep spoken segment crisp

    if (ai) {
      const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
      const chosenVoice = allowedVoices.includes(voice) ? voice : 'Kore';

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanSpokenText,
                speechMetadata: {
                  style: 'Articulate, calm, natural',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: chosenVoice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        return res.json({
          audioData: base64Audio,
          mimeType: 'audio/wav',
          cleanSpokenText,
        });
      }
    }

    // Fallback indicator so client can use Web Speech API
    res.json({
      fallback: true,
      cleanSpokenText,
    });
  } catch (err: unknown) {
    logServer('error', 'API:TTS', `Error in /api/tts: ${err instanceof Error ? err.message : err}`, err);
    // Return fallback: true so client seamlessly plays via Web Speech API
    const cleanSpokenText = (req.body.text || '')
      .replace(/```[\s\S]*?```/g, '')
      .slice(0, 1000);
    res.json({ fallback: true, cleanSpokenText });
  }
});

// API: Extract structured YAML + Markdown artifact from raw TXT, MD, or Google Docs export
app.post('/api/extract-artifact-from-file', async (req: Request, res: Response) => {
  try {
    const { content, filename = 'document.md', projectTitle = 'Project', fileType = 'doc' } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }

    if (ai) {
      const prompt = `You are MarkBrain, importing a document into a thinking workbench.
Analyze the following document (imported from ${fileType === 'gdoc' ? 'Google Docs' : 'file'}: "${filename}") for the project "${projectTitle}".
Synthesize it into a MarkBrain note with YAML frontmatter metadata and structured Markdown content.

Requirements:
1. Title: A concise title (few words).
2. Code: A clean, memorable kebab-case identifier/nickname (e.g., "reading-list", "garden-plan", "pricing-notes").
3. Type: One of ["note", "decision-record", "research-note", "summary", "reference", "topic"].
4. Description: A short description (a few phrases).
5. Summary: A summary of the contents in a few paragraphs — what it says, what matters, why it might matter later.
6. Tags: 4 to 8 highly relevant, lowercase, kebab-case tags (e.g., ["pricing", "family", "reading", "garden"]). These tags will be embedded in the YAML header to tentatively and automatically cross-link related notes.
7. Graph:
   - parent: A parent note code if this belongs under one, or null.
   - children: Array of child note codes if identified, or [].
   - relationships: Array of tentative relational objects: [{"target": "other-note-code", "type": "depends_on" | "implements" | "bridges", "note": "Tentative cross-link"}]
   - is_high_concept: boolean (true if this is a core thread tying many other thoughts together, false for a regular note).
8. Content: The full, clean Markdown content with clear hierarchy (headings, bullet lists, code blocks).

Respond ONLY with a JSON object in this exact schema:
{
  "title": "Short title in a few words",
  "code": "unique-slug-or-nickname",
  "type": "note",
  "category": "note",
  "description": "Short description in a few phrases",
  "summary": "Summary of contents in a few paragraphs",
  "tags": ["tag1", "tag2", "tag3", "tag4"],
  "graph": {
    "parent": null,
    "children": [],
    "relationships": [],
    "is_high_concept": true
  },
  "content": "Full markdown specification body"
}

Raw Input Document (${filename}):
${content.slice(0, 24000)}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      if (!Array.isArray(parsed.tags) || parsed.tags.length === 0) {
        parsed.tags = ['google-docs', 'imported-note', parsed.code || 'note'];
      }

      return res.json({
        artifact: parsed,
      });
    }

    // High quality deterministic fallback when AI key is absent
    const lines = content.split('\n');
    let title = filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    for (const l of lines) {
      const hMatch = l.match(/^#+\s+(.+)$/);
      if (hMatch) {
        title = hMatch[1].trim();
        break;
      }
    }
    const code = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const nonHeaders = lines.filter((l: string) => l.trim().length > 0 && !l.startsWith('#'));
    const description = nonHeaders[0]?.slice(0, 160) || `Imported Google Doc specification: ${title}`;
    const summary = nonHeaders.slice(0, 4).join(' ').slice(0, 400) || 'Imported note summary.';

    // Generate tentative tags from words in title and content
    const rawTokens = (title + ' ' + description).toLowerCase().match(/[a-z]{4,}/g) || [];
    const uniqueTokens = Array.from(new Set(rawTokens)).slice(0, 5);
    const tags = ['imported-doc', 'google-docs', ...uniqueTokens];

    return res.json({
      artifact: {
        title,
        code,
        type: 'note',
        category: 'note',
        description,
        summary,
        tags,
        graph: {
          parent: null,
          children: [],
          relationships: [],
          is_high_concept: false,
        },
        content,
      },
    });
  } catch (err: unknown) {
    logServer('error', 'API:EXTRACT', `Error in /api/extract-artifact-from-file: ${err instanceof Error ? err.message : err}`, err);
    const errorMessage = err instanceof Error ? err.message : 'Extraction error';
    res.status(500).json({ error: errorMessage });
  }
});

// Dev vs Prod Vite Mounting
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    logServer('info', 'SERVER', `Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  logServer('error', 'SERVER', `Failed to start server: ${err instanceof Error ? err.message : err}`, err);
  process.exit(1);
});
