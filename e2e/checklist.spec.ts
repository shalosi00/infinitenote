/**
 * Checklists (issue #302, test plan inline, ids CL-E*).
 * Real canvas, no mocks: a checklist item is a NORMAL single-line text
 * element whose text carries the `[ ]`/`[x]` task-list token — inserted
 * bare from the Import menu, applied to typed text as the OneNote To Do
 * tag from the right-click menu, and toggled from the same menu as ONE
 * undoable scene update. The checked state IS the text, so it survives
 * reload untouched, and the item text stays full-text-searchable (the
 * wave-14 in-page find; Ctrl+K's index reads the same scene text) with
 * zero search changes. Bound labels and multi-line text are deliberately
 * out of scope (v1: one text element = one item).
 *
 * Deterministic paths only (the page-find/table precedents): text is
 * created with the deselect-first + tool-verified dance, and the menu
 * opens on a real right-click at the element's scene-true center.
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  expectCount,
  resetToSeed,
  saveNow,
  scrollToContent,
  serializeCurrentPage,
  setActiveTool,
} from "./helpers";

interface ChecklistScene {
  elements: Array<{
    type: string;
    id?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    isDeleted?: boolean;
    containerId?: string | null;
    text?: string;
  }>;
}

function liveElements(scene: ChecklistScene) {
  return scene.elements.filter((e) => !e.isDeleted);
}

function textOf(scene: ChecklistScene, text: string) {
  return liveElements(scene).find(
    (e) => e.type === "text" && !e.containerId && e.text === text,
  );
}

function checklistItems(scene: ChecklistScene) {
  return liveElements(scene).filter(
    (e) =>
      e.type === "text" &&
      !e.containerId &&
      typeof e.text === "string" &&
      /^\[( |x|X)\]/.test(e.text),
  );
}

async function loadScene(page: Page): Promise<ChecklistScene> {
  return JSON.parse(await serializeCurrentPage(page)) as ChecklistScene;
}

/** Scene → viewport with Excalidraw's own transform (the table-spec pattern). */
async function scenePointToViewport(
  page: Page,
  sx: number,
  sy: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(([x, y]) => {
    const hooks = (
      window as unknown as {
        __NOTE_E2E__?: {
          excalidraw: {
            getAppState: () => {
              scrollX: number;
              scrollY: number;
              zoom: { value: number };
              offsetLeft: number;
              offsetTop: number;
            };
          };
        };
      }
    ).__NOTE_E2E__;
    if (!hooks) throw new Error("e2e hooks missing");
    const st = hooks.excalidraw.getAppState();
    return {
      x: (x + st.scrollX) * st.zoom.value + st.offsetLeft,
      y: (y + st.scrollY) * st.zoom.value + st.offsetTop,
    };
  }, [sx, sy]);
}

/**
 * Center of the live text element with this exact text, in viewport
 * coords. The lookup POLLS briefly: a commit can land late relative to
 * the caller's steps (measured: the element existed at the create-verify,
 * then a serialize right after raced its store reconciliation).
 */
async function textCenter(
  page: Page,
  text: string,
): Promise<{ x: number; y: number }> {
  let el: ChecklistScene["elements"][number] | undefined;
  await expect
    .poll(
      async () => {
        const scene = await loadScene(page);
        el = textOf(scene, text);
        return el ? 1 : 0;
      },
      { timeout: 5_000, message: `text element "${text}" exists on the page` },
    )
    .toBe(1);
  return scenePointToViewport(
    page,
    (el!.x ?? 0) + (el!.width ?? 0) / 2,
    (el!.y ?? 0) + (el!.height ?? 0) / 2,
  );
}

/** Right-click the text and run one context-menu action (issue #302). */
async function todoOp(
  page: Page,
  text: string,
  itemTestid: string,
): Promise<void> {
  await scrollToContent(page);
  const center = await textCenter(page, text);
  await page.mouse.click(center.x, center.y, { button: "right" });
  const menu = page.getByTestId("todo-context-menu");
  await menu.waitFor({ state: "visible", timeout: 10_000 });
  await menu.getByTestId(itemTestid).click();
  await menu.waitFor({ state: "hidden", timeout: 10_000 });
}

/** Right-click ONE scene element (picked by the caller) and run a menu action. */
async function todoOpAt(
  page: Page,
  el: ChecklistScene["elements"][number],
  itemTestid: string,
): Promise<void> {
  await scrollToContent(page);
  const center = await scenePointToViewport(
    page,
    (el.x ?? 0) + (el.width ?? 0) / 2,
    (el.y ?? 0) + (el.height ?? 0) / 2,
  );
  await page.mouse.click(center.x, center.y, { button: "right" });
  const menu = page.getByTestId("todo-context-menu");
  await menu.waitFor({ state: "visible", timeout: 10_000 });
  await menu.getByTestId(itemTestid).click();
  await menu.waitFor({ state: "hidden", timeout: 10_000 });
}

/** Insert one checklist item through the Import menu starter. */
async function insertChecklistItem(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const item = page.getByTestId("import-checklist");
  await item.waitFor({ state: "visible", timeout: 10_000 });
  await item.click();
}

