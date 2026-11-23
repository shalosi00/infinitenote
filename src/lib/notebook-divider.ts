/**
 * The section divider sheet of the notebook PDF export (issue #351) —
 * OneNote "Export notes as a PDF (Notebook)" parity, wave 22.
 *
 * PURE module on purpose: the headless unit tests print real jsPDF bytes
 * from this builder, and any import of notes-db.ts (Dexie at module scope)
 * would poison every db-sharing test file — the wave-21 lesson. The Dexie
 * reading adapter lives in notebook-pdf.ts; this file never touches I/O.
 *
 * A divider OPENS a section inside the notebook document: the section name
 * as vector text, a color accent bar in the effective section color
 * (override or notebook inheritance, issue #319), the page count and the
 * parent section-group name when the section lives in one. Its footer
 * carries the section name and the global sheet counter like any other
 * sheet in the document.
 */

/** Loose shape of the render core's files map (kept structurally here). */
type PdfFiles = Record<string, { id: string; dataURL: string }>;

/** One printable page: a title (footer), its paper style and its scene. */
export interface NotebookDividerScene {
  title: string;
  background: "plain";
  elements: readonly unknown[];
  files: PdfFiles | null;
}

/** One divider sheet's content, assembled by the exporter, unit-pinned here. */
export interface SectionDividerSpec {
  sectionName: string;
  /** Effective section color as CSS hex (override or notebook inheritance). */
  colorHex: string;
  pageCount: number;
  /** Name of the parent section group, when the section lives in one. */
  groupName: string | null;
}

/**
 * Build the divider sheet that opens a section inside a notebook export.
 * Pure vector — a filled accent bar plus short text lines — so headless
 * unit tests never pull the Excalidraw runtime.
 */
export function buildSectionDivider(spec: SectionDividerSpec): NotebookDividerScene {
  const elements: Record<string, unknown>[] = [
    {
      type: "rectangle",
      id: "nbpdf-divider-bar",
      x: 57,
      y: 90,
      width: 481,
      height: 8,
      angle: 0,
      strokeColor: spec.colorHex,
      backgroundColor: spec.colorHex,
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      isDeleted: false,
      roundness: null,
    },
    {
      type: "text",
      id: "nbpdf-divider-name",
      x: 57,
      y: 122,
      width: 481,
      height: 36,
      text: spec.sectionName,
      fontSize: 28,
      fontFamily: 1,
      textAlign: "left",
      verticalAlign: "top",
      lineHeight: 1.25,
      strokeColor: "#1e1b4b",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      angle: 0,
      isDeleted: false,
    },
    {
      type: "text",
      id: "nbpdf-divider-count",
      x: 57,
      y: 174,
      width: 481,
      height: 20,
      text: spec.pageCount === 1 ? "1 page" : `${spec.pageCount} pages`,
      fontSize: 15,
      fontFamily: 1,
      textAlign: "left",
      verticalAlign: "top",
      lineHeight: 1.25,
      strokeColor: "#475569",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      angle: 0,
      isDeleted: false,
    },
  ];
  if (spec.groupName) {
    elements.push({
      type: "text",
      id: "nbpdf-divider-group",
      x: 57,
      y: 204,
      width: 481,
      height: 19,
      text: `in section group ${spec.groupName}`,
      fontSize: 14,
      fontFamily: 1,
      textAlign: "left",
      verticalAlign: "top",
      lineHeight: 1.25,
      strokeColor: "#64748b",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      angle: 0,
      isDeleted: false,
    });
  }
  return {
    title: spec.sectionName,
    background: "plain",
    elements,
    files: null,
  };
}
