import { expect, test, type Page } from "@playwright/test";
import * as fs from "node:fs";
import { inflateSync } from "node:zlib";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Export section as PDF (OneNote "Export notes as a PDF (Section)" parity,
 * issue #344) — wave 21.
 *
 * Seed layout (deterministic, from the welcome seed):
 *   Welcome Notebook (violet) / Getting Started / "Start here"
 *   Welcome Notebook (violet) / Ideas           / "Brainstorm"
 *   My Notebook     (teal)    / New Section      / "Page 1"
 *
 * The section menu gains "Export as PDF" → A4 portrait / A4 landscape:
 * every alive page of the section, in sidebar order, flows into ONE
 * paginated A4 document through the shared print core. The band math is
 * the one proven in e2e/pdf-export.spec.ts: the injected 40-line tall
 * scene paginates into exactly 5 portrait / 11 landscape sheets; a
 * single-line page adds exactly one sheet either way.
 *
 * jsPDF runs with compress:true — every text assertion inflates the
 * FlateDecode streams first (node:zlib inflateSync).
 *
 * Lessons applied (waves 16–20): shared-prefix menu items are addressed
 * with exact: true; the Radix submenu needs hover → waitFor item → click;
 * a modal Radix menu aria-hides the app root, so store-action assertions
 * run only after the menus close; section export reads PERSISTED scenes,
 * so every injected scene is flushed with the saveNow hook first.
 */

const TALL_LINES = 40;
/** portrait: 5 (tall) + 1 (short); landscape: 11 + 1 */
const EXPECT_PORTRAIT_SHEETS = 6;
const EXPECT_LANDSCAPE_SHEETS = 12;

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
          id: `spdf-e2e-${marker}-${i}`,
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

test.describe.serial("export section as PDF (issue #344)", () => {
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

  const sectionMenu = (name: string) =>
    page
      .locator('[data-testid="section-row"]')
      .filter({ has: page.getByRole("button", { name, exact: true }) })
      .last()
      .getByRole("button", { name: `Actions for section ${name}`, exact: true });

  /** Open the section menu → hover the Export-as-PDF submenu → return the item. */
  const openExportSubmenu = async (): Promise<void> => {
    await page.getByRole("menuitem", { name: "Export as PDF", exact: true }).waitFor({
      state: "visible",
    });
    await page
      .locator('[data-testid="section-export-pdf-submenu"]')
      .hover();
    await page.locator('[data-testid="section-export-pdf-portrait"]').waitFor({
      state: "visible",
    });
  };

  const exportSectionPdf = async (
    section: string,
    orientation: "portrait" | "landscape",
  ): Promise<{ name: string; bytes: Buffer }> => {
    await sectionMenu(section).click();
    await openExportSubmenu();
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page
      .locator(`[data-testid="section-export-pdf-${orientation}"]`)
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

  test("SP-N01: a two-page section exports as ONE 6-sheet portrait PDF", async () => {
    // page 1 of the seed ("Start here", Getting Started) — boot page
    await injectScene(page, "SECPDFMARKER-A", TALL_LINES);
    await saveNow(page);

    // page 2 in the SAME section via the section menu
    await sectionMenu("Getting Started").click();
    await page.getByRole("menuitem", { name: "New page", exact: true }).click();
    // addPage navigates to the fresh page — wait until the canvas is empty
    await expect.poll(() => elementCount(page), { timeout: 15_000 }).toBe(0);
    await injectScene(page, "SECPDFMARKER-B", 1);
    await saveNow(page);
    await closeMenus();

    const { name, bytes } = await exportSectionPdf("Getting Started", "portrait");
    expect(name).toBe("Getting-Started.pdf");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfPageCount(bytes)).toBe(EXPECT_PORTRAIT_SHEETS);
    const text = pdfDecompressed(bytes);
    // BOTH notes' markers and the first note's footer title survive
    expect(text).toContain("SECPDFMARKER-A");
    expect(text).toContain("SECPDFMARKER-B");
    expect(text).toContain("Start here");
    // global sheet numbering 1..6 across both note pages
    expect(text).toContain("1 / 6");
    expect(text).toContain("6 / 6");
  });

  test("SP-N02: the same section exports landscape as ONE 12-sheet PDF", async () => {
    const { name, bytes } = await exportSectionPdf("Getting Started", "landscape");
    expect(name).toBe("Getting-Started.pdf");
    expect(pdfPageCount(bytes)).toBe(EXPECT_LANDSCAPE_SHEETS);
    expect(pdfDecompressed(bytes)).toContain("SECPDFMARKER-B");
  });

  test("SP-N03: trashing a page excludes it from the next export", async () => {
    // aria-current="page" sits on the row's MAIN button (the sidebar's
    // current-page marker); the kebab is addressable by name prefix, no
    // title extraction needed
    const activeRow = page
      .locator('[data-testid="page-row"]')
      .filter({ has: page.locator('[aria-current="page"]') });
    await expect(activeRow).toHaveCount(1);

    const kebab = activeRow.getByRole("button", { name: /^Actions for page / });
    // the kebab's accessible name carries the page title — use it to assert
    // the row is really gone (row COUNTS vary with section expansion, so a
    // global count is not a settle condition)
    const kebabLabel = (await kebab.getAttribute("aria-label")) ?? "";
    const title = kebabLabel.slice("Actions for page ".length);
    expect(title.length).toBeGreaterThan(0);

    await kebab.click();
    await page.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
    await expect
      .poll(() => page.getByRole("button", { name: title, exact: true }).count(), {
        timeout: 15_000,
      })
      .toBe(0);

    const { bytes } = await exportSectionPdf("Getting Started", "portrait");
    expect(pdfPageCount(bytes)).toBe(EXPECT_PORTRAIT_SHEETS - 1);
    const text = pdfDecompressed(bytes);
    expect(text).toContain("SECPDFMARKER-A");
    expect(text).not.toContain("SECPDFMARKER-B");
  });

  test("SP-N04: an empty section surfaces a typed error toast instead of a file", async () => {
    // a fresh section under the Welcome Notebook via the notebook menu
    await page
      .getByRole("button", { name: "Actions for notebook Welcome Notebook", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "New section", exact: true }).click();
    // the generated name is "Section N" — resolve it instead of hardcoding
    const fresh = page
      .locator('[data-testid="section-row"]')
      .filter({ has: page.getByRole("button", { name: /Section \d+/ }) })
      .last();
    await expect(fresh).toBeVisible();
    const freshName = (await fresh.getByRole("button").first().textContent())?.trim() ?? "";
    expect(freshName).toMatch(/^Section \d+$/);

    await sectionMenu(freshName).click();
    await openExportSubmenu();
    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 }).catch(() => null);
    await page.locator('[data-testid="section-export-pdf-portrait"]').click();
    // the serial run stacks toasts — assert the ERROR one by its text
    await expect(
      page
        .locator('[data-sonner-toast]')
        .filter({ hasText: "Nothing to export" })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    // no file ever downloads for an empty section
    expect(await downloadPromise).toBeNull();
    await closeMenus();
  });
});
