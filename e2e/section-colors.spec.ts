import { expect, test, type Locator, type Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";
import { NOTEBOOK_COLOR_HEX } from "../src/lib/types";

/**
 * Section colors (OneNote "Section Color" parity, issue #319) — wave 17.
 *
 * Seed layout (deterministic, from the welcome seed):
 *   Welcome Notebook (violet) / Getting Started / "Start here"
 *   Welcome Notebook (violet) / Ideas           / "Brainstorm"
 *   My Notebook     (teal)    / New Section      / "Page 1"
 *
 * Every section renders a colored swatch (the notebook row's exact swatch
 * pattern): the section's own override when set, the notebook's color when
 * not. The section menu gains a Color submenu — the 8-color palette plus
 * "Use notebook color" — OneNote's right-click the tab → Section Color flow.
 *
 * Lessons applied (wave 16): every shared-prefix menu item is addressed with
 * exact: true ("Color" would substring-match "Use notebook color" — Playwright
 * name matching is case-insensitive); assertions behind a store action go
 * through toHaveCSS/expect.poll instead of immediate reads; the reload-boot
 * drop window (~1.5 s) is re-verified past 1.6 s; the Radix submenu needs
 * hover → waitFor item → click.
 */

const rgbOf = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

test.describe.serial("section colors (issue #319)", () => {
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
    page
      .locator('[data-testid="section-row"]')
      .filter({ has: page.getByRole("button", { name, exact: true }) })
      .getByRole("button", { name: `Actions for section ${name}`, exact: true });

  /**
   * The colored swatch of a section's OWN row. Nested rows render inside
   * their parent's row div, so a parent that contains a child with the same
   * name filter matches twice — .last() picks the deepest (the child), and
   * the parent's OWN swatch is always the .first() inside its row.
   */
  const sectionSwatch = (name: string): Locator =>
    page
      .locator('[data-testid="section-row"]')
      .filter({ has: page.getByRole("button", { name, exact: true }) })
      .last()
      .locator('[data-testid="section-color"]')
      .first();

  /** Open the section's kebab menu, expand the Color submenu. */
  const openColorSubmenu = async (name: string, color: string): Promise<void> => {
    await sectionMenu(name).click();
    // exact: true — "Color" is case-insensitively a substring of
    // "Use notebook color"
    await page.getByRole("menuitem", { name: "Color", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("menuitem", { name: "Color", exact: true }).hover();
    await page
      .getByRole("button", { name: `Set section color ${color}`, exact: true })
      .waitFor({ state: "visible" });
  };

  /** Radix keeps a plain-button submenu open — Escape twice, then assert. */
  const closeMenus = async (): Promise<void> => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
  };

  test("SC-N01: the section menu gains Color and an override re-renders the swatch", async () => {
    // every section renders the swatch from day one — inherited, not overridden
    await expect(sectionSwatch("Getting Started")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.violet),
    );
    await expect(sectionSwatch("Ideas")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.violet),
    );
    // My Notebook ships COLLAPSED in the seed — expand it so its section
    // row (and swatch) is rendered before asserting
    await page.getByRole("button", { name: "My Notebook", exact: true }).click();
    await expect(sectionSwatch("New Section")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.teal),
    );

    // OneNote's flow: the section's menu → Section Color → pick a color
    await openColorSubmenu("Getting Started", "rose");
    await page
      .getByRole("button", { name: "Set section color rose", exact: true })
      .click();
    // a modal Radix menu aria-hides the app root — role queries see nothing
    // until it closes; close first, then assert (toHaveCSS still polls past
    // the store-action commit)
    await closeMenus();
    await expect(sectionSwatch("Getting Started")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.rose),
    );
    // the sibling sections were not touched
    await expect(sectionSwatch("Ideas")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.violet),
    );
    await expect(sectionSwatch("New Section")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.teal),
    );
    await closeMenus();
  });

  test("SC-N02: Use notebook color clears the override back to inheritance", async () => {
    await openColorSubmenu("Getting Started", "rose");
    await page.getByRole("menuitem", { name: "Use notebook color", exact: true }).click();
    await expect(sectionSwatch("Getting Started")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.violet),
    );
    await closeMenus();
  });

  test("SC-N03: an explicit color survives a reload", async () => {
    await openColorSubmenu("Ideas", "rose");
    await page
      .getByRole("button", { name: "Set section color rose", exact: true })
      .click();
    await closeMenus();
    await expect(sectionSwatch("Ideas")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.rose),
    );

    await page.reload();
    await expect(page.getByTestId("sidebar")).toContainText("Ideas");
    await expect(sectionSwatch("Ideas")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.rose),
    );
    // re-verify past the documented ~1.5 s reload-boot drop window: a late
    // boot re-hydrating the store from a stale snapshot must not flip the
    // override back to the inherited color (the SB-N01 lesson)
    await page.waitForTimeout(1_600);
    await expect(sectionSwatch("Ideas")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.rose),
    );
    await expect(sectionSwatch("Getting Started")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.violet),
    );
    await closeMenus();
  });

  test("SC-N04: a sub-section inherits the notebook color until overridden", async () => {
    // Ideas now carries SC-N03's rose override; its sub-section must NOT
    // inherit it — inheritance is from the NOTEBOOK (violet), never from
    // the parent section
    await sectionMenu("Ideas").click();
    await page.getByRole("menuitem", { name: "New sub-section", exact: true }).click();
    // the Welcome Notebook's next generated section title is "Section 3"
    await expect(page.getByTestId("sidebar")).toContainText("Section 3");
    await expect(sectionSwatch("Section 3")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.violet),
    );

    // override the child; the parent section keeps its own override
    await openColorSubmenu("Section 3", "emerald");
    await page
      .getByRole("button", { name: "Set section color emerald", exact: true })
      .click();
    await closeMenus();
    await expect(sectionSwatch("Section 3")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.emerald),
    );
    await expect(sectionSwatch("Ideas")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.rose),
    );

    // re-verify past the boot drop window, then leave a clean state
    await page.waitForTimeout(1_600);
    await expect(sectionSwatch("Section 3")).toHaveCSS(
      "background-color",
      rgbOf(NOTEBOOK_COLOR_HEX.emerald),
    );
  });
});
