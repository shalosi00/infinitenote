import path from "node:path";
import * as fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  createTextElement,
  drawRectangleOnCanvas,
  expectCount,
  notebookNode,
  openPage,
  resetToSeed,
  saveNow,
  sceneTypes,
  serializeCurrentPage,
  setActiveTool,
} from "./helpers";

/**
 * Import/export round-trips — the "last mile" of the transfer surface.
 *
 * The per-format import specs (imports.spec, import-overlay.spec, audio.spec,
 * import-pdf-truncation.spec) prove every format LANDS on the canvas, and
 * pdf-export.spec / export-filename.spec prove PDF content and export
 * filenames. What no spec proved yet:
 *
 *   1. PNG/SVG exports are real files with real content (only their
 *      filenames were ever asserted).
 *   2. An exported .excalidraw scene imports back — the only user-visible
 *      scene round-trip that matters (share a page, reopen it elsewhere).
 *   3. The full backup downloads, survives a wiped device, and restores the
 *      library through the actual UI (the disaster-recovery path; only the
 *      db-level unit round-trip existed).
 *   4. A non-backup JSON restore surfaces the friendly error toast.
 *
 * Everything here goes through real user actions: menu clicks, real
 * downloads, real file inputs.
 */

const FX = path.join(__dirname, "fixtures");
const MARKER = "ROUNDTRIPMARKER";

/** Shape of a .excalidraw scene file (subset this spec asserts on). */
interface SceneFile {
  elements: Array<{ type: string; text?: string; fileId?: string }>;
  files: Record<string, { dataURL?: string }>;
}

/** Shape of a full backup JSON (subset this spec asserts on). */
interface BackupFile {
  app: string;
  notebooks: Array<{
    name: string;
    sections: Array<{ name: string; pages: Array<{ title: string; content: string | null }> }>;
  }>;
}

/** Click Export → menu item, wait for the download, read its bytes. */
async function exportViaMenu(
  page: Page,
  menuItem: RegExp,
): Promise<{ name: string; bytes: Buffer; path: string }> {
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: menuItem }).click();
  const download = await downloadPromise;
  const p = await download.path();
  if (!p) throw new Error("download produced no file");
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(p), path: p };
}

/** Rename the open page through the title bar. */
async function renameOpenPage(page: Page, title: string): Promise<void> {
  await page.locator('button[title="Click to rename this page"]').click();
  const input = page.getByLabel("Page title");
  await input.fill(title);
  await input.press("Enter");
}

