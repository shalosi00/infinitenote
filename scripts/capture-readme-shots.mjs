/**
 * README screenshot capture — drives the real app (production build on :3000,
 * booted with `NEXT_PUBLIC_E2E=1 bun run build && bun .next/standalone/server.js`
 * so the ?e2e=1 hooks exist) with Playwright, seeds a realistic notebook
 * tree, imports the generated .excalidraw scenes
 * (scripts/gen-readme-scenes.py), runs the REAL handwriting engine once so
 * the toast is authentic, and saves the shots to /tmp/shots/out/.
 *
 * Run: bun scripts/capture-readme-shots.mjs
 *
 * Notes from the 2026-11-11 session (all learned the hard way):
 * - the e2e hooks only exist in NEXT_PUBLIC_E2E=1 builds (src/lib/e2e-gate.ts)
 * - Radix menus need settle waits; the notebook color swatch intentionally
 *   keeps the menu open (live preview) — dismiss with Escape
 * - sonner toasts: [data-sonner-toast] + [data-close-button]; default
 *   duration 4s but click the X to clear deterministically
 * - Excalidraw scrollToContent needs { fitToViewport: true } to actually fit
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000/?e2e=1";
const OUT = "/tmp/shots/out";
mkdirSync(OUT, { recursive: true });

// PHASE=build → seed tree + scenes only; PHASE=shoot → screenshots only;
// default: both. The browser profile persists (IndexedDB), so shoot can be
// re-run after a bad shot without rebuilding the tree.
const PHASE = process.env.PHASE ?? "all";
const doBuild = PHASE === "all" || PHASE === "build";
const doShoot = PHASE === "all" || PHASE === "shoot";

const shots = [];
function note(name) {
  shots.push(name);
  console.log(`  shot → ${name}`);
}

// Persistent profile: the seeded notebook tree + cached HWR model survive
// across runs, so individual shots can be retaken without a full rebuild.
const ctx = await chromium.launchPersistentContext("/tmp/shots/profile", {
  // sandbox ships an older browser cache (rev 1200) than playwright-core
  // 1.64 expects (rev 1248) — point at the existing binary explicitly
  executablePath: "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome",
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(60_000);

/* ------------------------------ app helpers ------------------------------ */
const el = (sel) => page.locator(sel);
async function count() {
  return page.evaluate(() => window.__NOTE_E2E__?.elementCount() ?? -1);
}
async function fitContent(factor = 0.85) {
  await page.evaluate(
    (f) =>
      window.__NOTE_E2E__?.excalidraw.scrollToContent(undefined, {
        fitToViewport: true,
        viewportZoomFactor: f,
      }),
    factor,
  );
}
async function saveNow() {
  await page.evaluate(() => window.__NOTE_E2E__?.saveNow());
}
async function openPageByTitle(title) {
  await expandAll();
  const row = page.locator('[data-testid="page-row"]').filter({
    has: page.getByRole("button", { name: title, exact: true }),
  });
  await row.getByRole("button", { name: title, exact: true }).click();
}
/**
 * After a reload the sidebar restores collapsed sections — open every
 * notebook/section whose children are not rendered (two passes: expanding a
 * notebook reveals its sections, which may be collapsed themselves).
 * SKIP_NODES stay collapsed (their untouched seed rows are visual noise).
 */
