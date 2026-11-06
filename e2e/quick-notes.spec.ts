import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachErrorCollector, createTextElement, expectCount, resetToSeed, setActiveTool } from "./helpers";

/** Local calendar date key — matches the app's `todayKey` (same host TZ). */
function todayKey(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const QUICK_NOTE_ROW = '[data-testid="page-row"]';

/** Rows whose page-title button is EXACTLY this title (quick note titles embed the date too). */
function rowsByExactTitle(page: Page, title: string) {
  return page.locator(QUICK_NOTE_ROW).filter({
    has: page.getByRole("button", { name: title, exact: true }),
  });
}

test.describe.serial("quick notes and today page (issue #19)", () => {
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

  test("quick note button bootstraps the home and focuses a ready-to-type canvas", async () => {
    await page.locator('[data-testid="quick-note-button"]').click();

    // the Quick Notes notebook + section appeared and expanded…
    await expect(page.getByRole("button", { name: "Quick Notes", exact: true }).first()).toBeVisible();

    // …and a dated quick note page is created and selected
    const row = page
      .locator(QUICK_NOTE_ROW)
      .filter({ hasText: /Quick note \d{4}-\d{2}-\d{2} \d{2}:\d{2}/ })
      .first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-selected", "true");

    // canvas received keyboard focus (typing/shortcuts work immediately)
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.activeElement?.closest(".excalidraw") !== null,
          ),
        { timeout: 10_000, message: "canvas container holds keyboard focus" },
      )
      .toBe(true);

    // and it is genuinely ready for typing
    await setActiveTool(page, "text");
    await createTextElement(page, "typed right after quick capture");
    await setActiveTool(page, "selection");
    await expectCount(page, 1);
  });

  test("keyboard shortcut Ctrl+Alt+N appends another quick note", async () => {
    const before = await page
      .locator(QUICK_NOTE_ROW)
      .filter({ hasText: /Quick note \d{4}-\d{2}-\d{2}/ })
      .count();
    await page.keyboard.press("Control+Alt+n");
    await expect(
      page
        .locator(QUICK_NOTE_ROW)
        .filter({ hasText: /Quick note \d{4}-\d{2}-\d{2}/ }),
    ).toHaveCount(before + 1, { timeout: 10_000 });
  });

  test("Today opens the daily page and reuses the very same page after reload", async () => {
    await page.locator('[data-testid="today-button"]').click();
    const key = todayKey();

    // exact-title match: quick note titles embed the same date as a substring
    const dailyRow = rowsByExactTitle(page, key).first();
    await expect(dailyRow).toBeVisible();
    await expect(dailyRow).toHaveAttribute("data-selected", "true");
    await expect(rowsByExactTitle(page, key)).toHaveCount(1);

    // reload → Today again → still the same single page (no duplicates)
    await page.reload();
    await page.locator(QUICK_NOTE_ROW).first().waitFor({ state: "visible", timeout: 30_000 });
    await page.locator('[data-testid="today-button"]').click();
    await expect(rowsByExactTitle(page, key)).toHaveCount(1);
    await expect(rowsByExactTitle(page, key).first()).toHaveAttribute("data-selected", "true");
  });

  test("quick notes are ordinary pages — Ctrl+K search finds them", async () => {
    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder("Search all pages…");
    await expect(input).toBeVisible();
    await input.fill("quick note");
    await expect(page.locator("[cmdk-list]")).toContainText(/Quick note \d{4}-\d{2}-\d{2}/, {
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
  });
});
