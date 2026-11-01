/**
 * BUG-011: compiling PAST turns for the model.
 *
 * <link>, <unlink> and <topic_shift> stay verbatim in place (the model must
 * see its own past operations, or it thinks they failed). But an
 * <artifact_upsert>'s body is NOT paid twice: the full note already rides in
 * the knowledge substrate, so the transcript carries a self-documenting stub
 * that tells the model where the body went — and tells it never to emit the
 * comment itself.
 */

const STUB_COMMENT = (file: string, words: number) =>
  `<!-- MarkBrain compiler: Artifact body (${words.toLocaleString('en-US')} words) was saved into "${file}" and moved to the attached knowledge substrate above so it is not duplicated in the chat transcript. When creating or updating an artifact in a new reply, you MUST still write the full <subtitle>, <description>, <summary>, and <content> inside <artifact_upsert>. Never emit this compiler comment yourself. -->`;

export function compileTurnContentForPrompt(content: string): string {
  if (!content) return content;
  return content.replace(
    /<(artifact_upsert|artifact)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (_all, _tag: string, attrs: string, inner: string) => {
      const attr = (name: string): string => {
        const m = new RegExp(`${name}=["']([^"']+)["']`, 'i').exec(attrs);
        return m ? m[1] : '';
      };
      const file = attr('file') || attr('id') || 'this note';
      const words = inner
        .replace(/<[^>]+>/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      const title = attr('title');
      const attrsRest = title ? ` title="${title}"` : '';
      return `<artifact_upsert file="${file}"${attrsRest}>\n${STUB_COMMENT(file, words)}\n</artifact_upsert>`;
    }
  );
}
