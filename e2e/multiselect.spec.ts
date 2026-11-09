import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Sidebar multi-select with bulk move/delete (issue #27).
 *
 * Seed layout (deterministic, from the welcome seed):
 *   Welcome Notebook / Getting Started / "Start here"
 *   Welcome Notebook / Ideas           / "Brainstorm"
 *   My Notebook     / New Section      / "Page 1"
 */

/**
 * Click a target row inside the freshly-opened Move-to dialog.
 *
 * Under a loaded runner the first click on a row of a just-opened Radix
 * dialog can land on the still-mounted open overlay instead (observed once
 * on a memory-constrained dev-server run: "element is not stable" during
 * mount, then the open overlay intercepting the click for the full 20s
 * action timeout). Retry the interaction: a fresh Escape→reopen cycle
 * re-mounts the dialog and re-lays-out the list. The final attempt is
 * deliberately uncaught — a real regression must still fail loudly, and
 * the assertions after the call keep the outcome authoritative (#152 style).
 */
async function clickMoveTarget(page: Page, target: string): Promise<void> {
  const row = page.locator('[data-testid="move-target"]').filter({ hasText: target });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await row.first().isVisible().catch(() => false))) {
      await page.locator('[data-testid="bulk-move"]').click({ timeout: 5_000 }).catch(() => {});
      await expect(row.first()).toBeVisible();
    }
    if (
      await row.first()
        .click({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      return;
    }
    // dismiss whatever the failed attempt left behind, then retry
    await page.keyboard.press("Escape");
    await expect(row.first()).toHaveCount(0, { timeout: 5_000 }).catch(() => {});
  }
  await page.locator('[data-testid="bulk-move"]').click();
  await row.first().click();
}

test.describe.serial("sidebar multi-select (issue #27)", () => {
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

  const pageRow = (title: string) =>
    page.locator('[data-testid="page-row"]').filter({ hasText: title });

  test("select mode shows checkboxes and toggles rows", async () => {
    // no checkboxes before entering select mode
    await expect(page.locator('[data-testid="page-checkbox"]')).toHaveCount(0);

    await page.locator('[data-testid="multiselect-toggle"]').click();
    await expect(page.locator('[data-testid="bulk-bar"]')).toBeVisible();
    // only the expanded section's page has a visible checkbox
    await expect(page.locator('[data-testid="page-checkbox"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="bulk-count"]')).toHaveText("0 selected");

    // clicking the row (not just the checkbox) toggles selection
    await pageRow("Start here").click();
    await expect(page.locator('[data-testid="bulk-count"]')).toHaveText("1 selected");
    await expect(pageRow("Start here")).toHaveAttribute("data-checked", "true");

    // clicking again deselects
    await pageRow("Start here").click();
    await expect(page.locator('[data-testid="bulk-count"]')).toHaveText("0 selected");
  });

  test("select all / clear scoped to expanded sections", async () => {
    await page.locator('[data-testid="bulk-select-all"]').click();
    await expect(page.locator('[data-testid="bulk-count"]')).toHaveText("1 selected");

    // the button now clears
    await expect(page.locator('[data-testid="bulk-select-all"]')).toHaveText("Clear");
    await page.locator('[data-testid="bulk-select-all"]').click();
    await expect(page.locator('[data-testid="bulk-count"]')).toHaveText("0 selected");

    // collapse the section → nothing visible to select
    await page.locator('[data-testid="section-row"]').filter({ hasText: "Getting Started" }).locator("button").first().click();
    await expect(page.locator('[data-testid="page-checkbox"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="bulk-select-all"]')).toBeDisabled();
    // expand again for the next test
    await page.locator('[data-testid="section-row"]').filter({ hasText: "Getting Started" }).locator("button").first().click();
  });

  test("bulk move lands pages in the target section (cross-section)", async () => {
    // expand "Ideas" so its page is selectable too
    await page.locator('[data-testid="section-row"]').filter({ hasText: "Ideas" }).locator("button").first().click();

    // a single selected page disables its own section as a no-op target
    await pageRow("Brainstorm").click();
    await expect(page.locator('[data-testid="bulk-count"]')).toHaveText("1 selected");
    await page.locator('[data-testid="bulk-move"]').click();
    const dialog = page.locator('[data-testid="move-target"]');
    await expect(dialog.first()).toBeVisible();
    await expect(dialog.filter({ hasText: "Ideas" })).toBeDisabled();
    await expect(dialog.filter({ hasText: "Getting Started" })).toBeEnabled();
    await page.keyboard.press("Escape"); // cancel

    // now move two pages at once
    await pageRow("Start here").click();
    await expect(page.locator('[data-testid="bulk-count"]')).toHaveText("2 selected");

    await page.locator('[data-testid="bulk-move"]').click();
    await clickMoveTarget(page, "New Section");

    // both pages now live in My Notebook / New Section
    const newSection = page.locator('[data-testid="section-row"]').filter({ hasText: "New Section" });
    await expect(newSection.locator('[data-testid="page-row"]').filter({ hasText: "Start here" })).toBeVisible();
    await expect(newSection.locator('[data-testid="page-row"]').filter({ hasText: "Brainstorm" })).toBeVisible();
    await expect(newSection.locator('[data-testid="page-row"]').filter({ hasText: "Page 1" })).toBeVisible();

    // select mode exited after the bulk action
    await expect(page.locator('[data-testid="bulk-bar"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="page-checkbox"]')).toHaveCount(0);
  });

  test("bulk delete trashes the selection and recovers the open page", async () => {
    await page.locator('[data-testid="multiselect-toggle"]').click();

    // the open page ("Start here" followed the move) plus one sibling
    await pageRow("Start here").click();
    await pageRow("Brainstorm").click();
    await expect(page.locator('[data-testid="bulk-count"]')).toHaveText("2 selected");

    await page.locator('[data-testid="bulk-delete"]').click();

    // rows are gone; "Page 1" remains and became the open page
    await expect(pageRow("Start here")).toHaveCount(0);
    await expect(pageRow("Brainstorm")).toHaveCount(0);
    const newSection = page.locator('[data-testid="section-row"]').filter({ hasText: "New Section" });
    await expect(newSection.locator('[data-testid="page-row"]')).toHaveCount(1);
    await expect(pageRow("Page 1")).toHaveAttribute("data-selected", "true");

    // both pages restorable from the trash
    await page.getByRole("button", { name: "Trash" }).click();
    const trashList = page.getByRole("dialog");
    await expect(trashList).toContainText("Start here");
    await expect(trashList).toContainText("Brainstorm");
  });
});
