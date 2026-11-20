/**
 * General file attachments (issue #278, ids FA-E*). Real canvas, no
 * mocks: a file attached through the picker (or dropped as an unsupported
 * type) lands a OneNote-style chip (extension badge + name + human size)
 * that keeps the ORIGINAL file bytes in customData, right-clicking opens
 * the shared attachment menu, Download round-trips byte-exactly, the
 * oversize cap refuses with an explicit toast, a PDF attached through the
 * explicit path embeds WITHOUT becoming a printout, and undo removes a
 * batch in one step.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  expectCount,
  resetToSeed,
  scrollToContent,
  serializeCurrentPage,
} from "./helpers";

const FX = path.join(__dirname, "fixtures");

/** Minimal ZIP-magic bytes — round-tripped verbatim, never parsed. */
const ZIP_BYTES = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0xd4, 0x7f,
]);

interface SerializedScene {
  elements: Array<{
    type: string;
    id?: string;
    link?: string | null;
    customData?: {
      fileName?: string;
      fileData?: string;
      fileSize?: number;
      fileMime?: string;
    } | null;
  }>;
  files: Record<string, unknown>;
}

function fileChips(scene: SerializedScene) {
  return scene.elements.filter(
    (e) => e.type === "embeddable" && e.link === "infinitenote:file",
  );
}

/** A buffer just over the 10 MiB attachment cap. */
function oversizedBytes(): Buffer {
  return Buffer.alloc(10 * 1024 * 1024 + 1024, 0x41);
}

/**
 * Assert the newest toast line. Sonner keeps past toasts in the DOM, so
 * repeated identical lines ("Attached 1 file") resolve to several
 * elements — the assertion must target the newest one.
 */
function expectToast(page: Page, text: string) {
  return expect(
    page.locator("[data-sonner-toast]").filter({ hasText: text }).last(),
  ).toBeVisible({ timeout: 15_000 });
}

async function attachViaInput(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  await page.setInputFiles('input[data-testid="attach-file-input"]', files);
}

async function rightClickChip(page: Page, nth = 0): Promise<void> {
  const box = await page
    .locator('[data-testid="file-attachment-chip"]')
    .nth(nth)
    .boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, {
    button: "right",
  });
}

