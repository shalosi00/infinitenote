import { expect, test, type Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Password-protected sections, phase 2 (issue #378) — wave 26: the two
 * candidates #371 named, both OneNote desktop parity.
 *
 * Seed layout (deterministic, from the welcome seed):
 *   Welcome Notebook (violet) / Getting Started / "Start here"
 *   Welcome Notebook (violet) / Ideas           / "Brainstorm"
 *   My Notebook     (teal)    / New Section      / "Page 1"
 *
 * OneNote's flow:
 * - Right-click any section tab → Password Protection → "Lock Protected
 *   Sections" locks ALL protected sections at once (not just the clicked
 *   one). The item here renders in the submenu whenever at least one
 *   protected section exists; the toast reports the count.
 * - File > Options > Password: protected sections re-lock after
 *   configurable inactivity — the default keeps them unlocked 10 minutes.
 *   The dialog here follows the same minutes semantics (0 = off, 1–720
 *   valid); the setting is per-device localStorage (the themes/last-page
 *   precedent).
 *
 * The section under test is "New Section" (My Notebook) — the same one the
 * phase-1 spec uses, with the same deterministic marker scene.
 */

const SECTION = "New Section";
const PAGE = "Page 1";
const MARKER = "PWP2-E2E-MARKER";
const PASSWORD = "s3cret-pw";

test.describe.serial("password-protected sections, phase 2 (issue #378)", () => {
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

  const closeMenus = async (): Promise<void> => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
  };

  /** Open the section kebab menu and hover the protection submenu open. */
  const openProtectionSubmenu = async (): Promise<void> => {
    await sectionRow(SECTION)
      .getByRole("button", { name: `Actions for section ${SECTION}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("menuitem", { name: "Password protection" }).hover();
    await page
      .getByRole("menuitem", { name: "Set password…", exact: true })
      .or(page.getByRole("menuitem", { name: "Change password…", exact: true }))
      .first()
      .waitFor({ state: "visible" });
  };

  const badge = () => sectionRow(SECTION).locator('[data-testid="section-lock-badge"]');

  /** Expand a collapsible sidebar row only when it is folded (a blind
      toggle click would COLLAPSE an already-expanded row — the wave-22
      locator lesson). The poll RE-CLICKS on every iteration: a click that
      lands during boot hydration (post-reload, slow CI runner) is
      swallowed by the not-yet-attached handler, so the first attempt
      alone is not trustworthy. */
  const ensureExpanded = async (name: string): Promise<void> => {
    const toggle = page.getByRole("button", { name, exact: true }).first();
    await expect
      .poll(
        async () => {
          if ((await toggle.getAttribute("aria-expanded")) !== "true") {
            await toggle.click();
          }
          return toggle.getAttribute("aria-expanded");
        },
        { timeout: 20_000, intervals: [250, 500, 1000] },
      )
      .toBe("true");
  };

  /** Reveal the test section's page rows (My Notebook folds in the seed). */
  const revealSection = async (): Promise<void> => {
    await ensureExpanded("My Notebook");
    await ensureExpanded(SECTION);
  };

  /** Open the seeded page and unlock it through the unlock card when the
      section is locked. Leaves the canvas showing the page's content. */
  const unlockViaCard = async (): Promise<void> => {
    await revealSection();
    await pageRow(PAGE).getByRole("button", { name: PAGE, exact: true }).click();
    await expect(page.getByTestId("section-unlock-card")).toBeVisible();
    await page.getByTestId("unlock-password-input").fill(PASSWORD);
    await page.getByTestId("unlock-submit").click();
    await expect(page.getByTestId("section-unlock-card")).toHaveCount(0);
    await expect(badge()).toHaveAttribute("data-lock-state", "unlocked");
  };

  /** Set the protection password through the submenu + dialog. */
  const protectSection = async (): Promise<void> => {
    await openProtectionSubmenu();
    await page.getByRole("menuitem", { name: "Set password…", exact: true }).click();
    const dialog = page.getByTestId("section-protection-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("protection-password-input").fill(PASSWORD);
    await page.getByTestId("protection-again-input").fill(PASSWORD);
    await page.getByTestId("protection-submit").click();
    await expect(dialog).toHaveCount(0);
    await expect(badge()).toHaveAttribute("data-lock-state", "unlocked");
  };

  /** Open the auto-lock dialog (minutes input pre-fills from the store). */
  const openAutoLockDialog = async (): Promise<void> => {
    await openProtectionSubmenu();
    await page.getByTestId("section-protection-autolock").click();
    await expect(page.getByTestId("auto-lock-dialog")).toBeVisible();
  };

  const saveAutoLock = async (minutes: string): Promise<void> => {
    await page.getByTestId("autolock-minutes-input").fill(minutes);
    await page.getByTestId("autolock-save").click();
    await expect(page.getByTestId("auto-lock-dialog")).toHaveCount(0);
  };

  test("PWP2-N01: lock-all locks every protected section; item hides with nothing protected", async () => {
    await revealSection();
    // with NOTHING protected, the lock-all item must not render; the
    // auto-lock item (app-global) always does
    await openProtectionSubmenu();
    await expect(
      page.getByRole("menuitem", { name: "Lock all protected sections", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("section-protection-autolock")).toBeVisible();
    await closeMenus();

    await protectSection();

    // unlocked right after protect (phase-1 semantics) — lock-all now
    // renders and flips every open key at once (OneNote: "Lock Protected
    // Sections" in the same submenu)
    await openProtectionSubmenu();
    await page.getByRole("menuitem", { name: "Lock all protected sections", exact: true }).click();
    await expect(
      page.getByText("Locked 1 protected section.", { exact: true }),
    ).toBeVisible();
    await expect(badge()).toHaveAttribute("data-lock-state", "locked");
    await closeMenus();

    // the open page swaps for the unlock card (the reactive mirror)
    await pageRow(PAGE).getByRole("button", { name: PAGE, exact: true }).click();
    await expect(page.getByTestId("section-unlock-card")).toBeVisible();
    await closeMenus();
  });
  test("PWP2-N02: auto-lock after 1 minute of inactivity re-locks the section", async () => {
    test.setTimeout(180_000);
    await unlockViaCard();

    // the dialog pre-fills OneNote's default (10) — never saved before
    await openAutoLockDialog();
    await expect(page.getByTestId("autolock-minutes-input")).toHaveValue("10");
    // invalid drafts show the inline error and never save ("721" is over
    // the 720 cap; fill() on a number input requires numeric text)
    await page.getByTestId("autolock-minutes-input").fill("721");
    await page.getByTestId("autolock-save").click();
    await expect(page.getByTestId("autolock-error")).toBeVisible();
    await expect(page.getByTestId("auto-lock-dialog")).toBeVisible();

    // save 1 minute; the Save click is the LAST activity in this test —
    // from here on only non-input polling happens (attribute/readability
    // polls emit no pointerdown/keydown/wheel/touchstart)
    await saveAutoLock("1");

    // deadline = last activity + 60s; the 15s interval fires it in ≤75s
    await expect(badge()).toHaveAttribute("data-lock-state", "locked", { timeout: 85_000 });
    await expect(
      page.getByText("Auto-locked 1 protected section after inactivity.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("section-unlock-card")).toBeVisible({ timeout: 15_000 });
    await closeMenus();
  });

  test("PWP2-N03: auto-lock off (0) never re-locks; the setting persists a reload", async () => {
    test.setTimeout(180_000);
    await unlockViaCard();

    // the dialog pre-fills the saved value (1) — the setting persisted
    await openAutoLockDialog();
    await expect(page.getByTestId("autolock-minutes-input")).toHaveValue("1");
    await saveAutoLock("0");

    // with auto-lock OFF the effect tears down (no listeners, no timer);
    // wait past the deadline a 1-minute setting would have used — the
    // section must stay unlocked the whole time
    await expect(badge()).toHaveAttribute("data-lock-state", "unlocked");
    await page.waitForTimeout(70_000);
    await expect(badge()).toHaveAttribute("data-lock-state", "unlocked");
    await expect(page.getByTestId("section-unlock-card")).toHaveCount(0);

    // a reload proves the setting persisted (the dialog pre-fills 0)
    await page.reload();
    await revealSection();
    await openAutoLockDialog();
    await expect(page.getByTestId("autolock-minutes-input")).toHaveValue("0");
    await page.getByTestId("autolock-cancel").click();
    await expect(page.getByTestId("auto-lock-dialog")).toHaveCount(0);
    await closeMenus();
  });

  test("PWP2-N04: remove password; lock-all item hides again", async () => {
    // still unlocked from N03 — clean up the whole protection
    await revealSection();
    await openProtectionSubmenu();
    await page.getByRole("menuitem", { name: "Remove password…", exact: true }).click();
    const dialog = page.getByTestId("section-protection-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("protection-current-input").fill(PASSWORD);
    await page.getByTestId("protection-submit").click();
    await expect(dialog).toHaveCount(0);
    await expect(badge()).toHaveCount(0);

    // back to nothing protected: the lock-all item is gone again, and the
    // auto-lock item stays (it is app-global, not per-section)
    await openProtectionSubmenu();
    await expect(
      page.getByRole("menuitem", { name: "Lock all protected sections", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("section-protection-autolock")).toBeVisible();
    await closeMenus();
  });
});
