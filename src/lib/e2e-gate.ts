/**
 * Test-hook gate (issue #102).
 *
 * The `?e2e=1` hooks (window.__NOTE_RESET__ erases ALL local data!) used to
 * install in EVERY environment — including production bundles. They now
 * require an explicit opt-in build flag:
 *
 *   NEXT_PUBLIC_E2E=1 next build   (or the dev:e2e script)
 *
 * Next.js inlines NEXT_PUBLIC_* vars at build time, so the check compiles to
 * `false` in normal production builds (web, Tauri, TWA) and the hooks never
 * ship; CI's Playwright job builds WITH the flag, and the `?e2e=1` search
 * param stays required on top (defense in depth — a flag build does not
 * expose the hooks on ordinary URLs).
 *
 * Pure: the logic is unit-testable without a DOM.
 */

/** Should the e2e test hooks install in this build + URL? */
export function e2eHooksEnabled(search: string, e2eBuildFlag: string | undefined): boolean {
  if (e2eBuildFlag !== "1") return false; // not an e2e-enabled build
  return new URLSearchParams(search).has("e2e");
}
