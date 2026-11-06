/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import {
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_PAGE,
  addTag,
  collectTags,
  normalizeTag,
  normalizeTags,
  pageHasTag,
  removeTag,
} from "../tags";

describe("normalizeTag", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeTag("  hello   world ")).toBe("hello world");
  });

  it("caps the length", () => {
    expect(normalizeTag("x".repeat(40))).toHaveLength(MAX_TAG_LENGTH);
  });

  it("rejects empty and blank input", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
  });
});

describe("normalizeTags", () => {
  it("dedupes case-insensitively and keeps the first casing", () => {
    expect(normalizeTags(["Recipe", "recipe", "RECIPE"])).toEqual(["Recipe"]);
  });

  it("drops invalid entries and caps the per-page count", () => {
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const out = normalizeTags(["", "   ", ...many]);
    expect(out).toHaveLength(MAX_TAGS_PER_PAGE);
    expect(out[0]).toBe("t0");
  });
});

describe("addTag / removeTag", () => {
  it("adds a tag and refuses duplicates case-insensitively", () => {
    const base = ["Recipe"];
    expect(addTag(base, " recipe ")).toBe(base); // unchanged → same reference
    expect(addTag(base, "urgent")).toEqual(["Recipe", "urgent"]);
    expect(addTag(base, "")).toBe(base);
  });

  it("removeTag is case-insensitive", () => {
    expect(removeTag(["Recipe", "urgent"], "RECIPE")).toEqual(["urgent"]);
    expect(removeTag(["a"], "b")).toEqual(["a"]);
  });
});

describe("pageHasTag / collectTags", () => {
  it("pageHasTag is case-insensitive and undefined-safe", () => {
    expect(pageHasTag(undefined, "x")).toBe(false);
    expect(pageHasTag([], "x")).toBe(false);
    expect(pageHasTag(["X"], "x")).toBe(true);
  });

  it("collectTags counts across pages, sorts by usage then alphabetically", () => {
    const pages = [
      { tags: ["idea", "work"] },
      { tags: ["Idea"] },
      { tags: ["work"] },
      {},
      { tags: undefined },
    ];
    expect(collectTags(pages)).toEqual([
      { tag: "idea", count: 2 },
      { tag: "work", count: 2 },
    ]);
  });

  it("collectTags keeps the first-seen casing per tag", () => {
    expect(collectTags([{ tags: ["Recipe"] }, { tags: ["recipe"] }])).toEqual([
      { tag: "Recipe", count: 2 },
    ]);
  });
});
