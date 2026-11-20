/**
 * Internal page links E2E (test plan: docs/test-plans/page-links.md, ids
 * PL-E*). OneNote "Copy Link to Page" parity: the picker inserts a linked
 * title element, clicking it navigates to the target page, the sidebar's
 * "Copy link to page" feeds the paste path, and a broken link (trashed
 * target) toasts instead of navigating.
 *
 * Deterministic paths only, built on the welcome seed: "Start here"
 * (2 elements), "Brainstorm" (empty), "Page 1" (empty) — the picker lists
 * every alive page EXCEPT the currently open one.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  attachErrorCollector,
  expectCount,
  openPage,
  resetToSeed,
  scrollToContent,
  serializeCurrentPage,
} from "./helpers";

interface LinkElement {
  type: string;
  text: string;
  link: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function linkElements(scene: { elements: Array<Record<string, unknown>> }): LinkElement[] {
  return scene.elements.filter(
    (e) =>
      e.type === "text" &&
      typeof e.link === "string" &&
      e.link.startsWith("infinitenote:page/"),
  ) as unknown as LinkElement[];
}

/** Scene coords -> viewport coords via the app's e2e hooks (table.spec pattern). */
async function sceneToViewport(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(([sx, sy]) => {
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
      x: (sx + st.scrollX) * st.zoom.value + st.offsetLeft,
      y: (sy + st.scrollY) * st.zoom.value + st.offsetTop,
    };
  }, [x, y]);
}

/**
 * Click the page-link element's LINK HANDLE — Excalidraw's native link
 * affordance (measured in 0.18.1: in desktop editing mode a click opens an
 * element's link ONLY via the small anchor icon at the element's top-right
 * corner; the icon center sits at scene (x2 + 8, y1 - 8) —
 * getLinkHandleFromCoords with DEFAULT_LINK_SIZE 14 + the 4px dashed-line
 * margin, at zoom 1 and angle 0).
 */
async function clickLinkElement(page: Page, label: string): Promise<void> {
  await scrollToContent(page);
  const scene = JSON.parse(await serializeCurrentPage(page)) as {
    elements: Array<Record<string, unknown>>;
  };
  const links = linkElements(scene).filter((e) => e.text === label);
  expect(links, `one link element labelled "${label}"`).toHaveLength(1);
  const el = links[0];
  const icon = await sceneToViewport(
    page,
    (el.x as number) + (el.width as number) + 8,
    (el.y as number) - 8,
  );
  await page.mouse.click(icon.x, icon.y);
}

async function expectToast(page: Page, text: string): Promise<void> {
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: text })
      .first(),
  ).toBeVisible({ timeout: 15_000 });
  // unhover so the toast can dismiss and never collide with a later one
  await page.mouse.move(10, 10);
}

async function openImportMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByTestId("import-page-link").waitFor({ state: "visible" });
}

/** The open page — the canvas's `name` appState (the page title). */
async function canvasName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const hooks = (
      window as unknown as {
        __NOTE_E2E__?: {
          excalidraw: { getAppState: () => { name: string } };
        };
      }
  ).__NOTE_E2E__;
    if (!hooks) throw new Error("e2e hooks missing");
    return hooks.excalidraw.getAppState().name;
  });
}

async function expectCurrentPage(page: Page, title: string): Promise<void> {
  await expect
    .poll(() => canvasName(page), {
      timeout: 15_000,
      message: `canvas shows page "${title}"`,
    })
    .toBe(title);
}

