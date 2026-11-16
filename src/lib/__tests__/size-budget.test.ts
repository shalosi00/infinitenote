/// <reference types="bun-types" />
/**
 * Unit tests pinning the bundle-size guard (scripts/check-bundle-size.mjs +
 * scripts/size-budget.json) — the Excalidraw size-limit practice, wave 3 of
 * the majors-research directive. Same pattern as fdroid-config.test.ts:
 * the pure helpers are imported straight from the script and the committed
 * budget file itself is pinned to be sane (a budget cannot be moved without
 * a real measurement next to it).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUDGET_FILE,
  CHUNKS_DIR,
  collectJsStats,
  evaluateBudget,
  formatKib,
  renderSummary,
  validateBudgetConfig,
} from "../../../scripts/check-bundle-size.mjs";

const ROOT = process.cwd();

const loadBudget = () =>
  JSON.parse(readFileSync(join(ROOT, BUDGET_FILE), "utf8"));

describe("evaluateBudget", () => {
  it("passes when the actual total equals the budget exactly", () => {
    const v = evaluateBudget(10400, 10400);
    expect(v.ok).toBe(true);
    expect(v.overByKib).toBe(0);
    expect(v.pctOfBudget).toBe(100);
  });

  it("passes under budget and reports the percentage", () => {
    const v = evaluateBudget(10400, 9909.1);
    expect(v.ok).toBe(true);
    expect(v.overByKib).toBe(0);
    expect(v.pctOfBudget).toBe(95.3);
  });

  it("fails strictly over budget and reports the overshoot", () => {
    const v = evaluateBudget(10400, 11000.4);
    expect(v.ok).toBe(false);
    expect(v.overByKib).toBe(600.4);
    expect(v.pctOfBudget).toBe(105.8);
  });

  it("rejects nonsense budgets and actuals", () => {
    expect(() => evaluateBudget(0, 100)).toThrow(/invalid budget/);
    expect(() => evaluateBudget(-5, 100)).toThrow(/invalid budget/);
    expect(() => evaluateBudget(100, Number.NaN)).toThrow(/invalid actual/);
    expect(() => evaluateBudget(100, -1)).toThrow(/invalid actual/);
  });
});

describe("validateBudgetConfig", () => {
  const valid = () => loadBudget();

  it("accepts the committed budget file shape", () => {
    const r = validateBudgetConfig(valid());
    expect(r.ok).toBe(true);
    expect(r.error).toBe("");
  });

  const bad = [
    ["null", null],
    ["an array", []],
    ["a string", "10400"],
  ] as const;
  for (const [why, raw] of bad) {
    it(`rejects a file that is ${why}`, () => {
      expect(validateBudgetConfig(raw as unknown as object).ok).toBe(false);
    });
  }

  it("rejects a missing or non-positive clientJsTotalKib", () => {
    const missing = { measured: valid().measured };
    expect(validateBudgetConfig(missing).error).toMatch(/clientJsTotalKib/);
    const zero = { clientJsTotalKib: 0, measured: valid().measured };
    expect(validateBudgetConfig(zero).ok).toBe(false);
    const negative = { clientJsTotalKib: -1, measured: valid().measured };
    expect(validateBudgetConfig(negative).ok).toBe(false);
  });

  it("rejects a measured block without on/commit/values", () => {
    const base = valid();
    const noOn = { ...base, measured: { ...base.measured, on: "" } };
    expect(validateBudgetConfig(noOn).error).toMatch(/measured\.on/);
    const noCommit = { ...base, measured: { ...base.measured, commit: "" } };
    expect(validateBudgetConfig(noCommit).error).toMatch(/measured\.commit/);
    const badFiles = {
      ...base,
      measured: { ...base.measured, clientJsFiles: 0 },
    };
    expect(validateBudgetConfig(badFiles).error).toMatch(/clientJsFiles/);
  });

  it("rejects a budget BELOW its own recorded measurement", () => {
    const base = valid();
    const under = {
      ...base,
      clientJsTotalKib: base.measured.clientJsTotalKib - 1,
    };
    const r = validateBudgetConfig(under);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/below the measured value/);
  });

  it("rejects a budget more than 20% above its recorded measurement", () => {
    const base = valid();
    const inflated = {
      ...base,
      clientJsTotalKib: Math.round(base.measured.clientJsTotalKib * 1.5),
    };
    const r = validateBudgetConfig(inflated);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/20% above/);
  });

  it("accepts a budget within 20% above the recorded measurement", () => {
    const base = valid();
    const mild = {
      ...base,
      clientJsTotalKib: Math.round(base.measured.clientJsTotalKib * 1.1),
    };
    expect(validateBudgetConfig(mild).ok).toBe(true);
  });
});

describe("collectJsStats", () => {
  it("sums bytes, counts files and finds the largest entry", () => {
    const entries = [
      { path: "a.js", bytes: 1000 },
      { path: "b.js", bytes: 2048 },
      { path: "c.js", bytes: 512 },
    ];
    const s = collectJsStats(entries);
    expect(s.fileCount).toBe(3);
    expect(s.totalKib).toBeCloseTo((1000 + 2048 + 512) / 1024, 1);
    expect(s.largestKib).toBeCloseTo(2, 1);
    expect(s.largestPath).toBe("b.js");
  });

  it("handles an empty list as zero totals", () => {
    const s = collectJsStats([]);
    expect(s.totalKib).toBe(0);
    expect(s.fileCount).toBe(0);
    expect(s.largestKib).toBe(0);
    expect(s.largestPath).toBe("");
  });

  it("rejects malformed entries", () => {
    expect(() => collectJsStats([{ path: 42 as never, bytes: 10 }])).toThrow(
      /bad entry/,
    );
    expect(() => collectJsStats([{ path: "a.js", bytes: -1 }])).toThrow(
      /bad entry/,
    );
    expect(() =>
      collectJsStats([{ path: "a.js", bytes: Number.NaN }]),
    ).toThrow(/bad entry/);
    expect(() => collectJsStats(null as never)).toThrow(/must be an array/);
  });
});

describe("formatKib", () => {
  it("stays in KiB below 1024", () => {
    expect(formatKib(512)).toBe("512 KiB");
    expect(formatKib(1023.9)).toBe("1023.9 KiB");
  });

  it("switches to MiB above 1024 with two decimals", () => {
    expect(formatKib(10400)).toBe("10.16 MiB");
    expect(formatKib(1024)).toBe("1.00 MiB");
    expect(formatKib(9909.1)).toBe("9.68 MiB");
  });
});

describe("renderSummary", () => {
  const stats = collectJsStats([
    { path: "big.js", bytes: 1024 * 1024 },
    { path: "small.js", bytes: 1024 },
  ]);

  it("renders a PASS summary with the numbers", () => {
    const v = evaluateBudget(2048, stats.totalKib);
    const md = renderSummary(stats, v, 2048);
    expect(md).toContain("## Bundle size");
    expect(md).toContain("PASS");
    expect(md).toContain("1.00 MiB");
    expect(md).toContain("2.00 MiB");
    expect(md).toContain("50%");
  });

  it("renders a FAIL summary with the overshoot", () => {
    const v = evaluateBudget(512, stats.totalKib);
    const md = renderSummary(stats, v, 512);
    expect(md).toContain("FAIL");
    expect(md).toContain("over");
    expect(md).toContain("513 KiB");
  });
});

describe("committed budget file invariants", () => {
  it("exists and parses with a valid measured block", () => {
    const raw = loadBudget();
    expect(validateBudgetConfig(raw).ok).toBe(true);
  });

  it("keeps ~5% headroom over the recorded measurement (between 1% and 20%)", () => {
    const raw = loadBudget();
    const ratio = raw.clientJsTotalKib / raw.measured.clientJsTotalKib;
    expect(ratio).toBeGreaterThan(1.01);
    expect(ratio).toBeLessThanOrEqual(1.2);
  });

  it("pins the measurement to a real develop commit and date", () => {
    const raw = loadBudget();
    expect(raw.measured.on).toBe("2026-11-16");
    expect(raw.measured.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(raw.measured.clientJsFiles).toBe(173);
    expect(raw.measured.clientJsTotalKib).toBeCloseTo(9909.1, 1);
    expect(raw.measured.largestChunkKib).toBeCloseTo(1776.7, 1);
  });

  it("documents the policy next to the number", () => {
    const raw = loadBudget();
    expect(raw.policy).toContain("5%");
    expect(raw.policy).toContain("non-required");
  });

  it("names the chunk dir and budget file the workflow uses", () => {
    expect(CHUNKS_DIR).toBe(".next/static/chunks");
    expect(BUDGET_FILE).toBe("scripts/size-budget.json");
  });
});
