import { expect, test, type Page } from "@playwright/test";
import * as fs from "node:fs";
import { inflateSync } from "node:zlib";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Sub-pages (OneNote page hierarchy parity, issue #359) — wave 23.
 *
 * Seed layout (deterministic, from the welcome seed):
 *   Welcome Notebook (violet) / Getting Started / "Start here"
 *   Welcome Notebook (violet) / Ideas           / "Brainstorm"
 *   My Notebook     (teal)    / New Section      / "Page 1"
 *
 * OneNote's command ("right-click a page and then click Make subpage" —
 * support.microsoft.com) lands in the page kebab menu as the
 * keyboard/touch path; Promote raises one level. The sidebar renders the
 * section's pages in VISIBLE tree order with a data-depth marker per row;
 * trashing a parent cascades to its subpages (one timestamp) and
 * restoring the parent brings the family back; the section PDF export
 * follows the indented order (a subpage exports right after its parent).
 *
 * jsPDF runs with compress:true — every text assertion inflates the
 * FlateDecode streams first (node:zlib inflateSync).
 */

function pdfPageCount(bytes: Buffer): number {
  return (bytes.toString("latin1").match(/\/Type[\s]*\/Page[^s]/g) ?? []).length;
}

function pdfDecompressed(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  let out = raw;
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      out += "\n" + inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      // not a zlib stream (e.g. binary payload) — keep the raw bytes
    }
  }
  return out;
}

/** Inject a deterministic one-line text scene through the e2e hook. */
async function injectScene(page: Page, marker: string): Promise<void> {
  await page.evaluate((marker) => {
    const api = window.__NOTE_E2E__?.excalidraw as unknown as {
      updateScene: (scene: { elements: unknown[] }) => void;
    };
    if (!api) throw new Error("e2e hook missing");
    api.updateScene({
      elements: [
        {
          type: "text",
          id: `subp-e2e-${marker}`,
          x: 60,
          y: 60,
          width: 500,
          height: 25,
          text: `${marker} first line`,
          fontSize: 20,
          fontFamily: 1,
          textAlign: "left",
          verticalAlign: "top",
          strokeColor: "#1e1b4b",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 1,
          opacity: 100,
          angle: 0,
          seed: 1,
          version: 1,
          versionNonce: 1,
          isDeleted: false,
          boundElements: null,
          updated: 1,
          link: null,
          locked: false,
          groupIds: [],
          frameId: null,
          roundness: null,
          baseline: 18,
          lineHeight: 1.25,
          containerId: null,
          originalText: "",
          autoResize: true,
        },
      ],
    });
  }, marker);
}

const saveNow = (page: Page): Promise<void> =>
  page.evaluate(() => window.__NOTE_E2E__?.saveNow());

