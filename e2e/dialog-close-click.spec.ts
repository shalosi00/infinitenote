/**
 * Closing overlays must not swallow clicks (found by version-history E2E).
 *
 * Every Radix overlay animates its exit (`data-[state=closed]:animate-out`)
 * and stays mounted for the animation's duration. Without
 * `data-[state=closed]:pointer-events-none`, a just-closed modal dialog's
 * overlay still carried pointer events across the whole viewport — the first
 * canvas interaction within ~200 ms of closing any dialog was silently
 * dropped (raw mouse events are exactly what the canvas uses).
 *
 * Pins the invariant from two sides:
 *   1. style probe — while a closed overlay is still mounted (mid-exit),
 *      its computed pointer-events must be "none"
 *   2. functional probe — a raw click on the canvas immediately after
 *      Escape opens the text editor, nothing is swallowed
 */
import { expect, test } from "@playwright/test";
import { attachErrorCollector, resetToSeed, setActiveTool } from "./helpers";

test.describe("closing overlays stop swallowing clicks", () => {
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

  test("a just-closed dialog is click-transparent (style + functional)", async () => {
    await setActiveTool(page, "text");

    // open any app dialog (the shortcuts cheatsheet: ? key)
    await page.keyboard.press("Shift+Slash");
    await page
      .locator('[role="dialog"]')
      .filter({ hasText: "Keyboard shortcuts" })
      .waitFor({ state: "visible" });

    // close it and probe DURING the exit animation
    await page.keyboard.press("Escape");
    const overlayPointerEvents = await page.evaluate(async () => {
      // first let Radix commit the closed state (the keypress can resolve
      // before React re-renders — an OPEN overlay legitimately has
      // pointer-events auto), then probe while the exit animation runs
      const q = () => document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
      for (let i = 0; i < 50; i++) {
        const el = q();
        if (!el || el.dataset.state === "closed") break;
        await new Promise((r) => setTimeout(r, 5));
      }
      // still mounted mid-exit? its pointer events are what matters; if the
      // animation already finished there is nothing to check (pass trivially)
      const overlay = q();
      if (!overlay) return "gone";
      return getComputedStyle(overlay).pointerEvents;
    });
    // "gone" (animation already finished) or "none" (transparent) — never
    // "auto": a closing overlay must never intercept input
    expect(["gone", "none"]).toContain(overlayPointerEvents);

    // second half of the invariant: Radix stamps `pointer-events: none`
    // onto <body> while a modal layer is open and removes it only when the
    // exit-animated layer unmounts — our Dialog wrapper clears it the
    // moment `open` flips false. A closed dialog must leave the body live.
    const bodyPointerEvents = await page.evaluate(
      () => document.body.style.pointerEvents || "(unset)",
    );
    expect(bodyPointerEvents).toBe("(unset)");

    // functional: a raw click on the canvas must reach it immediately
    const box = await page.locator(".excalidraw").boundingBox();
    const x = box!.x + box!.width * 0.6;
    const y = box!.y + box!.height * 0.75;
    await page.mouse.click(x, y);
    await expect(page.locator(".excalidraw textarea").last()).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.press("Escape");
  });
});
