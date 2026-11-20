/**
 * In-page find E2E (test plan: docs/test-plans/page-find.md, ids PF-E*).
 * OneNote "Find on this page" parity (issue #301): Ctrl/Cmd+F opens a
 * floating find bar over the canvas, matching the page's visible text
 * elements case-insensitively in reading order; Enter/Shift+Enter (and
 * the bar buttons) cycle with wrap-around; navigation selects + scrolls
 * to the match WITHOUT moving focus out of the input; Esc closes and
 * hands the keyboard back to the canvas; switching pages closes the bar.
 *
 * Deterministic paths only: PF-E01 runs on the welcome seed ("Start
 * here" — 2 text elements, query derived from the scene itself so the
 * seed's wording can drift safely); PF-E02+ build their own text
 * elements on the EMPTY "Brainstorm" page (no seed-element collisions).
 */
import { expect, test, type Page } from "@playwright/test";
import {
  attachErrorCollector,
  expectCount,
  openPage,
  resetToSeed,
  scrollOf,
  selectedElementIds,
  serializeCurrentPage,
  setActiveTool,
} from "./helpers";

interface SceneText {
  id: string;
  text: string;
  x: number;
  y: number;
}

/** The scene's visible text elements in the policy's reading order. */
function sceneTexts(scene: { elements: Array<Record<string, unknown>> }): SceneText[] {
  return scene.elements
    .filter(
      (e) =>
        e.type === "text" &&
        typeof e.text === "string" &&
        (e.text as string).trim() &&
        !e.isDeleted,
    )
    .map((e) => ({ id: e.id as string, text: e.text as string, x: e.x as number, y: e.y as number }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Total occurrence count across all scene texts (spec-side oracle). */
function occurrenceCount(texts: SceneText[], query: string): number {
  const n = query.toLowerCase();
  let count = 0;
  for (const t of texts) {
    const hay = t.text.toLowerCase();
    let i = hay.indexOf(n);
    while (i !== -1) {
      count += 1;
      i = hay.indexOf(n, i + n.length);
    }
  }
  return count;
}

/** Id of the reading-order-first element holding the query (or null). */
function firstMatchId(texts: SceneText[], query: string): string | null {
  const n = query.toLowerCase();
  for (const t of texts) {
    if (t.text.toLowerCase().includes(n)) return t.id;
  }
  return null;
}

/** Swap the case of every character — proves case-INSENSITIVE matching. */
function flipCase(s: string): string {
  return Array.from(s)
    .map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))
    .join("");
}

/**
 * Create a text element at a custom viewport ratio of the canvas — the
 * helpers.createTextElement dance with coordinates (its fixed 0.6/0.75
 * point is taken once the first element exists; on the EMPTY Brainstorm
 * page the well-separated points below cannot collide with anything).
 * Excalidraw returns to the selection tool after Escape, so each call
 * re-arms the text tool.
 */
async function createTextAt(page: Page, text: string, xr: number, yr: number): Promise<void> {
  const b = await page.locator(".excalidraw").boundingBox();
  if (!b) throw new Error(".excalidraw container not found");

  const toolOf = () =>
    page.evaluate(() => {
      const hooks = (
        window as unknown as {
          __NOTE_E2E__?: {
            excalidraw: { getAppState: () => { activeTool?: { type?: string } } };
          };
        }
      ).__NOTE_E2E__;
      return hooks?.excalidraw.getAppState().activeTool?.type ?? "no-hooks";
    });

  // Deselect first with the SELECTION tool: a leftover selection (the find
  // bar's gotoFindMatch SELECTS the match!) turns a text-tool click into
  // "edit the selected element". This also lets any pending canvas-focus
  // timer fire — closing the find bar bumps canvasFocus, whose delayed
  // .focus() would otherwise steal focus from a freshly opened editor and
  // cancel it (measured: the editor closed within ~150 ms and the tool
  // flipped back to selection).
  await setActiveTool(page, "selection");
  await page.mouse.click(b.x + b.width * xr, b.y + b.height * yr);
  await page.waitForTimeout(300);

  // arm the text tool and VERIFY it stuck before clicking
  await setActiveTool(page, "text");
  let armed = false;
  for (let i = 0; i < 10 && !armed; i++) {
    if ((await toolOf()) !== "text") await setActiveTool(page, "text");
    armed = (await toolOf()) === "text";
    if (!armed) await page.waitForTimeout(100);
  }
  if (!armed) throw new Error("text tool never armed (activeTool never reached 'text')");

  const editor = page.locator(".excalidraw textarea").last();
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    await page.mouse.click(b.x + b.width * xr, b.y + b.height * yr);
    try {
      await editor.waitFor({ state: "visible", timeout: 10_000 });
      opened = true;
    } catch {
      // a late focus steal or a finalize can flip the tool back — re-arm
      await setActiveTool(page, "text");
    }
  }
  if (!opened) throw new Error("text editor never opened after 3 canvas clicks");
  await page.keyboard.type(text, { delay: 20 });
  await page.keyboard.press("Escape");
}

