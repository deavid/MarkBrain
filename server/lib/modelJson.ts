/** Robust model-JSON parse: strip illegal control chars (keep \n/\r/\t),
 *  pull the outer {...} block, neutralize bad escapes. WHY: Gemini occasionally
 *  emits literal control characters / invalid escapes inside strings (observed:
 *  "Bad control character in string literal in JSON at position 1529") even with
 *  responseMimeType: application/json — a bare JSON.parse then 500s the import.
 *  Pure module (no provider imports) so unit tests don't boot the Gemini client. */
export function parseModelJson(raw: string): unknown {
  const cleaned = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to block extraction */
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const body = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(body);
    } catch {
      // Walk escapes properly: keep valid ones (\uXXXX, \" \\ \/ \b \f \n \r \t),
      // drop only the backslash of invalid ones — a naive /\\[^…]/g would eat
      // the second backslash of a valid \\ pair and corrupt the string.
      let out = '';
      for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c !== '\\') {
          out += c;
          continue;
        }
        const n = body[i + 1];
        if (n === undefined) break;
        if ('"\\/bfnrt'.includes(n)) {
          out += c + n;
          i++;
        } else if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(body.slice(i + 2, i + 6))) {
          out += body.slice(i, i + 6);
          i += 5;
        } else {
          out += n; // invalid escape: drop the backslash, keep the char
          i++;
        }
      }
      return JSON.parse(out);
    }
  }
  throw new Error(`no JSON object found in model output (starts: ${JSON.stringify(cleaned.slice(0, 80))})`);
}