/**
 * Create a text element at a custom viewport ratio of the canvas — the
 * page-find spec's dance with the wave-14 lessons baked in (deselect
 * first, verify the text tool stuck, retry the editor click), plus a
 * commit-verified retry loop: after a reload the canvas-focus handoff can
 * cancel a freshly opened editor before any character lands (measured
 * here: editor visible, zero characters committed, element never created),
 * so each attempt VERIFIES the element exists before returning and nudges
 * the point sideways on retry. Excalidraw returns to the selection tool
 * after Escape, so every attempt re-arms. The canvas's left ~15% swallows
 * text-tool clicks at every height (measured sweep) — all ratios used
 * here sit right of it.
 */
async function createTextAt(page: Page, text: string, xr: number, yr: number): Promise<void> {
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
  for (let attempt = 0; attempt < 3; attempt++) {
    const b = await page.locator(".excalidraw").boundingBox();
    if (!b) throw new Error(".excalidraw container not found");
    const x = b.x + b.width * (xr + attempt * 0.04);
    const y = b.y + b.height * yr;

    await setActiveTool(page, "selection");
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);

    await setActiveTool(page, "text");
    let armed = false;
    for (let i = 0; i < 10 && !armed; i++) {
      if ((await toolOf()) !== "text") await setActiveTool(page, "text");
      armed = (await toolOf()) === "text";
      if (!armed) await page.waitForTimeout(100);
    }
    if (!armed) continue;

    const editor = page.locator(".excalidraw textarea").last();
    let opened = false;
    for (let click = 0; click < 3 && !opened; click++) {
      await page.mouse.click(x, y);
      try {
        await editor.waitFor({ state: "visible", timeout: 10_000 });
        opened = true;
      } catch {
        await setActiveTool(page, "text");
      }
    }
    if (!opened) continue;

    // let the late canvas-focus timer fire before typing — a steal here
    // cancels the empty editor and the characters would land nowhere
    await page.waitForTimeout(250);
    if (!(await editor.isVisible().catch(() => false))) continue;
    await page.keyboard.type(text, { delay: 20 });
    await page.keyboard.press("Escape");
    // The commit can race the documented Excalidraw 0.18 store
    // reconciliation (the HWR waves measured freshly committed text
    // elements dropped ~1.5 s after insertion): poll for the element,
    // and once seen, re-verify PAST the drop window — a vanished element
    // retries the dance instead of poisoning the next step.
    let committed = false;
    await expect
      .poll(
        async () => {
          const check = await loadScene(page);
          committed = textOf(check, text) !== undefined;
          return committed ? 1 : 0;
        },
        { timeout: 3_000, message: `text "${text}" commits` },
      )
      .toBe(1);
    await page.waitForTimeout(1_700);
    const stable = await loadScene(page);
    if (textOf(stable, text)) return; // committed and past the drop window
  }
  throw new Error(`text "${text}" never committed after 3 attempts`);
}

/** Deselect + settle before keyboard undo (the wave-14 focus lessons). */
async function settleForUndo(page: Page): Promise<void> {
  const b = await page.locator(".excalidraw").boundingBox();
  if (!b) throw new Error(".excalidraw container not found");
  await setActiveTool(page, "selection");
  await page.mouse.click(b.x + b.width * 0.2, b.y + b.height * 0.2);
  await page.waitForTimeout(300);
}

