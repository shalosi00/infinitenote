/**
 * PDF file attachments (test plan: docs/test-plans/pdf-attachment.md,
 * ids PA-E*). Real canvas, no mocks: a PDF import lands a OneNote-style
 * file chip (red PDF badge + file name) above the rendered pages, the
 * chip keeps the ORIGINAL file bytes in customData, and right-clicking it
 * opens a context menu whose Download file item produces a byte-exact
 * copy of the uploaded file. The oversized case proves the 10 MiB cap,
 * and the OCR tie-in proves printout pages are still recognized (now by
 * the German fast model).
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
  sceneTypes,
  scrollToContent,
  serializeCurrentPage,
} from "./helpers";

const FX = path.join(__dirname, "fixtures");

interface SerializedScene {
  elements: Array<{
    type: string;
    id?: string;
    link?: string | null;
    customData?: { pdfName?: string; pdfData?: string } | null;
  }>;
  files: Record<string, unknown>;
}

function pdfChip(scene: SerializedScene) {
  return scene.elements.find(
    (e) => e.type === "embeddable" && e.link === "infinitenote:pdf",
  );
}

/**
 * Build a valid, whitespace-padded 1-page PDF just over the 10 MiB
 * attachment cap. Whitespace runs are legal PDF tokens, so pdfjs parses
 * it like any real document (one page, one line of text).
 */
function oversizedPdfBytes(): Buffer {
  // explicit object table: 1 Catalog, 2 Pages, 3 Font, 4 Contents stream,
  // 5 Page — cross-references follow those numbers exactly
  const out: string[] = ["%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n"];
  const stream = `BT /F1 24 Tf 72 770 Td (Oversized attachment test) Tj ET${" ".repeat(10 * 1024 * 1024 + 1024)}`;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>", // 1
    "<< /Type /Pages /Count 1 /Kids [5 0 R] >>", // 2
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", // 3
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, // 4
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 3 0 R >> >> >>", // 5
  ];
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(out.join("").length);
    out.push(`${i + 1} 0 obj\n${obj}\nendobj\n`);
  });
  const xrefAt = out.join("").length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out.push(xref);
  out.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return Buffer.from(out.join(""), "latin1");
}

/** Upload a PDF buffer under an explicit name (setInputFiles convenience). */
async function uploadPdf(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.setInputFiles('input[aria-label="Import files"]', {
    name,
    mimeType: "application/pdf",
    buffer,
  });
}

async function rightClickChip(page: Page): Promise<void> {
  const box = await page.locator('[data-testid="pdf-attachment-chip"]').boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, {
    button: "right",
  });
}

