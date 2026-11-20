/**
 * In-page find (Ctrl+F) — OneNote "Find on this page" parity (issue #301).
 *
 * Pure policy: match computation over a plain element array. No Excalidraw
 * imports — unit-testable with bun (the table-insert.ts / page-links.ts
 * pattern). The canvas feeds it `api.getSceneElements()`; navigation
 * (selection + scroll) stays client-side in excalidraw-canvas.tsx, where
 * DOM focus is the find bar's business — the policy never touches it.
 *
 * Matching is case-insensitive substring per OCCURRENCE (browser find
 * semantics: non-overlapping, stepping by the needle's length). Results
 * are in READING ORDER (top of page → bottom, left → right — the stable
 * sort keeps elements at identical positions in scene order) with the
 * occurrences inside one element in text order. The find bar's counter is
 * derived from the same array, so the "n of m" display can never drift
 * from what navigation steps through.
 */

/** Structural subset the matcher needs — fed from live scene elements. */
export interface FindableElementLike {
  id?: string;
  type?: string;
  /** Excalidraw text elements carry the rendered string here. */
  text?: string;
  x?: number;
  y?: number;
  isDeleted?: boolean;
  /** Set on bound labels (table cells, arrows, containers) — accepted so
   *  the live scene assigns cleanly; the matcher treats them like any
   *  other visible text, which is exactly what they are. */
  containerId?: string | null;
}

/**
 * One findable text carrier on the page: a visible TEXT element.
 * Standalone text elements AND the bound labels of containers/arrows/table
 * cells are both plain text elements in the scene array (bound labels carry
 * containerId), so the single type check covers every visible string.
 * OCR/HWR metadata and attachment file names deliberately do NOT match —
 * they are not visible page text (Ctrl+K covers them cross-page).
 */
export interface FindableText {
  elementId: string;
  text: string;
  x: number;
  y: number;
}

/** One match: an occurrence inside one element's text. */
export interface PageFindMatch {
  elementId: string;
  /** 1-based occurrence index within the element's text. */
  occurrence: number;
  /** Character offset of the match start within the element text. */
  offset: number;
}

/**
 * Collect the page's findable texts, in scene order.
 *
 * Defensive by contract (the search.ts precedent): page content can come
 * from a hand-edited sync page file or an older restore — non-string text,
 * missing ids, non-finite coordinates are all possible. Bad entries are
 * skipped, never crash the find bar; deleted tombstones never match.
 */
export function collectFindableTexts(
  elements: readonly FindableElementLike[] | null | undefined,
): FindableText[] {
  const out: FindableText[] = [];
  for (const el of elements ?? []) {
    if (!el || el.isDeleted) continue;
    if (el.type !== "text") continue;
    if (typeof el.text !== "string" || !el.text.trim()) continue;
    if (typeof el.id !== "string" || !el.id) continue;
    out.push({
      elementId: el.id,
      text: el.text,
      x: typeof el.x === "number" && Number.isFinite(el.x) ? el.x : 0,
      y: typeof el.y === "number" && Number.isFinite(el.y) ? el.y : 0,
    });
  }
  return out;
}

/**
 * Non-overlapping occurrence count, case-insensitive ("todo x todo" holds
 * 2 occurrences of "todo"; "aaaa" holds 1 of "aa" — stepping by the
 * needle length is what the browser does). An empty needle matches nothing.
 */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let count = 0;
  let i = h.indexOf(n);
  while (i !== -1) {
    count += 1;
    i = h.indexOf(n, i + n.length);
  }
  return count;
}

/**
 * All matches for a query, in reading order. An EMPTY query returns an
 * empty result (the bar then shows its explicit empty state); a non-empty
 * query matches exactly what the text holds — a lone space finds spaces.
 */
export function findPageMatches(
  elements: readonly FindableElementLike[] | null | undefined,
  query: string,
): PageFindMatch[] {
  const needle = typeof query === "string" ? query.toLowerCase() : "";
  if (!needle) return [];
  const texts = collectFindableTexts(elements).sort((a, b) => a.y - b.y || a.x - b.x);
  const matches: PageFindMatch[] = [];
  for (const t of texts) {
    const hay = t.text.toLowerCase();
    let idx = hay.indexOf(needle);
    let occurrence = 0;
    while (idx !== -1) {
      occurrence += 1;
      matches.push({ elementId: t.elementId, occurrence, offset: idx });
      idx = hay.indexOf(needle, idx + needle.length);
    }
  }
  return matches;
}

/**
 * Wrap-around step over a fixed result list: `current` + `delta` modulo
 * `total`, negative-safe in both directions. total <= 0 or any non-finite
 * input → -1 (no match — the caller keeps its "no matches" state).
 */
export function stepMatchIndex(current: number, total: number, delta: number): number {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(total) ||
    !Number.isFinite(delta) ||
    total <= 0
  ) {
    return -1;
  }
  return (((current + delta) % total) + total) % total;
}
