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
 * The section kebab menus are addressed by their exact aria-label, and the
 * "Move to…" dialog buttons by theirs — the keyboard/touch path (the
 * OneNote "Move or Copy" flow, the path Joplin lacks). The drag gesture is
 * driven with raw mouse steps so dnd-kit's 6px PointerSensor activation
 * fires deterministically, and the mid-drag `data-drop-active` highlight
 * is asserted on the REAL target row.
 */

test.describe.serial("section moves (issue #325)", () => {
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

  const notebookMenu = (name: string) =>
    page.getByRole("button", { name: `Actions for notebook ${name}` });

  const sidebarText = async (): Promise<string> =>
    (await page.getByTestId("sidebar").textContent()) ?? "";

  /** click a notebook row's toggle only when it is still collapsed */
  const expandNotebook = async (name: string) => {
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

  const expandSection = async (name: string) => {
    const row = page
      .locator('[data-testid="section-row"]')
      .filter({ hasText: name })
      .first();
    const toggle = row.locator("button").first();
    if ((await toggle.getAttribute("aria-expanded")) === "false") {
      await toggle.click();
    }
  };

  const sectionRow = (name: string) =>
    page
      .locator('[data-testid="section-row"]')
      .filter({ hasText: name })
      .first();

  const rowHandle = (name: string) =>
    page
      .locator('[data-testid="section-row-handle"]')
      .filter({ hasText: name })
      .first();

  /** drag one row handle onto another with dnd-kit-friendly mouse steps */
  const dragHandleToHandle = async (sourceName: string, targetName: string) => {
    const src = rowHandle(sourceName);
    const dst = rowHandle(targetName);
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

  test("SM-N01: the Move to… dialog moves a section to another notebook's top level", async () => {
    await expandNotebook("My Notebook");
    await expect(sectionRow("New Section")).toBeVisible();

    // OneNote "Move or Copy" parity: section menu → Move to…
    await sectionMenu("New Section").click();
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
    const mnNode = page
      .locator('[data-testid="notebook-node"]')
      .filter({ hasText: "My Notebook" })
      .first();
    await expect(mnNode).not.toContainText("New Section");
    const wnNode = page
      .locator('[data-testid="notebook-node"]')
      .filter({ hasText: "Welcome Notebook" })
      .first();
    await expect(wnNode).toContainText("New Section");
  });

  test("SM-N02: the dialog nests a section under another section", async () => {
    await sectionMenu("Ideas").click();
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
    const gsSubtree = sectionRow("Getting Started");
    await expect(gsSubtree.locator('[data-testid="section-row"]').filter({ hasText: "Ideas" })).toHaveCount(
      1
    );
    // the old top-level position is gone: Ideas no longer precedes Getting
    // Started's page in flat order — it lives after "Start here"
    const text = await sidebarText();
    expect(text.indexOf("Ideas")).toBeGreaterThan(text.indexOf("Start here"));
  });

  test("SM-N03: dragging a section onto another nests it under the target", async () => {
    // a fresh top-level section to drag (Welcome Notebook holds 3 → "Section 4")
    await notebookMenu("Welcome Notebook").click();
    await page.getByRole("menuitem", { name: "New section", exact: true }).click();
    await expect(sectionRow("Section 4")).toBeVisible();

    const dst = await dragHandleToHandle("Section 4", "New Section");
    // the REAL dnd-kit pipeline: pointerWithin marks the hovered valid
    // target before the drop lands
    await expect(dst).toHaveAttribute("data-drop-active", "true");
    await page.mouse.up();

    // Section 4 nested under New Section (auto-expanded by the move)
    await expect(
      sectionRow("New Section")
        .locator('[data-testid="section-row"]')
        .filter({ hasText: "Section 4" })
    ).toHaveCount(1);
    // the top-level position is gone
    const wnNode = page
      .locator('[data-testid="notebook-node"]')
      .filter({ hasText: "Welcome Notebook" })
      .first();
    const text = (await wnNode.textContent()) ?? "";
    expect(text.indexOf("New Section")).toBeLessThan(text.indexOf("Section 4"));
  });

  test("SM-N04: dropping a parent onto its own child is rejected", async () => {
    // New Section is Section 4's parent now — the child must never accept
    const dst = await dragHandleToHandle("New Section", "Section 4");
    await page.waitForTimeout(150); // let pointerWithin settle on the row
    expect(await dst.getAttribute("data-drop-active")).toBeNull();
    await page.mouse.up();

    // structure unchanged: Section 4 is still INSIDE New Section's subtree
    await expect(
      sectionRow("New Section")
        .locator('[data-testid="section-row"]')
        .filter({ hasText: "Section 4" })
    ).toHaveCount(1);
  });

  test("SM-N05: the moved subtree survives reload and trash/restore as a family", async () => {
    await page.reload();
    // re-verify past the documented ~1.5 s boot drop window
    await expect(page.getByTestId("sidebar")).toContainText("New Section", {
      timeout: 20_000,
    });

    // trashing the moved parent still takes the whole subtree (the family
    // moved to Welcome Notebook together in SM-N01/N03)
    await sectionMenu("New Section").click();
    await page.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
    await expect(page.getByTestId("sidebar")).not.toContainText("New Section");

    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("New Section (section)");
    await expect(dialog).toContainText("Section 4 (section)");

    await dialog
      .locator("div.flex.items-center")
      .filter({ hasText: "New Section (section)" })
      .getByRole("button", { name: "Restore" })
      .click();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("sidebar")).toContainText("New Section");
    await expandSection("New Section");
    await expect(page.getByTestId("sidebar")).toContainText("Section 4");
    // and it stayed in Welcome Notebook, not back in My Notebook
    const wnNode = page
      .locator('[data-testid="notebook-node"]')
      .filter({ hasText: "Welcome Notebook" })
      .first();
    await expect(wnNode).toContainText("New Section");
    const mnNode = page
      .locator('[data-testid="notebook-node"]')
      .filter({ hasText: "My Notebook" })
      .first();
    await expect(mnNode).not.toContainText("Section 4");
  });
});
