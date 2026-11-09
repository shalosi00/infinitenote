import { expect, test, type Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Focus-return regression for the title-bar rename editor (WCAG 2.4.3):
 * committing with Enter or cancelling with Escape unmounts the draft
 * input, and focus used to fall to <body>. Keyboard-closed editors must
 * return focus to the title button that opened them; click-away closes
 * intentionally let focus follow the click.
 */

const TITLE_BUTTON = 'button[title="Click to rename this page"]';

test.describe.serial("rename editor focus return", () => {
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

  test("committing with Enter returns focus to the title button", async () => {
    await page.locator(TITLE_BUTTON).click();
    const input = page.getByLabel("Page title");
    await input.fill("Renamed via Enter");
    await input.press("Enter");
    await page.waitForTimeout(400);

    await expect(page.locator(TITLE_BUTTON)).toBeFocused();
    // the rename itself still landed
    await expect(page.getByTestId("sidebar")).toContainText("Renamed via Enter");
  });

  test("cancelling with Escape returns focus to the title button", async () => {
    await page.locator(TITLE_BUTTON).click();
    const input = page.getByLabel("Page title");
    await input.fill("This rename must not land");
    await input.press("Escape");
    await page.waitForTimeout(400);

    await expect(page.locator(TITLE_BUTTON)).toBeFocused();
    await expect(page.getByTestId("sidebar")).toContainText("Renamed via Enter");
    await expect(page.getByTestId("sidebar")).not.toContainText("This rename must not land");
  });
});
