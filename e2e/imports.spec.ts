import path from "node:path";
import { readFileSync } from "node:fs";
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

  test("imports a PDF as a printout with its file chip", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "test.pdf"),
    );
    await expectCount(page, 5, 60_000); // 2 rendered PDF pages + 1 attachment chip
  });

  test("imports a .excalidraw scene", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "test-scene.excalidraw"),
    );
    await expectCount(page, 7); // + scene elements (with chip)
  });

  test("imports a Word document as structured text blocks", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "onenote-export.docx"),
    );
    await expectCount(page, 17); // 7 + 10 blocks (headings/lists/table)
  });

  test("imports a OneNote-exported HTML page", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "onenote-page.html"),
    );
    await expectCount(page, 26); // + 9 blocks
  });

  test("imports a OneNote .mht single-file page with its embedded images", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "onenote-page.mht"),
    );
    await expectCount(page, 35); // + 7 text blocks + 2 images
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
    await expectCount(page, 39); // + 3 text blocks + 1 image
  });

  test("drag-dropping an image inserts it exactly once, saved (issue #122)", async () => {
    // Synthetic drag-drop onto the canvas: Excalidraw's own drop handler
    // must not ALSO insert the first file natively — that duplicate used
    // to persist with status "pending" forever.
    const b64 = readFileSync(path.join(FX, "test-image.png"), "base64");
    await page.evaluate((data) => {
      const buf = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([buf], "dropped.png", { type: "image/png" }));
      const target = document.querySelector(".excalidraw") || document.body;
      target.dispatchEvent(
        new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
      target.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
    }, b64);
    await expectCount(page, 40); // + 1 image — exactly ONE insert
    const serialized = JSON.parse(await serializeCurrentPage(page)) as {
      elements: Array<{ type: string; status?: string }>;
    };
    const images = serialized.elements.filter((e) => e.type === "image");
    expect(images.length).toBeGreaterThanOrEqual(1);
    // every persisted image is "saved" once its file data is registered
    for (const img of images) {
      expect(img.status, "imported images must not persist as pending").toBe("saved");
    }
  });

  test("imported content persists across a reload", async () => {
    await saveNow(page);
    await page.reload();
    await openPage(page, "Page 2");
    await expectCount(page, 40);
  });
});
