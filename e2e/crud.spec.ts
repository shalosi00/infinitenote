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
  serializeCurrentPage,
  setActiveTool,
} from "./helpers";

test.describe.serial("tree CRUD, rename, duplicate, export serialization", () => {
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

  test("creates a notebook → section → page chain", async () => {
    await page.getByRole("button", { name: "Add notebook" }).click();
    await expect(page.locator('[data-testid="notebook-row"]')).toHaveCount(3);

    await clickInNotebook(page, "Notebook 3", "Add section");
    await expect(page.getByTestId("sidebar")).toContainText("Section 1");

    await clickInNotebook(page, "Notebook 3", "Add page");
    await expectCount(page, 0); // the new page's canvas is empty
  });

  test("renames the page from the title bar", async () => {
    await page.locator('button[title="Click to rename this page"]').click();
    const input = page.getByLabel("Page title");
    await input.fill("Renamed E2E Page");
    await input.press("Enter");
    await expect(page.locator("body")).toContainText("Renamed E2E Page");
  });

  test("duplicates a page with its content", async () => {
    await openPage(page, "Start here");
    await expectCount(page, 2);

    await page.getByRole("button", { name: "Actions for page Start here" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();

    await expect(page.getByTestId("sidebar")).toContainText("Start here (copy)");
    await expectCount(page, 2); // scene content copied
  });

  test("exports the current scene with all content", async () => {
    await setActiveTool(page, "rectangle");
    await drawRectangleOnCanvas(page);
    await setActiveTool(page, "text");
    await createTextElement(page, "QUANTUMFROG");
    await setActiveTool(page, "selection");
    await expectCount(page, 4);

    const serialized = await serializeCurrentPage(page);
    expect(serialized).toContain('"elements"');
    expect(serialized).toContain("QUANTUMFROG");
    expect(serialized).toContain('"rectangle"');
  });
});
