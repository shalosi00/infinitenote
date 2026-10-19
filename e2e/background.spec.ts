import { test, expect, type Page } from "@playwright/test";
import { attachErrorCollector, openPage, resetToSeed } from "./helpers";

/**
 * Page paper styles: plain / ruled / grid.
 * - grid = Excalidraw's native gridModeEnabled (renders below elements)
 * - ruled = a pointer-events-none overlay whose tile size/phase is locked to
 *   the viewport transform — proven here by asserting the computed
 *   background-size/position change with zoom and pan.
 */
test.describe.serial("page backgrounds: plain / ruled / grid", () => {
  let page: Page;
  let consoleErrors: string[];

  /** Open the paper menu deterministically (wait out Radix animations). */
  async function openPaperMenu(): Promise<void> {
    await expect(page.getByTestId("paper-menu")).toBeHidden();
    await page.getByTestId("background-picker").click();
    await expect(page.getByTestId("paper-menu")).toBeVisible();
  }

  /** Select a paper style and wait for the menu to fully close. */
  async function choosePaper(kind: "plain" | "ruled" | "grid"): Promise<void> {
    await openPaperMenu();
    await page.getByTestId(`background-${kind}`).click();
    await expect(page.getByTestId("paper-menu")).toBeHidden();
  }

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("defaults to plain: no overlay, gridMode off", async () => {
    await openPage(page, "Start here");
    await expect(page.getByTestId("ruled-paper")).toHaveCount(0);
    expect(await gridMode(page)).toBe(false);
  });

  test("switching to ruled shows the paper overlay and syncs with zoom", async () => {
    await choosePaper("ruled");
    const layer = page.getByTestId("ruled-paper");
    await expect(layer).toBeVisible();

    // overlay is sized from the first frame (not waiting for interaction)
    const initialSize = await bgStyle(page, "backgroundSize");
    expect(initialSize).toMatch(/^100% \d+(\.\d+)?px$/);

    // zoom in (ctrl+wheel) — the tile must scale with the viewport transform
    const canvas = await page.locator(".excalidraw").boundingBox();
    if (!canvas) throw new Error("canvas not found");
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -400);
    await page.keyboard.up("Control");
    await expect
      .poll(() => bgStyle(page, "backgroundSize"), { timeout: 10_000 })
      .not.toBe(initialSize);
  });

  test("ruled overlay follows panning", async () => {
    const beforePos = await bgStyle(page, "backgroundPosition");
    const canvas = await page.locator(".excalidraw").boundingBox();
    if (!canvas) throw new Error("canvas not found");
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    // plain wheel pans the canvas (no ctrl)
    await page.mouse.wheel(0, 240);
    await expect
      .poll(() => bgStyle(page, "backgroundPosition"), { timeout: 10_000 })
      .not.toBe(beforePos);
  });

  test("switching to grid enables native gridMode and drops the overlay", async () => {
    await choosePaper("grid");
    await expect(page.getByTestId("ruled-paper")).toHaveCount(0);
    await expect.poll(() => gridMode(page), { timeout: 10_000 }).toBe(true);
  });

  test("switching back to plain disables everything", async () => {
    await choosePaper("plain");
    await expect(page.getByTestId("ruled-paper")).toHaveCount(0);
    await expect.poll(() => gridMode(page), { timeout: 10_000 }).toBe(false);
  });

  test("paper style persists across a reload", async () => {
    await choosePaper("ruled");
    await page.reload();
    await openPage(page, "Start here");
    await expect(page.getByTestId("ruled-paper")).toBeVisible();
    const initialSize = await bgStyle(page, "backgroundSize");
    expect(initialSize).toMatch(/^100% \d+(\.\d+)?px$/);
  });
});

async function gridMode(p: Page): Promise<boolean> {
  return p.evaluate(() => window.__NOTE_E2E__?.excalidraw.getAppState().gridModeEnabled ?? false);
}

async function bgStyle(p: Page, prop: "backgroundSize" | "backgroundPosition"): Promise<string> {
  return p.evaluate(
    (name) => {
      const el = document.querySelector('[data-testid="ruled-paper"]');
      return el ? getComputedStyle(el)[name] : "missing";
    },
    prop,
  );
}
