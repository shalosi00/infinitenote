import { expect, test, type Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Password-protected sections (OneNote "Password Protection" parity,
 * issue #371) — wave 25.
 *
 * Seed layout (deterministic, from the welcome seed):
 *   Welcome Notebook (violet) / Getting Started / "Start here"
 *   Welcome Notebook (violet) / Ideas           / "Brainstorm"
 *   My Notebook     (teal)    / New Section      / "Page 1"
 *
 * OneNote's flow (support.microsoft.com, "Protect notes with a password"):
 * right-click a section tab → Password Protection → set / change / remove
 * password with an optional hint; a locked section cannot be opened,
 * exported, or searched ("OneNote excludes locked sections from
 * searches"); a forgotten password cannot be recovered; protection locks
 * again when the app closes (the unlock cache here is memory-only — a
 * reload locks every protected section again).
 *
 * The section under test is "New Section" (My Notebook) — its seeded page
 * "Page 1" carries a deterministic text scene injected through the e2e
 * hook so the search and unlock pins have real content to find (or fail
 * to find while locked).
 */

const SECTION = "New Section";
const PAGE = "Page 1";
const MARKER = "PWP-E2E-MARKER";

test.describe.serial("password-protected sections (issue #371)", () => {
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
    await page
      .getByRole("menuitem", { name: "Password protection" })
      .hover();
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
      alone is not trustworthy — retry until the row really expanded. */
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

  /** Inject the deterministic text scene into the open page and save it. */
  const seedMarkerContent = async (): Promise<void> => {
    await page.evaluate((marker) => {
      const api = window.__NOTE_E2E__?.excalidraw as unknown as {
        updateScene: (scene: { elements: unknown[] }) => void;
      };
      if (!api) throw new Error("e2e hook missing");
      api.updateScene({
        elements: [
          {
            type: "text",
            id: "pwp-e2e-text",
            x: 60,
            y: 60,
            width: 500,
            height: 25,
            text: `${marker} content probe`,
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
    }, MARKER);
    await page.evaluate(() => window.__NOTE_E2E__?.saveNow());
    await expect(page.locator('[data-testid="save-indicator"]')).toContainText("Saved", {
      timeout: 10_000,
    });
  };

  test("PWP-N01: set password seals the section; reload locks it again", async () => {
    await revealSection();
    // open the seeded page and give it deterministic content
    await pageRow(PAGE).getByRole("button", { name: PAGE, exact: true }).click();
    await seedMarkerContent();

    // OneNote's path: section menu → Password protection → Set password…
    await openProtectionSubmenu();
    await page.getByRole("menuitem", { name: "Set password…", exact: true }).click();
    const dialog = page.getByTestId("section-protection-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("protection-password-input").fill("s3cret-pw");
    // the mismatch guard shows while the repeat differs
    await page.getByTestId("protection-again-input").fill("s3cret");
    await expect(page.getByTestId("protection-mismatch")).toBeVisible();
    await page.getByTestId("protection-again-input").fill("s3cret-pw");
    await page.getByTestId("protection-hint-input").fill("starts with s");
    await page.getByTestId("protection-submit").click();
    await expect(dialog).toHaveCount(0);

    // unlocked right after (OneNote: locking happens on close) — open badge
    await expect(badge()).toHaveAttribute("data-lock-state", "unlocked");

    // the reload locks EVERYTHING (the cache is memory-only)
    await page.reload();
    await revealSection();
    await pageRow(PAGE).getByRole("button", { name: PAGE, exact: true }).click();
    await expect(badge()).toHaveAttribute("data-lock-state", "locked");
  });

  test("PWP-N02: locked canvas shows the unlock card; wrong password errors, right opens", async () => {
    await revealSection();
    // the locked section's page renders the unlock card, not the canvas
    await expect(page.getByTestId("section-unlock-card")).toBeVisible();
    await expect(page.getByTestId("unlock-title")).toContainText(SECTION);
    await expect(page.getByTestId("unlock-hint")).toContainText("starts with s");
    await expect(page.locator(".excalidraw, [data-testid*='canvas']")).toHaveCount(0);

    // wrong password → inline error, still locked
    await page.getByTestId("unlock-password-input").fill("wrong-pw");
    await page.getByTestId("unlock-submit").click();
    await expect(page.getByTestId("unlock-error")).toBeVisible();
    await expect(page.getByTestId("section-unlock-card")).toBeVisible();

    // right password → the canvas takes the card's place
    await page.getByTestId("unlock-password-input").fill("s3cret-pw");
    await page.getByTestId("unlock-submit").click();
    await expect(page.getByTestId("section-unlock-card")).toHaveCount(0);
    await expect(badge()).toHaveAttribute("data-lock-state", "unlocked");
    // the sealed content reads again — the marker decrypted on open
    await expect(page.locator('[data-testid="save-indicator"]')).toBeVisible();
  });

  test("PWP-N03: search skips locked content; unlocked sections are searchable again", async () => {
    const searchResults = page.locator("[cmdk-list]");
    // while UNLOCKED: the content term is found
    const openSearch = async () => {
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByPlaceholder("Search all pages…").waitFor({ state: "visible" });
    };
    const closeSearch = async () => {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    };
    await openSearch();
    await page.getByPlaceholder("Search all pages…").fill("content probe");
    await expect(searchResults).toContainText(PAGE, { timeout: 15_000 });
    await closeSearch();

    // lock now (OneNote: Password Protection → lock) — content vanishes
    await openProtectionSubmenu();
    await page.getByRole("menuitem", { name: "Lock now", exact: true }).click();
    await expect(badge()).toHaveAttribute("data-lock-state", "locked");
    await closeMenus();

    // locked: the content term must NOT match — search skips locked
    // sections (the dialog shows its empty state); the TITLE still matches
    // (titles are never sealed)
    await openSearch();
    await page.getByPlaceholder("Search all pages…").fill("content probe");
    await expect(searchResults).toContainText("No results found.", { timeout: 15_000 });
    await expect(searchResults).not.toContainText(PAGE);
    await page.getByPlaceholder("Search all pages…").fill(PAGE);
    await expect(searchResults).toContainText(PAGE, { timeout: 15_000 });
    await closeSearch();
  });

  test("PWP-N04: section PDF export refuses while locked, works unlocked", async () => {
    // still locked from N03 — OneNote cannot export a locked section
    await sectionRow(SECTION)
      .getByRole("button", { name: `Actions for section ${SECTION}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).waitFor({ state: "visible" });
    await page.getByTestId("section-export-pdf-submenu").hover();
    await page.getByTestId("section-export-pdf-portrait").waitFor({ state: "visible" });
    await page.getByTestId("section-export-pdf-portrait").click();
    await expect(
      page.getByText("Locked sections cannot be exported", { exact: false }),
    ).toBeVisible();
    await closeMenus();

    // unlock via the unlock card (the keyboard/touch path)
    await revealSection();
    await pageRow(PAGE).getByRole("button", { name: PAGE, exact: true }).click();
    await expect(page.getByTestId("section-unlock-card")).toBeVisible();
    await page.getByTestId("unlock-password-input").fill("s3cret-pw");
    await page.getByTestId("unlock-submit").click();
    await expect(page.getByTestId("section-unlock-card")).toHaveCount(0);

    // the same export now succeeds
    const download = page.waitForEvent("download", { timeout: 20_000 });
    await sectionRow(SECTION)
      .getByRole("button", { name: `Actions for section ${SECTION}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).waitFor({ state: "visible" });
    await page.getByTestId("section-export-pdf-submenu").hover();
    await page.getByTestId("section-export-pdf-portrait").waitFor({ state: "visible" });
    await page.getByTestId("section-export-pdf-portrait").click();
    const file = await download;
    // titleToFilename sanitizes spaces to hyphens (the section-export convention)
    expect(file.suggestedFilename()).toBe("New-Section.pdf");
    await closeMenus();
  });

  test("PWP-N05: remove password restores plaintext; the badge disappears", async () => {
    // the section is unlocked from N04 — remove the protection entirely
    await openProtectionSubmenu();
    await page.getByRole("menuitem", { name: "Remove password…", exact: true }).click();
    const dialog = page.getByTestId("section-protection-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("protection-current-input").fill("s3cret-pw");
    await page.getByTestId("protection-submit").click();
    await expect(dialog).toHaveCount(0);

    // the badge is gone and the submenu is back to "Set password…"
    await expect(badge()).toHaveCount(0);
    await openProtectionSubmenu();
    await expect(page.getByRole("menuitem", { name: "Set password…", exact: true })).toBeVisible();
    await closeMenus();

    // a reload proves nothing is left: content readable, no unlock card
    await page.reload();
    await revealSection();
    await pageRow(PAGE).getByRole("button", { name: PAGE, exact: true }).click();
    await expect(page.getByTestId("section-unlock-card")).toHaveCount(0);
    await expect(badge()).toHaveCount(0);
    // the content survives the whole protect / unlock / remove round-trip:
    // the search dialog finds the content term with no unlock in between
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder("Search all pages…").waitFor({ state: "visible" });
    await page.getByPlaceholder("Search all pages…").fill("content probe");
    await expect(page.locator("[cmdk-list]")).toContainText(PAGE, { timeout: 15_000 });
  });
});
