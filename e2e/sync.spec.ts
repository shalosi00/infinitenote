import { expect, test, type Download, type Page } from "@playwright/test";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { attachErrorCollector, openPage, resetToSeed } from "./helpers";

/**
 * E2E for file-based sync phase 1 (issue #37): the ZIP transport.
 * The File System Access folder flow needs a real directory picker and is
 * covered by unit tests + manual runbook; everything merge-related is
 * transport-agnostic and exercised here through the ZIP path.
 */

/** Open the sync dialog from the sidebar footer. */
async function openSyncDialog(page: Page): Promise<void> {
  await page.locator('[data-testid="sync-button"]').click();
  await page.locator('[data-testid="sync-dialog"]').waitFor({ state: "visible" });
}

/**
 * Click "Download sync ZIP", read the download and unzip it.
 *
 * The waiter is armed before each click and re-armed per retry: under a
 * loaded runner the click inside the open dialog was once silently dropped
 * (waitForEvent("download") ran its full 20s with no event, observed on a
 * memory-constrained dev-server run). A slow-but-real first click simply
 * wins the race, a swallowed one is retried — and if no download ever
 * arrives the assertion below still fails loudly (#152 style).
 */
async function exportAndReadZip(page: Page): Promise<Record<string, string>> {
  let download: Download | null = null;
  for (let attempt = 0; attempt < 3 && !download; attempt++) {
    const waiter = page
      .waitForEvent("download", { timeout: 8_000 })
      .then((d) => {
        download = d;
      })
      .catch(() => {});
    await page.locator('[data-testid="sync-export-zip"]').click();
    await waiter;
  }
  expect(download, "sync ZIP download event").toBeTruthy();
  expect(download!.suggestedFilename()).toMatch(/^infinitenote-sync-\d{4}-\d{2}-\d{2}\.zip$/);
  const path = await download!.path();
  expect(path, "downloaded zip path").toBeTruthy();
  const bytes = new Uint8Array(await (await import("node:fs/promises")).readFile(path!));
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    if (name.endsWith("/")) continue;
    out[name] = strFromU8(data);
  }
  return out;
}

/** Zip a folder file map and hand it to the import input. */
async function importZip(page: Page, files: Record<string, string>): Promise<void> {
  const zipped = zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
  );
  await page.locator('[data-testid="sync-zip-input"]').setInputFiles({
    name: "sync.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipped),
  });
}

/** Manifest shape used to craft foreign folders in tests. */
interface Manifest {
  app: "infinitenote";
  format: "sync-folder";
  version: 1;
  exportedAt: number;
  notebooks: Array<{ id: string; name: string; color: string; order: number; createdAt: number; updatedAt: number }>;
  sections: Array<{ id: string; notebookId: string; name: string; order: number; createdAt: number; updatedAt: number }>;
  pages: Array<{ id: string; sectionId: string; title: string; order: number; createdAt: number; updatedAt: number }>;
}