async function openFindBar(page: Page): Promise<void> {
  await page.keyboard.press("Control+f");
  await page.getByTestId("find-bar").waitFor({ state: "visible" });
}

/** The data-testid of the focused element (null when nothing focused). */
async function activeTestId(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.getAttribute("data-testid") ?? null,
  );
}

/**
 * Expand every collapsed notebook/section header in the tree (the
 * page-links.spec pattern, verbatim): the seed's Brainstorm page lives
 * under the COLLAPSED Ideas section and Page 1 under the collapsed My
 * Notebook — without this, openPage times out on their rows.
 *
 * Each click WAITS for its own header to report expanded before the next —
 * without that settle, a header can shift mid-click (the tree re-renders as
 * sections expand) and the click lands on the canvas, where it opens
 * Excalidraw's Shapes panel — which aria-hides the whole app and breaks
 * every later role query.
 */
async function expandAll(page: Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Notebook tree" });
  for (let guard = 0; guard < 12; guard++) {
    // :not([aria-label]) excludes the Radix DropdownMenu kebab triggers —
    // Radix sets aria-expanded="false" on them too, and clicking one opens
    // a menu instead of expanding the tree
    const collapsed = nav.locator('button[aria-expanded="false"]:not([aria-label])');
    if ((await collapsed.count()) === 0) return;
    const header = collapsed.first();
    // capture the accessible name BEFORE clicking: after the click the
    // `button[aria-expanded="false"]` filter no longer matches this header
    const name = ((await header.textContent()) ?? "").trim();
    await header.click();
    await expect(
      nav.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-expanded", "true", { timeout: 5_000 });
  }
}

test.describe.serial("in-page find (issue #301)", () => {
  let page: Page;
  let consoleErrors: string[];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
    await expandAll(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("PF-E01: Ctrl+F opens the bar, live-matches case-insensitively, and selects the reading-order-first match", async () => {
    await openPage(page, "Start here");
    await expectCount(page, 2);

    const scene = JSON.parse(await serializeCurrentPage(page)) as {
      elements: Array<Record<string, unknown>>;
    };
    const texts = sceneTexts(scene);
    expect(texts.length, "the seed has text elements to find").toBeGreaterThanOrEqual(1);
    const query = flipCase(texts[0].text.slice(0, 3));
    const expectedFirst = firstMatchId(texts, query);
    const expectedCount = occurrenceCount(texts, query);
    expect(expectedFirst, "the derived query really matches").not.toBeNull();

    await openFindBar(page);
    // the input is the keyboard home the moment the bar opens
    await expect
      .poll(() => activeTestId(page), { message: "find input holds focus" })
      .toBe("find-input");

    const before = await scrollOf(page);
    await page.getByTestId("find-input").fill(query);
    await expect(page.getByTestId("find-counter")).toHaveText(`1 of ${expectedCount}`);
    expect(await selectedElementIds(page), "the first match is selected").toContain(
      expectedFirst,
    );
    // gotoFindMatch scrolled the viewport to the match
    await expect
      .poll(async () => JSON.stringify(await scrollOf(page)), {
        message: "the viewport scrolled to the match",
        timeout: 10_000,
      })
      .not.toBe(JSON.stringify(before));
  });

  test("PF-E02: Enter/Shift+Enter cycle occurrences with wrap-around", async () => {
    await openPage(page, "Brainstorm");
    await expectCount(page, 0);
    await setActiveTool(page, "text");
    await createTextAt(page, "todo buy milk todo walk dog", 0.6, 0.75);
    await setActiveTool(page, "selection");
    await expectCount(page, 1);

    await openFindBar(page);
    await page.getByTestId("find-input").fill("TODO");
    const counter = page.getByTestId("find-counter");
    await expect(counter).toHaveText("1 of 2");
    const holder = (await selectedElementIds(page))[0];

    await page.keyboard.press("Enter");
    await expect(counter).toHaveText("2 of 2");
    await page.keyboard.press("Enter");
    await expect(counter).toHaveText("1 of 2"); // wrapped forward
    await page.keyboard.press("Shift+Enter");
    await expect(counter).toHaveText("2 of 2"); // wrapped backward
    // both occurrences live in the same element — selection never moved
    expect(await selectedElementIds(page)).toContain(holder);
  });

  test("PF-E03: matches follow reading order across elements, and the bar buttons cycle", async () => {
    await page.keyboard.press("Escape"); // close the PF-E02 bar
    await page.getByTestId("find-bar").waitFor({ state: "hidden" });

    await setActiveTool(page, "text");
    await createTextAt(page, "todo upper", 0.7, 0.4);
    await setActiveTool(page, "selection");
    await expectCount(page, 2);

    const scene = JSON.parse(await serializeCurrentPage(page)) as {
      elements: Array<Record<string, unknown>>;
    };
    const texts = sceneTexts(scene);
    // the element created at viewport 0.4 sits ABOVE the 0.75 one —
    // reading order puts it first
    const upperId = texts[0].id;
    const lowerId = texts[1].id;

    await openFindBar(page);
    await page.getByTestId("find-input").fill("todo");
    const counter = page.getByTestId("find-counter");
    await expect(counter).toHaveText("1 of 3");
    expect(await selectedElementIds(page), "the top element matches first").toEqual([upperId]);

    await page.keyboard.press("Enter");
    await expect(counter).toHaveText("2 of 3");
    expect(await selectedElementIds(page), "selection stepped DOWN the page").toEqual([lowerId]);

    await page.getByTestId("find-next").click();
    await expect(counter).toHaveText("3 of 3");
    await page.getByTestId("find-prev").click();
    await expect(counter).toHaveText("2 of 3");
    await page.getByTestId("find-prev").click();
    await expect(counter).toHaveText("1 of 3");
    expect(await selectedElementIds(page)).toEqual([upperId]);
  });

  test("PF-E04: no matches shows the explicit empty state; an empty query clears it", async () => {
    await page.keyboard.press("Escape");
    await page.getByTestId("find-bar").waitFor({ state: "hidden" });

    await openFindBar(page);
    const counter = page.getByTestId("find-counter");
    await page.getByTestId("find-input").fill("zzznotthere");
    await expect(counter).toHaveText("No matches");
    // cycling without matches is a no-op — the counter stays honest
    await page.keyboard.press("Enter");
    await expect(counter).toHaveText("No matches");
    await expect(page.getByTestId("find-next")).toBeDisabled();
    await expect(page.getByTestId("find-prev")).toBeDisabled();

    await page.getByTestId("find-input").fill("");
    await expect(counter).toHaveText("");
  });

  test("PF-E05: CJK content matches like any other text", async () => {
    await page.keyboard.press("Escape");
    await setActiveTool(page, "text");
    await createTextAt(page, "读书笔记与查找", 0.45, 0.55);
    await setActiveTool(page, "selection");
    await expectCount(page, 3);

    await openFindBar(page);
    await page.getByTestId("find-input").fill("笔记");
    await expect(page.getByTestId("find-counter")).toHaveText("1 of 1");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("find-counter")).toHaveText("1 of 1"); // wrapped to itself
  });

  test("PF-E06: Esc closes the bar, hands focus back to the canvas, and Ctrl+F re-opens fresh", async () => {
    // a live query first: closing must not leak state into the reopen
    await page.getByTestId("find-input").fill("todo");
    await expect(page.getByTestId("find-counter")).toHaveText(/of /);
    await page.keyboard.press("Escape");
    await page.getByTestId("find-bar").waitFor({ state: "hidden" });
    // browser-find semantics: the keyboard goes back to the page
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              !!(document.activeElement as HTMLElement | null)?.closest(".excalidraw"),
          ),
        { message: "focus returned to the canvas" },
      )
      .toBe(true);

    await openFindBar(page);
    await expect(page.getByTestId("find-counter")).toHaveText(""); // fresh bar, no stale query
    await page.getByTestId("find-input").fill("todo");
    await expect(page.getByTestId("find-counter")).toHaveText("1 of 3");
  });

  test("PF-E07: switching pages closes the bar", async () => {
    await openFindBar(page);
    await page.getByTestId("find-bar").waitFor({ state: "visible" });
    await openPage(page, "Start here");
    await page.getByTestId("find-bar").waitFor({ state: "hidden" });
  });

  test("PF-E08: the page-actions menu opens the find bar on desktop; the entry and the keyboard path are live on a phone viewport", async () => {
    // desktop: the ⋯ page-actions menu carries the entry (the TB-E11 menu
    // dance: wait for the container, click inside it)
    await page.getByTestId("page-actions").click();
    const menu = page.getByTestId("page-actions-menu");
    await menu.waitFor({ state: "visible", timeout: 10_000 });
    await menu.getByTestId("page-actions-find").click();
    await page.getByTestId("find-bar").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.getByTestId("find-bar").waitFor({ state: "hidden" });

    // phone: the header hides the big toolbar buttons below 640px — the ⋯
    // menu is the mobile surface. CI (2026-11-20): Radix's menu-item
    // click-through at phone widths proved hardware-metric-sensitive (the
    // trigger click landed but the item click timed out twice) — so the
    // phone pin is the entry's PRESENCE in the opened menu plus the
    // keyboard path, which works at every width.
    await page.setViewportSize({ width: 390, height: 800 });
    const trigger = page.getByTestId("page-actions");
    await expect(trigger).toBeVisible();
    await trigger.click();
    await menu.waitFor({ state: "visible", timeout: 10_000 });
    await expect(page.getByTestId("page-actions-find")).toBeAttached();
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden", timeout: 10_000 });

    await page.keyboard.press("Control+f");
    await page.getByTestId("find-bar").waitFor({ state: "visible" });
    await expect(page.getByTestId("find-input")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("find-bar").waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});
