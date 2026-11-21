import { expect, test, type Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Sub-sections (nested sections, issue #314) — wave 16.
 *
 * Seed layout (deterministic, from the welcome seed):
 *   Welcome Notebook / Getting Started / "Start here"
 *   Welcome Notebook / Ideas           / "Brainstorm"
 *   My Notebook     / New Section      / "Page 1"
 *
 * The default section title generator counts the notebook's sections, so a
 * new sub-section created in the Welcome Notebook is called "Section 3",
 * then "Section 4", "Section 5" — deterministic names the tree assertions
 * can rely on. A section row's kebab menu is addressed by its aria-label,
 * which is exact regardless of nesting depth.
 */

test.describe.serial("sub-sections (issue #314)", () => {
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

  const sectionMenu = (name: string) =>
    page.getByRole("button", { name: `Actions for section ${name}` });

  const sidebarText = async (): Promise<string> =>
    (await page.getByTestId("sidebar").textContent()) ?? "";

  test("SB-N01: the section menu gains New sub-section and the child nests expanded", async () => {
    await expect(page.getByTestId("sidebar")).toContainText("Getting Started");
    await sectionMenu("Getting Started").click();
    await page.getByRole("menuitem", { name: "New sub-section" }).click();

    // the child appears with the deterministic generated name …
    await expect(page.getByTestId("sidebar")).toContainText("Section 3");
    // … and the parent auto-expanded so the child is visible immediately
    await expect(
      page
        .locator('[data-testid="section-row"]')
        .filter({ hasText: "Getting Started" })
        .first()
        .getByRole("button")
        .first(),
    ).toHaveAttribute("aria-expanded", "true");
    // the child is ITS OWN row with its own actions menu
    await expect(sectionMenu("Section 3")).toHaveCount(1);
    // re-verify past the documented ~1.5 s reload-boot drop window: a late
    // boot re-hydrating the store from a pre-creation snapshot must not
    // silently swallow the new section (the handwriting-undo lesson)
    await page.waitForTimeout(1_600);
    await expect(sectionMenu("Section 3")).toHaveCount(1);
    await expect(page.getByTestId("sidebar")).toContainText("Section 3");
  });

  test("SB-N02: a page inside a nested section opens and edits normally", async () => {
    await sectionMenu("Section 3").click();
    await page.getByRole("menuitem", { name: "New page", exact: true }).click();
    // addPage selects the new page immediately
    await expect(page.locator('[data-testid="page-row"]').filter({ hasText: "Page 1" })).toBeVisible();
    // the canvas actually opened it (title bar button is the page title)
    await expect(page.locator('button[title="Click to rename this page"]')).toContainText(
      "Page 1",
      { timeout: 10_000 },
    );
    // it lives INSIDE the child, not at the top level: the child row (which
    // is nested inside the parent's row) shows the page between parent's page
    const text = await sidebarText();
    const childIdx = text.indexOf("Section 3");
    const pageIdx = text.indexOf("Page 1");
    expect(childIdx).toBeGreaterThan(-1);
    expect(pageIdx).toBeGreaterThan(childIdx);
  });

  test("SB-N03: reload restores the nested selection with its ancestors expanded", async () => {
    await page.reload();
    // the restored page sits inside Section 3 — boot must expand the whole
    // ancestor chain (Getting Started → Section 3) or the page is invisible
    await expect(page.getByTestId("sidebar")).toContainText("Section 3", {
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="page-row"]').filter({ hasText: "Page 1" })).toBeVisible();
    await expect(sectionMenu("Section 3")).toHaveCount(1);
  });

  test("SB-N04: trashing a parent takes the subtree to trash; restore brings it back", async () => {
    await sectionMenu("Getting Started").click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();

    // the whole subtree left the sidebar; Ideas remains
    await expect(page.getByTestId("sidebar")).not.toContainText("Getting Started");
    await expect(page.getByTestId("sidebar")).not.toContainText("Section 3");
    await expect(page.getByTestId("sidebar")).toContainText("Ideas");

    await page.getByRole("button", { name: "Trash" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Getting Started (section)");
    await expect(dialog).toContainText("Section 3 (section)");
    await expect(dialog).toContainText("Start here (page)");
    await expect(dialog).toContainText("Page 1 (page)");

    // restore ONLY the parent — the family comes back (OneNote-like)
    await dialog
      .locator("div.flex.items-center")
      .filter({ hasText: "Getting Started (section)" })
      .getByRole("button", { name: "Restore" })
      .click();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("sidebar")).toContainText("Getting Started");
    await expect(page.getByTestId("sidebar")).toContainText("Section 3");
    await expect(page.getByTestId("sidebar")).toContainText("Start here");
    const text = await sidebarText();
    expect(text.indexOf("Section 3")).toBeGreaterThan(-1);
    expect(text.indexOf("Page 1")).toBeGreaterThan(text.indexOf("Section 3"));
  });

  test("SB-N05: siblings reorder within their own parent scope", async () => {
    // two sub-sections under Ideas
    await sectionMenu("Ideas").click();
    await page.getByRole("menuitem", { name: "New sub-section" }).click();
    await expect(page.getByTestId("sidebar")).toContainText("Section 4");
    await sectionMenu("Ideas").click();
    await page.getByRole("menuitem", { name: "New sub-section" }).click();
    await expect(page.getByTestId("sidebar")).toContainText("Section 5");

    // Section 5 created after Section 4 — creation order
    let text = await sidebarText();
    expect(text.indexOf("Section 5")).toBeGreaterThan(text.indexOf("Section 4"));

    // move the LAST sibling up → it must precede its sibling, and nothing
    // outside Ideas' children may reorder
    await sectionMenu("Section 5").click();
    await page.getByRole("menuitem", { name: "Move up" }).click();

    // the reorder is an async store action — poll past the refresh instead
    // of racing it (the click resolves before the re-render commits)
    await expect
      .poll(async () => {
        const t = await sidebarText();
        return t.indexOf("Section 5") < t.indexOf("Section 4");
      })
      .toBe(true);
    text = await sidebarText();
    // the top-level structure is untouched
    expect(text.indexOf("Getting Started")).toBeLessThan(text.indexOf("Ideas"));
    expect(text.indexOf("Ideas")).toBeLessThan(text.indexOf("Section 5"));
  });
});
