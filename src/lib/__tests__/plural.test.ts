/// <reference types="bun-types" />
/**
 * Unit tests for the English plural helper (src/lib/plural.ts) — the
 * replacement for the ICU plural messages the catalog used to carry.
 */
import { describe, expect, it } from "bun:test";
import { plural } from "../plural";

describe("plural", () => {
  it("renders the one branch for exactly 1", () => {
    expect(plural(1, "1 page", "# pages")).toBe("1 page");
    expect(plural(1, "1 selected", "# selected")).toBe("1 selected");
  });

  it("renders the other branch with # replaced for every other count", () => {
    expect(plural(0, "1 page", "# pages")).toBe("0 pages");
    expect(plural(2, "1 page", "# pages")).toBe("2 pages");
    expect(plural(27, "1 notebook", "# notebooks")).toBe("27 notebooks");
  });

  it("replaces every # in the branch (multiple occurrences)", () => {
    expect(plural(5, "1 of #", "# of #")).toBe("5 of 5");
  });

  it("passes branches without # through unchanged", () => {
    expect(plural(3, "one item", "several items")).toBe("several items");
  });
});
