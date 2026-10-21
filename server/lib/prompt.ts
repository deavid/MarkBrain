import { isSentinelEmpty, parseSentinelBlocks, parseSentinelList } from '../../src/utils/sentinelParser';

/** The read bound for the model. The body the app stores is never cut. */
export const EXTRACT_READ_CHAR_CAP = 400_000;

/**
 * How the layers are read. This paragraph is the whole fix: it tells the model
 * that the layers are CONCATENATED and read in order, so each one must continue
 * where the previous stopped. Without it the model writes two standalone
 * overviews and the second one re-introduces the document.
 */
const LAYER_CONTRACT = `HOW THE LAYERS ARE READ (this is the whole job):
The layers are glued together in this order and read as ONE continuous briefing. Each layer continues where the previous one stopped.
  title — subtitle                        (~40 tokens)  what this is, and its single main takeaway
  + description                           (~200 tokens) the thesis, the pillars, the conclusions
  + summary                               (~800 to 1500) every section, rule, number, rejection, open question
  + the verbatim source document          (the app splices it in, you never write it)

HARD RULES:
1. NEVER repeat across layers. The reader has just finished the previous layer. Do not re-introduce the document, do not restate a claim you already made, and never open a layer by naming the document ("This document outlines...", "This note describes...", "The author discusses...", "This text covers..."). Name the thing and state what is in it.
2. NEVER describe the document from the outside. Write its actual content: the decisions, the rules, the numbers, the mechanics, the trade-offs. A reader must learn WHAT IT SAYS, not that it says something.
3. A layer too big or too small is a failure. The subtitle is not a title with more words; the summary is not a longer description. Each layer is a different job at a different scale.`;

/**
 * The import prompt. The uploaded document is the body layer and the app
 * splices it in verbatim: asking the model to re-type it cost a full output
 * pass over the input, mutated it, and silently condensed it once the document
 * got long (of 20 artifacts whose source file was still on disk, the bodies had
 * kept 59% of the source; one kept 5%).
 */
export function buildExtractPrompt(input: ExtractPromptInput): string {
  const {
    content,
    filename = 'document.md',
    projectTitle = 'Project',
    fileType = 'doc',
    previousError,
    previousOutput,
  } = input;

  const source = content.slice(0, EXTRACT_READ_CHAR_CAP);

  return `You are MarkBrain, importing a document into a thinking workbench for the project "${projectTitle}".
Read the source document below (imported from ${fileType === 'gdoc' ? 'Google Docs' : 'file'}: "${filename}") and write its metadata and its three compaction layers.

${LAYER_CONTRACT}

WHAT EACH LAYER SAYS HERE:
- SUBTITLE: one or two sentences (~40 tokens). What this document is and its single main takeaway. This is what a human reads next to the title in a list of fifty notes, so it must make the note recognisable on its own. It is not a teaser: state the actual subject and conclusion.
- DESCRIPTION: two or three dense paragraphs (~200 tokens), continuing from the subtitle. The core thesis, the main pillars or components, and the conclusions the document reaches. No new introduction.
- SUMMARY: a multi-section digest (~800 to 1500 tokens when the document is substantial; proportionally shorter only when the source itself is short), continuing from the description. Walk through every major section in order with Markdown headings and bullets, and extract the concrete specifics: rules, mechanics, numbers, formulas, item and entity lists, trade-offs, rejected alternatives, and open questions. A reader who has read this layer should be able to answer most concrete questions about the document without opening it.

The app stores the source document below verbatim as the body layer. Do not retell it, do not summarise it a second time in a content field, and do not output it: anything you write that repeats the document is thrown away.

Respond with plain text using exactly these sentinel headers on their own lines. No JSON, no code fences around the whole reply, no commentary.

=== TITLE ===
3 to 8 words. A handle, not a sentence.

=== SUBTITLE ===
1 to 2 sentences, ~40 tokens.

=== CODE ===
clean-kebab-case-slug

=== TYPE ===
one of: note | decision-record | research-note | summary | reference | topic

=== HIGH_CONCEPT ===
true if this is a foundational pillar tying many other notes together, otherwise false

=== TAGS ===
4 to 8 lowercase kebab-case tags, comma separated

=== PARENT ===
parent note code if this clearly belongs under one, otherwise none

=== RELATIONSHIPS ===
one per line as: target-code | depends_on | implements | bridges | short note. Write none if there are none.

=== DESCRIPTION ===
2 to 3 dense paragraphs continuing from the subtitle.

=== SUMMARY ===
The multi-section digest, continuing from the description.

${previousError ? `
RETRY — your previous attempt could not be read: ${String(previousError).slice(0, 500)}
Here is that output; fix it and do not repeat its mistakes:
${String(previousOutput || '(no output captured)').slice(0, 2000)}
` : ''}
--- SOURCE DOCUMENT (${filename}) ---
${source}`;
}

export interface ExtractPromptInput {
  content: string;
  filename?: string;
  projectTitle?: string;
  fileType?: string;
  previousError?: string;
  previousOutput?: string;
}

