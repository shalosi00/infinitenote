import { expect, test, type Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Focus-return regressions (WCAG 2.4.3): closing an overlay must return
 * focus to the element that had it before the overlay opened. Every app
 * dialog opens from CONTROLLED state (plain buttons / global shortcuts),
 * so Radix has no DialogTrigger to return to — the shared primitives
 * restore the last outside-overlay focus instead. Before the fix, focus
 * fell to <body> after every dialog close: keyboard users lost their place.
 */

test.describe.serial("closing overlays returns focus (WCAG 2.4.3)", () => {
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

  test("themes dialog returns focus to its trigger", async () => {
    const trigger = page.getByTestId("themes-button");
    await trigger.click();
    await page.getByTestId("themes-dialog").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400); // Radix exit animations
    await expect(trigger).toBeFocused();
  });

  test("sync dialog returns focus to its trigger", async () => {
    const trigger = page.getByTestId("sync-button");
    await trigger.click();
    await page.getByTestId("sync-dialog").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await expect(trigger).toBeFocused();
  });

  test("trash dialog returns focus to its trigger", async () => {
    const trigger = page.getByRole("button", { name: "Trash" });
    await trigger.click();
    await page.getByTestId("trash-dialog").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await expect(trigger).toBeFocused();
  });

  test("shortcuts dialog returns focus to its trigger", async () => {
    const trigger = page.getByTestId("shortcuts-button");
    await trigger.click();
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await expect(trigger).toBeFocused();
  });

  test("search dialog returns focus to the header Search button", async () => {
    const trigger = page.getByRole("button", { name: "Search pages" });
    await trigger.click();
    await page.locator("[cmdk-input]").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await expect(trigger).toBeFocused();
  });

  test("search opened via Ctrl+K returns focus to the previously focused element", async () => {
    // Ctrl+K is a global shortcut with no trigger button; the overlay must
    // return focus to whatever held it before the shortcut fired.
    const target = page.getByTestId("themes-button");
    await target.click(); // focused
    await page.keyboard.press("Escape"); // close the themes dialog again
    await page.waitForTimeout(400);
    await expect(target).toBeFocused(); // baseline: target holds focus

    await page.keyboard.press("Control+k");
    await page.locator("[cmdk-input]").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await expect(target).toBeFocused();
  });

  test("mobile drawer returns focus to the hamburger button", async () => {
    // Boot happened at desktop size (resetToSeed needs the visible sidebar);
    // shrink the viewport for the drawer flow — the proven mobile pattern.
    await page.setViewportSize({ width: 390, height: 844 });
    const trigger = page.getByRole("button", { name: "Open navigation" });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await page.locator("[data-slot='sheet-content']").waitFor({ state: "visible" });
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600); // sheet exit animation
    await expect(trigger).toBeFocused();
  });
});
