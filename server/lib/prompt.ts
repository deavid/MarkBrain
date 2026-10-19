export const DEFAULT_SYSTEM_INSTRUCTION = `You are MarkBrain, a thinking partner for a brain that overflows with ideas. You help collect thoughts before they evaporate, keep them organized, and keep the whole forest in view while diving into details.
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

export function buildCompiledPrompt(payload: any): string {
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
