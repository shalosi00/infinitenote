import { expect, test, type Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Section moves — sub-sections phase 2 (issue #325), wave 18.
 *
 * Seed layout (deterministic, from the welcome seed):
 *   Welcome Notebook / Getting Started / "Start here"
 *   Welcome Notebook / Ideas           / "Brainstorm"
 *   My Notebook      / New Section     / "Page 1"   (notebook COLLAPSED)
 *
 * Every test is SELF-CONTAINED: it resets to the seed and performs its own
 * moves, so test order never matters. This is deliberate — the wave-18 CI
 * lesson: a stateful serial group is not an atomic unit under fullyParallel
 * scheduling with multiple workers + retries (the scheduler re-dispatches
 * members, beforeAll re-runs on the new worker, and a reload test sees a
 * freshly re-seeded context). Self-contained tests are immune to that.
 *
 * Generated names per fresh seed: "New section" on Welcome Notebook →
 * "Section 3" (2 existing sections); "New sub-section" on New Section →
 * "Section 2" (My Notebook holds 1).
 *
 * The section kebab menus are addressed by their exact aria-label, and the
 * "Move to…" dialog buttons by theirs — the keyboard/touch path (the
 * OneNote "Move or Copy" flow, the path Joplin lacks). The drag gesture is
 * driven with raw mouse steps so dnd-kit's 6px PointerSensor activation
 * fires deterministically, and the mid-drag `data-drop-active` highlight
 * is asserted on the REAL target row.
 */

test.describe("section moves (issue #325)", () => {
  const sectionMenu = (page: Page, name: string) =>
    page.getByRole("button", { name: `Actions for section ${name}` });

  const notebookMenu = (page: Page, name: string) =>
    page.getByRole("button", { name: `Actions for notebook ${name}` });

  const sidebarText = async (page: Page): Promise<string> =>
    (await page.getByTestId("sidebar").textContent()) ?? "";

  /** click a notebook row's toggle only when it is still collapsed */
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

  test("SM-N01: the Move to… dialog moves a section to another notebook's top level", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);
    await expandNotebook(page, "My Notebook");
    await expect(sectionRow(page, "New Section")).toBeVisible();

    // OneNote "Move or Copy" parity: section menu → Move to…
    await sectionMenu(page, "New Section").click();
    await page.getByRole("menuitem", { name: "Move to…", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Move "New Section" to…');

    // cross-notebook top-level target
    await dialog
      .getByRole("button", { name: "Move to top level of Welcome Notebook" })
      .click();

    // the section left My Notebook and joined Welcome Notebook
    await expect(page.getByTestId("sidebar")).toContainText("New Section");
    await expect(notebookNode(page, "My Notebook")).not.toContainText("New Section");
    await expect(notebookNode(page, "Welcome Notebook")).toContainText("New Section");
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });

  test("SM-N02: the dialog nests a section under another section", async ({ page }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);

    await sectionMenu(page, "Ideas").click();
    await page.getByRole("menuitem", { name: "Move to…", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // nest Ideas under Getting Started (cross-notebook targets exist too;
    // its OWN notebook's top level and itself are disabled no-ops)
    await expect(
      dialog.getByRole("button", { name: "Move to top level of Welcome Notebook" })
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Move under Welcome Notebook / Ideas" })
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Move under Welcome Notebook / Getting Started" })
      .click();

    // Ideas now renders INSIDE Getting Started's subtree (row nesting,
    // not just text order), and the store auto-expanded the chain
    const gsSubtree = sectionRow(page, "Getting Started");
    await expect(
      gsSubtree.locator('[data-testid="section-row"]').filter({ hasText: "Ideas" })
    ).toHaveCount(1);
    // the old top-level position is gone: Ideas no longer precedes Getting
    // Started's page in flat order — it lives after "Start here"
    const text = await sidebarText(page);
    expect(text.indexOf("Ideas")).toBeGreaterThan(text.indexOf("Start here"));
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });

  test("SM-N03: dragging a section onto another nests it under the target", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);

    // a fresh top-level section to drag (Welcome Notebook holds 2 → "Section 3")
    await notebookMenu(page, "Welcome Notebook").click();
    await page.getByRole("menuitem", { name: "New section", exact: true }).click();
    await expect(sectionRow(page, "Section 3")).toBeVisible();

    const dst = await dragHandleToHandle(page, "Section 3", "Getting Started");
    // the REAL dnd-kit pipeline: pointerWithin marks the hovered valid
    // target before the drop lands
    await expect(dst).toHaveAttribute("data-drop-active", "true");
    await page.mouse.up();

    // Section 3 nested under Getting Started (auto-expanded by the move)
    await expect(
      sectionRow(page, "Getting Started")
        .locator('[data-testid="section-row"]')
        .filter({ hasText: "Section 3" })
    ).toHaveCount(1);
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });

  test("SM-N04: dropping a parent onto its own child is rejected", async ({ page }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);

    // build the parent→child pair by drag first (Section 3 nests under
    // Getting Started)
    await notebookMenu(page, "Welcome Notebook").click();
    await page.getByRole("menuitem", { name: "New section", exact: true }).click();
    await expect(sectionRow(page, "Section 3")).toBeVisible();
    await dragHandleToHandle(page, "Section 3", "Getting Started");
    await page.mouse.up();
    await expect(
      sectionRow(page, "Getting Started")
        .locator('[data-testid="section-row"]')
        .filter({ hasText: "Section 3" })
    ).toHaveCount(1);

    // now drag the PARENT onto its own child — the child must never accept
    const dst = await dragHandleToHandle(page, "Getting Started", "Section 3");
    await page.waitForTimeout(150); // let pointerWithin settle on the row
    expect(await dst.getAttribute("data-drop-active")).toBeNull();
    await page.mouse.up();

    // structure unchanged: Section 3 is still INSIDE Getting Started's subtree
    await expect(
      sectionRow(page, "Getting Started")
        .locator('[data-testid="section-row"]')
        .filter({ hasText: "Section 3" })
    ).toHaveCount(1);
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });

  test("SM-N05: the moved subtree survives reload and trash/restore as a family", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);

    // New Section (My Notebook) gains a child, then the whole family moves
    // to Welcome Notebook via the dialog
    await expandNotebook(page, "My Notebook");
    await sectionMenu(page, "New Section").click();
    await page.getByRole("menuitem", { name: "New sub-section", exact: true }).click();
    await expect(page.getByTestId("sidebar")).toContainText("Section 2");

    await sectionMenu(page, "New Section").click();
    await page.getByRole("menuitem", { name: "Move to…", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move to top level of Welcome Notebook" })
      .click();
    await expect(notebookNode(page, "Welcome Notebook")).toContainText("New Section");

    await page.reload();
    // re-verify past the documented ~1.5 s boot drop window
    await expect(page.getByTestId("sidebar")).toContainText("New Section", {
      timeout: 20_000,
    });

    // trashing the moved parent still takes the whole subtree (the family
    // moved to Welcome Notebook together)
    await sectionMenu(page, "New Section").click();
    await page.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
    await expect(page.getByTestId("sidebar")).not.toContainText("New Section");

    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("New Section (section)");
    await expect(dialog).toContainText("Section 2 (section)");

    await dialog
      .locator("div.flex.items-center")
      .filter({ hasText: "New Section (section)" })
      .getByRole("button", { name: "Restore" })
      .click();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("sidebar")).toContainText("New Section");
    await expandSection(page, "New Section");
    await expect(page.getByTestId("sidebar")).toContainText("Section 2");
    // and it stayed in Welcome Notebook, not back in My Notebook
    await expect(notebookNode(page, "Welcome Notebook")).toContainText("New Section");
    await expect(notebookNode(page, "My Notebook")).not.toContainText("Section 2");
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });
});
