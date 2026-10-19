import { expect, type Locator, type Page } from "@playwright/test";

/** The app only exposes its test hooks under ?e2e=1. */
export const E2E_BASE = "/?e2e=1";

/** Narrow structural typing for the window.__NOTE_E2E__ hook surface. */
export interface NoteE2EHooks {
  elementCount: () => number;
  saveNow: () => Promise<void>;
  serializeCurrentPage: () => string;
  excalidraw: {
    setActiveTool: (tool: { type: string }) => void;
    getSceneElements: () => Array<{ type: string }>;
    getAppState: () => { viewBackgroundColor: string };
  };
}

declare global {
  interface Window {
    __NOTE_E2E__?: NoteE2EHooks;
    __NOTE_RESET__?: () => Promise<void>;
  }
}

/* ------------------------- browser error capture ------------------------ */

/**
 * Collect uncaught exceptions and console.error output. Specs assert that the
 * returned list is empty in afterAll — the browser must stay clean.
 */
export function attachErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`uncaught exception: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/Download the React DevTools/i.test(message.text())) return; // dev hint, not an app error
    errors.push(`console.error: ${message.text()}`);
  });
  return errors;
}

/* ------------------------------ E2E hooks ------------------------------- */

export async function elementCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__NOTE_E2E__?.elementCount() ?? -1);
}

export async function sceneTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...new Set(window.__NOTE_E2E__?.excalidraw.getSceneElements().map((e) => e.type) ?? []),
  ]);
}

export async function serializeCurrentPage(page: Page): Promise<string> {
  return page.evaluate(() => window.__NOTE_E2E__?.serializeCurrentPage() ?? "");
}

export async function saveNow(page: Page): Promise<void> {
  await page.evaluate(() => window.__NOTE_E2E__?.saveNow());
}

export async function setActiveTool(page: Page, type: string): Promise<void> {
  await page.evaluate((t) => window.__NOTE_E2E__?.excalidraw.setActiveTool({ type: t }), type);
}

export function viewBackgroundColor(page: Page): Promise<string> {
  return page.evaluate(() => window.__NOTE_E2E__?.excalidraw.getAppState().viewBackgroundColor ?? "");
}

/**
 * Hard-reset the app to the deterministic welcome seed (exactly 2 elements).
 *
 * `__NOTE_RESET__` erases IndexedDB and reloads. The explicit `goto` right
 * after guarantees the next page load runs against the erased (and therefore
 * freshly re-seeded) database, no matter when the hook's own reload lands.
 */
export async function resetToSeed(page: Page): Promise<void> {
  await page.goto(E2E_BASE);
  await page.waitForFunction(
    () => typeof window.__NOTE_RESET__ === "function",
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() => window.__NOTE_RESET__?.());
  await page.goto(E2E_BASE);
  await expect
    .poll(() => elementCount(page), { timeout: 45_000, message: "welcome scene re-seeded after reset" })
    .toBe(2);
}

/** Poll until the canvas settles at the expected element count. */
export function expectCount(page: Page, expected: number, timeout = 30_000) {
  return expect
    .poll(() => elementCount(page), { timeout, message: `scene settles at ${expected} element(s)` })
    .toBe(expected);
}

/* --------------------------- canvas interactions ------------------------- */

async function canvasBox(page: Page) {
  const box = await page.locator(".excalidraw").boundingBox();
  if (!box) throw new Error(".excalidraw container not found");
  return box;
}

/** Drag a rectangle between two relative points of the canvas viewport. */
export async function drawRectangleOnCanvas(page: Page): Promise<void> {
  const b = await canvasBox(page);
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.32);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.55, { steps: 10 });
  await page.mouse.up();
}

/** Create a text element with the text tool and type `text` into it. */
export async function createTextElement(page: Page, text: string): Promise<void> {
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width * 0.35, b.y + b.height * 0.7);
  const editor = page.locator(".excalidraw textarea").last();
  await editor.waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.type(text, { delay: 20 });
  await page.keyboard.press("Escape");
}

/* --------------------------- sidebar tree helpers ------------------------ */

/** The NotebookNode subtree rooted at the notebook with this exact name. */
export function notebookNode(page: Page, name: string): Locator {
  return page.locator("div.select-none").filter({
    has: page.getByRole("button", { name, exact: true }),
  });
}

/** Click a button that lives inside a notebook's expanded subtree. */
export async function clickInNotebook(page: Page, notebook: string, buttonName: string): Promise<void> {
  await notebookNode(page, notebook).getByRole("button", { name: buttonName, exact: true }).click();
}

/** Open a page by its exact sidebar title. */
export async function openPage(page: Page, title: string): Promise<void> {
  const row = page.locator('[data-testid="page-row"]').filter({
    has: page.getByRole("button", { name: title, exact: true }),
  });
  await row.getByRole("button", { name: title, exact: true }).click();
}