test.describe.serial("file-based sync via ZIP (issue #37)", () => {
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

  test("exports a valid sync folder as a ZIP", async () => {
    await openSyncDialog(page);
    const files = await exportAndReadZip(page);

    const manifest = JSON.parse(files["manifest.json"]) as Manifest;
    expect(manifest.app).toBe("infinitenote");
    expect(manifest.format).toBe("sync-folder");
    expect(manifest.notebooks.length).toBeGreaterThan(0);
    expect(manifest.pages.length).toBeGreaterThan(0);
    expect(files["trash.jsonl"]).toBeDefined();
    // one page file per manifest page
    for (const p of manifest.pages) {
      expect(files[`pages/${p.id}.json`], `page file for ${p.id}`).toBeDefined();
    }
    await page.keyboard.press("Escape");
  });

  test("merges a foreign sync ZIP: new notebook/section/page appear", async () => {
    const t = Date.now();
    const manifest: Manifest = {
      app: "infinitenote",
      format: "sync-folder",
      version: 1,
      exportedAt: t,
      notebooks: [{ id: "e2e-nb-1", name: "From other device", color: "teal", order: 1, createdAt: t, updatedAt: t }],
      sections: [{ id: "e2e-sec-1", notebookId: "e2e-nb-1", name: "Shared", order: 1, createdAt: t, updatedAt: t }],
      pages: [{ id: "e2e-page-1", sectionId: "e2e-sec-1", title: "Remote page", order: 1, createdAt: t, updatedAt: t }],
    };
    await openSyncDialog(page);
    await importZip(page, {
      "manifest.json": JSON.stringify(manifest, null, 2),
      "pages/e2e-page-1.json": JSON.stringify({
        id: "e2e-page-1",
        sectionId: "e2e-sec-1",
        title: "Remote page",
        order: 1,
        createdAt: t,
        updatedAt: t,
        scene: { elements: [{ type: "rectangle", id: "r1" }], files: {} },
      }),
      "trash.jsonl": "",
    });

    await expect(page.locator('[data-testid="sync-summary"]')).toContainText(
      "1 notebook · 1 section · 1 page pulled · 1 notebook/section updated",
      { timeout: 20_000 }
    );
    // close the modal first — its overlay hides the sidebar from role queries
    await page.keyboard.press("Escape");
    // the pulled tree is visible: expand the imported notebook + section
    const nbButton = page.getByRole("button", { name: "From other device", exact: true });
    await expect(nbButton).toBeVisible();
    await nbButton.click(); // expand the notebook
    const secButton = page.getByRole("button", { name: "Shared", exact: true });
    await expect(secButton).toBeVisible();
    await secButton.click(); // expand the section
    await expect(page.getByRole("button", { name: "Remote page", exact: true })).toBeVisible();
  });

  test("concurrent edits create a conflict copy instead of losing work", async () => {
    // 1. export → this is the shared base both devices start from
    await openSyncDialog(page);
    const base = await exportAndReadZip(page);
    const manifest = JSON.parse(base["manifest.json"]) as Manifest;
    const target = manifest.pages[0];
    expect(base[`pages/${target.id}.json`]).toBeDefined();

    // 2. local edit: open the target page and rename it (bumps updatedAt)
    await page.keyboard.press("Escape");
    await openPage(page, target.title);
    await page.locator('button[title="Click to rename this page"]').click();
    const input = page.getByLabel("Page title");
    await input.fill("Local edit");
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="page-row"]', { hasText: "Local edit" })
    ).toBeVisible();

    // 3. remote edit: same page, different title, NEWER timestamp
    const t = Date.now() + 10_000;
    const remotePageFile = JSON.parse(base[`pages/${target.id}.json`]!);
    remotePageFile.title = "Remote edit wins";
    remotePageFile.updatedAt = t;
    const remoteManifest: Manifest = {
      ...manifest,
      exportedAt: t,
      pages: manifest.pages.map((p) =>
        p.id === target.id ? { ...p, title: "Remote edit wins", updatedAt: t } : p
      ),
    };

    // 4. merge → newer remote title wins, local rename survives as a dated copy
    await openSyncDialog(page);
    await importZip(page, {
      ...base,
      "manifest.json": JSON.stringify(remoteManifest, null, 2),
      [`pages/${target.id}.json`]: JSON.stringify(remotePageFile),
    });

    await expect(page.locator('[data-testid="sync-summary"]')).toContainText("1 conflict copy", {
      timeout: 20_000,
    });
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[data-testid="page-row"]', { hasText: "Remote edit wins" })
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="page-row"]', { hasText: "Local edit (conflict" })
    ).toBeVisible();
  });

  test("re-importing an unchanged ZIP is a no-op", async () => {
    await openSyncDialog(page);
    const files = await exportAndReadZip(page);
    await importZip(page, files);
    await expect(page.locator('[data-testid="sync-summary"]')).toHaveText(
      "Everything already in sync.",
      { timeout: 20_000 }
    );
    await page.keyboard.press("Escape");
  });

  test("a stale page file plus its tombstone does not resurrect the page", async () => {
    // Out-of-contract folder: pages/e2e-stale-page.json still exists while
    // trash.jsonl records the page's delete. Devices that never saw the page
    // must merge it as DELETED (restorable from trash), not resurrect it —
    // otherwise deleted pages flip-flop back alive on every fresh device.
    const t = Date.now();
    const manifest: Manifest = {
      app: "infinitenote",
      format: "sync-folder",
      version: 1,
      exportedAt: t,
      notebooks: [{ id: "e2e-nb-stale", name: "Stale folder", color: "teal", order: 1, createdAt: t, updatedAt: t }],
      sections: [{ id: "e2e-sec-stale", notebookId: "e2e-nb-stale", name: "Ghosted", order: 1, createdAt: t, updatedAt: t }],
      pages: [],
    };
    await openSyncDialog(page);
    await importZip(page, {
      "manifest.json": JSON.stringify(manifest, null, 2),
      "pages/e2e-stale-page.json": JSON.stringify({
        id: "e2e-stale-page",
        sectionId: "e2e-sec-stale",
        title: "Stale page",
        order: 1,
        createdAt: t,
        updatedAt: t,
        scene: { elements: [{ type: "rectangle", id: "r1" }], files: {} },
      }),
      "trash.jsonl": `${JSON.stringify({ id: "e2e-stale-page", kind: "page", at: t + 1000, purged: false, title: "Stale page" })}\n`,
    });

    // the notebook/section arrive; the page lands in the trash, not the tree
    await expect(page.locator('[data-testid="sync-summary"]')).toContainText(
      "1 item moved to trash",
      { timeout: 20_000 }
    );
    await page.keyboard.press("Escape");

    const nbButton = page.getByRole("button", { name: "Stale folder", exact: true });
    await expect(nbButton).toBeVisible();
    await nbButton.click();
    const secButton = page.getByRole("button", { name: "Ghosted", exact: true });
    await expect(secButton).toBeVisible();
    await secButton.click();
    await expect(page.getByRole("button", { name: "Stale page", exact: true })).toHaveCount(0);

    // …and it is restorable from the trash (the stale content survived)
    await page.getByRole("button", { name: "Trash" }).click();
    await expect(page.getByRole("dialog")).toContainText("Stale page (page)");
    await page.keyboard.press("Escape");
  });
});
