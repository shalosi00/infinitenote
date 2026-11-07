import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachErrorCollector, openPage, resetToSeed } from "./helpers";

/**
 * IME-safe text input (issue #99, bug-hunt wave 2): Enter pressed while an
 * IME composition is active must never commit a rename — CJK users would
 * otherwise lose their draft mid-composition. (The UI is English-only since
 * v1.9; input handling stays CJK-safe — these tests type real CJK text.)
 */
test.describe.serial("IME-safe renames (issue #99)", () => {
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
});
