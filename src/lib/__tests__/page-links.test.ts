/**
 * Unit pins for the internal-page-links pure policy (wave 13, OneNote
 * "Copy Link to Page" parity). Every constant below comes from
 * src/lib/page-links.ts — the UI only toasts/validates through it.
 */
import { describe, expect, test } from "bun:test";
import {
  PAGE_LINK_MAX_ID_LENGTH,
  PAGE_LINK_SCHEME,
  isPageLink,
  pageLinkCopyFailedToast,
  pageLinkCopiedToast,
  pageLinkFor,
  pageLinkMissingToast,
  pageLinkTargetOf,
} from "../page-links";

describe("PAGE_LINK_SCHEME", () => {
  test("is the documented marker scheme", () => {
    expect(PAGE_LINK_SCHEME).toBe("infinitenote:page");
  });
});

describe("pageLinkFor", () => {
  test("builds scheme + id", () => {
    expect(pageLinkFor("abc-123")).toBe("infinitenote:page/abc-123");
  });

  test("trims surrounding whitespace", () => {
    expect(pageLinkFor("  abc-123  ")).toBe("infinitenote:page/abc-123");
  });

  test("accepts UUID-shaped ids", () => {
    const id = "0f0e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
    expect(pageLinkFor(id)).toBe(`infinitenote:page/${id}`);
  });

  test("rejects null / undefined / empty / whitespace-only", () => {
    expect(pageLinkFor(null)).toBeNull();
    expect(pageLinkFor(undefined)).toBeNull();
    expect(pageLinkFor("")).toBeNull();
    expect(pageLinkFor("   ")).toBeNull();
  });

  test("rejects ids over the length cap", () => {
    const long = "a".repeat(PAGE_LINK_MAX_ID_LENGTH + 1);
    expect(pageLinkFor(long)).toBeNull();
    const exact = "a".repeat(PAGE_LINK_MAX_ID_LENGTH);
    expect(pageLinkFor(exact)).toBe(`infinitenote:page/${exact}`);
  });

  test("rejects ids with an extra path segment or spaces", () => {
    expect(pageLinkFor("a/b")).toBeNull();
    expect(pageLinkFor("a b")).toBeNull();
  });
});

describe("isPageLink", () => {
  test("accepts the scheme with a trailing slash", () => {
    expect(isPageLink("infinitenote:page/abc")).toBe(true);
  });

  test("rejects the bare scheme (no id part)", () => {
    expect(isPageLink("infinitenote:page")).toBe(false);
    expect(isPageLink("infinitenote:page/")).toBe(false);
  });

  test("rejects foreign schemes and data: URLs", () => {
    expect(isPageLink("infinitenote:audio")).toBe(false);
    expect(isPageLink("infinitenote:pdf")).toBe(false);
    expect(isPageLink("infinitenote:file")).toBe(false);
    expect(isPageLink("https://example.com/infinitenote:page/x")).toBe(false);
    expect(isPageLink("data:text/plain;base64,AAA")).toBe(false);
  });

  test("rejects null / undefined / empty", () => {
    expect(isPageLink(null)).toBe(false);
    expect(isPageLink(undefined)).toBe(false);
    expect(isPageLink("")).toBe(false);
  });

  test("rejects prefix-spoofing longer scheme names", () => {
    expect(isPageLink("infinitenote:page2/abc")).toBe(false);
  });
});

describe("pageLinkTargetOf", () => {
  test("round-trips with pageLinkFor", () => {
    const link = pageLinkFor("page-42");
    expect(link).not.toBeNull();
    expect(pageLinkTargetOf(link)).toBe("page-42");
  });

  test("returns null for foreign links (canvas must treat them as default links)", () => {
    expect(pageLinkTargetOf("https://example.com")).toBeNull();
    expect(pageLinkTargetOf("infinitenote:audio")).toBeNull();
    expect(pageLinkTargetOf("infinitenote:pdf")).toBeNull();
    expect(pageLinkTargetOf("infinitenote:file")).toBeNull();
    expect(pageLinkTargetOf(null)).toBeNull();
    expect(pageLinkTargetOf(undefined)).toBeNull();
  });

  test("returns null for malformed ids", () => {
    expect(pageLinkTargetOf("infinitenote:page/")).toBeNull();
    expect(pageLinkTargetOf("infinitenote:page/a b")).toBeNull();
    expect(pageLinkTargetOf("infinitenote:page/a/b")).toBeNull();
    expect(pageLinkTargetOf(`infinitenote:page/${"a".repeat(PAGE_LINK_MAX_ID_LENGTH + 1)}`)).toBeNull();
  });

  test("trims whitespace around a valid id", () => {
    expect(pageLinkTargetOf("infinitenote:page/ page-7 ")).toBe("page-7");
  });
});

describe("toast lines", () => {
  test("copy success names where to paste and what it does", () => {
    expect(pageLinkCopiedToast()).toBe(
      "Page link copied — paste it on any page (it opens that page).",
    );
  });

  test("copy failure is explicit", () => {
    expect(pageLinkCopyFailedToast()).toBe("Could not copy the page link.");
  });

  test("missing target explains the broken link", () => {
    expect(pageLinkMissingToast()).toBe(
      "That page no longer exists — the link is broken.",
    );
  });
});
