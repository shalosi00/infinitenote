/// <reference types="bun-types" />
/**
 * Notebook PDF export (issue #351) — wave 22, OneNote "Export notes as a
 * PDF (Notebook)" parity: every alive section opens on its divider sheet,
 * then its alive pages flow on fresh A4 sheets, all inside ONE document
 * with a GLOBAL footer sheet counter.
 *
 * The render core (pdf-sheet-render.ts) runs headless here: pure vector
 * scenes (dividers + text pages) never touch the raster fallback, jsPDF
 * prints the same bytes it prints in the browser, and the compressed
 * content streams inflate back to the vector text (the proven zlib pattern
 * from e2e/pdf-export.spec.ts).
 *
 * Deterministic band math (the same scene the section-PDF pins use): 40
 * single-line text elements, y = 60 + i*90, width 500, height 25 → 5
 * portrait sheets. A divider (name + count lines) and a single-line page
 * each add exactly one sheet in either orientation.
 */
import { describe, expect, it } from "bun:test";
import { inflateSync } from "node:zlib";
import { renderPdfDocument, type PdfSceneInput } from "../pdf-sheet-render";
import { selectNotebookExportSections } from "../section-tree";
import { buildSectionDivider } from "../notebook-divider";
import { ExportError, EXPORT_ERROR_MESSAGES } from "../export-errors";
import type { Section } from "../types";

/* ------------------------------ fixtures ------------------------------ */

let seq = 0;
function textEl(text: string, y: number): Record<string, unknown> {
  seq += 1;
  return {
    type: "text",
    id: `unit-nbpdf-${seq}`,
    x: 60,
    y,
    width: 500,
    height: 25,
    text,
    fontSize: 20,
    fontFamily: 1,
    textAlign: "left",
    verticalAlign: "top",
    strokeColor: "#1e1b4b",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    groupIds: [],
    frameId: null,
    roundness: null,
    baseline: 18,
    lineHeight: 1.25,
    containerId: null,
    originalText: "",
    autoResize: true,
  };
}

/** The deterministic tall scene: 40 lines → 5 portrait sheets. */
function tallScene(marker: string): Record<string, unknown>[] {
  const els: Record<string, unknown>[] = [];
  for (let i = 0; i < 40; i++) {
    els.push(textEl(i === 0 ? `${marker} first line` : `filler line ${i}`, 60 + i * 90));
  }
  return els;
}

function pageInput(
  title: string,
  elements: Record<string, unknown>[],
): PdfSceneInput {
  return { title, background: "plain", elements, files: null };
}

function pdfPageCount(bytes: Buffer): number {
  return (bytes.toString("latin1").match(/\/Type[\s]*\/Page[^s]/g) ?? []).length;
}

/** Full text of the file with FlateDecode streams inflated (jsPDF compresses). */
function pdfDecompressed(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  let out = raw;
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      out += "\n" + inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      // not a zlib stream (e.g. binary payload) — keep the raw bytes
    }
  }
  return out;
}

async function renderBytes(
  pages: PdfSceneInput[],
  orientation: "portrait" | "landscape",
): Promise<{ bytes: Buffer; sheetCount: number; inkPageCount: number }> {
  const { blob, sheetCount, inkPageCount } = await renderPdfDocument(pages, orientation);
  return { bytes: Buffer.from(await blob.arrayBuffer()), sheetCount, inkPageCount };
}

/* --------------------- selectNotebookExportSections --------------------- */

