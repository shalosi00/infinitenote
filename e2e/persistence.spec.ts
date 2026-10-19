import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  createTextElement,
  drawRectangleOnCanvas,
  expectCount,
  openPage,
  resetToSeed,
  saveNow,
  setActiveTool,
} from "./helpers";

test.describe.serial("persistence: autosave, reload, page switching", () => {
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

  test("content autosaves and survives a reload", async () => {
    await setActiveTool(page, "rectangle");
    await drawRectangleOnCanvas(page);
    await setActiveTool(page, "text");
    await createTextElement(page, "Hello E2E");
    await setActiveTool(page, "selection");
    await expectCount(page, 4);

    await saveNow(page);
    await expect(page.getByTestId("save-indicator")).toContainText("Saved");

    await page.reload();
    await expectCount(page, 4);
  });

  test("switching pages swaps scenes and flushes pending saves", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0); // fresh "Page 2" is empty

    await openPage(page, "Start here");
    await expectCount(page, 4); // previous scene restored
  });
});
