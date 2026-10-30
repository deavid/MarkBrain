/**
 * The one plain-text contract for every LLM call that returns fields.
 *
 * `=== HEADER ===` blocks instead of JSON: a model writing a 1,000-token digest
 * inside a `"summary": "..."` string gives up after two paragraphs (JSON string
 * values are short in its training data) and eventually emits an unescaped
 * quote, a literal newline or a raw tab and breaks `JSON.parse`. Plain markdown
 * under a sentinel header has no escaping to get wrong and no brevity bias, so
 * the model writes the digest it was asked for.
 */
export function parseSentinelBlocks(raw: string): Record<string, string> {
  const cleaned = raw
    .trim()
    .replace(/^```[a-zA-Z]*\r?\n/, '')
    .replace(/\r?\n```$/, '');

  const result: Record<string, string> = {};
  const headerRegex = /^===\s*([A-Z0-9_ -]+?)\s*===\s*$/gm;
  const matches = [...cleaned.matchAll(headerRegex)];

  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1].trim().toLowerCase().replace(/[\s-]+/g, '_');
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? cleaned.length) : cleaned.length;
    result[key] = cleaned.slice(start, end).trim();
  }

  return result;
}

/** True when a sentinel value is an explicit "nothing here" marker. */
export function isSentinelEmpty(value: string | undefined): boolean {
  const v = (value || '').trim();
  return v === '' || /^(none|null|n\/a|no|nothing|-)$/i.test(v);
}

/** Comma- or newline-separated tags/lists normalized to lowercase kebab-case. */
export function parseSentinelList(value: string | undefined): string[] {
  if (!value || isSentinelEmpty(value)) return [];
  return value
    .split(/[,\n]/)
    .map((item) => item.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean);
}
