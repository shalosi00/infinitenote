/**
 * Flicker reproduction probe (diagnostic only — not part of the test suite).
 *
 * Boots the app with E2E hooks, resets to the deterministic seed, then samples
 * the save-indicator's text every 50 ms across four interaction phases:
 *
 *   1. idle      — no interaction at all (baseline noise)
 *   2. select    — clicks on empty canvas + on the seeded text element
 *   3. zoom      — ctrl+wheel zoom in/out bursts
 *   4. pan       — space+drag viewport pans
 *
 * Any "Saving…" sighting in phases 2–4 (or 1) is a spurious save: the scene
 * content never changed, so nothing should ever be written or flashed.
 */
import { chromium } from "@playwright/test";;

const BASE = "http://localhost:3000/?e2e=1";

interface PhaseResult {
  phase: string;
  samples: number;
  transitions: number;
  savingSeen: number;
  states: string[];
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  // wait for the app shell + e2e hooks
  await page.locator('[data-testid="page-row"]').first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__NOTE_E2E__ === "object", undefined, { timeout: 30_000 });
  await page.waitForFunction(() => (window.__NOTE_E2E__?.elementCount() ?? -1) === 2, undefined, { timeout: 30_000 });

  const canvas = page.locator(".excalidraw");
  const box = (await canvas.boundingBox())!;

  const sample = async (phase: string, ms: number, action?: () => Promise<void>): Promise<PhaseResult> => {
    const states: string[] = [];
    const start = Date.now();
    const sampler = setInterval(async () => {
      const t = await page.locator('[data-testid="save-indicator"]').textContent().catch(() => "");
      states.push((t ?? "").trim());
    }, 50);
    if (action) await action();
    const remain = ms - (Date.now() - start);
    if (remain > 0) await page.waitForTimeout(remain);
    clearInterval(sampler);
    // close the sampling race: one final synchronous read
    states.push(((await page.locator('[data-testid="save-indicator"]').textContent()) ?? "").trim());
    let transitions = 0;
    let savingSeen = 0;
    for (let i = 1; i < states.length; i++) {
      if (states[i] !== states[i - 1]) transitions++;
      if (states[i] === "Saving…") savingSeen++;
    }
    return { phase, samples: states.length, transitions, savingSeen, states: [...new Set(states)] };
  };

  const results: PhaseResult[] = [];

  // Phase 1: pure idle
  results.push(await sample("idle", 2500));

  // Phase 2: selection clicks (empty canvas spot, then the seeded text element)
  results.push(
    await sample("select", 3000, async () => {
      await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
      await page.waitForTimeout(600);
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.waitForTimeout(600);
      await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
    })
  );

  // Phase 3: ctrl+wheel zoom bursts
  results.push(
    await sample("zoom", 3000, async () => {
      for (let i = 0; i < 6; i++) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
        await page.waitForTimeout(150);
      }
    })
  );

  // Phase 4: space+drag pan
  results.push(
    await sample("pan", 3000, async () => {
      await page.keyboard.down(" ");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.up(" ");
      await page.waitForTimeout(400);
      await page.keyboard.down(" ");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 - 60, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.up(" ");
    })
  );

  console.log("\n=== SAVE-INDICATOR FLICKER PROBE (50ms sampling) ===");
  for (const r of results) {
    console.log(
      `${r.phase.padEnd(7)} samples=${String(r.samples).padStart(3)}  text-transitions=${String(r.transitions).padStart(3)}  "Saving…"-frames=${String(r.savingSeen).padStart(3)}  states-seen=${JSON.stringify(r.states)}`
    );
  }
  const spurious = results.slice(1).filter((r) => r.savingSeen > 0 || r.transitions > 0);
  console.log(
    spurious.length > 0
      ? `\nFLICKER REPRODUCED: ${spurious.map((r) => r.phase).join(", ")} flashed the indicator without any content edit.`
      : "\nNo flicker observed."
  );

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