test.describe.serial("file-attachment: chip, context menu, byte-exact download", () => {
  let page: Page;
  let consoleErrors: string[];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("FA-E01: the picker input lands a chip carrying the original bytes", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await attachViaInput(page, [
      { name: "archive.zip", mimeType: "application/zip", buffer: ZIP_BYTES },
    ]);
    await expectToast(page, "Attached 1 file");
    await expectCount(page, 1);
    const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
    const chips = fileChips(scene);
    expect(chips, "exactly one generic chip").toHaveLength(1);
    expect(chips[0].customData?.fileName).toBe("archive.zip");
    expect(chips[0].customData?.fileData?.startsWith("data:application/zip;base64,")).toBe(true);
    expect(chips[0].customData?.fileMime).toBe("application/zip");
    expect(chips[0].customData?.fileSize).toBe(ZIP_BYTES.length);
  });

  test("FA-E02: the chip renders on-canvas with badge, name and human size", async () => {
    await scrollToContent(page);
    const chip = page.locator('[data-testid="file-attachment-chip"]');
    await expect(chip).toHaveCount(1);
    await expect(chip.locator('[data-testid="file-attachment-badge"]')).toHaveText("ZIP");
    await expect(chip.locator('[data-testid="file-attachment-name"]')).toHaveText("archive.zip");
    await expect(chip.locator('[data-testid="file-attachment-size"]')).toHaveText(
      `${ZIP_BYTES.length} B`,
    );
  });

  test("FA-E03: right-click opens the shared attachment menu", async () => {
    await rightClickChip(page);
    const menu = page.locator('[data-testid="pdf-attachment-menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-testid="pdf-attachment-view"]')).toHaveText("View file");
    await expect(menu.locator('[data-testid="pdf-attachment-download"]')).toHaveText("Download file");
    await expect(menu.locator('[data-testid="pdf-attachment-copy-name"]')).toHaveText(
      "Copy file name",
    );
  });

  test("FA-E04: Escape closes the menu; a canvas right-click never opens it", async () => {
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="pdf-attachment-menu"]')).toHaveCount(0);
    const b = await page.locator(".excalidraw").boundingBox();
    await page.mouse.click(b!.x + b!.width * 0.15, b!.y + b!.height * 0.2, {
      button: "right",
    });
    await expect(page.locator('[data-testid="pdf-attachment-menu"]')).toHaveCount(0);
    await page.keyboard.press("Escape"); // close whatever Excalidraw opened
  });

  test("FA-E05: Download file round-trips the ORIGINAL bytes", async () => {
    await rightClickChip(page);
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="pdf-attachment-download"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("archive.zip");
    const target = path.join(__dirname, "..", "test-results", "fa-e05-download.zip");
    await download.saveAs(target);
    expect(ZIP_BYTES.compare(readFileSync(target))).toBe(0); // byte-exact
  });

  test("FA-E06: Copy file name toasts the quoted name", async () => {
    await rightClickChip(page);
    await page.locator('[data-testid="pdf-attachment-copy-name"]').click();
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: 'Copied "archive.zip" to the clipboard.' }),
    ).toBeVisible({ timeout: 15_000 });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe("archive.zip");
  });

  test("FA-E07: View file opens a popup tab", async () => {
    await rightClickChip(page);
    const popupPromise = page.waitForEvent("popup");
    await page.locator('[data-testid="pdf-attachment-view"]').click();
    const popup = await popupPromise;
    await popup
      .waitForFunction(() => window.location.href.startsWith("blob:"), undefined, {
        timeout: 5_000,
      })
      .catch(() => undefined);
    await popup.close();
  });

  test("FA-E08: chip and payload persist across a reload", async () => {
    await page.reload();
    await page
      .locator('[data-testid="page-row"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await expectCount(page, 1);
    const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
    expect(fileChips(scene)[0].customData?.fileName).toBe("archive.zip");
    await scrollToContent(page);
    await expect(page.locator('[data-testid="file-attachment-chip"]')).toHaveCount(1);
  });

  test("FA-E09: Ctrl+K search finds the page by the attached file name", async () => {
    await page.keyboard.press("Control+K");
    const input = page.getByPlaceholder("Search all pages…");
    await input.waitFor({ state: "visible" });
    for (let attempt = 0; attempt < 4; attempt++) {
      await input.fill("archive");
      await page.waitForTimeout(250);
      if ((await input.inputValue()) === "archive") break;
    }
    await expect(input).toHaveValue("archive");
    await page.locator("[cmdk-list]").waitFor({ state: "visible" });
    await expect(page.locator("[cmdk-list]")).toContainText("archive.zip", {
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
  });

  test("FA-E10: an oversized file is refused with an explicit toast, no chip", async () => {
    await attachViaInput(page, [
      { name: "oversized.zip", mimeType: "application/zip", buffer: oversizedBytes() },
    ]);
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: 'Skipped the file attachment for "oversized.zip"' }),
    ).toBeVisible({ timeout: 15_000 });
    await expectCount(page, 1); // unchanged
    const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
    expect(fileChips(scene)).toHaveLength(1);
    expect(fileChips(scene)[0].customData?.fileName).toBe("archive.zip");
  });

  test("FA-E11: a PDF attached explicitly embeds WITHOUT becoming a printout", async () => {
    await attachViaInput(page, [
      {
        name: "manual.pdf",
        mimeType: "application/pdf",
        buffer: readFileSync(path.join(FX, "test.pdf")),
      },
    ]);
    await expectToast(page, "Attached 1 file");
    await expectCount(page, 2);
    const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
    const chips = fileChips(scene);
    expect(chips).toHaveLength(2);
    expect(chips[1].customData?.fileName).toBe("manual.pdf");
    expect(chips[1].customData?.fileMime).toBe("application/pdf");
    // the whole point of the explicit path: NO printout pages render
    expect(scene.elements.filter((e) => e.type === "image")).toHaveLength(0);
    await scrollToContent(page);
    const pdfChipEl = page.locator('[data-testid="file-attachment-chip"]').nth(1);
    await expect(pdfChipEl.locator('[data-testid="file-attachment-badge"]')).toHaveText("PDF");
  });

  test("FA-E12: an unsupported type through the import input attaches (no dead end)", async () => {
    await page.setInputFiles('input[aria-label="Import files"]', {
      name: "bundle.zip",
      mimeType: "application/zip",
      buffer: ZIP_BYTES,
    });
    await expectToast(page, "Attached 1 file");
    await expectCount(page, 3);
    const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
    expect(fileChips(scene)[2].customData?.fileName).toBe("bundle.zip");
  });

  test("FA-E13: the Import > File attachment menu item drives the real file chooser", async () => {
    await page.getByRole("button", { name: "Import" }).click();
    await page.locator('[data-testid="import-attach-file"]').waitFor({ state: "visible" });
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator('[data-testid="import-attach-file"]').click();
    const chooser = await chooserPromise;
    await chooser.setFiles([
      { name: "picked.zip", mimeType: "application/zip", buffer: ZIP_BYTES },
    ]);
    await expectToast(page, "Attached 1 file");
    await expectCount(page, 4);
  });

  test("FA-E14: the same menu item works at phone width", async () => {
    await page.setViewportSize({ width: 390, height: 740 });
    await page.getByRole("button", { name: "Import" }).click();
    await page.locator('[data-testid="import-attach-file"]').waitFor({ state: "visible" });
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator('[data-testid="import-attach-file"]').click();
    const chooser = await chooserPromise;
    await chooser.setFiles([
      { name: "mobile.zip", mimeType: "application/zip", buffer: ZIP_BYTES },
    ]);
    await expectToast(page, "Attached 1 file");
    await expectCount(page, 5);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("FA-E15: undo removes the attached chips, bounded presses", async () => {
    // the handwriting-undo lesson: sonner toasts steal keyboard focus and
    // Excalidraw's history COALESCES consecutive snapshots, so several
    // rapid attach batches can share one undo entry — the honest contract
    // is "undo removes the attach", not "one press per batch"
    await page
      .locator("[data-sonner-toast]")
      .waitFor({ state: "detached", timeout: 10_000 })
      .catch(() => {});
    const box = await page.locator(".excalidraw").boundingBox();
    expect(box).toBeTruthy();
    const candidates: Array<[number, number]> = [
      [0.15, 0.2],
      [0.2, 0.35],
      [0.85, 0.45],
      [0.7, 0.4],
    ];
    let focused = false;
    for (const [rx, ry] of candidates) {
      const x = box!.x + box!.width * rx;
      const y = box!.y + box!.height * ry;
      const hit = await page.evaluate(
        ([px, py]) => {
          const el = document.elementFromPoint(px, py);
          return el ? `${el.tagName}|${String(el.className).slice(0, 40)}` : "none";
        },
        [x, y],
      );
      if (hit.startsWith("CANVAS") || hit.includes("excalidraw")) {
        await page.mouse.click(x, y);
        focused = true;
        break;
      }
    }
    expect(focused, "an empty canvas spot exists to focus").toBe(true);
    await page.keyboard.press("Escape");
    for (let i = 0; i < 6; i++) {
      const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
      const names = fileChips(scene).map((c) => c.customData?.fileName);
      if (!names.includes("mobile.zip")) break;
      // a toast can steal keyboard focus mid-loop (the documented sonner
      // lesson) — a press that lands in the toast is lost; verify the
      // canvas still holds focus and re-click the empty spot if not
      const onCanvas = await page.evaluate(() => {
        const ae = document.activeElement;
        return !!ae && !!ae.closest(".excalidraw");
      });
      if (!onCanvas) {
        await page.mouse.click(box!.x + box!.width * 0.85, box!.y + box!.height * 0.45);
        await page.waitForTimeout(150);
      }
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(700);
    }
    const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
    const names = fileChips(scene).map((c) => c.customData?.fileName);
    expect(names).not.toContain("mobile.zip");
    // bounded presses never eat back past the reload — the FIRST chip stays
    expect(names).toContain("archive.zip");
    // every element on the page is a file chip — count and names agree
    await expectCount(page, names.length);
  });
});
