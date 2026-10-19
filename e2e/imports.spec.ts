import path from "node:path";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  expectCount,
  openPage,
  resetToSeed,
  saveNow,
  sceneTypes,
  serializeCurrentPage,
} from "./helpers";

const FX = path.join(__dirname, "fixtures");

test.describe.serial("imports: image / text / PDF printout / scene", () => {
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

  test("starts from an empty new page", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
  });

  test("imports an image", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "test-image.png"),
    );
    await expectCount(page, 1);
    await expect.poll(() => sceneTypes(page)).toContain("image");
  });

  test("imports a text file as a wrapped text element", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "test-notes.txt"),
    );
    await expectCount(page, 2);
    await expect.poll(() => sceneTypes(page)).toContain("text");
  });

  test("imports a PDF as a printout (one image per page)", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "test.pdf"),
    );
    await expectCount(page, 4, 60_000); // 2 rendered PDF pages
  });

  test("imports a .excalidraw scene", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "test-scene.excalidraw"),
    );
    await expectCount(page, 6);
  });

  test("imports a Word document as structured text blocks", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "onenote-export.docx"),
    );
    await expectCount(page, 16); // 6 + 10 blocks (headings/lists/table)
  });

  test("imports a OneNote-exported HTML page", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "onenote-page.html"),
    );
    await expectCount(page, 25); // + 9 blocks
  });

  test("imports a OneNote .mht single-file page with its embedded images", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "onenote-page.mht"),
    );
    await expectCount(page, 34); // + 7 text blocks + 2 images
    const types = await sceneTypes(page);
    expect(types).toContain("text");
    expect(types).toContain("image");
    // the serialized scene carries the image binaries (dataURLs) for persistence
    const serialized = JSON.parse(await serializeCurrentPage(page)) as {
      elements: Array<{ type: string; fileId: string }>;
      files: Record<string, { dataURL?: string }>;
    };
    const imageEls = serialized.elements.filter((e) => e.type === "image");
    const fileIds = new Set<string>(imageEls.map((e) => e.fileId));
    expect(fileIds.size).toBeGreaterThanOrEqual(2);
    for (const id of fileIds) {
      expect(serialized.files[id]?.dataURL?.startsWith("data:image/png;base64,")).toBe(true);
    }
  });

  test("imports an HTML page with an inline data: image (Graph export style)", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "onenote-inline-image.html"),
    );
    await expectCount(page, 38); // + 3 text blocks + 1 image
  });

  test("imported content persists across a reload", async () => {
    await saveNow(page);
    await page.reload();
    await openPage(page, "Page 2");
    await expectCount(page, 38);
  });
});
