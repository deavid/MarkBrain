import type { Express, Request, Response } from 'express';
import { ai, streamFromModel } from '../providers/gemini';
import { logServer } from '../lib/log';
import { estimateTokens } from '../lib/tokens';
import { DEFAULT_SYSTEM_INSTRUCTION, buildCompiledPrompt } from '../lib/prompt';
import { DEFAULT_MODEL_ID, requireModelId } from '../lib/models';

export function registerChatRoutes(app: Express): void {
app.post('/api/chat/cancel', (req: Request, res: Response) => {
  const { reason = 'User pressed stop' } = req.body;
  logServer('warn', 'CHAT:CANCEL', `Client canceled operation: ${reason}`);
  res.json({ success: true, message: 'Stream canceled' });
});

app.post('/api/chat/stream', async (req: Request, res: Response) => {
  const reqId = (req as any).reqId || Math.floor(Math.random() * 10000);
  const startTime = Date.now();
  let isClientAborted = false;

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
      model = DEFAULT_MODEL_ID,
      projectTitle = 'Untitled',
      systemInstruction: clientSystemInstruction,
    } = req.body;

    const systemInstruction = clientSystemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
    const compiledPrompt = buildCompiledPrompt(req.body);

    // Model errors are FINAL (David 2026-10-25): no substitution, no watchdog
    // swap. An unknown model or a provider failure is the real error — the
    // client's draft shows it as-is.
    const targetModel = requireModelId(model, 'chat');

    logServer('info', 'STREAM:INIT', `#${reqId} Initiating stream for project="${projectTitle}", model=${targetModel}, promptChars=${compiledPrompt.length}`);

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

      // The requested model answers, or the request fails with the real
      // reason. There is no second stream waiting behind a timer.
      const responseStream = await streamFromModel(targetModel, compiledPrompt, systemInstruction, reqId);
      const usedModel = targetModel;

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

      // Client-side demux is the sole parser of artifacts/topic shifts
      // (stream-protocol demuxFullTurn — superset of any server parse).

      // Raw provider usage normalized to our provider-neutral vocabulary — the
      // provider's wire names never leave this adapter.
      const inputTokens = usageMetadata?.promptTokenCount ?? estimateTokens(compiledPrompt);
      const outputTokens = usageMetadata?.candidatesTokenCount ?? estimateTokens(fullText);
      const totalTokens = usageMetadata?.totalTokenCount ?? (inputTokens + outputTokens);
      const latencyMs = Date.now() - startTime;

      logServer('success', 'STREAM:DONE', `#${reqId} Completed in ${latencyMs}ms`, {
        model: usedModel,
        inputTokens,
        outputTokens,
        totalTokens,
      });

      const telemetry = {
        model: usedModel,
        inputTokens,
        outputTokens,
        totalTokens,
        latencyMs,
        timeToFirstChunkMs: timeToFirstChunkMs ?? latencyMs,
        isFallback: false,
      };

      sendSSE('complete', {
        rawReply: fullText,
        telemetry,
      });

      sendSSE('done', { success: true });
      res.end();
    } else {
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

      const inputTokens = estimateTokens(compiledPrompt);
      const outputTokens = estimateTokens(accumulated);

      const telemetry = {
        model: targetModel,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        latencyMs: Date.now() - startTime,
        timeToFirstChunkMs: 350,
        isFallback: true,
      };

      sendSSE('complete', {
        rawReply: accumulated,
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
}
