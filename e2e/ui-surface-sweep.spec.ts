/**
 * Full app-surface sweep: pairwise overlap audit + viewport clipping of every
 * interactive control in every first-party surface — dialogs (themes, sync,
 * trash, search, move-pages), dropdowns (shapes, import, export + PDF
 * submenu), popovers (tag picker), context menus (page row), and the mobile
 * navigation drawer — at five viewports, with a strict zero-console-error
 * guard across the whole run.
 *
 * Pins the fixes found by the original probe sweep:
 * - search dialog: the input must not run under the close button
 *   (mis-clicks closed the dialog and lost the query)
 * - mobile drawer: the sheet's close X must not sit on "Add notebook"
 * - export menu at compact widths: the PDF orientations must be reachable
 *   (the flyout submenu flipped off-screen left below ~640px — flattened
 *   into plain items there instead)
 * - header Search / Import / Export buttons keep an accessible name below
 *   sm/lg (icon-only but labeled)
 *
 * Excalidraw's own canvas UI is third-party and stays out of scope.
 */
import { expect, test, type Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

const VIEWPORTS = [
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "laptop-900", width: 900, height: 700 },
  { name: "tablet-768", width: 768, height: 900 },
  { name: "phone-390", width: 390, height: 740 },
  { name: "phone-narrow-320", width: 320, height: 700 },
] as const;

const INTERACTIVE =
  'button, a[href], [role="button"], [role^="menuitem"], input:not([type="hidden"]), textarea, [contenteditable="true"]';

interface SurfaceReport {
  count: number;
  issues: string[];
}

async function auditSurface(page: Page, scopeSel: string): Promise<SurfaceReport> {
  return page.evaluate(
    ({ selector, scopeSel }) => {
      const EPS = 0.5; // px — sub-pixel edge contact is not an overlap
      const scope = document.querySelector(scopeSel);
      if (!scope) return { count: 0, issues: [`scope ${scopeSel} not found`] };
      const controls: { label: string; rect: DOMRect }[] = [];
      for (const el of Array.from(scope.querySelectorAll<HTMLElement>(selector))) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
        if (!el.offsetParent && cs.position !== "fixed") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const label =
          el.getAttribute("aria-label") ||
          el.getAttribute("data-testid") ||
          (el.textContent ?? "").trim().slice(0, 30) ||
          el.tagName.toLowerCase();
        controls.push({ label: `${label}@${Math.round(rect.x)},${Math.round(rect.y)}`, rect });
      }
      const issues: string[] = [];
      for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i].rect;
          const b = controls[j].rect;
          const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ix > EPS && iy > EPS) {
            issues.push(`"${controls[i].label}" overlaps "${controls[j].label}"`);
          }
        }
      }
      for (const c of controls) {
        if (c.rect.left < -1 || c.rect.right > window.innerWidth + 1) {
          issues.push(
            `"${c.label}" extends past viewport (x ${Math.round(c.rect.left)}..${Math.round(c.rect.right)} of ${window.innerWidth})`,
          );
        }
      }
      return { count: controls.length, issues };
    },
    { selector: INTERACTIVE, scopeSel },
  );
}

/** Audit the LAST visible [role=menu] in DOM order (most recently opened). */
async function auditLastOpenMenu(page: Page): Promise<SurfaceReport> {
  await page.evaluate(() => {
    document
      .querySelectorAll("[data-probe-scope]")
      .forEach((el) => el.removeAttribute("data-probe-scope"));
    const menus = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]')).filter(
      (m) => m.offsetParent !== null && m.getBoundingClientRect().width > 0,
    );
    menus[menus.length - 1]?.setAttribute("data-probe-scope", "1");
  });
  const rep = await auditSurface(page, "[data-probe-scope='1']");
  if (rep.count === 0 && rep.issues.length === 0) return { count: 0, issues: ["no open menu"] };
  return rep;
}

function vis(page: Page, testid: string) {
  return page.locator(`[data-testid="${testid}"]:visible`);
}

/** Assert a surface is clean (and actually measured). */
function expectClean(vp: string, surface: string, rep: SurfaceReport) {
  expect(
    rep.count,
    `the ${surface} audit at ${vp} must measure at least one control (scope selector broken?)`,
  ).toBeGreaterThanOrEqual(1);
  expect(rep.issues, `${surface} must be overlap-free and inside the viewport at ${vp}`).toEqual([]);
}

