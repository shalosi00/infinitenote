import { expect, test, type Locator, type Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Sub-pages phase 2 — drag-to-indent (issue #365), wave 24.
 *
 * The gesture half of the sub-pages feature (issue #359's named phase-2
 * candidate, the same operation OneNote's desktop page list performs):
 * a page dropped on another page indents under it (the menu "Make
 * subpage" policy decides — same section, cycle-safe, two-tier depth
 * cap); a page dropped on its OWN section row promotes one level (the
 * menu "Promote" command's gesture path). Invalid targets never
 * highlight and never write.
 *
 * Seed layout (deterministic, from the welcome seed):
 *   Welcome Notebook (violet) / Getting Started / "Start here"
 *   Welcome Notebook (violet) / Ideas           / "Brainstorm"
 *   My Notebook     (teal)    / New Section      / "Page 1"  (notebook COLLAPSED)
 *
 * Every test is SELF-CONTAINED (the wave-18 CI lesson): it resets to the
 * seed and performs its own drags, so test order never matters under
 * fullyParallel scheduling with retries. Generated page names count the
 * section's own pages: a fresh Getting Started (1 page) yields "Page 2",
 * then "Page 3", then "Page 4".
 *
 * The gesture is driven with raw mouse steps so dnd-kit's 6px
 * PointerSensor activation fires deterministically, and the mid-drag
 * `data-drop-active` highlight is asserted on the REAL target row.
 */

const sectionRow = (page: Page, name: string): Locator =>
  page
    .locator('[data-testid="section-row"]')
    .filter({ hasText: name })
    .first();

const pageRow = (page: Page, title: string): Locator =>
  page
    .locator('[data-testid="page-row"]')
    .filter({ has: page.getByRole("button", { name: title, exact: true }) })
    .first();

/** The section's page rows in DOM (= visible tree) order, as [title, depth]. */
const pageTree = (page: Page): Promise<Array<[string, number]>> =>
  sectionRow(page, "Getting Started")
    .locator('[data-testid="page-row"]')
    .evaluateAll((rows) =>
      rows.map((r) => [
        (r.querySelector("button span")?.textContent ?? "").trim(),
        Number(r.getAttribute("data-depth")),
      ]),
    );

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
  const row = sectionRow(page, name);
  const toggle = row.locator("button").first();
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
  await expect(row).toHaveAttribute("data-section-id", /.+/);
};

/** Create a page on a section and wait for its generated row. */
const newPageOn = async (page: Page, sectionName: string, title: string) => {
  await sectionRow(page, sectionName)
    .getByRole("button", { name: `Actions for section ${sectionName}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "New page", exact: true }).click();
  await expect(pageRow(page, title)).toHaveCount(1);
};

/** Drag one row onto another with dnd-kit-friendly mouse steps. */
const dragRowTo = async (page: Page, src: Locator, dst: Locator) => {
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

test.describe("sub-pages drag-to-indent (issue #365)", () => {
  test("PGD-N01: dragging a page onto another indents it under the target", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);
    await newPageOn(page, "Getting Started", "Page 2");

    const dst = await dragRowTo(page, pageRow(page, "Page 2"), pageRow(page, "Start here"));
    // the REAL dnd-kit pipeline: pointerWithin marks the hovered valid
    // target before the drop lands
    await expect(dst).toHaveAttribute("data-drop-active", "true");
    await page.mouse.up();

    // the indented order: top-level parent first, subpage right after it
    await expect
      .poll(() => pageTree(page))
      .toEqual([
        ["Start here", 0],
        ["Page 2", 1],
      ]);
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });

  test("PGD-N02: dropping a subpage on its own section row promotes it", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);
    await newPageOn(page, "Getting Started", "Page 2");
    await dragRowTo(page, pageRow(page, "Page 2"), pageRow(page, "Start here"));
    await page.mouse.up();
    await expect
      .poll(() => pageTree(page))
      .toEqual([
        ["Start here", 0],
        ["Page 2", 1],
      ]);

    // the gesture path of the menu's Promote command: drop on the section
    const sectionHandle = sectionRow(page, "Getting Started").locator(
      '[data-testid="section-row-handle"]'
    );
    await dragRowTo(page, pageRow(page, "Page 2"), sectionHandle);
    await expect(sectionHandle).toHaveAttribute("data-drop-active", "true");
    await page.mouse.up();

    await expect
      .poll(() => pageTree(page))
      .toEqual([
        ["Start here", 0],
        ["Page 2", 0],
      ]);
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });

  test("PGD-N03: dropping a parent onto its own descendant never highlights", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);
    // build the two-tier chain purely by drags: Page 2 under Start here,
    // then Page 3 under Page 2 (depth 1 + 1 = the OneNote cap, allowed)
    await newPageOn(page, "Getting Started", "Page 2");
    await dragRowTo(page, pageRow(page, "Page 2"), pageRow(page, "Start here"));
    await page.mouse.up();
    await newPageOn(page, "Getting Started", "Page 3");
    await dragRowTo(page, pageRow(page, "Page 3"), pageRow(page, "Page 2"));
    await page.mouse.up();
    await expect
      .poll(() => pageTree(page))
      .toEqual([
        ["Start here", 0],
        ["Page 2", 1],
        ["Page 3", 2],
      ]);

    // drag the ROOT onto its own descendant — the target must never accept
    const dst = await dragRowTo(page, pageRow(page, "Start here"), pageRow(page, "Page 3"));
    await page.waitForTimeout(150); // let pointerWithin settle on the row
    expect(await dst.getAttribute("data-drop-active")).toBeNull();
    await page.mouse.up();

    // structure unchanged: the chain still reads Start here > Page 2 > Page 3
    await expect
      .poll(() => pageTree(page))
      .toEqual([
        ["Start here", 0],
        ["Page 2", 1],
        ["Page 3", 2],
      ]);
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });

  test("PGD-N04: the depth cap and notebook rows reject page drags", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);
    // the capped family: Start here > Page 2 > Page 3 (height 2)
    await newPageOn(page, "Getting Started", "Page 2");
    await dragRowTo(page, pageRow(page, "Page 2"), pageRow(page, "Start here"));
    await page.mouse.up();
    await newPageOn(page, "Getting Started", "Page 3");
    await dragRowTo(page, pageRow(page, "Page 3"), pageRow(page, "Page 2"));
    await page.mouse.up();
    await newPageOn(page, "Getting Started", "Page 4");

    // the whole height-2 subtree under a top-level target would read depth 3 —
    // over OneNote's cap: no highlight, no write
    const dst = await dragRowTo(page, pageRow(page, "Start here"), pageRow(page, "Page 4"));
    await page.waitForTimeout(150);
    expect(await dst.getAttribute("data-drop-active")).toBeNull();
    await page.mouse.up();
    await expect
      .poll(() => pageTree(page))
      .toEqual([
        ["Start here", 0],
        ["Page 2", 1],
        ["Page 3", 2],
        ["Page 4", 0],
      ]);

    // a page dragged over a NOTEBOOK row neither highlights nor drops
    // (notebook rows accept section drags only — the #325 semantics)
    const nbRow = page
      .locator('[data-testid="notebook-row"]')
      .filter({ hasText: "Welcome Notebook" })
      .first();
    await dragRowTo(page, pageRow(page, "Page 2"), nbRow);
    await page.waitForTimeout(150);
    expect(await nbRow.getAttribute("data-drop-active")).toBeNull();
    await page.mouse.up();
    await expect
      .poll(() => pageTree(page))
      .toEqual([
        ["Start here", 0],
        ["Page 2", 1],
        ["Page 3", 2],
        ["Page 4", 0],
      ]);
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });

  test("PGD-N05: foreign sections reject page drags; the chain survives reload", async ({
    page,
  }) => {
    const consoleErrors: string[] = attachErrorCollector(page);
    await resetToSeed(page);
    await newPageOn(page, "Getting Started", "Page 2");
    await dragRowTo(page, pageRow(page, "Page 2"), pageRow(page, "Start here"));
    await page.mouse.up();
    await newPageOn(page, "Getting Started", "Page 3");
    await dragRowTo(page, pageRow(page, "Page 3"), pageRow(page, "Page 2"));
    await page.mouse.up();
    await expect
      .poll(() => pageTree(page))
      .toEqual([
        ["Start here", 0],
        ["Page 2", 1],
        ["Page 3", 2],
      ]);

    // a page dragged onto ANOTHER section's page row: no highlight, no
    // re-home (pages never move between sections by drag — the bulk-move
    // dialog stays that path)
    await expandNotebook(page, "My Notebook");
    await expandSection(page, "New Section");
    await expect(pageRow(page, "Page 1")).toBeVisible();
    const dst = await dragRowTo(page, pageRow(page, "Page 3"), pageRow(page, "Page 1"));
    await page.waitForTimeout(150);
    expect(await dst.getAttribute("data-drop-active")).toBeNull();
    await page.mouse.up();
    await expect
      .poll(() => pageTree(page))
      .toEqual([
        ["Start here", 0],
        ["Page 2", 1],
        ["Page 3", 2],
      ]);

    // the drag-built chain persists across a reload
    await page.reload();
    await expect(pageRow(page, "Start here")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => pageTree(page))
      .toEqual([
        ["Start here", 0],
        ["Page 2", 1],
        ["Page 3", 2],
      ]);
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
  });
});
