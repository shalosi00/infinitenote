/**
 * HWR benchmark — issue #193 ("measure first"): per-line recognition
 * latency on the REAL vendored engine, one cold round (includes first-use
 * model load) plus warm rounds (pipeline singleton already initialized).
 *
 * NOT a CI test: skipped unless HWR_BENCH=1, so the required-CI e2e suite
 * is unaffected. Run locally with:
 *
 *   HWR_BENCH=1 bunx playwright test e2e/hwr-bench.spec.ts                    # wasm arm
 *   HWR_BENCH=1 HWR_BENCH_DEVICE=webgpu bunx playwright test e2e/hwr-bench.spec.ts
 *
 * The webgpu arm forces the device through the documented verification
 * seam (globalThis.__HWR_DEVICE__, read by src/lib/hwr-device.ts —
 * production pages never set it) and launches full Chromium with
 * --enable-unsafe-swiftshader so a software WebGPU adapter can exist.
 *
 * Output: one "HWR-BENCH-RESULTS <json>" console line (device, page
 * probe state, every /hwr/ request path, round samples with the engine's
 * own per-line latency logs). The recorded evidence table lives in
 * docs/test-plans/handwriting.md — every number there comes from an
 * actual run of this spec.
 */
import { expect, test, type Page } from "@playwright/test";
import { attachErrorCollector, clickInNotebook, expectCount, resetToSeed } from "./helpers";

const BENCH_DEVICE: "wasm" | "webgpu" =
  process.env.HWR_BENCH_DEVICE === "webgpu" ? "webgpu" : "wasm";
// webgpu-on-SwiftShader measured ~75 s/line (2026-11-12) — 2 rounds keeps
// a full webgpu invocation inside ~5 min; wasm keeps 1 cold + 3 warm
const ROUNDS = BENCH_DEVICE === "webgpu" ? 2 : 4;

if (BENCH_DEVICE === "webgpu") {
  // Full chromium build (not the stripped headless shell) + software WebGPU.
  test.use({
    channel: "chromium",
    launchOptions: { args: ["--enable-unsafe-webgpu", "--enable-unsafe-swiftshader"] },
  });
}

test.skip(process.env.HWR_BENCH !== "1", "benchmark runs only with HWR_BENCH=1");

interface BenchSample {
  round: number;
  kind: "cold" | "warm";
  /** wall-clock from clicking run-hwr to the recognition toast */
  totalMs: number;
  /** the engine's own per-line latency log entries (ms + logged device) */
  lines: Array<{ ms: number; device: string }>;
}

interface BenchOutcome {
  device: "wasm" | "webgpu";
  pageProbe: { gpuBinding: string; adapter: string };
  hwrRequests: string[];
  samples: BenchSample[];
  identity: string;
}

