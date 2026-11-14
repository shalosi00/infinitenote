/**
 * Ignore rules for the E2E error-free guard (issue #223).
 *
 * `attachErrorCollector` (e2e/helpers.ts) fails any spec whose browser logs a
 * console error. The rules here are browser deprecation notices tied to
 * VENDORED third-party behavior the app cannot fix — each with its
 * justification. Keep this list MINIMAL and anchor every rule to the exact
 * message: a broad filter would blind the guard to real app errors.
 */
const IGNORED_CONSOLE_ERRORS: readonly RegExp[] = [
  // Chromium 159+ enforces the `unload` permissions policy by default and
  // logs `Permissions policy violation: unload is not allowed in this
  // document.` on every page load: the vendored Excalidraw bundle registers
  // an `unload` cleanup handler (dist chunk, measured via a console-location
  // probe on 2026-11-14). The app allows same-origin unload via
  // `Permissions-Policy: ... unload=(self)` (next.config.ts), but the
  // standalone CI e2e server and the static-export/Tauri contexts do not
  // carry next.config headers — so the guard must tolerate the exact notice.
  // It is a deprecation warning about Excalidraw's own cleanup registration,
  // not an app error. Issue #223.
  /^Permissions policy violation: unload is not allowed in this document\.$/,
];

/** True when the console-error text matches a documented ignore rule. */
export function isIgnoredConsoleError(text: string): boolean {
  return IGNORED_CONSOLE_ERRORS.some((rule) => rule.test(text));
}
