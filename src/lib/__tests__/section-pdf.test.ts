/// <reference types="bun-types" />
/**
 * Section PDF export (issue #344) — wave 21, OneNote "Export notes as a
 * PDF (Section)" parity.
 *
 * The render core (pdf-sheet-render.ts) runs headless here: pure vector
 * scenes never touch the raster fallback, jsPDF prints the same bytes it
 * prints in the browser, and the compressed content streams inflate back
 * to the vector text (the proven zlib pattern from e2e/pdf-export.spec.ts).
 *
 * Deterministic band math (same scene the E2E spec pins): 40 single-line
 * text elements, y = 60 + i*90, width 500, height 25 → contentH 3535,
 * contentW 500 → portrait: scale = min(2, 515.28/500) = 1.03056, bandH =
 * 761.89/1.03056 = 739.27 → ceil(3535/739.27) = 5 sheets; landscape: scale
 * = 1.52378, bandH = 338.2 → 11 sheets. A single-line page adds exactly
 * one sheet in either orientation.
 */
import { describe, expect, it } from "bun:test";
import { inflateSync } from "node:zlib";
import { renderPdfDocument, type PdfSceneInput } from "../pdf-sheet-render";
import { selectSectionPages } from "../section-tree";
import { ExportError, EXPORT_ERROR_MESSAGES } from "../export-errors";
import type { PageRow } from "../types";

/* ------------------------------ fixtures ------------------------------ */

let seq = 0;
function textEl(text: string, y: number): Record<string, unknown> {
  seq += 1;
  return {
    type: "text",
    id: `unit-spdf-${seq}`,
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

/** The deterministic tall scene: 40 lines → 5 portrait / 11 landscape sheets. */
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

/* --------------------------- selectSectionPages ------------------------ */

function row(partial: Partial<PageRow> & Pick<PageRow, "id" | "sectionId" | "order">): PageRow {
  return {
    title: `Page ${partial.id}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
    ...partial,
  } as PageRow;
}

describe("selectSectionPages (issue #344, section-tree policy)", () => {
  it("keeps only the alive pages of the requested section, in sidebar order", () => {
    const pages = [
      row({ id: "a", sectionId: "s1", order: 2, title: "B" }),
      row({ id: "b", sectionId: "s2", order: 0, title: "other section" }),
      row({ id: "c", sectionId: "s1", order: 1, title: "A" }),
      row({ id: "d", sectionId: "s1", order: 3, title: "trashed", deletedAt: 123 }),
    ];
    const out = selectSectionPages(pages, "s1");
    expect(out.map((p) => p.id)).toEqual(["c", "a"]);
  });

  it("tie-breaks equal orders by creation time — deterministic export order", () => {
    const pages = [
      row({ id: "late", sectionId: "s1", order: 5, createdAt: 2_000, title: "Late" }),
      row({ id: "early", sectionId: "s1", order: 5, createdAt: 1_000, title: "Early" }),
    ];
    expect(selectSectionPages(pages, "s1").map((p) => p.id)).toEqual(["early", "late"]);
  });
});

/* ---------------------------- renderPdfDocument ------------------------ */

describe("renderPdfDocument (issue #344)", () => {
  it("two note pages flow into ONE document: 5 + 1 = 6 portrait sheets, global footer numbering", async () => {
    const { bytes, sheetCount, inkPageCount } = await renderBytes(
      [
        pageInput("First note", tallScene("UNITMARKER-A")),
        pageInput("Second note", [textEl("UNITMARKER-B only line", 60)]),
      ],
      "portrait",
    );
    expect(sheetCount).toBe(6);
    expect(inkPageCount).toBe(2);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfPageCount(bytes)).toBe(6);
    const text = pdfDecompressed(bytes);
    // both notes' marker text survived as vector text
    expect(text).toContain("UNITMARKER-A");
    expect(text).toContain("UNITMARKER-B");
    // footers carry the NOTE title and the GLOBAL sheet counter 1..6
    expect(text).toContain("First note");
    expect(text).toContain("Second note");
    expect(text).toContain("1 / 6");
    expect(text).toContain("6 / 6");
  });

  it("landscape re-paginates the same section: 11 + 1 = 12 sheets", async () => {
    const { sheetCount } = await renderBytes(
      [
        pageInput("First note", tallScene("UNITMARKER-A")),
        pageInput("Second note", [textEl("UNITMARKER-B only line", 60)]),
      ],
      "landscape",
    );
    expect(sheetCount).toBe(12);
  });

  it("a page without ink renders as a blank sheet that keeps its footer title", async () => {
    const { bytes, sheetCount, inkPageCount } = await renderBytes(
      [
        pageInput("First note", tallScene("UNITMARKER-A")),
        pageInput("Blank note", []),
        pageInput("Second note", [textEl("UNITMARKER-B only line", 60)]),
      ],
      "portrait",
    );
    // 5 (tall) + 1 (blank) + 1 (short)
    expect(sheetCount).toBe(7);
    expect(inkPageCount).toBe(2);
    expect(pdfPageCount(bytes)).toBe(7);
    const text = pdfDecompressed(bytes);
    expect(text).toContain("Blank note");
    expect(text).toContain("7 / 7");
  });

  it("an empty page list is a typed ExportError, not an empty PDF", async () => {
    expect(renderPdfDocument([], "portrait")).rejects.toThrow(ExportError);
  });

  it("the empty-section failure carries a stable code with its message", () => {
    expect(EXPORT_ERROR_MESSAGES.emptySection).toBe(
      "Nothing to export — this section has no pages yet.",
    );
    const err = new ExportError(EXPORT_ERROR_MESSAGES.emptySection, "emptySection");
    expect(err.code).toBe("emptySection");
    expect(err instanceof ExportError).toBe(true);
  });
});
