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

// Shared Gemini Client
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

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
    oAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
  });
});

// API: Chat with MarkBrain
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const {
      model = 'gemini-3.8-flash',
      messages = [],
      contextPayload = '',
      currentTopic = '',
      chapterSummaries = [],
      projectTitle = 'Design System Core',
      compiledPrompt: clientCompiledPrompt,
      systemInstruction: clientSystemInstruction,
    } = req.body;

    const defaultSystemInstruction = `You are MarkBrain, a principal systems architect specializing in multi-tier design systems, token topologies, component state machines, and spatial software architectures.
You collaborate with engineers to brainstorm, structure, and refine complex system boundaries.

CRITICAL INSTRUCTIONS:
1. Ground your analysis strictly on the provided Context & Project boundaries.
2. If you formulate a concrete architectural artifact, schema, token definition, or system invariant, output it inside a dedicated artifact block:
\`\`\`artifact
title: [Short Artifact Title]
type: [architecture | token-spec | component-contract | schema | migration-guide]
abstract: [1-sentence summary of this concept]
highConcept: [true | false - set true if it represents a cross-project core protocol or top-level architecture that can bridge repos, false if it is a detail component/token implementation]
[Markdown artifact specification content here]
\`\`\`
3. Keep prose articulate, high-signal, and structured.
4. If the user's latest query shifts into a substantially new topic/dimension, declare it via:
<topic_shift title="New Chapter Title" abstract="1-sentence essence" summary="Key invariant bullets" />
or conclude with a JSON block:
\`\`\`topic_shift
{"shiftDetected": true, "newChapterTitle": "Suggested New Chapter Title", "reason": "Reason for architectural pivot"}
\`\`\`
otherwise omit that block.`;

    const systemInstruction = clientSystemInstruction || defaultSystemInstruction;

    let compiledPrompt = clientCompiledPrompt;

    if (!compiledPrompt) {
      compiledPrompt = `Project: ${projectTitle}\nCurrent Focus: ${currentTopic || 'General Architecture'}\n\n`;

      if (chapterSummaries && chapterSummaries.length > 0) {
        compiledPrompt += `--- PREVIOUS CHAPTER SUMMARIES (Compressed Memory) ---\n`;
        for (const chap of chapterSummaries) {
          compiledPrompt += `[Chapter: ${chap.title}]\nSummary: ${chap.summary}\nKey Invariants: ${(chap.keyPoints || []).join('; ')}\n\n`;
        }
      }

      if (contextPayload && contextPayload.trim().length > 0) {
        compiledPrompt += `--- ACTIVE IN-MEMORY ARTIFACTS ---\n${contextPayload}\n\n`;
      }

      compiledPrompt += `--- CONVERSATION TRANSCRIPT ---\n`;
      for (const msg of messages) {
        compiledPrompt += `${msg.role === 'user' ? 'User' : 'Architect'}: ${msg.content}\n`;
      }

      compiledPrompt += `\nArchitect:`;
    }

    let replyText = '';

    if (ai) {
      // Pick model from supported list
      const validModels = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'];
      const targetModel = validModels.includes(model) ? model : 'gemini-3.8-flash';

      const response = await ai.models.generateContent({
        model: targetModel,
        contents: compiledPrompt,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      replyText = response.text || '';
    } else {
      // High-fidelity fallback when API key is not yet set in environment
      replyText = `### Architectural Synthesis: ${projectTitle}

We are examining the active memory state with your configured abstraction layers. 

\`\`\`artifact
title: Dynamic Token Boundary Spec
type: token-spec
abstract: Unified semantic token resolution matrix bridging core foundations with component aliases
highConcept: true
# Dynamic Token Boundary Spec v2.1

## Topology
\`\`\`
[Global Primitives] (e.g. color.cyan.500)
       ↓
[Semantic Aliases] (e.g. color.surface.accent)
       ↓
[Component Overrides] (e.g. button.primary.fill)
\`\`\`

## Invariants
1. Cross-repo boundaries must reference **Semantic Aliases** only. Detail overrides remain repo-scoped.
2. Abstraction resolution preserves 40% context budget across multi-chapter sessions.
\`\`\`

The chapter context and spatial nodes have been verified. You can tweak the token compression slider to test different footprint budgets.`;
    }

    // Extract any artifacts generated
    const artifacts: Array<{
      title: string;
      type: string;
      abstract: string;
      highConcept: boolean;
      content: string;
    }> = [];

    const artifactRegex = /```artifact\s*([\s\S]*?)```/g;
    let match;
    while ((match = artifactRegex.exec(replyText)) !== null) {
      const block = match[1];
      const titleMatch = block.match(/title:\s*(.*)/i);
      const typeMatch = block.match(/type:\s*(.*)/i);
      const abstractMatch = block.match(/abstract:\s*(.*)/i);
      const highConceptMatch = block.match(/highConcept:\s*(true|false)/i);

      // Remove the header lines to leave the markdown body
      const bodyLines = block
        .replace(/title:.*\n/i, '')
        .replace(/type:.*\n/i, '')
        .replace(/abstract:.*\n/i, '')
        .replace(/highConcept:.*\n/i, '')
        .trim();

      artifacts.push({
        title: titleMatch ? titleMatch[1].trim() : 'Synthesized Artifact',
        type: typeMatch ? typeMatch[1].trim() : 'architecture',
        abstract: abstractMatch ? abstractMatch[1].trim() : 'Generated architectural artifact.',
        highConcept: highConceptMatch ? highConceptMatch[1].toLowerCase() === 'true' : false,
        content: bodyLines || block,
      });
    }

    // Extract any XML <artifact_upsert> tags
    const upsertXmlRegex = /<artifact_upsert\s+id=["']([^"']+)["']\s+title=["']([^"']+)["'](?:\s+type=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/artifact_upsert>/gi;
    let upMatch;
    while ((upMatch = upsertXmlRegex.exec(replyText)) !== null) {
      const upTitle = upMatch[2];
      const upType = upMatch[3] || 'document';
      const inner = upMatch[4];
      const absMatch = /<abstract>([\s\S]*?)<\/abstract>/i.exec(inner);
      const contentMatch = /<content>([\s\S]*?)<\/content>/i.exec(inner);
      artifacts.push({
        title: upTitle,
        type: upType,
        abstract: absMatch ? absMatch[1].trim() : upTitle,
        highConcept: false,
        content: contentMatch ? contentMatch[1].trim() : inner.trim(),
      });
    }

    // Extract any topic shift (JSON or XML)
    let topicShift: { shiftDetected: boolean; newChapterTitle: string; reason: string } | null = null;
    const topicShiftRegex = /```topic_shift\s*([\s\S]*?)```/;
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
      .replace(/```topic_shift[\s\S]*?```/g, '')
      .replace(/<topic_shift[\s\S]*?\/>/g, '')
      .replace(/<artifact_upsert[\s\S]*?<\/artifact_upsert>/g, '')
      .replace(/<link[\s\S]*?\/>/g, '')
      .trim();

    const promptTokens = estimateTokens(compiledPrompt);
    const completionTokens = estimateTokens(replyText);

    res.json({
      reply: cleanedReply,
      artifacts,
      topicShift,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    });
  } catch (err: unknown) {
    console.error('Error in /api/chat:', err);
    const errorMessage = err instanceof Error ? err.message : 'Internal Server Error';
    res.status(500).json({ error: errorMessage });
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
      const prompt = `Summarize the following architectural brainstorming chapter titled "${title}".
Provide:
1. An executive summary (2-3 sentences) capturing core architectural decisions and rationales.
2. Up to 4 bullet points of crucial system invariants or contracts established.

Output format:
SUMMARY: [executive summary]
INVARIANTS:
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
      const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]*?)(?=INVARIANTS:|$)/i);
      summaryText = summaryMatch ? summaryMatch[1].trim() : raw.slice(0, 300);

      const bulletMatches = raw.match(/- (.*)/g);
      if (bulletMatches) {
        keyPoints = bulletMatches.map((b) => b.replace(/^- \s*/, '').trim());
      }
    } else {
      summaryText = `Chapter focused on ${title}. Established modular contracts, context boundary constraints, and memory token optimization strategies.`;
      keyPoints = [
        'Isolated detail artifacts within repository boundaries to reduce overhead',
        'Bridged high-concept abstractions across project graphs',
        'Implemented dynamic resolution compression for older message contexts',
      ];
    }

    res.json({
      summary: summaryText,
      keyPoints,
      tokens: estimateTokens(summaryText + keyPoints.join(' ')),
    });
  } catch (err: unknown) {
    console.error('Error in /api/summarize-chapter:', err);
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
                  style: 'Articulate, calm, professional systems architect',
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
    console.error('Error in /api/tts:', err);
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
      const prompt = `You are MarkBrain's architectural compiler and YAML artifact synthesizer.
Analyze the following document (imported from ${fileType === 'gdoc' ? 'Google Docs' : 'file'}: "${filename}") for the project "${projectTitle}".
Synthesize it into a pristine MarkBrain artifact containing YAML frontmatter metadata and structured Markdown pages.

Requirements:
1. Title: A concise title (few words).
2. Code: A clean, memorable kebab-case identifier/nickname (e.g., "physics-engine", "combat-rage-loop", "token-allocator").
3. Type: One of ["architecture", "system-spec", "concept-doc", "component-contract", "token-spec", "schema", "decision-record", "research-note"].
4. Description: A short description (few phrases).
5. Summary: A detailed summary of the contents in a few paragraphs explaining rationale, key invariants, and state flows.
6. Tags: 4 to 8 highly relevant, lowercase, kebab-case tags (e.g., ["rage-system", "combat-flow", "gameplay-mechanic", "state-machine"]). These tags will be embedded in the YAML header to tentatively and automatically cross-link related artifacts and graph nodes.
7. Graph:
   - parent: A parent artifact code if this is a sub-system, or null.
   - children: Array of sub-component codes if identified, or [].
   - relationships: Array of tentative relational objects: [{"target": "other-spec-code", "type": "depends_on" | "implements" | "bridges", "note": "Tentative cross-link"}]
   - is_high_concept: boolean (true if high-level conceptual boundary, false if granular detail).
8. Content: The full, clean Markdown specification with clear hierarchy (headings, bullet lists, code blocks, or invariant tables).

Respond ONLY with a JSON object in this exact schema:
{
  "title": "Short title in a few words",
  "code": "unique-slug-or-nickname",
  "type": "architecture",
  "category": "system-spec",
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
        parsed.tags = ['google-docs', 'imported-spec', parsed.code || 'component'];
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
    const summary = nonHeaders.slice(0, 4).join(' ').slice(0, 400) || 'Comprehensive architectural specification summary.';

    // Generate tentative tags from words in title and content
    const rawTokens = (title + ' ' + description).toLowerCase().match(/[a-z]{4,}/g) || [];
    const uniqueTokens = Array.from(new Set(rawTokens)).slice(0, 5);
    const tags = ['imported-doc', 'google-docs', ...uniqueTokens];

    return res.json({
      artifact: {
        title,
        code,
        type: 'architecture',
        category: 'system-spec',
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
    console.error('Error in /api/extract-artifact-from-file:', err);
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
    console.log(`[Antigravity Architect] Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
