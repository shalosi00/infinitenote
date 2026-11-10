/// <reference types="bun-types" />
/**
 * Edge-case unit tests for the generated-names module (issue #63) — the
 * uniqueness and format mechanics behind the plain English name set,
 * which the base suite (generated-names.test.ts) does not pin: pool
 * injectivity and cross-pool distinctness, verbatim counter embedding,
 * copy/conflict suffix mechanics, restored-level distinctness, welcome
 * seed field distinctness, prefix composition contract, and the
 * stateless-singleton / fully-baked-literal invariants.
 */
import { describe, expect, it } from "bun:test";
import { generatedNames } from "../generated-names";

describe("numbered name pools", () => {
  it("are injective over a contiguous range and mutually distinct per level", () => {
    const names = generatedNames();
    for (const fn of [names.notebook, names.section, names.page]) {
      const rendered = Array.from({ length: 50 }, (_, i) => fn(i + 1));
      expect(new Set(rendered).size).toBe(rendered.length);
    }
    // same counter never renders the same title across two levels
    for (const n of [1, 2, 99]) {
      expect(new Set([names.notebook(n), names.section(n), names.page(n)]).size).toBe(3);
    }
  });

  it("embed multi-digit counters verbatim — one space, no padding or separators", () => {
    const names = generatedNames();
    expect(names.notebook(12)).toBe("Notebook 12");
    expect(names.section(41)).toBe("Section 41");
    expect(names.page(1000)).toBe("Page 1000");
  });
});

describe("suffix mechanics", () => {
  it("copy() is a pure suffix — the title passes through verbatim and repeats stack", () => {
    const names = generatedNames();
    expect(names.copy("Meeting notes")).toBe("Meeting notes (copy)");
    // duplicating an already-duplicated title stacks the suffix — dedup is
    // the caller's job, the naming layer only formats
    expect(names.copy("Meeting notes (copy)")).toBe("Meeting notes (copy) (copy)");
    // surrounding whitespace is preserved, not trimmed — the suffix template
    // contributes exactly one space of its own
    const oddTitle = "  spaced  ";
    expect(names.copy(oddTitle)).toBe(`${oddTitle} (copy)`);
  });

  it("conflict() embeds the date verbatim and never collides with copy() for the same title", () => {
    const names = generatedNames();
    expect(names.conflict("Notes", "2026-11-07T10:00")).toBe("Notes (conflict 2026-11-07T10:00)");
    expect(names.conflict("Notes", "2026-01-02")).not.toBe(names.conflict("Notes", "2026-01-03"));
    expect(names.conflict("Notes", "2026-01-02")).not.toBe(names.copy("Notes"));
  });
});

describe("fixed-name invariants", () => {
  it("restored fallbacks are level-specific and pairwise distinct from each other and from untitled", () => {
    const names = generatedNames();
    const restored = [names.restoredNotebook, names.restoredSection, names.restoredPage];
    expect(new Set(restored).size).toBe(3);
    for (const r of restored) {
      expect(r.trim().length).toBeGreaterThan(0);
      expect(r).not.toBe(names.untitled);
    }
  });

  it("welcome seed fields are pairwise distinct so first-run pages never share titles", () => {
    const w = generatedNames().welcome;
    const fields = [
      w.notebook,
      w.section,
      w.ideasSection,
      w.myNotebook,
      w.mySection,
      w.startHere,
      w.brainstorm,
      w.pageOne,
      w.title,
    ];
    expect(new Set(fields).size).toBe(fields.length);
    for (const f of fields) {
      expect(f.trim().length).toBeGreaterThan(0);
    }
  });

  it("quick-note and recording prefixes end with exactly one space (title composition contract)", () => {
    const names = generatedNames();
    for (const prefix of [names.quickNotePrefix, names.recordingPrefix]) {
      expect(prefix.endsWith(" ")).toBe(true);
      expect(prefix.endsWith("  ")).toBe(false);
    }
    expect(names.quickNotePrefix).not.toBe(names.recordingPrefix);
  });
});

describe("registry invariants", () => {
  it("is a stateless singleton whose strings are fully baked — no format placeholders leak", () => {
    const a = generatedNames();
    const b = generatedNames();
    // same object every call — no per-call reconstruction, no hidden state
    expect(a).toBe(b);
    const strings: string[] = [
      a.restoredNotebook,
      a.restoredSection,
      a.restoredPage,
      a.untitled,
      a.quickNotesNotebook,
      a.quickNotesSection,
      a.quickNotePrefix,
      a.recordingPrefix,
      ...Object.values(a.welcome),
      a.notebook(1),
      a.section(1),
      a.page(1),
      a.copy("x"),
      a.conflict("x", "y"),
    ];
    for (const s of strings) {
      expect(s.includes("{")).toBe(false);
      expect(s.includes("}")).toBe(false);
      expect(s.includes("%")).toBe(false);
      expect(s.includes("$")).toBe(false);
    }
  });
});
