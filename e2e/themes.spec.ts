import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Themes gallery E2E (issue #55).
 * Covers the full DOM contract the unit tests cannot: opening the gallery
 * from the sidebar, the data-theme attribute landing on <html>, persistence
 * via the pre-hydration script across reload, the default clearing the
 * attribute + storage, and the localized (zh-CN) gallery labels.
 */
test.describe.serial("themes gallery", () => {
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

  async function rootDataTheme(): Promise<string | null> {
    return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  }

  async function rootPrimaryVar(): Promise<string> {
    return page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()
    );
  }

  async function openGallery() {
    await page.getByTestId("themes-button").click();
    await expect(page.getByTestId("themes-dialog")).toBeVisible();
  }

  test("gallery opens with one card per catalog theme", async () => {
    await openGallery();
    for (const id of ["default", "ocean", "forest", "sunset", "rose", "slate"]) {
      await expect(page.getByTestId(`theme-card-${id}`)).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("themes-dialog")).toBeHidden();
  });

  test("applying an accent theme lands the attribute, overrides --primary and persists", async () => {
    const before = await rootPrimaryVar();
    await openGallery();
    await page.getByTestId("theme-card-ocean").click();
    await expect.poll(rootDataTheme).toBe("ocean");
    await expect.poll(rootPrimaryVar).not.toBe(before);
    expect(await page.evaluate(() => localStorage.getItem("infinitenote.theme"))).toBe("ocean");
    await page.keyboard.press("Escape");

    // The pre-hydration script must restore the theme before first paint —
    // i.e. the attribute is already on <html> right after the reload.
    await page.reload();
    await page.locator('[data-testid="page-row"]').first().waitFor({ state: "visible" });
    expect(await rootDataTheme()).toBe("ocean");
    await expect.poll(rootPrimaryVar).not.toBe(before);
  });

  test("re-applying the default clears the attribute and the storage key", async () => {
    await openGallery();
    await page.getByTestId("theme-card-default").click();
    await expect.poll(rootDataTheme).toBeNull();
    expect(
      await page.evaluate(() => localStorage.getItem("infinitenote.theme"))
    ).toBeNull();
    await page.keyboard.press("Escape");
    await page.reload();
    await page.locator('[data-testid="page-row"]').first().waitFor({ state: "visible" });
    expect(await rootDataTheme()).toBeNull();
  });

  test("the gallery is localized after switching to 简体中文", async () => {
    await page.getByTestId("locale-toggle").click(); // en → zh-CN
    await openGallery();
    await expect(page.getByTestId("themes-dialog").locator("h2")).toHaveText("主题");
    await expect(page.getByTestId("theme-card-ocean")).toContainText("海洋");
    await expect(page.getByTestId("theme-card-default")).toContainText("紫罗兰");
    // switch back to English for later specs / deterministic state
    await page.keyboard.press("Escape");
    await page.getByTestId("locale-toggle").click();
  });
});
