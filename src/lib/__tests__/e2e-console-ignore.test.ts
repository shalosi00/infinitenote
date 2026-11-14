import { describe, expect, it } from "bun:test";
import { isIgnoredConsoleError } from "../e2e-console-ignore";

/**
 * Pins for the E2E error-free guard's ignore list (issue #223).
 * The list must stay minimal: every rule here is a browser deprecation
 * notice from vendored third-party code, matched EXACTLY.
 */
describe("isIgnoredConsoleError (E2E error-free guard ignore list, issue #223)", () => {
  it("ignores the exact Chromium 159 unload-permissions-policy violation", () => {
    expect(
      isIgnoredConsoleError(
        "Permissions policy violation: unload is not allowed in this document.",
      ),
    ).toBe(true);
  });

  it("does not ignore other permissions-policy violations", () => {
    expect(
      isIgnoredConsoleError(
        "Permissions policy violation: camera is not allowed in this document.",
      ),
    ).toBe(false);
    expect(
      isIgnoredConsoleError(
        "Permissions policy violation: geolocation is not allowed in this document.",
      ),
    ).toBe(false);
  });

  it("does not ignore a truncated or altered unload message", () => {
    expect(
      isIgnoredConsoleError(
        "Permissions policy violation: unload is not allowed in this document",
      ),
    ).toBe(false);
    expect(
      isIgnoredConsoleError(
        "Permissions policy violation: unload is not allowed in this document. Extra context",
      ),
    ).toBe(false);
  });

  it("does not ignore unrelated errors — the guard stays honest", () => {
    expect(isIgnoredConsoleError("Uncaught TypeError: x is not a function")).toBe(false);
    expect(isIgnoredConsoleError("Failed to load resource: 500")).toBe(false);
    expect(isIgnoredConsoleError("")).toBe(false);
  });
});
