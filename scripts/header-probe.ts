/**
 * Header-space probe (diagnostic): at 320px, where does every header child
 * sit, and how much space must be reclaimed so the last button fits?
 */
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000/?e2e=1";

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 320, height: 700 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="save-indicator"]').waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(600);
  const rows = await page.evaluate(() => {
    const header = document.querySelector("header")!;
    const vw = window.innerWidth;
    const kids = Array.from(header.querySelectorAll(":scope > *")).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        what: (el.getAttribute("aria-label") ?? el.getAttribute("data-testid") ?? el.textContent?.trim().slice(0, 14) ?? el.tagName.toLowerCase()).slice(0, 22),
        x: Math.round(r.x),
        right: Math.round(r.right),
        w: Math.round(r.width),
        out: r.right > vw + 0.5,
      };
    });
    const scrollable = { scrollWidth: header.scrollWidth, clientWidth: header.clientWidth };
    return { vw, kids, scrollable };
  });
  console.log(`viewport=${rows.vw}  header scrollW=${rows.scrollable.scrollWidth} clientW=${rows.scrollable.clientWidth}`);
  for (const k of rows.kids) {
    console.log(`  ${String(k.x).padStart(4)}..${String(k.right).padStart(4)} (w=${String(k.w).padStart(3)}) ${k.out ? "OUT " : "    "} ${k.what}`);
  }
  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
