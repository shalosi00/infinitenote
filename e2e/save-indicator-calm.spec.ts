/**
 * The "Saved" indicator must stay calm (user-reported flicker).
 *
 * Root cause fixed here: Excalidraw's onChange fires for appState-only
 * updates too (pan, zoom, selection, tool switches), and every one of them
 * used to schedule an autosave — so any viewport interaction blinked
 * "Saving…" / "Saved" even though nothing in the persisted scene changed.
 * The autosave gate now compares a content signature; this spec pins the
 * behavior from both sides:
 *   - real content edits still autosave (organically, no saveNow) and end
 *     on a steady "Saved"
 *   - viewport-only interactions never re-enter the save cycle
 */
import { expect, test } from "@playwright/test";
import {
  E2E_BASE,
  attachErrorCollector,
  drawRectangleOnCanvas,
  expectCount,
  resetToSeed,
  setActiveTool,
} from "./helpers";

test.describe("save indicator stays calm", () => {
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

  /** Record every text change of the save indicator into window.__SAVED_LOG__. */
  async function startIndicatorRecorder(): Promise<void> {
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="save-indicator"]');
      if (!el) throw new Error("save indicator not found");
      const log = (window as unknown as { __SAVED_LOG__?: string[] });
      log.__SAVED_LOG__ = [el.textContent ?? ""];
      new MutationObserver(() => {
        log.__SAVED_LOG__?.push(el.textContent ?? "");
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  async function indicatorLog(): Promise<string[]> {
    return page.evaluate(() => (window as unknown as { __SAVED_LOG__?: string[] }).__SAVED_LOG__ ?? []);
  }

  async function clearIndicatorLog(): Promise<void> {
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="save-indicator"]');
      (window as unknown as { __SAVED_LOG__?: string[] }).__SAVED_LOG__ = [el?.textContent ?? ""];
    });
  }

  test("real edits autosave organically; viewport-only changes never re-save", async () => {
    await startIndicatorRecorder();

    // ---- a real content edit must autosave and settle on "Saved" --------
    await setActiveTool(page, "rectangle");
    await drawRectangleOnCanvas(page);
    await setActiveTool(page, "selection");
    await expectCount(page, 3); // 2 seed elements + the rectangle
    await expect(
      page.getByTestId("save-indicator"),
      "organic autosave (no saveNow) must end on Saved",
    ).toContainText("Saved", { timeout: 10_000 });

    // ---- viewport-only changes must not re-enter the save cycle ---------
    await clearIndicatorLog();

    // pan via appState update
    await page.evaluate(() => {
      const api = window.__NOTE_E2E__?.excalidraw as unknown as {
        updateScene: (opts: { appState: Record<string, unknown> }) => void;
        getAppState: () => { scrollX: number; scrollY: number };
      };
      const s = api.getAppState();
      api.updateScene({ appState: { scrollX: s.scrollX + 137.5, scrollY: s.scrollY - 42.25 } });
    });
    // zoom-to-fit (viewport zoom change)
    await page.evaluate(() => {
      window.__NOTE_E2E__?.excalidraw.scrollToContent(undefined, {
        fitToViewport: true,
        viewportZoomFactor: 0.7,
      });
    });
    // tool switch (pure appState)
    await setActiveTool(page, "rectangle");
    await setActiveTool(page, "selection");
    // click on empty canvas — deselects the rectangle (selection appState)
    const box = await page.locator(".excalidraw").boundingBox();
    if (!box) throw new Error(".excalidraw container not found");
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.15);

    // wait out the autosave debounce window — nothing may fire
    await page.waitForTimeout(1_600);

    const log = await indicatorLog();
    expect(
      new Set(log),
      `viewport-only changes must keep the label steady; saw: ${JSON.stringify(log)}`,
    ).toEqual(new Set(["Saved"]));

    // ---- persistence is intact ------------------------------------------
    await page.reload();
    await expectCount(page, 3);
  });

  test("an edit undone inside the debounce window never persists", async () => {
    // The gate must not merely skip NEW writes — it must also drop a pending
    // stash when the scene returns to the persisted state. Draw a rectangle,
    // undo it before the 700ms debounce fires, and prove nothing lands: the
    // label never moves and a reload shows the pre-edit scene. (Regression:
    // the first version of the gate early-returned without clearing the
    // stash, so the undone scene was written anyway.)
    await startIndicatorRecorder();

    // Robust tool activation: right after a reload, Excalidraw's App.restore
    // can still be settling and resets activeTool to the default — on slow
    // CI the plain setActiveTool lands in that window and gets clobbered,
    // turning the draw into a selection marquee. Set-and-verify until the
    // tool actually reads back as rectangle.
    await expect
      .poll(
        async () => {
          await setActiveTool(page, "rectangle");
          return page.evaluate(
            () =>
              (window.__NOTE_E2E__?.excalidraw.getAppState() as unknown as {
                activeTool?: { type?: string };
              })?.activeTool?.type ?? "",
          );
        },
        { timeout: 10_000, message: "rectangle tool must stick after the reload" },
      )
      .toBe("rectangle");
    await drawRectangleOnCanvas(page);
    // resolves on the first poll (the element exists from pointerdown), so
    // this check stays far inside the debounce window
    await expectCount(page, 4);

    // undo IMMEDIATELY — no intermediate steps that could eat the 700ms
    await page.keyboard.press("Control+z");
    await expectCount(page, 3);

    // outlive the debounce window — nothing may fire
    await page.waitForTimeout(1_600);
    const log = await indicatorLog();
    expect(log, `undo must not even wake the label; saw: ${JSON.stringify(log)}`).toEqual([""]);

    // the undone rectangle must NOT have been persisted by the stale stash
    await page.reload();
    await expectCount(page, 3);
  });
});
