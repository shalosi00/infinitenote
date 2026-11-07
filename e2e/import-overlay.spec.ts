/**
 * The full import matrix on ONE canvas (issue #68): import every supported
 * file type in a single batch, then write and draw over all of it.
 *
 * This is the integration sibling of e2e/imports.spec.ts (which imports one
 * type at a time): it proves the whole promise of the app — any file lands
 * on the same infinite canvas, and ink + text go on top of everything.
 *
 * Expected element budget (from the per-type counts verified in
 * imports.spec.ts + audio.spec.ts):
 *   image 1 · txt 1 · md 1 · PDF printout 2 · .excalidraw scene 2
 *   · .docx 10 · OneNote HTML 9 · OneNote .mht 9 (7 text + 2 images)
 *   · audio 1  =  36 elements in one batch.
 */
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
  setActiveTool,
  serializeCurrentPage,
} from "./helpers";

const FX = path.join(__dirname, "fixtures");

test.describe.serial("import matrix: every file type on one canvas + ink on top", () => {
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

  test("imports every supported file type in one batch", async () => {
    await page.setInputFiles('input[aria-label="Import files"]', [
      path.join(FX, "test-image.png"), // image
      path.join(FX, "test-notes.txt"), // plain text
      path.join(FX, "test-notes.md"), // markdown
      path.join(FX, "test.pdf"), // PDF printout (2 pages)
      path.join(FX, "test-scene.excalidraw"), // scene
      path.join(FX, "onenote-export.docx"), // Word
      path.join(FX, "onenote-page.html"), // OneNote HTML
      path.join(FX, "onenote-page.mht"), // OneNote .mht
      path.join(FX, "test-audio.wav"), // audio (issue #67)
    ]);
    await expectCount(page, 36, 90_000);
  });

  test("the single canvas carries every imported kind", async () => {
    const types = await sceneTypes(page);
    expect(types).toContain("image"); // png + PDF printout + .mht images
    expect(types).toContain("text"); // txt + md + docx + html + mht text
    expect(types).toContain("embeddable"); // audio block
    // the serialized scene carries the audio payload alongside image binaries
    const serialized = JSON.parse(await serializeCurrentPage(page)) as {
      elements: Array<{ type: string }>;
      files: Record<string, unknown>;
    };
    expect(serialized.elements).toHaveLength(36);
    expect(Object.keys(serialized.files).length).toBeGreaterThanOrEqual(5); // png + 2 pdf pages + 2 mht images
  });

  test("draws ink over the imported content with real mouse input", async () => {
    await setActiveTool(page, "freedraw");
    const box = await page.locator(".excalidraw").boundingBox();
    expect(box).toBeTruthy();
    // A long zigzag stroke across the imported stack. NOTE: the stroke must
    // start right of Excalidraw's floating Shapes island — the panel overlays
    // the left-center of the canvas container and swallows pointer events.
    await page.mouse.move(box!.x + box!.width * 0.45, box!.y + box!.height * 0.5);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(
        box!.x + box!.width * (0.45 + 0.05 * i),
        box!.y + box!.height * (0.5 + (i % 2 === 0 ? 0.06 : -0.06)),
      );
    }
    await page.mouse.up();
    await setActiveTool(page, "selection");
    await expectCount(page, 37); // 36 imported + 1 freedraw stroke ON TOP
    expect(await sceneTypes(page)).toContain("freedraw");
  });

  test("types an annotation on top of the imported content", async () => {
    await setActiveTool(page, "text");
    // click right of the Shapes island, then type (createTextElement's 0.35
    // x-ratio can land on the island on a busy canvas)
    const box = await page.locator(".excalidraw").boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.click(box!.x + box!.width * 0.6, box!.y + box!.height * 0.75);
    const editor = page.locator(".excalidraw textarea").last();
    await editor.waitFor({ state: "visible", timeout: 10_000 });
    await page.keyboard.type("annotated over everything", { delay: 20 });
    await page.keyboard.press("Escape");
    await setActiveTool(page, "selection");
    await expectCount(page, 38);
    const scene = JSON.parse(await serializeCurrentPage(page)) as {
      elements: Array<{ type: string; text?: string }>;
    };
    const note = scene.elements.find((e) => e.type === "text" && e.text === "annotated over everything");
    expect(note).toBeTruthy();
  });

  test("the full mixed scene persists across a reload", async () => {
    await saveNow(page);
    await page.reload();
    await openPage(page, "Page 2");
    await expectCount(page, 38);
    // the imported stack is taller than the viewport — fit it so the audio
    // block (bottom of the stack) enters view and Excalidraw mounts its
    // embeddable player again
    await page.evaluate(() =>
      window.__NOTE_E2E__?.excalidraw.scrollToContent(undefined, { fitToViewport: true }),
    );
    await expect(page.locator('[data-testid="audio-player"]')).toHaveCount(1);
    const types = await sceneTypes(page);
    for (const expected of ["image", "text", "embeddable", "freedraw"]) {
      expect(types).toContain(expected);
    }
  });
});
