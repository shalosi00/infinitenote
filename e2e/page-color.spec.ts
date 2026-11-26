import { expect, test, type Page } from "@playwright/test";
import { inflateSync } from "node:zlib";
import fs from "node:fs";
import {
  attachErrorCollector,
  canvasTheme,
  resetToSeed,
  viewBackgroundColor,
} from "./helpers";

/**
 * Page color — OneNote "View > Page Color" parity (issue #385), wave 27.
 *
 * PC-N01 set + paint + reload persistence (light AND dark paint contract)
 * PC-N02 switching tints updates the paint immediately
 * PC-N03 "None (white paper)" resets — and survives a reload
 * PC-N04 the tint is a light-AUTHORED color: it does NOT flip on theme
 *        toggle (the filter dims it, the same contract as the paper-white)
 * PC-N05 the section PDF fills the sheet with the palette tint
 *
 * Seed layout (helpers.resetToSeed): notebook "My Notebook" (teal) →
 * section "New Section" → page "Page 1".
 */

const AMBER = "#fef3c7"; // PAGE_COLOR_HEX.amber
const CYAN = "#cffafe"; // PAGE_COLOR_HEX.cyan

async function openPageColorMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Page color" }).click();
  await expect(page.getByTestId("page-color-menu")).toBeVisible();
}

/** Expand a collapsible sidebar row only when folded — the blind toggle
    click would COLLAPSE an already-expanded row (wave-22 locator lesson).
    The poll re-clicks every iteration: a click landing during boot
    hydration is swallowed by the not-yet-attached handler. */
/** The sidebar row button — scoped to the row testid because after a
    reload the page auto-reopens (v1.10) and the header title button ALSO
    matches the bare name (strict-mode violation). */
function pageRowButton(page: Page, name: string): ReturnType<Page["getByRole"]> {
  return page
    .locator('[data-testid="page-row"]')
    .filter({ has: page.getByRole("button", { name, exact: true }) })
    .getByRole("button", { name, exact: true });
}

async function ensureExpanded(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole("button", { name, exact: true }).first();
  await expect
    .poll(
      async () => {
        if ((await toggle.getAttribute("aria-expanded")) !== "true") {
          await toggle.click();
        }
        return toggle.getAttribute("aria-expanded");
      },
      { timeout: 20_000, intervals: [250, 500, 1000] },
    )
    .toBe("true");
}

test.describe.serial("page color (issue #385)", () => {
  let page: Page;
  let consoleErrors: string[];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
    // "My Notebook" folds in the seed — reveal the section, then open the page
    await ensureExpanded(page, "My Notebook");
    await ensureExpanded(page, "New Section");
    await pageRowButton(page, "Page 1").click();
    await expect.poll(() => viewBackgroundColor(page)).toBe("#ffffff");
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("PC-N01: picking Amber paints the canvas and survives a reload", async () => {
    await openPageColorMenu(page);
    await page.getByTestId("page-color-amber").click();
    await expect.poll(() => viewBackgroundColor(page)).toBe(AMBER);
    // the header button reflects the active tint
    await expect(page.getByTestId("page-color-picker")).toContainText("Amber");
    // persistence: the row carries the tint across a reload
    await page.reload();
    await ensureExpanded(page, "My Notebook");
    await ensureExpanded(page, "New Section");
    await pageRowButton(page, "Page 1").click();
    await expect.poll(() => viewBackgroundColor(page)).toBe(AMBER);
    // the active swatch is marked (aria-checked radio semantics)
    await openPageColorMenu(page);
    await expect(page.getByTestId("page-color-amber")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
  });

  test("PC-N02: switching to Cyan repaints immediately", async () => {
    await openPageColorMenu(page);
    await page.getByTestId("page-color-cyan").click();
    await expect.poll(() => viewBackgroundColor(page)).toBe(CYAN);
    await expect(page.getByTestId("page-color-cyan")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
  });

  test("PC-N03: None resets to white paper and survives a reload", async () => {
    await openPageColorMenu(page);
    await page.getByTestId("page-color-none").click();
    await expect.poll(() => viewBackgroundColor(page)).toBe("#ffffff");
    await expect(page.getByTestId("page-color-picker")).toContainText("Page color");
    await page.reload();
    await ensureExpanded(page, "My Notebook");
    await ensureExpanded(page, "New Section");
    await pageRowButton(page, "Page 1").click();
    await expect.poll(() => viewBackgroundColor(page)).toBe("#ffffff");
  });

  test("PC-N04: the tint is light-authored — theme toggle does not flip it", async () => {
    await openPageColorMenu(page);
    await page.getByTestId("page-color-amber").click();
    await expect.poll(() => viewBackgroundColor(page)).toBe(AMBER);
    // the swatch grid is not menu items — Radix keeps the modal menu open
    // (outside content aria-hidden), so close it before touching the header
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]')).toHaveCount(0);

    // dark mode dims the painted tint through Excalidraw's filter; the
    // AUTHORING color stays the palette hex (same contract as white paper)
    const before = await canvasTheme(page);
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect.poll(() => canvasTheme(page)).not.toBe(before);
    await expect.poll(() => viewBackgroundColor(page)).toBe(AMBER);

    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect.poll(() => canvasTheme(page)).toBe(before);
    await expect.poll(() => viewBackgroundColor(page)).toBe(AMBER);

    // clean up: back to white for the PDF check
    await openPageColorMenu(page);
    await page.getByTestId("page-color-none").click();
    await expect.poll(() => viewBackgroundColor(page)).toBe("#ffffff");
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
  });

  test("PC-N05: the section PDF fills the sheet with the palette tint", async () => {
    await openPageColorMenu(page);
    await page.getByTestId("page-color-amber").click();
    await expect.poll(() => viewBackgroundColor(page)).toBe(AMBER);
    await page.keyboard.press("Escape");

    // export the section as PDF (OneNote "Export notes as a PDF (Section)"):
    // the proven Radix submenu flow — kebab → hover sub-trigger → wait → click
    await page
      .locator('[data-testid="section-row"]')
      .filter({ has: page.getByRole("button", { name: "New Section", exact: true }) })
      .getByRole("button", { name: "Actions for section New Section", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Export as PDF", exact: true }).waitFor({
      state: "visible",
    });
    await page.locator('[data-testid="section-export-pdf-submenu"]').hover();
    await page.locator('[data-testid="section-export-pdf-portrait"]').waitFor({
      state: "visible",
    });
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page.locator('[data-testid="section-export-pdf-portrait"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("New-Section.pdf"); // titleToFilename slugifies spaces
    const path = await download.path();
    const bytes = fs.readFileSync(path);

    // jsPDF compress:true deflates content streams — inflate before grepping
    // (the section-pdf-export spec pattern). The amber tint (254,243,199)
    // lands as the normalized fill color `1. 0.95 0.78 rg` — verified against
    // jsPDF's actual output during development (2-decimal normalization).
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
    expect(out).toContain("1. 0.95 0.78 rg");
  });
});
