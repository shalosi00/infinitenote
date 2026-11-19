/**
 * Page templates E2E (test plan: docs/test-plans/page-templates.md, ids PT-E*).
 *
 * Deterministic paths only, built on the welcome seed (exactly 2 elements
 * on "Start here"): save-as-template with a typed name, create-from-template
 * via the section menu and the page-actions menu, the paper-style carry-over,
 * the stationery case (paper style without content), and the delete flow
 * with its confirm step. The oversize cap is covered by unit tests (PT-P13)
 * — E2E cannot build a 10 MiB page at a reasonable cost.
 * Deterministic background (measured): a fresh page's first autosave writes
 * an EMPTY scene — "empty page" saves are real stationery saves, not refusals.
 */
import { expect, test } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  expectCount,
  openPage,
  resetToSeed,
} from "./helpers";

// serial: the tests build on each other (save → create → style → delete) —
// fullyParallel would split them across workers and each worker's beforeAll
// re-seeds, destroying the built-up state.
test.describe.serial("page templates", () => {
  let consoleErrors: string[];
  let page: import("@playwright/test").Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  async function openPageActions(): Promise<void> {
    await page.getByRole("button", { name: "Page actions" }).click();
    await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
  }

  async function openSectionMenu(sectionName: string): Promise<void> {
    await page
      .locator('[data-testid="section-row"]')
      .filter({ has: page.getByRole("button", { name: sectionName, exact: true }) })
      .getByRole("button", { name: `Actions for section ${sectionName}`, exact: true })
      .click();
    // exact: true — "New page" is a substring of "New page from template…"
    await page
      .getByRole("menuitem", { name: "New page", exact: true })
      .waitFor({ state: "visible" });
  }

  async function saveAsTemplate(name: string): Promise<void> {
    await openPageActions();
    await page.locator('[data-testid="save-as-template"]').click();
    await page.locator('[data-testid="save-template-dialog"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="template-name-input"]').fill(name);
    await page.locator('[data-testid="save-template-confirm"]').click();
    await page.locator('[data-testid="save-template-dialog"]').waitFor({ state: "hidden" });
    // .first(): an earlier test's IDENTICAL toast can still be mounted —
    // sonner pauses auto-dismiss while hovered, and the mouse rests where
    // the confirm click left it (bottom-center, right on the toast)
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Template saved." })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    // unhover so the toast can dismiss and never collide with a later one
    await page.mouse.move(10, 10);
  }

  async function deleteTemplate(name: string): Promise<void> {
    const row = page.locator('[data-testid="template-row"]').filter({ hasText: name });
    await row.locator('[data-testid="template-delete"]').click();
    await page.locator('[data-testid="template-delete-dialog"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="template-delete-confirm"]').click();
    await expect(row).toHaveCount(0);
  }

  test("PT-E01: save the welcome page as a template (prefilled name, explicit toast)", async () => {
    await openPage(page, "Start here");
    await expectCount(page, 2);

    await openPageActions();
    await page.locator('[data-testid="save-as-template"]').click();
    await page.locator('[data-testid="save-template-dialog"]').waitFor({ state: "visible" });
    // OneNote's own default: the current page title
    await expect(page.locator('[data-testid="template-name-input"]')).toHaveValue("Start here");
    await page.locator('[data-testid="template-name-input"]').fill("Meeting notes");
    await page.locator('[data-testid="save-template-confirm"]').click();
    await page.locator('[data-testid="save-template-dialog"]').waitFor({ state: "hidden" });
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Template saved." })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await page.mouse.move(10, 10);

    // the template is listed in the picker, with its measured meta
    await openPageActions();
    await page.locator('[data-testid="new-page-from-template"]').click();
    await page.locator('[data-testid="templates-dialog"]').waitFor({ state: "visible" });
    const row = page.locator('[data-testid="template-row"]').filter({ hasText: "Meeting notes" });
    await expect(row).toBeVisible();
    await expect(row.locator('[data-testid="template-meta"]')).toContainText("2 elements");
    await page.keyboard.press("Escape");
    await page.locator('[data-testid="templates-dialog"]').waitFor({ state: "hidden" });
  });

  test("PT-E02: create a page from the template — the scene comes back", async () => {
    const rowsBefore = await page.locator('[data-testid="page-row"]').count();

    await openSectionMenu("Getting Started");
    await page.getByRole("menuitem", { name: "New page from template…" }).click();
    await page.locator('[data-testid="templates-dialog"]').waitFor({ state: "visible" });
    await page
      .locator('[data-testid="template-row"]')
      .filter({ hasText: "Meeting notes" })
      .getByRole("button", { name: "Use template Meeting notes" })
      .click();
    await page.locator('[data-testid="templates-dialog"]').waitFor({ state: "hidden" });
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: 'New page created from "Meeting notes".' })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await page.mouse.move(10, 10);

    // the template's full scene payload landed on the fresh page
    await expectCount(page, 2);
    await expect(page.locator('[data-testid="page-row"]')).toHaveCount(rowsBefore + 1);
  });

  test("PT-E03: the paper style rides along with the content", async () => {
    // grid on the current page (the page PT-E02 created)
    await page.getByTestId("background-picker").click();
    await page.locator('[data-testid="paper-menu"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="background-grid"]').click();
    await page.locator('[data-testid="paper-menu"]').waitFor({ state: "hidden" });

    await saveAsTemplate("Grid planner");

    // create a page from it via the page-actions entry — same picker,
    // targeting the current page's own section
    await openPageActions();
    await page.locator('[data-testid="new-page-from-template"]').click();
    await page.locator('[data-testid="templates-dialog"]').waitFor({ state: "visible" });
    await page
      .locator('[data-testid="template-row"]')
      .filter({ hasText: "Grid planner" })
      .getByRole("button", { name: "Use template Grid planner" })
      .click();
    await page.locator('[data-testid="templates-dialog"]').waitFor({ state: "hidden" });

    // content AND paper style carried over
    await expectCount(page, 2);
    await expect(page.getByTestId("background-picker")).toContainText("Grid");
  });

  test("PT-E04: a fresh page saves as stationery — paper style without content", async () => {
    // OneNote's stationery case: a template may carry ONLY the paper style.
    // A fresh page's first autosave writes an empty scene — it saves as a
    // zero-element template.
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);

    await page.getByTestId("background-picker").click();
    await page.locator('[data-testid="paper-menu"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="background-ruled"]').click();
    await page.locator('[data-testid="paper-menu"]').waitFor({ state: "hidden" });

    await saveAsTemplate("Ruled stationery");

    // the picker lists it with its measured zero-element meta
    await openPageActions();
    await page.locator('[data-testid="new-page-from-template"]').click();
    await page.locator('[data-testid="templates-dialog"]').waitFor({ state: "visible" });
    const row = page
      .locator('[data-testid="template-row"]')
      .filter({ hasText: "Ruled stationery" });
    await expect(row.locator('[data-testid="template-meta"]')).toContainText("0 elements");
    await row.getByRole("button", { name: "Use template Ruled stationery" }).click();
    await page.locator('[data-testid="templates-dialog"]').waitFor({ state: "hidden" });

    // paper style carried over, canvas stays empty
    await expectCount(page, 0);
    await expect(page.getByTestId("background-picker")).toContainText("Ruled");
    await page.mouse.move(10, 10);
  });

  test("PT-E05: delete flow with confirm, empty state at the end", async () => {
    await openSectionMenu("Getting Started");
    await page.getByRole("menuitem", { name: "New page from template…" }).click();
    await page.locator('[data-testid="templates-dialog"]').waitFor({ state: "visible" });

    await deleteTemplate("Grid planner");
    await deleteTemplate("Meeting notes");
    await deleteTemplate("Ruled stationery");

    await expect(page.locator('[data-testid="templates-empty"]')).toBeVisible();
    // Escape right after the nested AlertDialog closed can be swallowed
    // (the #226 Radix-dismissal family) — close via the dialog's own button
    await page
      .locator('[data-testid="templates-dialog"]')
      .getByRole("button", { name: "Close" })
      .click();
    await page.locator('[data-testid="templates-dialog"]').waitFor({ state: "hidden" });
  });
});
