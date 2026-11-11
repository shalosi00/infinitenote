import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

/**
 * InfiniteNote E2E suite.
 *
 * - CI boots the real production build (`next build` + standalone server).
 * - Locally the dev server is reused when :3000 is already running, otherwise
 *   `bun run dev:e2e` is started (and torn down) by Playwright itself.
 * - Every spec resets its own browser context (isolated IndexedDB) via the
 *   app's `?e2e=1` hooks, so files can run fully parallel.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: isCI ? 2 : 1, // local sandbox is memory-constrained; CI runners are not
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  reporter: [
    ["list"],
    ["html", { outputFolder: "e2e-report", open: "never" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  outputDir: "./test-results",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: isCI
      ? // NEXT_PUBLIC_E2E=1 compiles the test hooks into this build only —
        // ordinary production builds never ship them (issue #102). The build
        // is retried twice (belt-and-braces): on 2026-11-11 Turbopack's
        // PostCSS worker IPC deadline elapsed deterministically on slower
        // shared runners — 9 consecutive FATAL panics ("Failed to write app
        // endpoint /page") — fixed by moving the build script to webpack
        // (`next build --webpack`), a supported Next 16 flag.
        "NEXT_PUBLIC_E2E=1 bun run build || NEXT_PUBLIC_E2E=1 bun run build || NEXT_PUBLIC_E2E=1 bun run build && bun .next/standalone/server.js"
      : "bun run dev:e2e",
    url: BASE_URL,
    reuseExistingServer: !isCI,
    // the CI webServer command includes the FULL production build (+ up to
    // two retries for the flaky Turbopack panic) — a single slow build
    // measured 6m42s on a busy shared runner (2026-11-11), so the budget
    // must fit several attempts; the suite itself is unaffected
    timeout: 1_500_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