export interface SummarizePromptInput {
  title: string;
  messages: Array<{ role: string; content: string }>;
  steeringPrompt?: string;
}

/** Verbatim turns are the body layer; a chapter only ever writes subtitle, description and summary. */
export function buildSummarizePrompt(input: SummarizePromptInput): string {
  const { title, messages, steeringPrompt } = input;
  const transcript = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
  const steering = (steeringPrompt || '').trim().slice(0, 2000);

  return `Compact this conversation chapter, titled "${title}", into its layers.
The verbatim turns below are the body layer: they are what the reader gets at full, so do not retell them.

${LAYER_CONTRACT}

WHAT EACH LAYER SAYS HERE:
- SUBTITLE: one or two sentences (~40 tokens). What this chapter settled, in a form a reader recognises a month later.
- DESCRIPTION: one or two dense paragraphs (~200 tokens), continuing from the subtitle. The decisions reached, the problem solved, the direction chosen.
- SUMMARY: the detailed recap (~800 to 1500 tokens when the chapter is substantial), continuing from the description. Every concrete decision, technical or design detail, number, rejected option and open question, so a future turn does not need the raw transcript.
${steering ? `\nThe user asked for this recap to be steered toward: ${steering}\n` : ''}
Respond with plain text using exactly these sentinel headers on their own lines. No JSON, no code fences around the whole reply.

=== SUBTITLE ===
1 to 2 sentences, ~40 tokens.

=== DESCRIPTION ===
1 to 2 dense paragraphs continuing from the subtitle.

=== SUMMARY ===
The detailed recap, continuing from the description.

--- CHAPTER TRANSCRIPT ---
${transcript}`;
}

/** Reads the sentinel reply from an import or recap call into its fields. */
export function readSentinelArtifact(raw: string, fallbackTitle: string) {
  const blocks = parseSentinelBlocks(raw);
  const tags = parseSentinelList(blocks.tags);
  const relationships = (blocks.relationships || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('|') && !isSentinelEmpty(line))
    .map((line) => {
      const [target = '', type = 'depends_on', note = ''] = line.split('|').map((p) => p.trim());
      return { target, type, note };
    })
    .filter((rel) => Boolean(rel.target));

  const title = (blocks.title || '').trim() || fallbackTitle;
  return {
    title,
    subtitle: blocks.subtitle || '',
    code:
      (blocks.code || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) ||
      'imported-note',
    type: (blocks.type || 'note').trim().toLowerCase(),
    description: blocks.description || '',
    summary: blocks.summary || '',
    tags: tags.length > 0 ? tags : ['imported-note'],
    parent: isSentinelEmpty(blocks.parent) ? null : (blocks.parent || '').trim(),
    relationships,
    isHighConcept: /^(true|yes)$/i.test((blocks.high_concept || '').trim()),
    hasLayers: Boolean(blocks.subtitle || blocks.description || blocks.summary),
  };
}

/**
 * The server-side fallback instruction. The client normally sends its own
 * compiled instruction, which teaches the same blocks.
 */
export const DEFAULT_SYSTEM_INSTRUCTION = `You are MarkBrain, a thinking partner for a brain that overflows with ideas. You help collect thoughts before they evaporate, keep them organized, and keep the whole forest in view while diving into details.
Talk WITH the user, curious, direct, plain-spoken. No corporate filler. It's fine to say you don't know something.

CRITICAL INSTRUCTIONS:
1. Ground your response in the provided notes and conversation chapters.
2. When the user crystallizes an idea worth keeping on its own, emit an artifact block carrying all four layers. They are read together in this order, so each one continues where the previous stopped and never re-introduces the note:
<artifact_upsert id="kebab-case-slug" title="Short Note Title" type="document">
<subtitle>One or two sentences (~40 tokens): what this note is and its single main takeaway.</subtitle>
<description>Two or three dense paragraphs (~200 tokens): the core thesis, the pillars, the conclusions.</description>
<summary>A multi-section digest (~800 to 1500 tokens): every section, rule, number, rejection and open question.</summary>
<content>The complete Markdown note body.</content>
</artifact_upsert>
Never open a layer with "This document outlines", "This note describes" or any other book report: name the thing and state what is in it.
3. If the conversation shifts into a substantially new topic, declare it via:
<topic_shift title="New Chapter Title" subtitle="One or two sentences stating what this chapter is about and its main takeaway" />
otherwise omit that block.
4. No JSON anywhere.`;

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
      prompt += `[Chapter: ${chap.title}]\n${chap.description ? `Description: ${chap.description}\n` : ''}Summary: ${chap.summary}\n\n`;
    }
  }

  if (contextPayload && contextPayload.trim().length > 0) {
    prompt += `--- ACTIVE-IN-MEMORY ARTIFACTS ---\n${contextPayload}\n\n`;
  }

  prompt += `--- CONVERSATION TRANSCRIPT ---\n`;
  for (const msg of messages) {
    prompt += `${msg.role === 'user' ? 'User' : 'MarkBrain'}: ${msg.content}\n`;
  }

  prompt += `\nMarkBrain:`;
  return prompt;
}