test.describe.serial("hwr benchmark: per-line recognition latency", () => {
  // the suite's 90 s test timeout fits nothing here: webgpu-on-SwiftShader
  // measured ~75 s PER LINE (2026-11-12) — benchmark-only override, CI never
  // runs this spec
  test.setTimeout(BENCH_DEVICE === "webgpu" ? 1_500_000 : 600_000);
  let page: Page;
  let consoleErrors: string[];
  let lastIdentity = "unchecked";
  let probeState: BenchOutcome["pageProbe"] = { gpuBinding: "n/a", adapter: "n/a" };
  const allConsole: string[] = [];
  const samples: BenchSample[] = [];
  const hwrPaths = new Set<string>();

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    if (BENCH_DEVICE === "webgpu") {
      await page.addInitScript(() => {
        (globalThis as { __HWR_DEVICE__?: string }).__HWR_DEVICE__ = "webgpu";
      });
    }
    consoleErrors = attachErrorCollector(page);
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/hwr/")) hwrPaths.add(new URL(url).pathname);
    });
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    const outcome: BenchOutcome = {
      device: BENCH_DEVICE,
      pageProbe: probeState,
      hwrRequests: [...hwrPaths].sort(),
      samples,
      identity: lastIdentity,
    };
    console.info(`HWR-BENCH-RESULTS ${JSON.stringify(outcome)}`);
    await page.close();
  });

  async function runHandwriting(): Promise<void> {
    await page.getByRole("button", { name: "Page actions" }).click();
    await page.locator('[data-testid="page-actions-menu"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="run-hwr"]').click();
  }

  test("HWR-BENCH: 1 cold + 3 warm single-line rounds", async () => {
    // in-page WebGPU state: what the gate's silent fallback sees here
    probeState = await page.evaluate(async () => {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
      if (!gpu) return { gpuBinding: "absent", adapter: "n/a" };
      try {
        const adapter = await gpu.requestAdapter();
        return { gpuBinding: "present", adapter: adapter ? "obtained" : "null" };
      } catch (err) {
        return { gpuBinding: "present", adapter: `error: ${String(err).slice(0, 80)}` };
      }
    });

    let lineLogs: string[] = [];
    page.on("console", (msg) => {
      allConsole.push(msg.text().slice(0, 200));
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
      // the EXACT success toast — the partial-failure variant
      // ("none was readable, 1 failed") must NOT count as a benchmark sample
      await page
        .getByText("Recognized handwriting on 1 line — 1 line had readable text.")
        .waitFor({ state: "visible", timeout: BENCH_DEVICE === "webgpu" ? 900_000 : 300_000 })
        .catch(async () => {
          const toastText = await page
            .locator("[data-sonner-toast]")
            .first()
            .innerText({ timeout: 5_000 })
            .catch(() => "(no toast)");
          const outcome = {
            device: BENCH_DEVICE,
            pageProbe: probeState,
            hwrRequests: [...hwrPaths].sort(),
            samples,
            identity: lastIdentity,
            failure: `webgpu arm not measurable here — toast: ${toastText}`,
            consoleTail: allConsole.slice(-12),
          };
          console.info(`HWR-BENCH-RESULTS ${JSON.stringify(outcome)}`);
          throw new Error(
            `WebGPU arm not measurable in this environment — toast: ${toastText}`,
          );
        });
      const totalMs = Date.now() - t0;

      const lines = lineLogs
        .map((l) => {
          const m = /line:\s*(\d+)ms \((wasm|webgpu)\)/.exec(l);
          return m ? { ms: Number.parseInt(m[1], 10), device: m[2] } : null;
        })
        .filter((x): x is { ms: number; device: string } => x !== null);
      expect(lines.length, "engine must log per-line latency").toBeGreaterThan(0);
      expect(
        lines.every((l) => l.device === BENCH_DEVICE),
        `engine must run on the benchmarked device (${BENCH_DEVICE})`,
      ).toBe(true);

      samples.push({ round, kind: round === 1 ? "cold" : "warm", totalMs, lines });

      // let the toast detach before the next sidebar interaction (the
      // bottom-center toast zone swallows clicks while visible)
      await page
        .locator("[data-sonner-toast]")
        .first()
        .waitFor({ state: "detached", timeout: 20_000 })
        .catch(() => {});
    }

    // result-identity check: the final page's recognized ink must be
    // searchable — same acceptance criterion as the HWR-E02 wasm path
    await page.keyboard.press("Control+K");
    const input = page.getByPlaceholder("Search all pages…");
    await input.waitFor({ state: "visible" });
    for (let attempt = 0; attempt < 4; attempt++) {
      await input.fill("CAT");
      await page.waitForTimeout(250);
      if ((await input.inputValue()) === "CAT") break;
    }
    await expect(input).toHaveValue("CAT");
    await page.locator("[cmdk-list]").waitFor({ state: "visible" });
    lastIdentity = (await page.locator("[cmdk-list]").innerText()).includes("CAT")
      ? "recognized text searchable (CAT hit)"
      : "NO CAT HIT";
    expect(lastIdentity, "recognition must produce a searchable CAT hit").toContain("searchable");
    await page.keyboard.press("Escape");

    const warm = samples.filter((s) => s.kind === "warm");
    const warmLineMs = warm.flatMap((s) => s.lines.map((l) => l.ms));
    expect(warmLineMs.length).toBeGreaterThanOrEqual(warm.length);
    console.info(
      `HWR-BENCH-SUMMARY device=${BENCH_DEVICE} probe=${JSON.stringify(probeState)} ` +
        `warm single-line samples=${warmLineMs.length} ` +
        `min=${Math.min(...warmLineMs)}ms mean=${Math.round(
          warmLineMs.reduce((a, b) => a + b, 0) / warmLineMs.length,
        )}ms max=${Math.max(...warmLineMs)}ms`,
    );
  });
});
