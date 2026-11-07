import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachErrorCollector, openPage, resetToSeed } from "./helpers";

/**
 * Bug-hunt wave 2, PR 5 — i18n fixes:
 * - #99 Enter during IME composition must not commit renames/tags
 * - #63 generated names (default titles, Quick Notes home) follow the locale
 */
test.describe.serial("wave2 i18n: IME composition + localized generated names", () => {
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

  test("#99 Enter while composing does not commit the page rename", async () => {
    await openPage(page, "Start here");
    await page.locator("main").getByRole("button", { name: "Start here", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Page title" });
    await expect(input).toBeFocused();
    await input.fill("会议记录");

    // Enter WITH an active IME composition: must be ignored by the app
    await input.evaluate((el) => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      );
    });

    // the rename input must still be open with the draft intact
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("会议记录");
    // and the page title must not have changed yet
    await expect(
      page.getByTestId("sidebar").getByRole("button", { name: "Start here", exact: true }),
    ).toHaveCount(1);

    // a plain Enter (composition finished) commits the rename
    await input.press("Enter");
    await expect(
      page.getByTestId("sidebar").getByRole("button", { name: "会议记录", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("#99 Enter while composing does not commit the sidebar rename", async () => {
    await openPage(page, "会议记录");
    const row = page
      .getByTestId("sidebar")
      .locator('[data-testid="page-row"]')
      .filter({ hasText: "会议记录" });
    await row.getByRole("button", { name: "会议记录", exact: true }).dblclick();
    // while renaming, the row swaps to the input (no page-row testid) —
    // locate it by its aria-label within the sidebar
    const input = page.getByTestId("sidebar").getByRole("textbox", { name: "Rename" });
    await expect(input).toBeFocused();
    await input.fill("正在改名");

    await input.evaluate((el) => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      );
    });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("正在改名");
    await input.press("Enter"); // real Enter commits
    await expect(
      page.getByTestId("sidebar").getByRole("button", { name: "正在改名", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("#63 the Quick Notes home and quick-note title follow the locale", async () => {
    // switch to 简体中文
    await page.getByTestId("locale-toggle").click();

    // quick capture in zh: the home + the note title must be localized
    await page.locator('[data-testid="quick-note-button"]').click();
    // the created page carries the localized prefix (unique: date pattern)
    await expect(
      page.getByTestId("sidebar").getByText(/^快速笔记 \d{4}-\d{2}-\d{2}/).first(),
    ).toBeVisible({ timeout: 10_000 });
    // and the Quick Notes home notebook exists under its localized name
    // (the quick-action button shares the label, so assert the tree area)
    await expect(
      page.getByTestId("sidebar").locator('nav[aria-label]'),
    ).toContainText("快速笔记");

    // switch back to English for cleanliness
    await page.getByTestId("locale-toggle").click();
  });
});