function sec(partial: Partial<Section> & Pick<Section, "id" | "notebookId" | "order">): Section {
  return {
    parentId: null,
    color: null,
    kind: null,
    name: `Section ${partial.id}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
    ...partial,
  } as Section;
}

describe("selectNotebookExportSections (issue #351, section-tree policy)", () => {
  it("walks the sidebar depth-first: group children export at their position, groups are never entries, trash and foreign notebooks are excluded", () => {
    const sections = [
      sec({ id: "s2", notebookId: "nb1", order: 1, name: "Second" }),
      // a group holding a nested section, in sibling order
      sec({ id: "g1", notebookId: "nb1", order: 2, kind: "group", name: "Archive" }),
      sec({ id: "s3", notebookId: "nb1", order: 0, parentId: "g1", name: "Inside group" }),
      sec({ id: "s4", notebookId: "nb1", order: 3, name: "Trashed", deletedAt: 123 }),
      sec({ id: "s5", notebookId: "nb2", order: 0, name: "Other notebook" }),
      sec({ id: "s1", notebookId: "nb1", order: 0, name: "First" }),
    ];
    const out = selectNotebookExportSections(sections, "nb1");
    expect(out.map((s) => s.name)).toEqual([
      "First",
      "Second",
      "Inside group", // the group's child, in sidebar position
      // no "Archive" (group containers never export) and no "Trashed"
    ]);
  });

  it("orphans (missing or trashed parent) still export — appended in sibling order", () => {
    const sections = [
      sec({ id: "orphan-b", notebookId: "nb1", order: 5, parentId: "gone", name: "Orphan B" }),
      sec({ id: "orphan-a", notebookId: "nb1", order: 4, parentId: "gone", name: "Orphan A" }),
      sec({ id: "top", notebookId: "nb1", order: 0, name: "Top" }),
    ];
    const out = selectNotebookExportSections(sections, "nb1");
    expect(out.map((s) => s.name)).toEqual(["Top", "Orphan A", "Orphan B"]);
  });

  it("a corrupted parentId cycle terminates and both members still export", () => {
    const sections = [
      sec({ id: "a", notebookId: "nb1", order: 1, parentId: "b", name: "Loop A" }),
      sec({ id: "b", notebookId: "nb1", order: 2, parentId: "a", name: "Loop B" }),
    ];
    const out = selectNotebookExportSections(sections, "nb1");
    expect(out.map((s) => s.name)).toEqual(["Loop A", "Loop B"]);
  });

  it("an empty notebook selects nothing — the exporter turns that into emptyNotebook", () => {
    expect(selectNotebookExportSections([], "nb1")).toEqual([]);
  });
});

/* ---------------------------- buildSectionDivider ----------------------- */

describe("buildSectionDivider (issue #351)", () => {
  it("carries the section name as the footer title and prints name, count and color accent as vector ink", () => {
    const divider = buildSectionDivider({
      sectionName: "Getting Started",
      colorHex: "#e0115f",
      pageCount: 3,
      groupName: null,
    });
    expect(divider.title).toBe("Getting Started"); // footer keeps the name
    expect(divider.background).toBe("plain");
    expect(divider.files).toBeNull();
    const els = divider.elements as Array<Record<string, unknown>>;
    const texts = els.filter((e) => e.type === "text").map((e) => e.text);
    expect(texts).toContain("Getting Started");
    expect(texts).toContain("3 pages");
    expect(texts.some((t) => String(t).includes("section group"))).toBe(false);
    const bar = els.find((e) => e.type === "rectangle");
    expect(bar?.backgroundColor).toBe("#e0115f");
    expect(bar?.backgroundColor).toBe(bar?.strokeColor);
  });

  it("names the parent section group only when the section lives in one", () => {
    const withGroup = buildSectionDivider({
      sectionName: "Deep notes",
      colorHex: "#0f7b6c",
      pageCount: 1,
      groupName: "Archive",
    });
    const texts = (withGroup.elements as Array<Record<string, unknown>>)
      .filter((e) => e.type === "text")
      .map((e) => e.text);
    expect(texts).toContain("1 page");
    expect(texts).toContain("in section group Archive");
  });
});

/* ---------------------------- document assembly ------------------------- */

describe("notebook export document assembly (issue #351)", () => {
  it("dividers + section pages flow into ONE document: 1 + 5 + 1 + 1 = 8 portrait sheets, global footer numbering", async () => {
    const doc = [
      buildSectionDivider({
        sectionName: "Getting Started",
        colorHex: "#7c3aed",
        pageCount: 1,
        groupName: null,
      }),
      pageInput("Start here", tallScene("NBPDFMARKER-A")),
      buildSectionDivider({
        sectionName: "Ideas",
        colorHex: "#f59e0b",
        pageCount: 1,
        groupName: null,
      }),
      pageInput("Brainstorm", []),
    ];
    const { bytes, sheetCount, inkPageCount } = await renderBytes(doc, "portrait");
    expect(sheetCount).toBe(8);
    expect(inkPageCount).toBe(3); // both dividers carry text ink, the blank page none
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfPageCount(bytes)).toBe(8);
    const text = pdfDecompressed(bytes);
    // both dividers print their section name and page count
    expect(text).toContain("Getting Started");
    expect(text).toContain("Ideas");
    expect(text).toContain("1 page");
    // the page's marker text survived as vector text
    expect(text).toContain("NBPDFMARKER-A");
    // the blank page keeps its footer title
    expect(text).toContain("Brainstorm");
    // GLOBAL sheet counter 1..8 across dividers, pages and blanks
    expect(text).toContain("1 / 8");
    expect(text).toContain("8 / 8");
  });

  it("landscape re-paginates: 1 + 11 + 1 = 13 sheets for divider + tall page + divider", async () => {
    const doc = [
      buildSectionDivider({
        sectionName: "Getting Started",
        colorHex: "#7c3aed",
        pageCount: 1,
        groupName: null,
      }),
      pageInput("Start here", tallScene("NBPDFMARKER-A")),
      buildSectionDivider({
        sectionName: "Ideas",
        colorHex: "#f59e0b",
        pageCount: 0,
        groupName: "Archive",
      }),
    ];
    const { sheetCount } = await renderBytes(doc, "landscape");
    expect(sheetCount).toBe(13);
  });

  it("an empty input page list is a typed ExportError, not an empty PDF", () => {
    expect(renderPdfDocument([], "portrait")).rejects.toThrow(ExportError);
  });

  it("the empty-notebook failure carries a stable code with its message", () => {
    expect(EXPORT_ERROR_MESSAGES.emptyNotebook).toBe(
      "Nothing to export — this notebook has no sections yet.",
    );
    const err = new ExportError(EXPORT_ERROR_MESSAGES.emptyNotebook, "emptyNotebook");
    expect(err.code).toBe("emptyNotebook");
    expect(err instanceof ExportError).toBe(true);
  });
});
