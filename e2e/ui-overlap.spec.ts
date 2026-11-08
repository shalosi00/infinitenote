/**
 * App-chrome overlap audit (user report: "check if any buttons overlap").
 *
 * At every supported viewport, all interactive controls in the app's own
 * chrome — the top header, the page title bar, and the desktop sidebar —
 * are measured and pairwise-checked for bounding-box intersections, plus a
 * viewport-clipping check. Excalidraw's own canvas UI is third-party and
 * out of scope; hover-revealed controls (opacity-0) are ignored because
 * they are invisible until hovered by design.
 */
import { expect, test } from "@playwright/test";
import { E2E_BASE, attachErrorCollector, resetToSeed } from "./helpers";

const VIEWPORTS = [
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "laptop-900", width: 900, height: 700 },
  { name: "tablet-768", width: 768, height: 900 },
  { name: "phone-390", width: 390, height: 740 },
  { name: "phone-narrow-320", width: 320, height: 700 },
] as const;

const INTERACTIVE =
  'button, a[href], [role="button"], input:not([type="hidden"]), textarea, [contenteditable="true"]';

test.describe("app chrome button overlap audit", () => {
  let consoleErrors: string[];
  let page: import("@playwright/test").Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  for (const vp of VIEWPORTS) {
    test(`no overlapping controls at ${vp.name} (${vp.width}x${vp.height})`, async () => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // let responsive classes (sm:/md:/lg:) and layout settle
      await page.waitForTimeout(250);

      const report = await page.evaluate((selector) => {
        const EPS = 0.5; // px — sub-pixel edge contact is not an overlap
        const scopes = [
          document.querySelector("header"),
          document.querySelector("main > div.h-12"),
          document.querySelector('aside[data-testid="sidebar"]'),
        ].filter((el): el is HTMLElement => !!el);

        const controls: { label: string; rect: DOMRect }[] = [];
        for (const scope of scopes) {
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
            issues.push(`"${c.label}" extends past the viewport edge`);
          }
        }
        return { count: controls.length, issues };
      }, INTERACTIVE);

      expect(
        report.count,
        "the audit must actually measure controls (scope selectors broken?)",
      ).toBeGreaterThanOrEqual(6);
      expect(
        report.issues,
        `interactive controls must not overlap at ${vp.width}x${vp.height}`,
      ).toEqual([]);
    });
  }
});
