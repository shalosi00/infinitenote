/**
 * Page version history E2E (test plan: docs/test-plans/version-history.md,
 * ids VH-E*).
 *
 * Deterministic paths only: the manual "Save version now" button and the
 * automatic pre-restore safety snapshot. The 5-minute auto-snapshot policy
 * is covered by unit tests with an injected clock (VH-P10..P16) — E2E cannot
 * fake wall-clock time.
 *
 * Known-deterministic background: the WELCOME page ("Start here") triggers
 * exactly one normalization save on its first load after seeding (Excalidraw
 * re-measures the seed's text widths against the self-hosted fonts), which
 * records one Automatic version. Tests therefore locate rows by their
 * content, never by index, and the empty state is probed on a brand-new
 * page (null content — nothing to normalize, no saves).
 */
import { expect, test } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  createTextElement,
  drawRectangleOnCanvas,
  elementCount,
  expectCount,
  openPage,
  resetToSeed,
  setActiveTool,
} from "./helpers";

// serial: the tests build on each other (fresh page → manual version →
// restore → reload) — fullyParallel would split them across workers and
// each worker's beforeAll re-seeds, destroying the built-up state.
test.describe.serial("page version history", () => {
  let consoleErrors: string[];
  let page: import("@playwright/test").Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  async function openHistoryDialog(): Promise<void> {
    await page.getByRole("button", { name: "Page actions" }).click();
    await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="open-version-history"]').click();
    await page.locator('[data-testid="history-dialog"]').waitFor({ state: "visible" });
  }

  test("VH-E01: a brand-new page shows the empty state", async () => {
    // fresh page via the sidebar — null content, no normalization save,
    // therefore a provably empty history
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);

    await openHistoryDialog();
    await expect(page.locator('[data-testid="history-empty"]')).toBeVisible();
    await page.keyboard.press("Escape");

    // back to the welcome page for the tests that follow
    await openPage(page, "Start here");
    await expectCount(page, 2);
  });

  test("VH-E02: Save version now lists a Manual row with the element count", async () => {
    await openHistoryDialog();
    await page.locator('[data-testid="save-version-now"]').click();
    const row = page.locator('[data-testid="version-row"]').first();
    await expect(row).toBeVisible();
    await expect(row.locator('[data-testid="version-source"]')).toHaveText("Manual");
    await expect(row.locator('[data-testid="version-meta"]')).toContainText("2 elements");
    await page.keyboard.press("Escape");
  });

  test("VH-E03: full restore round-trip — canvas returns to the versioned scene", async () => {
    // 2 (seed) → 3: draw a rectangle
    await setActiveTool(page, "rectangle");
    await drawRectangleOnCanvas(page);
    await expectCount(page, 3);

    // version the 3-element state
    await openHistoryDialog();
    await page.locator('[data-testid="save-version-now"]').click();
    await expect(
      page.locator('[data-testid="version-row"]', { hasText: "3 elements" }).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // 3 → 4: type a text element
    await setActiveTool(page, "text");
    await createTextElement(page, "later addition");
    await expectCount(page, 4);

    // restore the 3-element version — located by its meta, never by index
    // (the welcome page's first-load normalization version may or may not
    // sit between the manual saves)
    await openHistoryDialog();
    const target = page
      .locator('[data-testid="version-row"]', { hasText: "3 elements" })
      .first();
    await expect(target.locator('[data-testid="version-meta"]')).toContainText("3 elements");
    await target.getByRole("button", { name: "Restore" }).click();

    // the canvas remounts with the restored scene
    await expectCount(page, 3);
    // the replaced 4-element state was saved as a "Before restore" version
    await expect(
      page.locator('[data-testid="version-row"]').first().locator('[data-testid="version-source"]'),
    ).toHaveText("Before restore");
    await page.keyboard.press("Escape");
  });

  test("VH-E04: the restored scene persists across a reload", async () => {
    await page.reload();
    await expectCount(page, 3);
    expect(await elementCount(page)).toBe(3);
  });

  test("VH-E05: another page's history is its own (isolation)", async () => {
    // "Brainstorm" lives in the collapsed "Ideas" section — expand it first
    await page.getByRole("button", { name: "Ideas", exact: true }).click();
    await openPage(page, "Brainstorm");
    await expectCount(page, 0);

    await openHistoryDialog();
    await expect(page.locator('[data-testid="history-empty"]')).toBeVisible();
    await page.keyboard.press("Escape");

    // and back — the versioned page kept its history (restore still listed)
    await openPage(page, "Start here");
    await expectCount(page, 3);
    await openHistoryDialog();
    await expect(
      page.locator('[data-testid="version-row"]').first().locator('[data-testid="version-source"]'),
    ).toHaveText("Before restore");
    await page.keyboard.press("Escape");
  });
});