const SKIP_NODES = new Set(["My Notebook"]);
async function expandAll() {
  for (let pass = 0; pass < 2; pass++) {
    const clicked = await page.evaluate((skip) => {
      let n = 0;
      const nodes = [...document.querySelectorAll('[data-testid="sidebar"] div.select-none')];
      for (const node of nodes) {
        if (node.querySelector('div.select-none')) continue; // children rendered → expanded
        const row = node.querySelector("button");
        if (row && skip.includes(row.textContent?.trim() ?? "")) continue;
        const chevron = node.querySelector('button svg[class*="chevron-right"]')?.closest("button");
        if (chevron) {
          chevron.click();
          n++;
        }
      }
      return n;
    }, [...SKIP_NODES]);
    await page.waitForTimeout(450);
    if (clicked === 0) break;
  }
}
async function renamePage(title) {
  const renameBtn = page.locator('button[title="Click to rename this page"]');
  for (let attempt = 0; attempt < 3; attempt++) {
    await renameBtn.waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(300); // let the freshly-opened page settle
    await renameBtn.click();
    try {
      const input = page.getByLabel("Page title");
      await input.waitFor({ state: "visible", timeout: 5_000 });
      await input.fill(title);
      await input.press("Enter");
      await waitText(title);
      return;
    } catch {
      console.log(`    (retrying page rename attempt ${attempt + 1})`);
    }
  }
  throw new Error(`could not rename page to "${title}"`);
}
async function kebab(label) {
  console.log(`    kebab(${label})`);
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.locator('[role="menu"]').first().waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(400); // wait out the Radix open animation
}
/** Click a menu item and wait for the (animated) menu chain to fully close. */
async function menuItem(name) {
  console.log(`    menuItem(${name})`);
  const item = page.getByRole("menuitem", { name, exact: true });
  await item.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(150);
  await item.click();
  await page.locator('[role="menu"]').first().waitFor({ state: "hidden", timeout: 10_000 });
  await page.waitForTimeout(300);
}
/** Open a notebook/section/page kebab menu and pick an item (Radix-safe). */
async function menuPick(actionsLabel, itemName) {
  await kebab(actionsLabel);
  await menuItem(itemName);
}
/** The subtree div of a sidebar node (notebook or section) by its button name. */
function subtreeOf(name) {
  return page.locator("div.select-none").filter({
    has: page.getByRole("button", { name, exact: true }),
  });
}
/** Click the standalone “Add page” button inside an expanded section. */
async function addPageIn(sectionName) {
  await subtreeOf(sectionName).getByRole("button", { name: "Add page", exact: true }).click();
}
async function renameViaSidebar(actionsLabel, newName) {
  await menuPick(actionsLabel, "Rename");
  const input = page.getByLabel("Rename", { exact: true });
  await input.fill(newName);
  await input.press("Enter");
  await page.waitForTimeout(500);
  await waitText(newName, '[data-testid="sidebar"]');
  await page.waitForTimeout(250);
}
/** Color swatch: the app keeps the menu open for live preview — Escape after. */
async function pickNotebookColor(actionsLabel, color) {
  await kebab(actionsLabel);
  await page.getByRole("menuitem", { name: "Color" }).click();
  const swatch = page.getByRole("button", { name: `Set color ${color}` });
  await swatch.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(200);
  await swatch.click();
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await page.locator('[role="menu"]').first().waitFor({ state: "hidden", timeout: 10_000 });
  await page.waitForTimeout(400);
}
async function importScene(file) {
  await page.setInputFiles('input[aria-label="Import files"]', file);
}
async function settle(ms = 600) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}
/** Dismiss every sonner toast via its close button and wait for removal. */
async function clearToasts() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const n = await page.locator("[data-sonner-toast]").count();
    if (n === 0) return;
    const closes = page.locator("[data-sonner-toast] [data-close-button]");
    const c = await closes.count();
    for (let i = 0; i < c; i++) {
      await closes.nth(i).click({ timeout: 2000 }).catch(() => undefined);
    }
    await page.waitForTimeout(500);
  }
  try {
    await page.locator("[data-sonner-toast]").first().waitFor({ state: "hidden", timeout: 8000 });
  } catch {
    console.log("    (toasts still visible — continuing)");
  }
}
/** Plain-library stand-in for expect(locator).toContainText(text). */
async function waitText(text, scopeSel = "body") {
  await page
    .locator(scopeSel)
    .getByText(text, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
}

/* ------------------------------- build data ------------------------------ */
console.log("1. loading app…");
await page.goto(BASE, { timeout: 300_000, waitUntil: "domcontentloaded" });
await el('[data-testid="page-row"]').first().waitFor({ state: "visible", timeout: 300_000 });
console.log("   app is up.");

console.log("2. building the notebook tree…");
if (!doBuild) {
  console.log("   (skipped — PHASE=shoot reuses the persisted profile)");
} else {
// --- Work notebook -----------------------------------------------------
await page.getByRole("button", { name: "Add notebook" }).click();
await waitText("Notebook 3", '[data-testid="sidebar"]');
await page.waitForTimeout(400);
await renameViaSidebar("Actions for notebook Notebook 3", "Work");
await pickNotebookColor("Actions for notebook Work", "cyan");

await menuPick("Actions for notebook Work", "New section");
await waitText("Section 1", '[data-testid="sidebar"]');
await page.waitForTimeout(400);
await renameViaSidebar("Actions for section Section 1", "Planning");

await addPageIn("Planning");
await page.waitForFunction(() => (window.__NOTE_E2E__?.elementCount() ?? -1) === 0);
await renamePage("Q4 product planning");

console.log("3. importing scene A (light hero)…");
await importScene("/tmp/shots/scene-a.excalidraw");
await page.waitForFunction(() => (window.__NOTE_E2E__?.elementCount() ?? 0) >= 15);
await fitContent(0.85);
await saveNow();
// tag the page
await el('[data-testid="tag-picker"]').click();
await el('[data-testid="tag-input"]').fill("planning");
await page.keyboard.press("Enter");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// second page in Planning
await openPageByTitle("Q4 product planning");
await addPageIn("Planning");
await page.waitForFunction(() => (window.__NOTE_E2E__?.elementCount() ?? -1) === 0);
await renamePage("Weekly sync");
await el('[data-testid="tag-picker"]').click();
await el('[data-testid="tag-input"]').fill("meeting");
await page.keyboard.press("Enter");
await page.keyboard.press("Escape");
await saveNow();

// --- Research notebook --------------------------------------------------
await page.getByRole("button", { name: "Add notebook" }).click();
await waitText("Notebook 4", '[data-testid="sidebar"]');
await page.waitForTimeout(400);
await renameViaSidebar("Actions for notebook Notebook 4", "Research");
await pickNotebookColor("Actions for notebook Research", "emerald");

await menuPick("Actions for notebook Research", "New section");
await waitText("Section 1", '[data-testid="sidebar"]');
await page.waitForTimeout(400);
await renameViaSidebar("Actions for section Section 1", "Field notes");

await addPageIn("Field notes");
await page.waitForFunction(() => (window.__NOTE_E2E__?.elementCount() ?? -1) === 0);
await renamePage("Alpine field notes");
console.log("4. importing scene B (dark hero)…");
await importScene("/tmp/shots/scene-b.excalidraw");
await page.waitForFunction(() => (window.__NOTE_E2E__?.elementCount() ?? 0) >= 13);
await saveNow();
await el('[data-testid="tag-picker"]').click();
await el('[data-testid="tag-input"]').fill("research");
await page.keyboard.press("Enter");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

await addPageIn("Field notes");
await page.waitForFunction(() => (window.__NOTE_E2E__?.elementCount() ?? -1) === 0);
await renamePage("Ink sketchbook");
console.log("5. importing scene C (ink)…");
await importScene("/tmp/shots/scene-c.excalidraw");
await page.waitForFunction(() => (window.__NOTE_E2E__?.elementCount() ?? 0) >= 8);
await fitContent(0.9);
await saveNow();
}

/* ----------------------------- screenshots ------------------------------ */
console.log("6. taking screenshots…");
if (!doShoot) {
  console.log("   (skipped — PHASE=build)");
  await ctx.close();
  process.exit(0);
}

// collapse the untouched seed notebook — its default "New Section"/"Page 1"
// rows are noise in every shot that shows the sidebar. The notebook toggle
// button (inside [data-testid=notebook-row]) carries the name text AND
// aria-expanded, so it is both the finder and the click target.
await expandAll();
await page.evaluate(() => {
  const toggles = [...document.querySelectorAll('[data-testid="notebook-row"] > button')];
  const t = toggles.find(
    (b) => b.textContent?.trim() === "My Notebook" && b.getAttribute("aria-expanded") === "true",
  );
  t?.click();
});
await page.waitForTimeout(500);

// (a) handwriting FIRST — run the real engine so “cat” is indexed before the
// search shot, and capture the toast at its feature moment
await openPageByTitle("Ink sketchbook");
await fitContent(0.6);
// two zoom-out notches drop the fitted content clear of the floating toolbar
await page.getByRole("button", { name: "Zoom out" }).click();
await page.waitForTimeout(250);
await page.getByRole("button", { name: "Zoom out" }).click();
await page.waitForTimeout(400);
console.log("   running the real handwriting engine (first use loads the model)…");
await kebab("Page actions");
await el('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
await el('[data-testid="run-hwr"]').click();
try {
  await page
    .getByText(/Recognized handwriting on \d lines? — \d lines? had readable text\./)
    .waitFor({ timeout: 300_000 });
} catch {
  const texts = await page.evaluate(() =>
    [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent),
  );
  console.error("HWR toast never appeared. Current toasts:", texts);
  throw new Error("handwriting recognition did not complete");
}
await settle(250);
await page.screenshot({ path: path.join(OUT, "handwriting.png") });
note("handwriting.png");
await clearToasts();

// (b) light hero — Q4 planning page
await openPageByTitle("Q4 product planning");
await fitContent(0.85);
await settle();
await clearToasts();
await page.screenshot({ path: path.join(OUT, "light-hero.png") });
note("light-hero.png");

// (c) search palette finding handwriting-recognized text
await page.keyboard.press("Control+K");
const search = page.getByPlaceholder("Search all pages…");
await search.waitFor({ state: "visible" });
await search.fill("cat");
await page.locator("[cmdk-list]").waitFor({ state: "visible" });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, "search.png") });
note("search.png");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// (d) version history on the Q4 page (2 saved versions)
await kebab("Page actions");
await el('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
await el('[data-testid="open-version-history"]').click();
await el('[data-testid="history-dialog"]').waitFor({ state: "visible" });
await el('[data-testid="save-version-now"]').click();
await el('[data-testid="version-row"]').first().waitFor({ state: "visible" });
await clearToasts();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, "version-history.png") });
note("version-history.png");
await page.keyboard.press("Escape");
await page.waitForTimeout(600);

// (e) theme gallery
await el('[data-testid="themes-button"]').click();
await el('[data-testid="themes-dialog"]').waitFor({ state: "visible" });
await settle(400);
await page.screenshot({ path: path.join(OUT, "themes.png") });
note("themes.png");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// (f) dark hero — Alpine page, plain paper so the canvas follows the dark
// theme (#1e1e1e) and the scene's light ink pops (grid paper forces a light
// canvas even in dark mode — verified in the first capture run)
await page.getByRole("button", { name: "Toggle theme" }).click();
await page.waitForTimeout(700);
await openPageByTitle("Alpine field notes");
await fitContent(0.85);
await settle();
await page.screenshot({ path: path.join(OUT, "dark-hero.png") });
note("dark-hero.png");

// (g) back to light, mobile drawer
await page.getByRole("button", { name: "Toggle theme" }).click();
await page.waitForTimeout(700);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
await page.getByRole("button", { name: "Open navigation" }).click();
await page.locator("[data-slot='sheet-content']").waitFor({ state: "visible" });
await settle(1000);
await page.screenshot({ path: path.join(OUT, "mobile.png") });
note("mobile.png");

await ctx.close();
console.log(`\ndone — ${shots.length} screenshots in ${OUT}`);
