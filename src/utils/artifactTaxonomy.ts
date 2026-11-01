/**
 * BUG-006 §1–2: the artifact identity + category vocabulary.
 *
 * One visible identifier (the slug, `artifact.code`, shown as `slug.md`) and
 * one Category concept with six canonical, self-describing options. The
 * internal `artifact.id` stays a hidden immutable primary key — renaming a
 * slug never rewrites edges, attachments or revisions.
 */

export interface ArtifactCategoryDef {
  value: string;
  label: string;
  description: string;
}

/** The canon. Nothing outside this list may be written going forward. */
export const ARTIFACT_CATEGORIES: readonly ArtifactCategoryDef[] = [
  {
    value: 'note',
    label: 'Note',
    description: 'Quick thoughts, scratchpad ideas, or rough notes',
  },
  {
    value: 'document',
    label: 'Document',
    description: 'General long-form prose or article',
  },
  {
    value: 'spec',
    label: 'Spec',
    description: 'Technical or design specification',
  },
  {
    value: 'reference',
    label: 'Reference',
    description: 'Facts, research, worldbuilding, or API reference',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Roadmap, tasks, timeline, or milestones',
  },
  {
    value: 'chapter',
    label: 'Chapter',
    description: 'Conversation chapter summary extracted from chat',
  },
] as const;

/** Legacy snapshots carry opaque values; they fold into the canon on read. */
const LEGACY_CATEGORY_MAP: Record<string, string> = {
  specification: 'spec',
  general: 'note',
};

export function normalizeCategory(raw: string | null | undefined): string {
  const v = (raw || '').trim().toLowerCase();
  if (ARTIFACT_CATEGORIES.some((c) => c.value === v)) return v;
  return LEGACY_CATEGORY_MAP[v] || 'note';
}

/** `type` and `category` stay synchronized: chapter is the only split. */
export function categoryToType(category: string): 'document' | 'chapter' {
  return normalizeCategory(category) === 'chapter' ? 'chapter' : 'document';
}

export function categoryLabel(category: string | null | undefined): string {
  const v = normalizeCategory(category);
  return ARTIFACT_CATEGORIES.find((c) => c.value === v)?.label || v;
}

// ── Slug (visible identifier) utilities ─────────────────────────────────────

/** A slug is lowercase `a-z0-9-` — it becomes a filename (`slug.md`). */
export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Is `code` already used by another artifact in the workspace? */
export function slugTaken(
  code: string,
  artifacts: Array<{ id: string; code?: string }>,
  excludeArtifactId: string | null
): boolean {
  return artifacts.some((a) => a.code === code && a.id !== excludeArtifactId);
}

/**
 * Collision rule (BUG-006 §1.2): an import or a new note that lands on a taken
 * slug is suffixed automatically — `-001`, `-002`, …
 */
export function uniqueSlug(code: string, taken: Set<string>): string {
  if (!taken.has(code)) return code;
  for (let i = 1; i < 1000; i++) {
    const candidate = `${code}-${String(i).padStart(3, '0')}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${code}-${Date.now()}`;
}
