// Reproduce VH-E01's stuck history dialog and dump the surface state.
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 150)));

await page.goto("http://localhost:3000/?e2e=1", { timeout: 90_000 });
await page.locator('[data-testid="page-row"]').first().waitFor({ state: "visible", timeout: 30_000 });

// VH-E01 prelude: the spec's own flow — the notebook row's "Add page" button
const nb = page.locator("div.select-none").filter({ has: page.getByRole("button", { name: "Welcome Notebook", exact: true }) });
await nb.getByRole("button", { name: "Add page", exact: true }).click();
await page.waitForTimeout(600);
console.log("new page created");

// open Page actions menu → open-version-history
await page.getByRole("button", { name: "Page actions" }).click();
await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible", timeout: 8_000 });

const preMenuState = await page.evaluate(() => ({
  menus: [...document.querySelectorAll('[role="menu"]')].map((m) => ({
    testid: (m as HTMLElement).dataset.testid,
    state: (m as HTMLElement).dataset.state,
  })),
}));
console.log("menu open:", JSON.stringify(preMenuState));

await page.locator('[data-testid="open-version-history"]').click();
await page.locator('[data-testid="history-dialog"]').waitFor({ state: "visible", timeout: 8_000 });
console.log("history dialog visible");

// NOW dump what else is in the DOM before Escape
const preEscape = await page.evaluate(() => ({
  menus: [...document.querySelectorAll('[role="menu"]')].map((m) => ({
    testid: (m as HTMLElement).dataset.testid,
    state: (m as HTMLElement).dataset.state,
    connected: m.isConnected,
  })),
  overlays: [...document.querySelectorAll('[data-slot="dialog-overlay"], [data-slot="popover-overlay"], [data-slot="menu-overlay"], [data-slot^="dropdown"], [data-slot^="context"]')].map((n) => ({
    slot: (n as HTMLElement).dataset.slot,
    state: (n as HTMLElement).dataset.state,
  })),
  focus: document.activeElement?.tagName + "." + (document.activeElement as HTMLElement)?.dataset?.testid,
  bodyPE: document.body.style.pointerEvents || "(empty)",
}));
console.log("before Escape:", JSON.stringify(preEscape, null, 1));

await page.keyboard.press("Escape");
await page.waitForTimeout(600);

const postEscape = await page.evaluate(() => ({
  dialogState: (document.querySelector('[data-testid="history-dialog"]') as HTMLElement)?.dataset.state,
  dialogInDom: !!document.querySelector('[data-testid="history-dialog"]'),
  menus: [...document.querySelectorAll('[role="menu"]')].map((m) => ({
    testid: (m as HTMLElement).dataset.testid,
    state: (m as HTMLElement).dataset.state,
  })),
  focus: document.activeElement?.tagName + "." + (document.activeElement as HTMLElement)?.dataset?.testid,
}));
console.log("after Escape:", JSON.stringify(postEscape, null, 1));
console.log("pageerrors:", errors);
await browser.close();