/**
 * Expand every collapsed notebook/section header in the tree. The store's
 * default expanded state only opens the first notebook+section (the seed's
 * Welcome Notebook/Getting Started), and selectPage never auto-expands —
 * later pages (e.g. "Page 1" under My Notebook) need this once up front.
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

test.describe.serial("page links", () => {
  let page: Page;
  let consoleErrors: string[];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // the paste path reads the REAL system clipboard (the "Copy link to
    // page" action writes it) — the file-attachment.spec grant precedent
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
    await expandAll(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("PL-E01: the picker lists every alive page except the open one, and a pick inserts the link", async () => {
    await openPage(page, "Start here");
    await expectCount(page, 2);

    await openImportMenu(page);
    await page.getByTestId("import-page-link").click();
    await page.getByTestId("page-link-dialog").waitFor({ state: "visible" });

    const rows = page.getByTestId("page-link-row");
    await expect(rows).toHaveCount(2);
    // the current page is never offered — a page linking to itself is dead
    await expect(rows.filter({ hasText: "Start here" })).toHaveCount(0);
    // breadcrumb meta lines name the target's notebook
    await expect(
      rows.filter({ hasText: "Brainstorm" }).getByTestId("page-link-meta"),
    ).toContainText("Welcome Notebook");
    await expect(
      rows.filter({ hasText: "Page 1" }).getByTestId("page-link-meta"),
    ).toContainText("My Notebook");

    await rows.filter({ hasText: "Brainstorm" }).click();
    await page.getByTestId("page-link-dialog").waitFor({ state: "hidden" });
    await expectToast(page, 'Linked to "Brainstorm".');
    await expectCount(page, 3);
  });

  test("PL-E02: the inserted element is a text element carrying the marker scheme, and clicking it navigates", async () => {
    const scene = JSON.parse(await serializeCurrentPage(page)) as {
      elements: Array<Record<string, unknown>>;
    };
    const links = linkElements(scene);
    expect(links, "exactly one page-link element").toHaveLength(1);
    expect(links[0].text).toBe("Brainstorm");

    // the marker survives serialization: the target id is the second
    // segment after the scheme
    const targetId = links[0].link.slice("infinitenote:page/".length);
    expect(targetId.length).toBeGreaterThan(0);

    await clickLinkElement(page, "Brainstorm");
    await expectCurrentPage(page, "Brainstorm");
    // Brainstorm is an empty page — navigation really moved the canvas
    await expectCount(page, 0);
  });

  test("PL-E03: 'Copy link to page' feeds the paste path — pasting inserts the linked title", async () => {
    await openPage(page, "Page 1");
    await expectCount(page, 0);

    // OneNote: right-click the page tab -> Copy Link to Page. Ours: the
    // page kebab menu -> Copy link to page (writes the scheme URL).
    const startRow = page.locator('[data-testid="page-row"]').filter({
      has: page.getByRole("button", { name: "Start here", exact: true }),
    });
    await startRow.getByRole("button", { name: "Actions for page Start here" }).click();
    await page.getByTestId("page-copy-link").click();
    await expectToast(page, "Page link copied");

    // paste onto the canvas. The app-side steps are all REAL (the kebab
    // copy wrote the scheme URL to the actual system clipboard; the canvas
    // click restores focus via the wrapper's pointer-down handler). Only
    // the OS keyboard→clipboardData plumbing is simulated: headless
    // Chromium does not turn a synthetic Ctrl+V into a paste event carrying
    // clipboardData, so the ClipboardEvent is dispatched on the container
    // — it still flows through Excalidraw's real document-level paste
    // listener, its focus guard, parseClipboard and our onPaste (proven in
    // the wave-13 probe: identical behavior to the manual flow).
    const link = await page.evaluate(() => navigator.clipboard.readText());
    await page.mouse.move(600, 350);
    await page.mouse.click(600, 350);
    await page.evaluate((text) => {
      const target = document.querySelector(".excalidraw") as HTMLElement | null;
      if (!target) throw new Error("excalidraw container missing");
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      target.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, link);
    await expectToast(page, 'Linked to "Start here".');
    await expectCount(page, 1);
    const scene = JSON.parse(await serializeCurrentPage(page)) as {
      elements: Array<Record<string, unknown>>;
    };
    const links = linkElements(scene);
    expect(links, "exactly one pasted page-link element").toHaveLength(1);
    expect(links[0].text).toBe("Start here");

    // and the pasted link navigates right back (Start here also carries
    // the PL-E01 Brainstorm link — 2 seed elements + 1 link)
    await clickLinkElement(page, "Start here");
    await expectCurrentPage(page, "Start here");
    await expectCount(page, 3);
  });

  test("PL-E04: a link whose target was trashed toasts instead of navigating", async () => {
    // back to Page 1, insert a link to Brainstorm via the picker
    await openPage(page, "Page 1");
    await openImportMenu(page);
    await page.getByTestId("import-page-link").click();
    await page.getByTestId("page-link-dialog").waitFor({ state: "visible" });
    await page
      .getByTestId("page-link-row")
      .filter({ hasText: "Brainstorm" })
      .click();
    await page.getByTestId("page-link-dialog").waitFor({ state: "hidden" });
    // Page 1 already carries the pasted "Start here" link from PL-E03
    await expectCount(page, 2);

    // trash the target through its kebab menu
    const brainstormRow = page.locator('[data-testid="page-row"]').filter({
      has: page.getByRole("button", { name: "Brainstorm", exact: true }),
    });
    await brainstormRow
      .getByRole("button", { name: "Actions for page Brainstorm" })
      .click();
    await page.getByRole("menuitem", { name: "Move to trash" }).first().click();
    // the selection STAYS on Page 1 (nextSelectionAfterPageDelete keeps a
    // live page in the current section) — the trash only kills the target
    await expectCurrentPage(page, "Page 1");

    // the linking page is still open: activate the now-broken link
    await scrollToContent(page);
    await clickLinkElement(page, "Brainstorm");
    await expectToast(page, "That page no longer exists — the link is broken.");
    // navigation must NOT have happened
    await expectCurrentPage(page, "Page 1");

    // and the picker no longer offers the trashed target
    await openImportMenu(page);
    await page.getByTestId("import-page-link").click();
    await page.getByTestId("page-link-dialog").waitFor({ state: "visible" });
    const rows = page.getByTestId("page-link-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.filter({ hasText: "Brainstorm" })).toHaveCount(0);
    await page
      .locator('[data-testid="page-link-dialog"]')
      .getByRole("button", { name: "Close" })
      .click();
    await page.getByTestId("page-link-dialog").waitFor({ state: "hidden" });
  });
});
