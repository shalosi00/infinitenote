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
await page.waitForTimeout(800);

// before reload
const before = await page.evaluate(() => ({
  players: document.querySelectorAll('[data-testid="audio-player"]').length,
  containers: document.querySelectorAll(".excalidraw__embeddable-container").length,
}));
console.log("before reload:", JSON.stringify(before));

await page.evaluate(() => window.__NOTE_E2E__.saveNow());
await page.reload();
await page.locator('[data-testid="page-row"]').first().waitFor({ state: "visible", timeout: 30000 });
await page.waitForFunction(() => typeof window.__NOTE_E2E__?.elementCount() === "number", undefined, { timeout: 30000 });
const afterLoad = await page.evaluate(() => ({
  count: window.__NOTE_E2E__.elementCount(),
  players: document.querySelectorAll('[data-testid="audio-player"]').length,
}));
console.log("after reload (default page):", JSON.stringify(afterLoad));

// switch to Page 2
const row2 = page.locator('[data-testid="page-row"]').filter({ has: page.getByRole("button", { name: "Page 2", exact: true }) });
await row2.getByRole("button", { name: "Page 2", exact: true }).click();
await page.waitForFunction(() => window.__NOTE_E2E__?.elementCount() === 1, undefined, { timeout: 30000 });
await page.waitForTimeout(1500);
const after = await page.evaluate(() => {
  const st = window.__NOTE_E2E__.excalidraw.getAppState();
  return {
    count: window.__NOTE_E2E__.elementCount(),
    players: document.querySelectorAll('[data-testid="audio-player"]').length,
    containers: [...document.querySelectorAll(".excalidraw__embeddable-container")].map((c) => ({
      display: getComputedStyle(c).display,
      transform: c.style.transform,
    })),
    scroll: [st.scrollX, st.scrollY], zoom: st.zoom.value,
    els: window.__NOTE_E2E__.excalidraw.getSceneElements().map((e) => ({ t: e.type, link: e.link ? e.link.slice(0, 24) : null, customData: e.customData ?? null })),
  };
});
console.log("after switch to Page 2:", JSON.stringify(after, null, 1));
console.log("console errors:", errors);
await browser.close();