test.describe("app surface sweep (dialogs, menus, drawer)", () => {
  let consoleErrors: string[];
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await resetToSeed(page);

    // The trash dialog needs real content for a meaningful audit: bulk-delete
    // one page. The bulk action auto-exits select mode — no toggle-off needed.
    await page.getByTestId("multiselect-toggle").click();
    await page.getByTestId("page-checkbox").first().click();
    await page.getByTestId("bulk-delete").click();
    await page.waitForTimeout(600);
    if ((await vis(page, "multiselect-toggle").getAttribute("aria-pressed")) === "true") {
      await page.getByTestId("multiselect-toggle").click();
      await page.waitForTimeout(200);
    }

    // Keep a section with pages expanded so page rows stay auditable.
    await page
      .locator('[data-testid="section-row"]')
      .filter({ hasText: "Ideas" })
      .locator("button")
      .first()
      .click();
    await page.waitForTimeout(250);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free across every surface").toEqual([]);
    await page.close();
  });

  for (const vp of VIEWPORTS) {
    test(`surfaces are overlap-free at ${vp.name} (${vp.width}x${vp.height})`, async () => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(300);
      const mobile = vp.width < 768;

      const drawerOpen = async () => {
        if (await page.locator('[data-slot="sheet-content"]').first().isVisible().catch(() => false))
          return;
        await page.getByRole("button", { name: "Open navigation" }).click();
        // wait for the slide-in to fully settle — auditing mid-animation reads
        // phantom offsets (the transform can still be a few px off its rest)
        await page.waitForFunction(
          () => {
            const sheet = document.querySelector('[data-slot="sheet-content"]');
            return !!sheet && getComputedStyle(sheet).transform === "none";
          },
          undefined,
          { timeout: 5_000 },
        );
        await page.waitForTimeout(100);
      };
      const drawerClose = async () => {
        if (!(await page.locator('[data-slot="sheet-content"]').first().isVisible().catch(() => false)))
          return;
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      };

      if (mobile) {
        await drawerOpen();
        expectClean(vp.name, "mobile drawer", await auditSurface(page, '[data-slot="sheet-content"]'));
      }

      // --- Themes / Sync / Trash (sidebar footer; drawer copy on mobile) -----
      await vis(page, "themes-button").click();
      await page.getByTestId("themes-dialog").waitFor({ state: "visible" });
      await page.waitForTimeout(120);
      expectClean(vp.name, "themes dialog", await auditSurface(page, '[data-testid="themes-dialog"]'));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      await vis(page, "sync-button").click();
      await page.getByTestId("sync-dialog").waitFor({ state: "visible" });
      await page.waitForTimeout(120);
      expectClean(vp.name, "sync dialog", await auditSurface(page, '[data-testid="sync-dialog"]'));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      const trashButton = mobile
        ? page.locator('[data-slot="sheet-content"]').getByRole("button", { name: "Trash" })
        : page.locator("aside").getByRole("button", { name: "Trash" });
      await trashButton.click();
      await page.getByTestId("trash-dialog").waitFor({ state: "visible" });
      await page.waitForTimeout(300);
      expectClean(vp.name, "trash dialog", await auditSurface(page, '[data-testid="trash-dialog"]'));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      if (mobile) await drawerClose();

      // --- Search dialog --------------------------------------------------------
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(250);
      expectClean(vp.name, "search dialog", await auditSurface(page, '[role="dialog"]'));
      await page.keyboard.type("note", { delay: 15 });
      await page.waitForTimeout(250);
      expectClean(vp.name, "search dialog (typed)", await auditSurface(page, '[role="dialog"]'));

      // Behavioral pin: clicking just inside the input's right edge must focus
      // the input, not close the dialog (the close X used to sit on it).
      const inputBox = await page.locator('[role="dialog"] input').boundingBox();
      expect(inputBox, "search input must be present").not.toBeNull();
      if (inputBox) {
        await page.mouse.click(inputBox.x + inputBox.width - 4, inputBox.y + inputBox.height / 2);
        await page.waitForTimeout(150);
        await expect(page.locator('[role="dialog"]')).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      // --- Shapes dropdown ---------------------------------------------------------
      await vis(page, "shapes-button").click();
      await page.getByTestId("shapes-menu").waitFor({ state: "visible" });
      await page.waitForTimeout(150);
      expectClean(vp.name, "shapes menu", await auditSurface(page, '[data-testid="shapes-menu"]'));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      // --- Import dropdown (named at every width — a11y pin) -----------------------
      const importBtn = page.getByRole("button", { name: "Import" });
      await expect(importBtn).toBeVisible();
      await importBtn.click();
      await page.waitForTimeout(250);
      expectClean(vp.name, "import menu", await auditLastOpenMenu(page));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      // --- Export dropdown (+ PDF submenu on wide screens) ---------------------------
      const exportBtn = page.getByRole("button", { name: "Export" });
      await expect(exportBtn).toBeVisible();
      await exportBtn.click();
      await page.waitForTimeout(250);
      expectClean(vp.name, "export menu", await auditLastOpenMenu(page));

      if (mobile) {
        // Compact layout flattens the PDF orientations into the menu itself —
        // they must be visible and inside the viewport (the flyout submenu
        // used to flip off-screen left and was unreachable).
        for (const id of ["export-pdf-portrait", "export-pdf-landscape"]) {
          const item = page.getByTestId(id);
          await expect(item).toBeVisible();
          const box = await item.boundingBox();
          expect(box, `${id} must have a box`).not.toBeNull();
          if (box) {
            expect(box.x, `${id} must start inside the viewport`).toBeGreaterThanOrEqual(0);
            expect(
              box.x + box.width,
              `${id} must end inside the viewport`,
            ).toBeLessThanOrEqual(vp.width);
          }
        }
      } else {
        await page.getByTestId("export-pdf-submenu").hover();
        await page.waitForTimeout(450);
        expectClean(vp.name, "export PDF submenu", await auditLastOpenMenu(page));
      }
      await page.keyboard.press("Escape"); // submenu (wide) or nothing (compact)
      await page.waitForTimeout(250);
      await page.keyboard.press("Escape"); // parent menu
      await page.waitForTimeout(200);

      // --- Paper style menu -------------------------------------------------------------
      await page.getByTestId("background-picker").click();
      await page.waitForTimeout(250);
      expectClean(vp.name, "paper menu", await auditSurface(page, '[data-testid="paper-menu"]'));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      // --- Tag picker popover --------------------------------------------------------------
      await page.getByTestId("tag-picker").click();
      await page.waitForTimeout(250);
      expectClean(vp.name, "tag picker", await auditSurface(page, '[data-testid="tag-menu"]'));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      // --- Page row context menu + move-pages dialog (sidebar; drawer on mobile) ------
      if (mobile) await drawerOpen();
      const pageRow = page
        .locator(mobile ? '[data-slot="sheet-content"]' : "aside")
        .locator('[data-testid="page-row"]')
        .first();
      await pageRow.hover();
      await page.waitForTimeout(200);
      const rowMenuBtn = pageRow.getByRole("button", { name: /actions for page/i }).first();
      await rowMenuBtn.click();
      await page.waitForTimeout(250);
      expectClean(vp.name, "page row menu", await auditLastOpenMenu(page));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      await vis(page, "multiselect-toggle").click();
      await page.waitForTimeout(200);
      await page
        .locator(mobile ? '[data-slot="sheet-content"]' : "aside")
        .locator('[data-testid="page-checkbox"]')
        .first()
        .click();
      await page.waitForTimeout(150);
      await page.getByTestId("bulk-move").click();
      await page.waitForTimeout(250);
      expectClean(vp.name, "move-pages dialog", await auditSurface(page, '[role="dialog"]'));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      await vis(page, "multiselect-toggle").click();
      await page.waitForTimeout(150);
      if (mobile) await drawerClose();
    });
  }

  test("header controls keep accessible names at compact widths", async () => {
    await page.setViewportSize({ width: 390, height: 740 });
    await page.waitForTimeout(300);
    // below sm/lg these triggers are icon-only — the labels hide, the
    // accessible names must survive via aria-label
    for (const name of ["Search pages", "Import", "Export", "Insert shape", "Record audio"]) {
      await expect(
        page.getByRole("button", { name, exact: true }).first(),
        `header button "${name}" must stay named at 390px`,
      ).toBeVisible();
    }
  });
});
