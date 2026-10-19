import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachErrorCollector,
  createTextElement,
  drawRectangleOnCanvas,
  expectCount,
  resetToSeed,
  sceneTypes,
  setActiveTool,
} from "./helpers";

test.describe.serial("canvas: drawing and typing with real input", () => {
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

  test("draws a rectangle with real mouse input", async () => {
    await setActiveTool(page, "rectangle");
    await drawRectangleOnCanvas(page);
    await setActiveTool(page, "selection");
    await expectCount(page, 3); // 2 seeded + 1 rectangle
  });

  test("creates a text element by typing", async () => {
    await setActiveTool(page, "text");
    await createTextElement(page, "Hello E2E");
    await setActiveTool(page, "selection");
    await expectCount(page, 4); // ... + 1 text
  });

  test("scene now mixes text and rectangle elements", async () => {
    const types = await sceneTypes(page);
    expect(types).toContain("rectangle");
    expect(types).toContain("text");
  });
});