test.describe.serial("checklists (issue #302)", () => {
  let page: Page;
  let consoleErrors: string[];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    const realErrors = (consoleErrors ?? []).filter(
      (e) => !/Failed to use workers for subsetting/i.test(e),
    );
    expect(realErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("CL-E01: the Import-menu starter inserts one bare `[ ]` item", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
    await insertChecklistItem(page);
    await expectCount(page, 1);
    await saveNow(page);
    const scene = await loadScene(page);
    const items = checklistItems(scene);
    expect(items.length).toBe(1);
    expect(items[0].text).toBe("[ ]");
    expect(items[0].containerId ?? null).toBeNull();
  });

  test("CL-E02: typed text gets the To Do tag from the right-click menu", async () => {
    // OneNote's flow: type the line first, then apply the tag (desktop
    // text edits open fully selected, so the tag is APPLIED — never
    // pre-inserted around a retype).
    await createTextAt(page, "Buy milk", 0.6, 0.75);
    await todoOp(page, "Buy milk", "todo-menu-add");
    const scene = await loadScene(page);
    expect(textOf(scene, "[ ] Buy milk")).toBeTruthy();
    expect(textOf(scene, "Buy milk")).toBeUndefined();
  });

  test("CL-E03: Toggle checked flips the token to [x]", async () => {
    await todoOp(page, "[ ] Buy milk", "todo-menu-toggle");
    const scene = await loadScene(page);
    expect(textOf(scene, "[x] Buy milk")).toBeTruthy();
    expect(textOf(scene, "[ ] Buy milk")).toBeUndefined();
  });

  test("CL-E04: toggling again flips back to [ ]", async () => {
    await todoOp(page, "[x] Buy milk", "todo-menu-toggle");
    const scene = await loadScene(page);
    expect(textOf(scene, "[ ] Buy milk")).toBeTruthy();
    expect(textOf(scene, "[x] Buy milk")).toBeUndefined();
    await saveNow(page);
  });

  test("CL-E05: one toggle is exactly one undo step", async () => {
    await todoOp(page, "[ ] Buy milk", "todo-menu-toggle");
    const sceneAfter = await loadScene(page);
    expect(textOf(sceneAfter, "[x] Buy milk")).toBeTruthy();
    await settleForUndo(page);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    const sceneUndone = await loadScene(page);
    expect(textOf(sceneUndone, "[ ] Buy milk")).toBeTruthy();
    expect(textOf(sceneUndone, "[x] Buy milk")).toBeUndefined();
    // and one toggle forward again for the persistence test below
    await todoOp(page, "[ ] Buy milk", "todo-menu-toggle");
    await expect
      .poll(async () => (textOf(await loadScene(page), "[x] Buy milk") ? 1 : 0), {
        timeout: 10_000,
        message: "the toggle re-applied",
      })
      .toBe(1);
    await saveNow(page);
  });

  test("CL-E06: two items toggle independently", async () => {
    // Two starter items, one toggle: the second `[ ]` (larger y — the
    // insert position anchors below existing content) flips while the
    // other item keeps its state. Built entirely from the starter +
    // toggle paths — no WYSIWYG commit (the reload-boot replacement race
    // measured on this page is avoided by not typing after a reload).
    await insertChecklistItem(page);
    await expect
      .poll(async () => checklistItems(await loadScene(page)).length, {
        timeout: 10_000,
        message: "the second starter item lands",
      })
      .toBe(3); // starter #1 + `[x] Buy milk` + starter #2
    const scene = await loadScene(page);
    const items = checklistItems(scene).slice().sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    const second = items[2]; // below the others = the new one
    expect(second.text).toBe("[ ]");
    await todoOpAt(page, second, "todo-menu-toggle");
    const after = await loadScene(page);
    const afterItems = checklistItems(after).slice().sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    expect(afterItems[2].text).toBe("[x]"); // toggled
    expect(afterItems[1].text).toBe("[x] Buy milk"); // untouched
    expect(afterItems[0].text).toBe("[ ]"); // untouched
    await saveNow(page);
  });

  test("CL-E07: multi-line text is out of scope — no checklist menu", async () => {
    await createTextAt(page, "Buy eggs\nBuy bread", 0.6, 0.85);
    const scene = await loadScene(page);
    const multiline = liveElements(scene).find(
      (e) => e.type === "text" && e.text === "Buy eggs\nBuy bread",
    );
    expect(multiline, "the multi-line text exists").toBeTruthy();
    await scrollToContent(page);
    const center = await scenePointToViewport(
      page,
      (multiline!.x ?? 0) + (multiline!.width ?? 0) / 2,
      (multiline!.y ?? 0) + (multiline!.height ?? 0) / 2,
    );
    await page.mouse.click(center.x, center.y, { button: "right" });
    await page.waitForTimeout(300);
    await expect(page.getByTestId("todo-context-menu")).toHaveCount(0);
    await page.keyboard.press("Escape"); // close whatever Excalidraw opened
    await saveNow(page);
  });

  test("CL-E08: the item text is in-page-findable — zero search changes", async () => {
    await page.keyboard.press("Control+f");
    const bar = page.getByTestId("find-bar");
    await bar.waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("find-input").fill("milk");
    await expect(page.getByTestId("find-counter")).toContainText("1 of 1", {
      timeout: 10_000,
    });
    await page.getByTestId("find-close").click();
    await bar.waitFor({ state: "hidden", timeout: 10_000 });
    await saveNow(page);
  });

  test("CL-E09: every checklist state survives reload — it IS the text", async () => {
    await page.reload();
    await page
      .locator('[data-testid="page-row"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    // the serialize hook attaches with the canvas — wait for it before the
    // first poll (an early evaluate reads "" and JSON.parse throws)
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __NOTE_E2E__?: { serializeCurrentPage?: unknown } })
          .__NOTE_E2E__?.serializeCurrentPage === "function",
      undefined,
      { timeout: 30_000 },
    );
    await expect
      .poll(async () => checklistItems(await loadScene(page)).length, {
        timeout: 15_000,
        message: "the checklist items are back after reload",
      })
      .toBe(3);
    const scene = await loadScene(page);
    // checked + unchecked states, the bare starter and the multi-line text
    // all come back byte-exact — persistence IS the text
    expect(textOf(scene, "[x] Buy milk")).toBeTruthy();
    expect(textOf(scene, "[ ] Buy milk") ?? textOf(scene, "[ ]")).toBeTruthy();
    const items = checklistItems(scene).slice().sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    expect(items[0].text).toBe("[ ]");
    expect(items[1].text).toBe("[x] Buy milk");
    expect(items[2].text).toBe("[x]");
    expect(textOf(scene, "Buy eggs\nBuy bread")).toBeTruthy();
    await saveNow(page);
  });
});
