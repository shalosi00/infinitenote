import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachErrorCollector,
  expectCount,
  resetToSeed,
  sceneTypes,
  serializeCurrentPage,
} from "./helpers";

const FX = path.join(__dirname, "fixtures");

/**
 * Web Share Target (issue #247).
 *
 * The manifest declares POST /share-target; the service worker intercepts
 * the POST, stashes the payload in the IndexedDB mailbox and redirects to
 * /; on boot the app drains the mailbox and lands each share as a Quick
 * Notes page through the regular import pipeline.
 *
 * These tests exercise the REAL chain end to end: the page is SW-controlled
 * (same as an installed PWA), the POST goes through the SW fetch handler,
 * and the assertions run against the captured page's scene.
 */
test.describe.serial("web share target (issue #247)", () => {
  let page: Page;
  let consoleErrors: string[];

  interface ShareBody {
    title?: string;
    text?: string;
    url?: string;
    fileName?: string;
    fileType?: string;
    fileBase64?: string;
  }

  /** Fire the share-sheet POST exactly as the OS would (multipart form). */
  async function shareIntoApp(body: ShareBody): Promise<{ status: number; url: string; redirected: boolean }> {
    return page.evaluate(async (b) => {
      const fd = new FormData();
      if (b.title) fd.set("title", b.title);
      if (b.text) fd.set("text", b.text);
      if (b.url) fd.set("url", b.url);
      if (b.fileBase64) {
        const bytes = Uint8Array.from(atob(b.fileBase64), (c) => c.charCodeAt(0));
        fd.append("files", new File([bytes], b.fileName ?? "shared.png", { type: b.fileType ?? "image/png" }));
      }
      const res = await fetch("/share-target", { method: "POST", body: fd });
      return { status: res.status, url: res.url, redirected: res.redirected };
    }, body);
  }

  /** Reload so the boot drain imports whatever was shared, then settle. */
  async function reloadAndDrain(): Promise<void> {
    await page.reload();
    await page.locator('[data-testid="page-row"]').first().waitFor({ state: "visible", timeout: 30_000 });
  }

  function rowsByExactTitle(title: string) {
    return page.locator('[data-testid="page-row"]').filter({
      has: page.getByRole("button", { name: title, exact: true }),
    });
  }

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
    // The share sheet only exists for installed (SW-controlled) PWAs: wait
    // for the registration, then reload so THIS document is controlled —
    // a fetch POST only reaches the SW from a controlled document.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await reloadAndDrain();
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("a shared link+text is intercepted, redirected and captured as a titled quick note", async () => {
    const result = await shareIntoApp({
      title: "Field survey",
      text: "A note shared from the share sheet",
      url: "https://example.com/article",
    });
    // the SW answered the POST with 303 -> / (followed by fetch). The 303 is
    // synthesized INSIDE the service worker, so res.redirected stays false —
    // the interception is proven by the capture assertions below (a 404 from
    // the static server would stash nothing)
    expect(result.status).toBe(200);
    expect(new URL(result.url).pathname).toBe("/");

    await reloadAndDrain();

    // the shared title became the page title and the page is selected
    const row = rowsByExactTitle("Field survey");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-selected", "true");

    // body = text + url composed, imported as one text element on the page
    await expectCount(page, 1);
    await expect.poll(() => sceneTypes(page)).toContain("text");
    const serialized = await serializeCurrentPage(page);
    expect(serialized).toContain("A note shared from the share sheet");
    expect(serialized).toContain("https://example.com/article");
  });

  test("a shared image file lands as an image element on the captured page", async () => {
    const pngBase64 = readFileSync(path.join(FX, "test-image.png"), "base64");
    const result = await shareIntoApp({
      title: "Snapshot",
      fileBase64: pngBase64,
      fileName: "gallery-shot.png",
      fileType: "image/png",
    });
    expect(result.status).toBe(200);

    await reloadAndDrain();

    const row = rowsByExactTitle("Snapshot");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-selected", "true");
    await expectCount(page, 1);
    await expect.poll(() => sceneTypes(page)).toContain("image");
  });

  test("a URL-only share still captures the link under the dated fallback title", async () => {
    const result = await shareIntoApp({ url: "https://example.com/just-a-link" });
    expect(result.status).toBe(200);

    await reloadAndDrain();

    // no shared title → the regular dated quick-note title
    const row = page
      .locator('[data-testid="page-row"]')
      .filter({ hasText: /Quick note \d{4}-\d{2}-\d{2} \d{2}:\d{2}/ })
      .first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-selected", "true");
    await expectCount(page, 1);
    expect(await serializeCurrentPage(page)).toContain("https://example.com/just-a-link");
  });

  test("two shares stashed before one reload become two pages, in order", async () => {
    await shareIntoApp({ title: "First share", text: "body one" });
    await shareIntoApp({ title: "Second share", text: "body two" });

    await reloadAndDrain();

    // both captured; the LAST stashed share owns the selection (the drain
    // walks the mailbox in stash order and createQuickNote selects each)
    await expect(rowsByExactTitle("First share")).toHaveCount(1);
    await expect(rowsByExactTitle("Second share")).toHaveCount(1);
    await expect(rowsByExactTitle("Second share")).toHaveAttribute("data-selected", "true");
    await expectCount(page, 1);
    expect(await serializeCurrentPage(page)).toContain("body two");
  });
});
