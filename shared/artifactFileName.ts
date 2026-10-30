/**
 * How a note is NAMED when it is sent: a filename, not an identifier.
 *
 * The old payload carried the internal id (`art-1792614286498-4845`). Nothing
 * told the model what that was, so it read it as the note's name and wrote
 * replies like "…the sprawling procedural dream (art-1792614286498-4845,
 * art-1792614209332-9472)". A machine id is a database key; a reader — human or
 * model — needs a handle. The title, slugified, IS that handle: it is what the
 * model would call the note anyway, and it is stable in what the user sees.
 *
 * Falls back to the note's `code` (the kebab handle the import sentinel already
 * produces) when a title slugifies to nothing — a title of pure punctuation or
 * of script outside a-z. `-2`, `-3` disambiguation is applied per payload by
 * `uniqueFileName`, because two notes may legitimately share a title.
 *
 * Extracted from src/domains/03-optical-compiler (which re-exports these) so
 * the server repo can name files the same way without importing the compiler.
 */
import type { UniversalArtifactDocument } from './types/artifact';

export function artifactFileName(art: Pick<UniversalArtifactDocument, 'code' | 'title'>): string {
  const slug = (candidate: string) =>
    candidate
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '');
  return `${slug(art.title || '') || slug(art.code || '') || 'note'}.md`;
}


/**
 * A slug that reads as a handle, never a database key. Chapters use the same
 * rule as notes so the payload has ONE way of naming things.
 */
export function slugHandle(text: string): string {
  return (
    (text || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'untitled'
  );
}

/** Give a payload's filenames a unique suffix so one name means one note. */
export function uniqueFileName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const stem = base.replace(/\.md$/i, '');
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}.md`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}
