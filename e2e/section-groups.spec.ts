import { expect, test, type Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Section groups — OneNote "Section Groups" parity (issue #337),
 * sub-sections phase 3, wave 20.
 *
 * Seed layout (deterministic, from the welcome seed):
 *   Welcome Notebook / Getting Started / "Start here"
 *   Welcome Notebook / Ideas           / "Brainstorm"
 *   My Notebook      / New Section     / "Page 1"   (notebook COLLAPSED)
 *
 * Every test is SELF-CONTAINED: it resets to the seed and performs its own
 * steps (the wave-18 CI lesson — fullyParallel scheduling + retries make
 * stateful serial groups non-atomic). Generated names per fresh seed:
 * Welcome Notebook holds 2 sections, so its group lands as
 * "Section group 3" and a fresh section as "Section 3".
 *
 * The OneNote evidence: right-click any section tab → "New Section Group"
 * lands a group as a peer of the section tabs; "a section group can hold
 * as many sections as you want, along with all their pages" — groups keep
 * sections together and hold NO pages of their own.
 */

test.describe("section groups (issue #337)", () => {
  const sectionMenu = (page: Page, name: string) =>
    page.getByRole("button", { name: `Actions for section ${name}` });

  const notebookMenu = (page: Page, name: string) =>
    page.getByRole("button", { name: `Actions for notebook ${name}` });

  const sidebar = (page: Page) => page.getByTestId("sidebar");

  const expandNotebook = async (page: Page, name: string) => {
    const row = page
      .locator('[data-testid="notebook-row"]')
      .filter({ hasText: name })
      .first();
    const toggle = row.locator("button").first();
    if ((await toggle.getAttribute("aria-expanded")) === "false") {
      await toggle.click();
    }
    await expect(row).toHaveAttribute("data-notebook-id", /.+/);
  };

  const expandSection = async (page: Page, name: string) => {
    const row = page
      .locator('[data-testid="section-row"]')
      .filter({ hasText: name })
      .first();
    const toggle = row.locator("button").first();
    if ((await toggle.getAttribute("aria-expanded")) === "false") {
      await toggle.click();
    }
  };

  const sectionRow = (page: Page, name: string) =>
    page
      .locator('[data-testid="section-row"]')
      .filter({ hasText: name })
      .first();

  const rowHandle = (page: Page, name: string) =>
    page
      .locator('[data-testid="section-row-handle"]')
      .filter({ hasText: name })
      .first();

  /** drag one row handle onto another with dnd-kit-friendly mouse steps */
  const dragHandleToHandle = async (
    page: Page,
    sourceName: string,
    targetName: string
  ) => {
    const src = rowHandle(page, sourceName);
    const dst = rowHandle(page, targetName);
    const sb = (await src.boundingBox())!;
    const db = (await dst.boundingBox())!;
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.down();
    // pass the 6px activation constraint before heading for the target
    await page.mouse.move(sb.x + sb.width / 2 + 14, sb.y + sb.height / 2, {
      steps: 3,
    });
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, {
      steps: 14,
    });
    return dst;
  };

  const notebookNode = (page: Page, name: string) =>
    page
      .locator('[data-testid="notebook-node"]')
      .filter({ hasText: name })
      .first();

  const GROUP_NAME = "Section group 3";

  test("SG-N01: 'New section group' lands a group at the notebook top level — folder glyph, no page menu", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);

    // the OneNote-documented path: right-click a SECTION tab → New Section Group
    await sectionMenu(page, "Ideas").click();
    await page.getByRole("menuitem", { name: "New section group", exact: true }).click();

    // the group appears as a peer of the section tabs, at the END of the scope
    const groupRow = sectionRow(page, GROUP_NAME);
    await expect(groupRow).toBeVisible();
    await expect(groupRow.locator('[data-testid="section-group-icon"]')).toHaveCount(1);
    // a group carries no color swatch — the folder glyph IS the affordance
    await expect(groupRow.locator('[data-testid="section-color"]')).toHaveCount(0);

    // its menu holds the section affordances, not the page ones
    await sectionMenu(page, GROUP_NAME).click();
    await expect(page.getByRole("menuitem", { name: "New section", exact: true })).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "New page", exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: "New page from template…", exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: "Color", exact: true })
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // the notebook menu path creates one too
    await notebookMenu(page, "Welcome Notebook").click();
    await page.getByRole("menuitem", { name: "New section group", exact: true }).click();
    await expect(sectionRow(page, "Section group 4")).toBeVisible();
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });

  test("SG-N02: a group holds sections — 'New section' nests a child, 'Add section' is the tail button", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);

    await notebookMenu(page, "Welcome Notebook").click();
    await page.getByRole("menuitem", { name: "New section group", exact: true }).click();
    await expect(sectionRow(page, GROUP_NAME)).toBeVisible();

    // the group's menu gains "New section" — its whole purpose
    await sectionMenu(page, GROUP_NAME).click();
    await page.getByRole("menuitem", { name: "New section", exact: true }).click();

    // the child nests INSIDE the group's subtree (row nesting, auto-expanded).
    // The fresh child is "Section 4": the group itself counts in the
    // notebook's section count that names it.
    const groupSubtree = sectionRow(page, GROUP_NAME);
    await expect(
      groupSubtree.locator('[data-testid="section-row"]').filter({ hasText: "Section 4" })
    ).toHaveCount(1);
    // the group's expanded body offers "Add section" as its tail button —
    // and renders NO page rows (groups hold no pages; the child's own
    // "Add page" tail inside its subtree is correct and stays)
    await expect(groupSubtree.getByRole("button", { name: "Add section" })).toBeVisible();
    await expect(groupSubtree.locator('[data-testid="page-row"]')).toHaveCount(0);
    // the child is a PLAIN section — it carries the color swatch and page flows
    const childRow = groupSubtree
      .locator('[data-testid="section-row"]')
      .filter({ hasText: "Section 4" })
      .first();
    await expect(childRow.locator('[data-testid="section-color"]')).toHaveCount(1);
    await expect(childRow.locator('[data-testid="section-group-icon"]')).toHaveCount(0);
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });

  test("SG-N03: groups are not bulk-move targets — pages cannot live in a group", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);

    await notebookMenu(page, "Welcome Notebook").click();
    await page.getByRole("menuitem", { name: "New section group", exact: true }).click();
    await expect(sectionRow(page, GROUP_NAME)).toBeVisible();

    // select every visible page and open the bulk-move picker
    await page.getByTestId("multiselect-toggle").click();
    await expect(page.getByTestId("bulk-bar")).toBeVisible();
    await page.getByTestId("bulk-select-all").click();
    await page.getByTestId("bulk-move").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Getting Started / Ideas are targets; the group is NOT in the list
    await expect(dialog).toContainText("Getting Started");
    await expect(dialog).not.toContainText(GROUP_NAME);
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });

  test("SG-N04: dragging a section onto a group nests it — and the family survives reload", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);

    await expandNotebook(page, "Welcome Notebook");
    await notebookMenu(page, "Welcome Notebook").click();
    await page.getByRole("menuitem", { name: "New section group", exact: true }).click();
    await expect(sectionRow(page, GROUP_NAME)).toBeVisible();

    // a fresh top-level section to drag — "Section 4": the group itself
    // counts in the notebook's section count that names it
    await notebookMenu(page, "Welcome Notebook").click();
    await page.getByRole("menuitem", { name: "New section", exact: true }).click();
    await expect(sectionRow(page, "Section 4")).toBeVisible();

    const dst = await dragHandleToHandle(page, "Section 4", GROUP_NAME);
    // the REAL dnd-kit pipeline: pointerWithin marks the hovered valid
    // target before the drop lands
    await expect(dst).toHaveAttribute("data-drop-active", "true");
    await page.mouse.up();

    await expect(
      sectionRow(page, GROUP_NAME)
        .locator('[data-testid="section-row"]')
        .filter({ hasText: "Section 4" })
    ).toHaveCount(1);

    // reload — the nested structure persists (re-verify past the ~1.5 s
    // boot drop window; the seed re-runs on a fresh context)
    await page.reload();
    await expect(sidebar(page)).toContainText(GROUP_NAME, { timeout: 20_000 });
    await expandSection(page, GROUP_NAME);
    await expect(
      sectionRow(page, GROUP_NAME)
        .locator('[data-testid="section-row"]')
        .filter({ hasText: "Section 4" })
    ).toHaveCount(1);
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });

  test("SG-N05: trashing a group takes its whole subtree to trash; restore brings the family back", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);

    await notebookMenu(page, "Welcome Notebook").click();
    await page.getByRole("menuitem", { name: "New section group", exact: true }).click();
    await expect(sectionRow(page, GROUP_NAME)).toBeVisible();
    await sectionMenu(page, GROUP_NAME).click();
    await page.getByRole("menuitem", { name: "New section", exact: true }).click();
    await expect(
      sectionRow(page, GROUP_NAME)
        .locator('[data-testid="section-row"]')
        .filter({ hasText: "Section 4" })
    ).toHaveCount(1);
    // give the child a page (the generated first page is "Page 1")
    await sectionMenu(page, "Section 4").click();
    await page.getByRole("menuitem", { name: "New page", exact: true }).click();
    await expect(sidebar(page)).toContainText("Page 1");

    // trash the GROUP — the #314 cascade covers the whole subtree
    await sectionMenu(page, GROUP_NAME).click();
    await page.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
    await expect(sidebar(page)).not.toContainText(GROUP_NAME);
    await expect(sidebar(page)).not.toContainText("Section 4");

    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`${GROUP_NAME} (section)`);
    await expect(dialog).toContainText("Section 4 (section)");
    await expect(dialog).toContainText("Page 1 (page)");

    await dialog
      .locator("div.flex.items-center")
      .filter({ hasText: `${GROUP_NAME} (section)` })
      .getByRole("button", { name: "Restore" })
      .click();
    await page.keyboard.press("Escape");

    // the family is back: group + child section + the child's page
    await expect(sidebar(page)).toContainText(GROUP_NAME);
    await expandSection(page, GROUP_NAME);
    await expect(
      sectionRow(page, GROUP_NAME)
        .locator('[data-testid="section-row"]')
        .filter({ hasText: "Section 4" })
    ).toHaveCount(1);
    await expect(
      sectionRow(page, "Section 4").locator('[data-testid="page-row"]').filter({ hasText: "Page 1" })
    ).toHaveCount(1);
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });
});
