/**
 * BUG-013: the provider-NEUTRAL conversation wire — real native turns
 * (`user` / `assistant`) instead of one blob, plus the last assistant turn's
 * thinking. Both providers map THIS shape to their own wire format.
 */

export interface WireChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /**
   * Present ONLY on the most recent assistant turn before the current user
   * ask (David 2026-10-31: "only for the last turn for now").
   */
  thinking?: string;
}

export interface GeminiWirePart {
  text: string;
  thought?: boolean;
}

export interface GeminiWireContent {
  role: 'user' | 'model';
  parts: GeminiWirePart[];
}

/** Gemini `contents`: assistant → `model`; thinking rides as a thought part. */
export function geminiWireContents(messages: WireChatMessage[]): GeminiWireContent[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts:
      m.role === 'assistant' && m.thinking
        ? [{ text: m.thinking, thought: true }, { text: m.content }]
        : [{ text: m.content }],
  }));
}

export interface OpenRouterWireMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoning?: string;
  reasoning_content?: string;
}

/** OpenRouter `messages`: thinking rides as both `reasoning` spellings. */
export function openrouterWireMessages(
  systemInstruction: string,
  messages: WireChatMessage[]
): OpenRouterWireMessage[] {
  const out: OpenRouterWireMessage[] = [];
  if (systemInstruction) out.push({ role: 'system', content: systemInstruction });
  for (const m of messages) {
    if (m.role === 'assistant' && m.thinking) {
      out.push({
        role: 'assistant',
        content: m.content,
        reasoning: m.thinking,
        reasoning_content: m.thinking,
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}