test.describe.serial("sub-pages (issue #359)", () => {
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

  const sectionRow = (name: string) =>
    page
      .locator('[data-testid="section-row"]')
      .filter({ has: page.getByRole("button", { name, exact: true }) })
      .last();

  const pageRow = (title: string) =>
    page
      .locator('[data-testid="page-row"]')
      .filter({ has: page.getByRole("button", { name: title, exact: true }) });

  /** The section's page rows in DOM (= visible tree) order, as [title, depth]. */
  const pageTree = async (): Promise<Array<[string, number]>> =>
    sectionRow("Getting Started")
      .locator('[data-testid="page-row"]')
      .evaluateAll((rows) =>
        rows.map((r) => [
          (r.querySelector("button span")?.textContent ?? "").trim(),
          Number(r.getAttribute("data-depth")),
        ]),
      );

  const openPageMenu = async (title: string): Promise<void> => {
    await pageRow(title).getByRole("button", { name: `Actions for page ${title}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).waitFor({ state: "visible" });
  };

  const closeMenus = async (): Promise<void> => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
  };

  test("SUBP-01: Make subpage indents the page under its previous sibling", async () => {
    // a fresh page in the seeded section lands at the top level
    await sectionRow("Getting Started")
      .getByRole("button", { name: "Actions for section Getting Started", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "New page", exact: true }).click();
    await expect(pageRow("Page 2")).toHaveCount(1);

    // the FIRST page has no previous sibling: both hierarchy commands hide
    await openPageMenu("Start here");
    await expect(page.getByRole("menuitem", { name: "Make subpage", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Promote", exact: true })).toHaveCount(0);
    await closeMenus();

    // OneNote's exact command: right-click the page → Make subpage
    await openPageMenu("Page 2");
    await page.getByRole("menuitem", { name: "Make subpage", exact: true }).click();
    await expect(page.locator('[role="menu"]')).toHaveCount(0);

    // the indented order: top-level parent first, subpage right after it
    await expect.poll(() => pageTree()).toEqual([
      ["Start here", 0],
      ["Page 2", 1],
    ]);
  });

  test("SUBP-02: Promote raises the subpage back to the top level", async () => {
    await openPageMenu("Page 2");
    await page.getByRole("menuitem", { name: "Promote", exact: true }).click();
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
    await expect.poll(() => pageTree()).toEqual([
      ["Start here", 0],
      ["Page 2", 0],
    ]);
  });

  test("SUBP-03: trashing the parent cascades; restoring it brings the family back", async () => {
    // indent again — the depth cap lives two tiers deep, one stays available
    await openPageMenu("Page 2");
    await page.getByRole("menuitem", { name: "Make subpage", exact: true }).click();
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
    await expect.poll(() => pageTree()).toEqual([
      ["Start here", 0],
      ["Page 2", 1],
    ]);

    // trash the PARENT — both rows vanish in one write
    await pageRow("Start here")
      .getByRole("button", { name: "Actions for page Start here", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
    await expect(pageRow("Start here")).toHaveCount(0);
    await expect(pageRow("Page 2")).toHaveCount(0);

    // the trash holds BOTH rows — the cascade reached the subpage
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Start here (page)");
    await expect(dialog).toContainText("Page 2 (page)");
    // restore the parent only — the family comes back together
    await dialog
      .locator("div.flex.items-center")
      .filter({ hasText: "Start here (page)" })
      .getByRole("button", { name: "Restore", exact: true })
      .click();
    await expect(dialog).not.toContainText("Start here (page)");
    await page.keyboard.press("Escape");

    await expect.poll(() => pageTree()).toEqual([
      ["Start here", 0],
      ["Page 2", 1],
    ]);
  });

  test("SUBP-04: the section PDF export follows the indented order", async () => {
    // one deterministic line per page; the subpage exports AFTER its parent
    await pageRow("Start here").getByRole("button", { name: "Start here", exact: true }).click();
    await injectScene(page, "SUBP-A");
    await saveNow(page);
    await pageRow("Page 2").getByRole("button", { name: "Page 2", exact: true }).click();
    await injectScene(page, "SUBP-B");
    await saveNow(page);

    await sectionRow("Getting Started")
      .getByRole("button", { name: "Actions for section Getting Started", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Export as PDF", exact: true }).waitFor({
      state: "visible",
    });
    await page.locator('[data-testid="section-export-pdf-submenu"]').hover();
    await page.locator('[data-testid="section-export-pdf-portrait"]').waitFor({
      state: "visible",
    });
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page.locator('[data-testid="section-export-pdf-portrait"]').click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no file");
    const bytes = fs.readFileSync(path);

    expect(download.suggestedFilename()).toBe("Getting-Started.pdf");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    // both pages are single-band → exactly two sheets, globally numbered
    expect(pdfPageCount(bytes)).toBe(2);
    const text = pdfDecompressed(bytes);
    expect(text).toContain("SUBP-A");
    expect(text).toContain("SUBP-B");
    expect(text).toContain("Start here");
    expect(text).toContain("Page 2");
    expect(text).toContain("1 / 2");
    expect(text).toContain("2 / 2");
    // tree order: the parent's sheet precedes the subpage's sheet
    expect(text.indexOf("SUBP-A")).toBeLessThan(text.indexOf("SUBP-B"));
  });
});
