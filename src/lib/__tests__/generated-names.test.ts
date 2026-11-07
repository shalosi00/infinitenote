/// <reference types="bun-types" />
/**
 * Bug-hunt wave 2, PR 5 — localized generated names (issue #63) and
 * surrogate-safe truncation (issue #101).
 */
import { describe, expect, it } from "bun:test";
import {
  generatedNames,
  setGeneratedNamesLocale,
} from "../generated-names";
import { normalizeTag, MAX_TAG_LENGTH } from "../tags";
import { searchIndex, buildSearchIndex } from "../search";

describe("generated names (issue #63)", () => {
  it("defaults to English", () => {
    expect(generatedNames().notebook(3)).toBe("Notebook 3");
    expect(generatedNames().section(2)).toBe("Section 2");
    expect(generatedNames().page(1)).toBe("Page 1");
    expect(generatedNames().copy("Notes")).toBe("Notes (copy)");
    expect(generatedNames().conflict("Notes", "2026-11-07")).toBe(
      "Notes (conflict 2026-11-07)",
    );
    expect(generatedNames().quickNotesNotebook).toBe("Quick Notes");
    expect(generatedNames().welcome.notebook).toBe("Welcome Notebook");
  });

  it("switches to 简体中文 names when the locale changes", () => {
    setGeneratedNamesLocale("zh-CN");
    expect(generatedNames().notebook(3)).toBe("笔记本 3");
    expect(generatedNames().section(2)).toBe("分区 2");
    expect(generatedNames().page(1)).toBe("页面 1");
    expect(generatedNames().copy("笔记")).toBe("笔记（副本）");
    expect(generatedNames().conflict("笔记", "2026-11-07")).toBe(
      "笔记（冲突 2026-11-07）",
    );
    expect(generatedNames().restoredPage).toBe("恢复的页面");
    expect(generatedNames().untitled).toBe("无标题");
    expect(generatedNames().quickNotesNotebook).toBe("快速笔记");
    expect(generatedNames().quickNotePrefix).toBe("快速笔记 ");
    expect(generatedNames().recordingPrefix).toBe("录音 ");
    expect(generatedNames().welcome.notebook).toBe("欢迎使用");
    setGeneratedNamesLocale("en"); // never leak locale state into other tests
  });

  it("restores English after switching back", () => {
    setGeneratedNamesLocale("zh-CN");
    setGeneratedNamesLocale("en");
    expect(generatedNames().notebook(1)).toBe("Notebook 1");
  });
});

describe("surrogate-safe truncation (issue #101)", () => {
  it("normalizeTag never splits an astral character at the cap", () => {
    // each emoji is 2 UTF-16 units; the old .slice(0, 24) could cut one in half
    const emojiTag = "🎵".repeat(MAX_TAG_LENGTH); // 24 code points, 48 units
    const normalized = normalizeTag(emojiTag);
    expect(normalized).not.toBeNull();
    if (normalized === null) return;
    expect(Array.from(normalized)).toHaveLength(MAX_TAG_LENGTH);
    // no lone surrogates survive
    for (const ch of normalized) {
      const cp = ch.codePointAt(0) ?? 0;
      expect(cp).toBeGreaterThan(0xffff);
    }
  });

  it("keeps CJK tags intact (BMP characters are unaffected)", () => {
    expect(normalizeTag("  会议   记录 ")).toBe("会议 记录");
  });

  it("search snippets never end on a lone surrogate", () => {
    // odd-length prefix ⇒ the old UTF-16 .slice(0, 140) landed mid-emoji
    const longEmojiText = "lorem ".repeat(10) + "x" + "🎵".repeat(60) + " keyword";
    const index = buildSearchIndex([], [], [
      {
        id: "p1",
        sectionId: "s1",
        title: "Emoji page",
        order: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
        content: JSON.stringify({ elements: [{ type: "text", text: longEmojiText }] }),
      } as never,
    ]);
    const hits = searchIndex(index, "keyword");
    expect(hits).toHaveLength(1);
    const snippet = hits[0].snippet;
    // the snippet must contain only complete characters: a lone surrogate
    // (from a bad UTF-16 slice) would render as U+FFFD
    for (const ch of snippet) {
      const cp = ch.codePointAt(0) ?? 0;
      expect(cp >= 0xd800 && cp <= 0xdfff).toBe(false);
    }
  });
});