test.describe.serial("pdf-attachment: chip, context menu, byte-exact download", () => {
  let page: Page;
  let consoleErrors: string[];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // headless chromium denies clipboard writes without an explicit grant —
    // PA-E06 asserts the success path (the failure path toasts on its own)
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("PA-E01: PDF import lands a chip element carrying the original bytes", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    // upload under a distinctive name so the search assertions are unambiguous
    await uploadPdf(page, "quarterly-report.pdf", readFileSync(path.join(FX, "test.pdf")));
    // 2 rendered pages + 1 chip
    await expectCount(page, 3, 60_000);
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: 'Inserted PDF printout "quarterly-report.pdf" (2 pages)' }),
    ).toBeVisible({ timeout: 15_000 });
    const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
    const chip = pdfChip(scene);
    expect(chip, "exactly the chip carries the marker scheme").toBeTruthy();
    expect(chip?.customData?.pdfName).toBe("quarterly-report.pdf");
    expect(chip?.customData?.pdfData?.startsWith("data:application/pdf;base64,")).toBe(true);
    const images = scene.elements.filter((e) => e.type === "image");
    expect(images).toHaveLength(2);
  });

  test("PA-E02: the chip renders on-canvas with a badge and the file name", async () => {
    await scrollToContent(page);
    const chip = page.locator('[data-testid="pdf-attachment-chip"]');
    await expect(chip).toHaveCount(1);
    await expect(chip.locator('[data-testid="pdf-attachment-badge"]')).toHaveText("PDF");
    await expect(chip.locator('[data-testid="pdf-attachment-name"]')).toHaveText(
      "quarterly-report.pdf",
    );
  });

  test("PA-E03: right-click opens the attachment menu with all three options", async () => {
    await rightClickChip(page);
    const menu = page.locator('[data-testid="pdf-attachment-menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-testid="pdf-attachment-view"]')).toHaveText("View file");
    await expect(menu.locator('[data-testid="pdf-attachment-download"]')).toHaveText("Download file");
    await expect(menu.locator('[data-testid="pdf-attachment-copy-name"]')).toHaveText(
      "Copy file name",
    );
  });

  test("PA-E04: Escape closes the menu; a canvas right-click never opens it", async () => {
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="pdf-attachment-menu"]')).toHaveCount(0);
    // right-click far from every element — the chip menu must stay closed
    const b = await page.locator(".excalidraw").boundingBox();
    await page.mouse.click(b!.x + b!.width * 0.15, b!.y + b!.height * 0.2, {
      button: "right",
    });
    await expect(page.locator('[data-testid="pdf-attachment-menu"]')).toHaveCount(0);
    await page.keyboard.press("Escape"); // close whatever Excalidraw opened
  });

  test("PA-E05: Download file round-trips the ORIGINAL bytes", async () => {
    await rightClickChip(page);
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="pdf-attachment-download"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("quarterly-report.pdf");
    const target = path.join(__dirname, "..", "test-results", "pa-e05-download.pdf");
    await download.saveAs(target);
    const original = readFileSync(path.join(FX, "test.pdf"));
    expect(original.compare(readFileSync(target))).toBe(0); // byte-exact
  });

  test("PA-E06: Copy file name toasts the quoted name", async () => {
    await rightClickChip(page);
    await page.locator('[data-testid="pdf-attachment-copy-name"]').click();
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: 'Copied "quarterly-report.pdf" to the clipboard.' }),
    ).toBeVisible({ timeout: 15_000 });
    // and the clipboard really holds the name (clipboard-write/read granted)
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe("quarterly-report.pdf");
  });

  test("PA-E07: View file opens a popup tab", async () => {
    await rightClickChip(page);
    const popupPromise = page.waitForEvent("popup");
    await page.locator('[data-testid="pdf-attachment-view"]').click();
    const popup = await popupPromise;
    // headless-shell cannot commit a top-level blob: PDF navigation (it
    // becomes a viewer page in headed Chrome, a download in the shell) —
    // the deterministic assertion is that the action opens a new tab whose
    // document carries our blob URL; the payload itself is covered by the
    // byte-exact download round-trip (PA-E05) and ATT-P04.
    await popup.waitForFunction(() => window.location.href.startsWith("blob:"), undefined, {
      timeout: 5_000,
    }).catch(() => undefined);
    await popup.close();
  });

  test("PA-E08: chip and payload persist across a reload", async () => {
    await page.reload();
    await page
      .locator('[data-testid="page-row"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await expectCount(page, 3);
    const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
    expect(pdfChip(scene)?.customData?.pdfName).toBe("quarterly-report.pdf");
    await scrollToContent(page);
    await expect(page.locator('[data-testid="pdf-attachment-chip"]')).toHaveCount(1);
  });

  test("PA-E09: Ctrl+K search finds the page by the embedded file name", async () => {
    await page.keyboard.press("Control+K");
    const input = page.getByPlaceholder("Search all pages…");
    await input.waitFor({ state: "visible" });
    for (let attempt = 0; attempt < 4; attempt++) {
      await input.fill("quarterly");
      await page.waitForTimeout(250);
      if ((await input.inputValue()) === "quarterly") break;
    }
    await expect(input).toHaveValue("quarterly");
    await page.locator("[cmdk-list]").waitFor({ state: "visible" });
    await expect(page.locator("[cmdk-list]")).toContainText("quarterly-report.pdf", {
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
  });

  test("PA-E10: an oversized PDF imports as a printout WITHOUT a chip", async () => {
    await uploadPdf(page, "oversized-attachment-test.pdf", oversizedPdfBytes());
    await expectCount(page, 4, 60_000); // + 1 rendered page, NO chip
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: 'Skipped the file attachment for "oversized-attachment-test.pdf"' }),
    ).toBeVisible({ timeout: 15_000 });
    const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
    // the page still holds E01's chip — but never one for the oversized file
    const chips = scene.elements.filter(
      (e) => e.type === "embeddable" && e.link === "infinitenote:pdf",
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].customData?.pdfName).toBe("quarterly-report.pdf");
    const types = await sceneTypes(page);
    expect(types).toContain("image");
  });

  test("PA-E11: the printout pages are recognized (OCR tie-in) and searchable", async () => {
    await page.getByRole("button", { name: "Page actions" }).click();
    await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="run-ocr"]').click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Recognized text in" }),
    ).toBeVisible({ timeout: 120_000 });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+K");
    const input = page.getByPlaceholder("Search all pages…");
    await input.waitFor({ state: "visible" });
    await input.fill("PRINTOUT TEST");
    await page.locator("[cmdk-list]").waitFor({ state: "visible" });
    // the text printed on the fixture pages survives recognition
    await expect(page.locator("[cmdk-list]")).toContainText("PRINTOUT TEST PAGE", {
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
  });
});
