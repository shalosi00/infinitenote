// TEMPORARY local-only capture spec (never committed) — wave-12 PR previews.
import { test } from "@playwright/test";
import { attachErrorCollector, expectCount, openPage, resetToSeed } from "./helpers";

test("capture wave-12 previews", async ({ page }) => {
  const errors = attachErrorCollector(page);
  await resetToSeed(page);
  await openPage(page, "Start here");
  await expectCount(page, 2); // settle: the seed page's normalization save

  // shot 1: the Save-as-template dialog with its page-title prefill
  await page.getByRole("button", { name: "Page actions" }).click();
  await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
  await page.locator('[data-testid="save-as-template"]').click();
  await page.locator('[data-testid="save-template-dialog"]').waitFor({ state: "visible" });
  await page.locator('[data-testid="save-template-dialog"]').screenshot({
    path: "e2e-artifacts/wave12-save-dialog.png",
  });
  await page.locator('[data-testid="template-name-input"]').fill("Meeting notes");
  await page.locator('[data-testid="save-template-confirm"]').click();
  await page.locator('[data-testid="save-template-dialog"]').waitFor({ state: "hidden" });
  await page.mouse.move(10, 10);
  await page.waitForTimeout(4500); // let the toast retire before the next shot

  // shot 2: the picker with a real template row (meta: elements · KB · age)
  await page.getByRole("button", { name: "Page actions" }).click();
  await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
  await page.locator('[data-testid="new-page-from-template"]').click();
  await page.locator('[data-testid="templates-dialog"]').waitFor({ state: "visible" });
  await page.locator('[data-testid="templates-dialog"]').screenshot({
    path: "e2e-artifacts/wave12-picker.png",
  });

  // eslint-disable-next-line no-console
  console.log("console errors:", errors.length);
});
