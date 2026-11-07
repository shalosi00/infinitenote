/// <reference types="bun-types" />
/**
 * Unit tests for the quick-notes date/title derivation (issue #19).
 * All cases use explicit Date objects — never the wall clock — so the suite
 * is deterministic regardless of timezone or time of day.
 */
import { describe, expect, it } from "bun:test";
import {
  QUICK_NOTES_NOTEBOOK_NAME,
  QUICK_NOTES_SECTION_NAME,
  isDailyPageTitle,
  quickNoteTitle,
  todayKey,
} from "../quick-notes";

describe("todayKey", () => {
  it("formats local calendar dates with zero padding", () => {
    expect(todayKey(new Date(2026, 9, 19, 23, 59))).toBe("2026-10-19");
    expect(todayKey(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
    expect(todayKey(new Date(2026, 11, 31, 12, 0))).toBe("2026-12-31");
  });

  it("uses the LOCAL day, not UTC (evening before an UTC midnight)", () => {
    // 2026-03-08 23:30 local (any timezone west of UTC) must NOT become 03-09
    const local = new Date(2026, 2, 8, 23, 30);
    expect(todayKey(local)).toBe("2026-03-08");
  });
});

describe("quickNoteTitle", () => {
  it("stamps the title with the local date and 24h time", () => {
    expect(quickNoteTitle(new Date(2026, 9, 19, 9, 5, 7))).toBe("Quick note 2026-10-19 09:05:07");
    expect(quickNoteTitle(new Date(2026, 9, 19, 14, 32, 59))).toBe("Quick note 2026-10-19 14:32:59");
  });

  it("agrees with todayKey on the date part", () => {
    const d = new Date(2026, 4, 17, 18, 45);
    expect(quickNoteTitle(d).startsWith(`Quick note ${todayKey(d)} `)).toBe(true);
  });
});

describe("isDailyPageTitle", () => {
  it("accepts exact date keys", () => {
    expect(isDailyPageTitle("2026-10-19")).toBe(true);
    expect(isDailyPageTitle("1999-01-31")).toBe(true);
  });

  it("rejects anything else — especially quick note titles", () => {
    expect(isDailyPageTitle("Quick note 2026-10-19 14:32")).toBe(false);
    expect(isDailyPageTitle("2026-10-19 extra")).toBe(false);
    expect(isDailyPageTitle("2026-10")).toBe(false);
    expect(isDailyPageTitle("")).toBe(false);
    expect(isDailyPageTitle("26-10-19")).toBe(false);
  });
});

describe("constants", () => {
  it("quick notes home names are stable (data compatibility)", () => {
    expect(QUICK_NOTES_NOTEBOOK_NAME).toBe("Quick Notes");
    expect(QUICK_NOTES_SECTION_NAME).toBe("Quick Notes");
  });
});
