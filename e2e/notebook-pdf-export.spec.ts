import { expect, test, type Page } from "@playwright/test";
import * as fs from "node:fs";
import { inflateSync } from "node:zlib";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Export notebook as PDF (OneNote "Export notes as a PDF (Notebook)"
 * parity, issue #351) — wave 22, the phase-2 candidate the wave-21 docs
 * named ("notebook-level export with section divider sheets").
 *
 * Seed layout (deterministic, from the welcome seed):
 *   Welcome Notebook (violet) / Getting Started / "Start here"
 *   Welcome Notebook (violet) / Ideas           / "Brainstorm"
 *   My Notebook     (teal)    / New Section      / "Page 1"
 *
 * The notebook menu gains "Export as PDF" → A4 portrait / A4 landscape:
 * every alive section OPENS ON A DIVIDER SHEET (name + page count + color
 * accent), then its alive pages flow on fresh A4 sheets — ONE paginated A4
 * document, global footer sheet counter, dividers included. The band math
 * is the one proven in e2e/pdf-export.spec.ts and e2e/section-pdf-export.spec.ts:
 * the injected 40-line tall scene paginates into exactly 5 portrait /
 * 11 landscape sheets; a divider and a blank single page each add exactly
 * one sheet.
 *
 * Expected sheet counts (portrait, Welcome Notebook):
 *   divider(Getting Started) + 5 (tall "Start here")
 *   + divider(Ideas) + 1 (blank "Brainstorm") = 8
 * Landscape (My Notebook): divider(New Section) + 1 = 2.
 *
 * jsPDF runs with compress:true — every text assertion inflates the
 * FlateDecode streams first (node:zlib inflateSync).
 *
 * Lessons applied (waves 16–21): shared-prefix menu items are addressed
 * with exact: true; the Radix submenu needs hover → waitFor item → click;
 * a modal Radix menu aria-hides the app root, so store-action assertions
 * run only after the menus close; notebook export reads PERSISTED scenes,
 * so every injected scene is flushed with the saveNow hook first; stacked
 * toasts are filtered by their text with .first().
 */

const TALL_LINES = 40;
/** portrait Welcome Notebook: divider + 5 + divider + 1 */
const EXPECT_WELCOME_PORTRAIT_SHEETS = 8;
/** landscape My Notebook: divider + 1 */
const EXPECT_MY_LANDSCAPE_SHEETS = 2;
/** portrait Welcome Notebook after "Brainstorm" is trashed: 7 */
const EXPECT_WELCOME_AFTER_TRASH_SHEETS = 7;

function pdfPageCount(bytes: Buffer): number {
  return (bytes.toString("latin1").match(/\/Type[\s]*\/Page[^s]/g) ?? []).length;
}

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

/** Inject a deterministic text scene through the e2e hook. */
async function injectScene(page: Page, marker: string, lines: number): Promise<void> {
  await page.evaluate(
    ({ marker, lines }) => {
      const api = window.__NOTE_E2E__?.excalidraw as unknown as {
        updateScene: (scene: { elements: unknown[] }) => void;
      };
      if (!api) throw new Error("e2e hook missing");
      const elements: unknown[] = [];
      for (let i = 0; i < lines; i++) {
        elements.push({
          type: "text",
          id: `nbpdf-e2e-${marker}-${i}`,
          x: 60,
          y: 60 + i * 90,
          width: 500,
          height: 25,
          text: i === 0 ? `${marker} first line` : `filler line ${i}`,
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
        });
      }
      api.updateScene({ elements });
    },
    { marker, lines },
  );
}

const elementCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__NOTE_E2E__?.elementCount() ?? -1);

const saveNow = (page: Page): Promise<void> =>
  page.evaluate(() => window.__NOTE_E2E__?.saveNow());

