/**
 * HWR benchmark — issue #193 step 1 ("measure first"): per-line recognition
 * latency on the REAL vendored engine, one cold round (includes first-use
 * model load) plus warm rounds (pipeline singleton already initialized).
 *
 * NOT a CI test: skipped unless HWR_BENCH=1, so the required-CI e2e suite
 * is unaffected. Run locally with:
 *
 *   HWR_BENCH=1 bunx playwright test e2e/hwr-bench.spec.ts
 *
 * Output: one "HWR-BENCH-RESULTS <json>" console line (round, kind,
 * totalMs click→toast, lineMs = the engine's own per-line latency logs).
 * The recorded evidence table lives in docs/test-plans/handwriting.md —
 * every number there comes from an actual run of this spec.
 */
import { expect, test, type Page } from "@playwright/test";
import { attachErrorCollector, clickInNotebook, expectCount, resetToSeed } from "./helpers";

const ROUNDS = 4; // 1 cold (model load) + 3 warm single-line rounds

test.skip(process.env.HWR_BENCH !== "1", "benchmark runs only with HWR_BENCH=1");

interface BenchSample {
  round: number;
  kind: "cold" | "warm";
  /** wall-clock from clicking run-hwr to the recognition toast */
  totalMs: number;
  /** the engine's own per-line latency log entries (ms) */
  lineMs: number[];
}

test.describe.serial("hwr benchmark: per-line recognition latency", () => {
  let page: Page;
  let consoleErrors: string[];
  const samples: BenchSample[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    console.info(`HWR-BENCH-RESULTS ${JSON.stringify(samples)}`);
    await page.close();
  });

  async function runHandwriting(): Promise<void> {
    await page.getByRole("button", { name: "Page actions" }).click();
    await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="run-hwr"]').click();
  }

  test("HWR-BENCH: 1 cold + 3 warm single-line rounds", async () => {
    let lineLogs: string[] = [];
    page.on("console", (msg) => {
      if (msg.text().includes("andwriting] line:")) lineLogs.push(msg.text());
    });

    for (let round = 1; round <= ROUNDS; round++) {
      lineLogs = [];
      await clickInNotebook(page, "Welcome Notebook", "Add page");
      await expectCount(page, 0);
      await page.setInputFiles(
        'input[aria-label="Import files"]',
        "e2e/fixtures/handwriting-cat.excalidraw",
      );
      await expectCount(page, 5);

      const t0 = Date.now();
      await runHandwriting();
      await page
        .getByText("Recognized handwriting on 1 line — 1 line had readable text.")
        .waitFor({ state: "visible", timeout: 300_000 });
      const totalMs = Date.now() - t0;

      const lineMs = lineLogs
        .map((l) => {
          const m = /line:\s*(\d+)ms/.exec(l);
          return m ? Number.parseInt(m[1], 10) : 0;
        })
        .filter((n) => n > 0);
      expect(lineMs.length, "engine must log per-line latency").toBeGreaterThan(0);

      samples.push({ round, kind: round === 1 ? "cold" : "warm", totalMs, lineMs });

      // let the toast detach before the next sidebar interaction (the
      // bottom-center toast zone swallows clicks while visible)
      await page
        .locator("[data-sonner-toast]")
        .first()
        .waitFor({ state: "detached", timeout: 20_000 })
        .catch(() => {});
    }

    const warm = samples.filter((s) => s.kind === "warm");
    const warmLineMs = warm.flatMap((s) => s.lineMs);
    expect(warmLineMs.length).toBeGreaterThanOrEqual(warm.length);
    console.info(
      `HWR-BENCH-SUMMARY warm single-line samples=${warmLineMs.length} ` +
        `min=${Math.min(...warmLineMs)}ms mean=${Math.round(
          warmLineMs.reduce((a, b) => a + b, 0) / warmLineMs.length,
        )}ms max=${Math.max(...warmLineMs)}ms`,
    );
  });
});
