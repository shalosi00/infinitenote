/// <reference types="bun-types" />
/**
 * Unit tests for the conventional-commit PR-title validator
 * (src/lib/pr-title.ts). The `pr-title` CI workflow runs the same module
 * directly (`bun src/lib/pr-title.ts`, title in PR_TITLE), so the behavior
 * the workflow enforces is pinned here.
 *
 * Positive cases are REAL titles from this repo's merged-PR history
 * (queried from the GitHub API on 2026-11-16) — no invented data. Negative
 * cases are the malformed shapes the check exists to catch.
 */
import { describe, expect, it } from "bun:test";
import { PR_TITLE_TYPES, validatePrTitle } from "../pr-title";

describe("validatePrTitle — real titles from the merged history", () => {
  const realTitles = [
    "feat: web share target — capture OS shares into Quick Notes (#247)",
    "docs: worklog entry — web share target capture (#247)",
    "chore(deps): bump the action-pins group with 4 updates",
    "chore(security): ship scripts/audit-lockfile.py + fix the audit report's CI-gate claim",
    "chore: sync main with develop — audit-verification cycle (#238/#239)",
    "docs: adopt major-repo community practices — SECURITY.md, CoC, issue forms, copilot guide",
    "chore(deps): security sweep — fresh lockfile + katex/nanoid overrides; 35 audit findings to 1 documented residue (#235)",
    "ci: enforce conventional PR titles + path-based auto-labeling (majors' practice)",
  ];

  it("has real, non-empty history titles to test against", () => {
    expect(realTitles.length).toBe(8);
  });

  for (const title of realTitles) {
    it(`accepts: ${title.slice(0, 48)}${title.length > 48 ? "…" : ""}`, () => {
      const result = validatePrTitle(title);
      expect(result.ok).toBe(true);
      expect(result.reason).toBe("");
    });
  }
});

describe("validatePrTitle — structural shapes", () => {
  it("accepts the breaking-change marker with a scope", () => {
    expect(validatePrTitle("feat(sync)!: three-way merge v2").ok).toBe(true);
  });

  it("accepts the breaking-change marker without a scope", () => {
    expect(validatePrTitle("feat!: one-time schema migration").ok).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(validatePrTitle("  fix: flush pending autosave  ").ok).toBe(true);
  });

  it("accepts every documented type", () => {
    expect(PR_TITLE_TYPES.length).toBe(11);
    for (const type of PR_TITLE_TYPES) {
      const result = validatePrTitle(`${type}: a plausible subject line`);
      expect(result.ok).toBe(true);
    }
  });
});

describe("validatePrTitle — rejects malformed titles", () => {
  const bad = [
    ["", "empty"],
    ["   ", "whitespace only"],
    ["Update stuff", "no type"],
    ["feat no colon here", "no type"],
    ["unknown: something changed here", "unknown type"],
    ["Feature: adds the thing", "uppercase type"],
    ["feat(UI): rework the sidebar", "uppercase scope"],
    ["feat:", "empty subject"],
    ["feat: x", "too-short subject"],
    ["feat: two\nlines in one title", "multiline"],
    ["feat(Scope): mixed-case scope name", "bad scope chars"],
    ["chore(deps)missing: colon after scope", "malformed scope"],
  ] as const;

  it("covers all 12 malformed shapes", () => {
    expect(bad.length).toBe(12);
  });

  for (const [title, why] of bad) {
    it(`rejects ${why}: ${title === "" ? "(empty)" : title.slice(0, 40)}`, () => {
      const result = validatePrTitle(title);
      expect(result.ok).toBe(false);
      expect(result.reason.length).toBeGreaterThan(0);
    });
  }
});

describe("validatePrTitle — complaint quality", () => {
  it("names the unknown type", () => {
    const result = validatePrTitle("wishlist: build the moon");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('unknown type "wishlist"');
  });

  it("flags an uppercase type", () => {
    const result = validatePrTitle("Feature: adds the thing");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("lowercase");
  });

  it("flags a too-short subject with the measured length", () => {
    const result = validatePrTitle("feat: x");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("1 chars");
  });

  it("flags multiline titles", () => {
    const result = validatePrTitle("feat: one\ntwo");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("single line");
  });
});