test.describe.serial("export notebook as PDF (issue #351)", () => {
  let page: Page;
  let consoleErrors: string[];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  const notebookMenu = (name: string) =>
    page
      .getByRole("button", { name: `Actions for notebook ${name}`, exact: true });

  const sectionMenu = (name: string) =>
    page
      .locator('[data-testid="section-row"]')
      .filter({ has: page.getByRole("button", { name, exact: true }) })
      .last()
      .getByRole("button", { name: `Actions for section ${name}`, exact: true });

  /** Open the notebook menu → hover the Export-as-PDF submenu → item visible. */
  const openNotebookExportSubmenu = async (): Promise<void> => {
    await page.getByRole("menuitem", { name: "Export as PDF", exact: true }).waitFor({
      state: "visible",
    });
    await page
      .locator('[data-testid="notebook-export-pdf-submenu"]')
      .hover();
    await page.locator('[data-testid="notebook-export-pdf-portrait"]').waitFor({
      state: "visible",
    });
  };

  const exportNotebookPdf = async (
    notebook: string,
    orientation: "portrait" | "landscape",
  ): Promise<{ name: string; bytes: Buffer }> => {
    await notebookMenu(notebook).click();
    await openNotebookExportSubmenu();
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page
      .locator(`[data-testid="notebook-export-pdf-${orientation}"]`)
      .click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no file");
    return { name: download.suggestedFilename(), bytes: fs.readFileSync(path) };
  };

  const closeMenus = async (): Promise<void> => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
  };

  test("NP-N01: a two-section notebook exports as ONE 8-sheet portrait PDF with divider sheets", async () => {
    // page 1 of the seed ("Start here", Getting Started) — boot page
    await injectScene(page, "NBPDFMARKER-A", TALL_LINES);
    await saveNow(page);

    const { name, bytes } = await exportNotebookPdf("Welcome Notebook", "portrait");
    expect(name).toBe("Welcome-Notebook.pdf");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfPageCount(bytes)).toBe(EXPECT_WELCOME_PORTRAIT_SHEETS);
    const text = pdfDecompressed(bytes);
    // BOTH divider sheets print their section names and page counts
    expect(text).toContain("Getting Started");
    expect(text).toContain("1 page");
    expect(text).toContain("Ideas");
    // the tall page's marker text survives as vector text
    expect(text).toContain("NBPDFMARKER-A");
    // the blank page keeps its footer title
    expect(text).toContain("Brainstorm");
    // GLOBAL sheet numbering 1..8 across dividers, pages and blanks
    expect(text).toContain("1 / 8");
    expect(text).toContain("8 / 8");
    await closeMenus();
  });

  test("NP-N02: a single-section notebook exports landscape as ONE 2-sheet PDF", async () => {
    const { name, bytes } = await exportNotebookPdf("My Notebook", "landscape");
    expect(name).toBe("My-Notebook.pdf");
    expect(pdfPageCount(bytes)).toBe(EXPECT_MY_LANDSCAPE_SHEETS);
    const text = pdfDecompressed(bytes);
    expect(text).toContain("New Section"); // the divider's section name
    expect(text).toContain("1 / 2");
    expect(text).toContain("2 / 2");
  });

  /** Expand a notebook/section row only when collapsed — a blind click on
   *  an expanded toggle would COLLAPSE it and hide the child rows. */
  const ensureExpanded = async (name: string): Promise<void> => {
    const toggle = page.getByRole("button", { name, exact: true }).first();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  };

  test("NP-N03: trashing a page excludes it from the next export — its section keeps its divider", async () => {
    await ensureExpanded("Ideas"); // reveal the page rows under Ideas
    // trash "Brainstorm" (the blank page under Ideas) via its page menu
    const brainstormRow = page
      .locator('[data-testid="page-row"]')
      .filter({ has: page.getByRole("button", { name: "Brainstorm", exact: true }) });
    await brainstormRow.first().getByRole("button", { name: "Actions for page Brainstorm", exact: true }).click();
    await page.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
    await expect
      .poll(() => page.getByRole("button", { name: "Brainstorm", exact: true }).count(), {
        timeout: 15_000,
      })
      .toBe(0);

    const { bytes } = await exportNotebookPdf("Welcome Notebook", "portrait");
    expect(pdfPageCount(bytes)).toBe(EXPECT_WELCOME_AFTER_TRASH_SHEETS);
    const text = pdfDecompressed(bytes);
    // the trashed blank page's footer is gone…
    expect(text).not.toContain("Brainstorm");
    // …but its SECTION still exports, empty, on its divider sheet
    expect(text).toContain("Ideas");
    expect(text).toContain("0 pages");
    await closeMenus();
  });

  test("NP-N04: a notebook without alive sections surfaces a typed error toast instead of a file", async () => {
    await ensureExpanded("My Notebook"); // reveal the section row
    // trash the only section of My Notebook via the section menu
    await sectionMenu("New Section").click();
    await page.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
    await expect
      .poll(
        () =>
          page
            .getByRole("button", { name: "Actions for section New Section", exact: true })
            .count(),
        { timeout: 15_000 },
      )
      .toBe(0);

    await notebookMenu("My Notebook").click();
    await openNotebookExportSubmenu();
    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 }).catch(() => null);
    await page.locator('[data-testid="notebook-export-pdf-portrait"]').click();
    // the serial run stacks toasts — assert the ERROR one by its text
    await expect(
      page
        .locator('[data-sonner-toast]')
        .filter({ hasText: "Nothing to export" })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    // no file ever downloads for an empty notebook
    expect(await downloadPromise).toBeNull();
    await closeMenus();
  });
});
