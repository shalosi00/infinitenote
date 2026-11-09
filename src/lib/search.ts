/**
 * Cross-page full-text search.
 *
 * Extracts searchable text from serialized Excalidraw scenes without loading
 * them into the editor: text element bodies (raw + label), arrow labels,
 * audio clip filenames (embeddable customData, issue #67) and OCR text
 * recognized from images / PDF printouts (image customData.ocrText,
 * docs/test-plans/ocr.md). Matching = all query terms must appear (AND),
 * case-insensitive.
 */
import type { Notebook, PageMeta, Section } from "./types";

interface SceneElementLike {
  type?: string;
  text?: string;
  id?: string;
  customData?: { audioName?: unknown; ocrText?: unknown; pdfName?: unknown } | null;
}

/** Extract searchable strings from a serialized page content payload. */
export function extractSearchableText(contentJson: string | null | undefined): string[] {
  if (!contentJson) return [];
  let parsed: { elements?: SceneElementLike[] };
  try {
    parsed = JSON.parse(contentJson);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const el of parsed.elements ?? []) {
    if (typeof el?.text === "string" && el.text.trim()) out.push(el.text);
    // audio blocks (issue #67) carry their clip filename in customData —
    // searching "interview" should find the page holding interview.mp3
    if (el?.type === "embeddable" && typeof el.customData?.audioName === "string") {
      const name = el.customData.audioName.trim();
      if (name) out.push(name);
    }
    // PDF attachment chips (docs/test-plans/pdf-attachment.md) carry the
    // printout's file name the same way — "contract" finds contract.pdf
    if (el?.type === "embeddable" && typeof el.customData?.pdfName === "string") {
      const name = el.customData.pdfName.trim();
      if (name) out.push(name);
    }
    // OCR (docs/test-plans/ocr.md): recognized text on an image element is
    // content like any other — a scanned PDF printout becomes searchable
    if (el?.type === "image" && typeof el.customData?.ocrText === "string") {
      const ocr = el.customData.ocrText.trim();
      if (ocr) out.push(ocr);
    }
  }
  return out;
}

export interface SearchHit {
  pageId: string;
  sectionId: string;
  notebookId: string;
  pagePath: string;
  title: string;
  snippet: string;
}

export function buildSearchIndex(
  notebooks: Notebook[],
  sections: Section[],
  pagesWithContent: Array<PageMeta & { content: string | null }>
): Array<{ pageId: string; sectionId: string; notebookId: string; title: string; pagePath: string; haystack: string[]; contents: string[] }> {
  return pagesWithContent.map((page) => {
    const sec = sections.find((s) => s.id === page.sectionId);
    const nb = sec ? notebooks.find((n) => n.id === sec.notebookId) : undefined;
    const contents = extractSearchableText(page.content);
    return {
      pageId: page.id,
      sectionId: page.sectionId,
      notebookId: nb?.id ?? "",
      title: page.title,
      pagePath: [nb?.name ?? "…", sec?.name ?? "…"].join(" / "),
      haystack: [page.title, ...(page.tags ?? []), ...contents],
      contents,
    };
  });
}

/** Case-insensitive AND-search across the index. Returns ranked hits. */
export function searchIndex(
  index: ReturnType<typeof buildSearchIndex>,
  query: string,
  limit = 30
): SearchHit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!terms.length) return [];
  const hits: Array<SearchHit & { score: number }> = [];
  for (const entry of index) {
    const titleLower = entry.title.toLowerCase();
    const contentLower = entry.haystack.map((h) => h.toLowerCase());
    const every = terms.every((t) =>
      contentLower.some((h) => h.includes(t)) || titleLower.includes(t)
    );
    if (!every) continue;
    let score = 0;
    if (titleLower.includes(terms[0])) score += 10;
    score += terms.reduce(
      (acc, t) => acc + contentLower.filter((h) => h.includes(t)).length,
      0
    );
    const firstContentWithTerm = entry.contents.find((c) =>
      terms.some((t) => c.toLowerCase().includes(t))
    );
    hits.push({
      pageId: entry.pageId,
      sectionId: entry.sectionId,
      notebookId: entry.notebookId,
      pagePath: entry.pagePath,
      title: entry.title,
      // snippet capped by CODE POINTS (issue #101) — never split an astral
      // character (emoji, rare CJK) into a broken half
      snippet: Array.from(
        (firstContentWithTerm ?? entry.contents[0] ?? "").replace(/\s+/g, " ").trim(),
      )
        .slice(0, 140)
        .join(""),
      score,
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