test.describe.serial("import/export round-trips: PNG, SVG, scene file, full backup", () => {
  let page: Page;
  let consoleErrors: string[];

  // carried between the serial tests
  let scenePath = "";
  let backupPath = "";
  let backupName = "";
  let expectedRestoredPages = 0;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("builds a mixed-content page: drawn shape + typed text + imported image", async () => {
    // a dedicated notebook keeps every later lookup unambiguous
    await page.getByRole("button", { name: "Add notebook" }).click();
    await clickInNotebook(page, "Notebook 3", "Add section");
    await clickInNotebook(page, "Notebook 3", "Add page");
    // let the title bar settle on the new page first — clicking rename during
    // the re-render lands on a node that unmounts before the event dispatch
    await expect(
      page.locator("main").getByRole("button", { name: "Page 1", exact: true }),
    ).toBeVisible();
    await expectCount(page, 0);
    await renameOpenPage(page, "Assets");
    await expect(
      page.locator("main").getByRole("button", { name: "Assets", exact: true }),
    ).toBeVisible();

    await setActiveTool(page, "rectangle");
    await drawRectangleOnCanvas(page);
    await setActiveTool(page, "text");
    await createTextElement(page, MARKER);
    await setActiveTool(page, "selection");
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "test-image.png"),
    );
    await expectCount(page, 3);
  });

  test("PNG export downloads a real PNG with sane dimensions", async () => {
    const { name, bytes } = await exportViaMenu(page, /PNG image/);
    expect(name).toBe("Assets.png");
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR: width/height at offsets 16/20, big-endian — the scale-2 export of
    // the scene bounds must carry the whole rectangle+text+image stack
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    expect(width).toBeGreaterThan(100);
    expect(height).toBeGreaterThan(100);
    // a rendered scene is never a blank stub
    expect(bytes.length).toBeGreaterThan(2_000);
  });

  test("SVG export downloads vector markup carrying the content", async () => {
    const { name, bytes } = await exportViaMenu(page, /SVG vector/);
    expect(name).toBe("Assets.svg");
    const svg = bytes.toString("utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("xmlns");
    // the typed text survives as a text node, not a screenshot
    expect(svg).toContain(MARKER);
    expect(bytes.length).toBeGreaterThan(1_000);
  });

  test("scene export serializes every element and the image payload", async () => {
    const { name, bytes, path: p } = await exportViaMenu(page, /Excalidraw scene/);
    expect(name).toBe("Assets.excalidraw");
    const scene = JSON.parse(bytes.toString("utf8")) as SceneFile;
    expect(scene.elements).toHaveLength(3);
    expect(scene.elements.map((e) => e.type)).toEqual(
      expect.arrayContaining(["rectangle", "text", "image"]),
    );
    expect(scene.elements.some((e) => e.type === "text" && e.text === MARKER)).toBe(true);
    // the imported image's binary rides along as a data URL
    const imageFile = scene.elements.find((e) => e.type === "image")?.fileId;
    expect(imageFile).toBeTruthy();
    expect(scene.files[imageFile!]?.dataURL?.startsWith("data:image/png;base64,")).toBe(true);
    scenePath = p;
  });

  test("the exported scene file imports back into another page (round-trip)", async () => {
    await clickInNotebook(page, "Notebook 3", "Add page"); // "Page 2"
    await expectCount(page, 0);
    // pass the downloaded file with its REAL name — classification keys on
    // the extension, and setInputFiles(path) would expose only Playwright's
    // extension-less artifact basename to the app
    await page.setInputFiles('input[aria-label="Import files"]', {
      name: "Assets.excalidraw",
      mimeType: "application/json",
      buffer: fs.readFileSync(scenePath),
    });
    await expectCount(page, 3);

    const types = await sceneTypes(page);
    expect(types).toContain("rectangle");
    expect(types).toContain("text");
    expect(types).toContain("image");

    const parsed = JSON.parse(await serializeCurrentPage(page)) as SceneFile;
    expect(parsed.elements.some((e) => e.type === "text" && e.text === MARKER)).toBe(true);
    const img = parsed.elements.find((e) => e.type === "image");
    expect(img?.fileId).toBeTruthy();
    expect(parsed.files[img!.fileId!]?.dataURL?.startsWith("data:image/png;base64,")).toBe(true);

    // the round-tripped scene persists
    await saveNow(page);
    await page.reload();
    await openPage(page, "Page 2");
    await expectCount(page, 3);
  });

  test("full backup export captures the whole library, content included", async () => {
    // make sure both pages' content is flushed to IndexedDB first
    await openPage(page, "Assets");
    await saveNow(page);

    const { name, bytes, path: p } = await exportViaMenu(page, /Full backup/);
    expect(name).toMatch(/^infinitenote-backup-\d{4}-\d{2}-\d{2}\.json$/);
    backupName = name;
    const backup = JSON.parse(bytes.toString("utf8")) as BackupFile;
    expect(backup.app).toBe("infinitenote");

    const nb = backup.notebooks.find((n) => n.name === "Notebook 3");
    expect(nb, "the created notebook is in the backup").toBeTruthy();
    const titles = nb!.sections.flatMap((s) => s.pages.map((pg) => pg.title));
    expect(titles).toEqual(expect.arrayContaining(["Assets", "Page 2"]));

    const pages = nb!.sections.flatMap((s) => s.pages);
    const assets = pages.find((pg) => pg.title === "Assets");
    expect(assets?.content, "the Assets scene is in the backup").toContain(MARKER);
    const page2 = pages.find((pg) => pg.title === "Page 2");
    expect(page2?.content, "the round-tripped scene is in the backup").toContain(MARKER);

    expectedRestoredPages = backup.notebooks.reduce(
      (sum, n) => sum + n.sections.reduce((s, sec) => s + sec.pages.length, 0),
      0,
    );
    expect(expectedRestoredPages).toBeGreaterThanOrEqual(5); // 3 seed + our 2
    backupPath = p;
  });

  test("a wiped app restores the library from the downloaded backup", async () => {
    // simulate a fresh device: IndexedDB erased, welcome seed re-created
    await resetToSeed(page);
    await expect(page.getByTestId("sidebar")).not.toContainText("Notebook 3");

    // restore through the real UI: Import menu → "Restore backup (.json)"
    // (the restore entry lives under the Import menu's "Library" section)
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: /Restore backup/ }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      // the real downloaded filename — setInputFiles(path)/setFiles(path)
      // would expose only Playwright's extension-less artifact basename
      name: backupName,
      mimeType: "application/json",
      buffer: fs.readFileSync(backupPath),
    });

    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: `Restored backup — ${expectedRestoredPages} pages imported.` }),
    ).toBeVisible({ timeout: 20_000 });

    // the restored notebook is back in the tree (collapsed — new ids)
    const nb = notebookNode(page, "Notebook 3");
    await expect(page.locator('[data-testid="notebook-row"]').filter({ hasText: "Notebook 3" })).toBeVisible();
    await nb.getByRole("button", { name: "Notebook 3", exact: true }).click(); // expand notebook
    await nb.getByRole("button", { name: "Section 1", exact: true }).click(); // expand section

    // and the content survived the disk round-trip
    await openPage(page, "Assets");
    await expectCount(page, 3);
    expect(await serializeCurrentPage(page)).toContain(MARKER);
  });

  test("restoring a non-backup JSON surfaces the friendly error toast", async () => {
    await page.setInputFiles('input[aria-label="Restore backup file"]', {
      name: "junk.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ app: "other", notebooks: [] })),
    });
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Could not restore that backup file." }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
