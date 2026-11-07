import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("uncaught: " + e.message));

await page.goto("http://localhost:3000/?e2e=1");
await page.locator('[data-testid="page-row"]').first().waitFor({ state: "visible", timeout: 30000 });
await page.evaluate(() => { void window.__NOTE_RESET__?.().catch(() => undefined); });
await page.waitForFunction(() => window.__NOTE_E2E__?.elementCount() === 2, undefined, { timeout: 45000 });

const row = page.locator("div.select-none").filter({ has: page.getByRole("button", { name: "Welcome Notebook", exact: true }) });
await row.getByRole("button", { name: "Add page", exact: true }).click();
await page.waitForFunction(() => window.__NOTE_E2E__?.elementCount() === 0);

await page.setInputFiles('input[aria-label="Import files"]', "e2e/fixtures/test-audio.wav");
await page.waitForFunction(() => window.__NOTE_E2E__?.elementCount() === 1);

await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const appState = window.__NOTE_E2E__.excalidraw.getAppState();
  const els = window.__NOTE_E2E__.excalidraw.getSceneElements();
  const containers = [...document.querySelectorAll(".excalidraw__embeddable-container")];
  const players = [...document.querySelectorAll('[data-testid="audio-player"]')];
  return {
    scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom,
    width: appState.width, height: appState.height,
    offsetTop: appState.offsetTop, offsetLeft: appState.offsetLeft,
    element: els.map((e) => ({ type: e.type, x: e.x, y: e.y, w: e.width, h: e.height, link: e.link?.slice(0, 30) })),
    containerCount: containers.length,
    containerStyles: containers.map((c) => ({ display: getComputedStyle(c).display, w: c.style.width, h: c.style.height, transform: c.style.transform })),
    playerCount: players.length,
  };
});
console.log(JSON.stringify(info, null, 2));
console.log("console errors:", errors);
await browser.close();
