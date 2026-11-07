/**
 * Page tags — pure helpers, no I/O.
 *
 * Tags are short free-form labels (OneNote note tags without the icons).
 * Case is preserved for display, but identity is case-insensitive so
 * "Recipe" and "recipe" are the same tag.
 */

/** Keep sidebar chips compact: cap both per-page count and tag length. */
export const MAX_TAGS_PER_PAGE = 12;
export const MAX_TAG_LENGTH = 24;

/** Normalize one raw tag: trim, collapse whitespace, cap length. null = invalid.
 * The cap slices by CODE POINTS (issue #101): a UTF-16 .slice could split a
 * surrogate pair and leave a lone half rendering as U+FFFD. */
export function normalizeTag(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const t = Array.from(collapsed).slice(0, MAX_TAG_LENGTH).join("").trim();
  return t.length ? t : null;
}

/** Normalize a list: drop invalid entries, dedupe case-insensitively, keep order. */
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = normalizeTag(r);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (out.length >= MAX_TAGS_PER_PAGE) break;
    out.push(t);
  }
  return out;
}

/** Append a tag; returns the SAME array reference when nothing changed. */
export function addTag(tags: string[], raw: string): string[] {
  return addTagWithResult(tags, raw).tags;
}

/** Outcome of adding a tag — why nothing changed, for user feedback (#100). */
export type AddTagStatus = "added" | "duplicate" | "invalid" | "capped";

/**
 * Add a tag and REPORT what happened (issue #100): the silent 12-tag cap
 * previously swallowed further tags without any feedback, and duplicates
 * were indistinguishable from successes.
 */
export function addTagWithResult(
  tags: string[],
  raw: string
): { tags: string[]; status: AddTagStatus } {
  const t = normalizeTag(raw);
  if (!t) return { tags, status: "invalid" };
  if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
    return { tags, status: "duplicate" };
  }
  const next = normalizeTags([...tags, t]);
  if (next.length === tags.length) {
    // the cap consumed the new entry — the page was already at the maximum
    return { tags, status: "capped" };
  }
  return { tags: next, status: "added" };
}

/** Remove a tag case-insensitively. */
export function removeTag(tags: string[], tag: string): string[] {
  const key = tag.toLowerCase();
  return tags.filter((t) => t.toLowerCase() !== key);
}

/** True when the page carries this tag (case-insensitive; undefined-safe). */
export function pageHasTag(tags: string[] | undefined, tag: string): boolean {
  const key = tag.toLowerCase();
  return (tags ?? []).some((t) => t.toLowerCase() === key);
}

export interface TagCount {
  tag: string;
  count: number;
}

/** All distinct tags across pages — most-used first, alphabetical tiebreak. */
export function collectTags(pages: Array<{ tags?: string[] }>): TagCount[] {
  const counts = new Map<string, TagCount>();
  for (const p of pages) {
    for (const t of p.tags ?? []) {
      const key = t.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { tag: t, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
  );
}
