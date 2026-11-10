/// <reference types="bun-types" />
/**
 * Edge tests for page tags — aspects beyond tags.test.ts: surrogate-pair-safe
 * truncation (issue #101), addTagWithResult status reporting (issue #100),
 * and post-normalization dedupe.
 */
import { describe, expect, it } from "bun:test";
import {
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_PAGE,
  addTagWithResult,
  normalizeTag,
  normalizeTags,
} from "../tags";

describe("normalizeTag — unicode and boundaries", () => {
  it("caps emoji tags by code points, never splitting a surrogate pair (issue #101)", () => {
    const emoji = normalizeTag("🎨".repeat(40));
    expect(emoji).not.toBeNull();
    expect(Array.from(emoji!).length).toBe(MAX_TAG_LENGTH); // 24 whole code points
    expect(emoji!.includes("\uFFFD")).toBe(false);

    // truncation may drop a trailing emoji but must never garble one
    const mixed = normalizeTag(`${"🎨".repeat(23)}x🎨`);
    expect(Array.from(mixed!).length).toBe(MAX_TAG_LENGTH);
    expect(mixed![mixed!.length - 1]).toBe("x"); // the cut fell between code points
  });
});

describe("addTagWithResult — status reporting (issue #100)", () => {
  it("reports added / duplicate / invalid, never mutating the input array", () => {
    const base = ["Work"];

    const added = addTagWithResult(base, " urgent ");
    expect(added.status).toBe("added");
    expect(added.tags).toEqual(["Work", "urgent"]);
    expect(added.tags).not.toBe(base); // a real new list…
    expect(base).toEqual(["Work"]); // …and the original is untouched

    const duplicate = addTagWithResult(base, "WORK");
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.tags).toBe(base); // unchanged → same reference
    expect(duplicate.tags).toHaveLength(1);

    const invalid = addTagWithResult(base, "   ");
    expect(invalid.status).toBe("invalid");
    expect(invalid.tags).toBe(base);
  });

  it("reports capped when the page already holds MAX_TAGS_PER_PAGE tags", () => {
    const full = Array.from({ length: MAX_TAGS_PER_PAGE }, (_, i) => `tag-${i}`);
    const res = addTagWithResult(full, "overflow");
    expect(res.status).toBe("capped");
    expect(res.tags).toBe(full); // unchanged → same reference
    expect(res.tags).toHaveLength(MAX_TAGS_PER_PAGE);
    expect(res.tags).not.toContain("overflow");
  });
});

describe("normalizeTags — post-normalization dedupe", () => {
  it("collapses tags that only collide after whitespace/case normalization", () => {
    expect(normalizeTags(["Road  Trip", "road trip", "ROAD\tTRIP"])).toEqual(["Road Trip"]);
    // invalid entries between variants do not resurrect a dropped duplicate
    expect(normalizeTags(["", "a b", "   ", "A  B"])).toEqual(["a b"]);
  });
});
