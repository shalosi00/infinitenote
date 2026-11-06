import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Locale switching (issue #54): the sidebar Language toggle flips the whole
 * UI chrome between English and 简体中文, <html lang> follows, and the choice
 * survives a reload (localStorage). Switching back restores English.
 *
 * Isolation: each spec file gets a fresh browser context (own localStorage),
 * so the default-English assertions are not affected by other specs.
 */

const SIDEBAR_HEADER = '[data-testid="sidebar"] >> text=';

test.describe.serial("locale switching (issue #54)", () => {
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

  test("UI chrome is English by default", async () => {
    await expect(page.locator(SIDEBAR_HEADER + "Notebooks")).toBeVisible();
    await expect(page.locator('[data-testid="quick-note-button"]')).toHaveText(/Quick note/);
    await expect(page.locator('[data-testid="today-button"]')).toHaveText(/Today/);
  });

  test("the Language toggle switches the chrome to Simplified Chinese", async () => {
    await page.locator('[data-testid="locale-toggle"]').click();

    await expect(page.locator(SIDEBAR_HEADER + "笔记本")).toBeVisible();
    await expect(page.locator('[data-testid="quick-note-button"]')).toHaveText(/快速笔记/);
    await expect(page.locator('[data-testid="today-button"]')).toHaveText(/今天/);
    await expect(page.locator('[data-testid="sync-button"]')).toHaveText(/同步/);

    // <html lang> follows the active locale
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

    // the toggle now offers the way back
    await expect(page.locator('[data-testid="locale-toggle"]')).toHaveText(/English/);
  });

  test("menus and dialogs render localized labels", async () => {
    // open a kebab menu on the first notebook row and check a translated action
    await page.locator('[data-testid="notebook-row"]').first().hover();
    await page
      .locator('[data-testid="notebook-row"]')
      .first()
      .locator('button[aria-label*="的操作"]')
      .click();
    await expect(page.getByRole("menuitem", { name: "新建分区" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "移入回收站" })).toBeVisible();
    await page.keyboard.press("Escape");

    // shortcuts dialog (keyboard: ?)
    await page.keyboard.press("Shift+Slash");
    await expect(page.locator('[data-testid="shortcuts-dialog"]')).toBeVisible();
    await expect(page.getByRole("dialog").getByText("键盘快捷键")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("画布工具")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("the locale choice survives a reload", async () => {
    await page.reload();
    await resetToSeed(page);
    await expect(page.locator(SIDEBAR_HEADER + "笔记本")).toBeVisible();
    await expect(page.locator('[data-testid="quick-note-button"]')).toHaveText(/快速笔记/);
  });

  test("switching back restores English", async () => {
    await page.locator('[data-testid="locale-toggle"]').click();
    await expect(page.locator(SIDEBAR_HEADER + "Notebooks")).toBeVisible();
    await expect(page.locator('[data-testid="quick-note-button"]')).toHaveText(/Quick note/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
