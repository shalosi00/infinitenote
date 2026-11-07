/// <reference types="bun-types" />
/**
 * Unit tests for the structured sync change summary (src/lib/sync/summary.ts):
 * which changes surface, in which order, how deletions/purges combine across
 * fields, and the English label rendering (v1.9, formerly ICU messages).
 */
import { describe, expect, it } from "bun:test";
import {
  summaryParts,
  summaryPartLabel,
  formatSyncSummary,
  type SummaryPart,
} from "../sync/summary";
import type { SyncSummary } from "../sync/merge";

const EMPTY: SyncSummary = {
  notebooksAdded: 0,
  sectionsAdded: 0,
  pagesAdded: 0,
  pagesUpdated: 0,
  treeUpdated: 0,
  pagesConflicted: 0,
  pagesDeleted: 0,
  treeDeleted: 0,
  pagesPurged: 0,
  treePurged: 0,
};

function parts(s: Partial<SyncSummary>): SummaryPart[] {
  return summaryParts({ ...EMPTY, ...s });
}

describe("summaryParts", () => {
  it("returns nothing for a no-op summary", () => {
    expect(summaryParts(EMPTY)).toEqual([]);
  });

  it("keeps the canonical part order", () => {
    expect(
      parts({
        notebooksAdded: 1,
        sectionsAdded: 2,
        pagesAdded: 3,
        pagesUpdated: 4,
        pagesConflicted: 5,
        pagesDeleted: 6,
        treeUpdated: 7,
        pagesPurged: 8,
      }).map((p) => p.key)
    ).toEqual([
      "wNotebooks",
      "wSections",
      "wPagesPulled",
      "wPagesUpdated",
      "wConflicts",
      "wTrashed",
      "wTreeUpdated",
      "wPurged",
    ]);
  });

  it("combines page and tree deletions into one trashed count", () => {
    expect(parts({ pagesDeleted: 2, treeDeleted: 3 })).toEqual([{ key: "wTrashed", count: 5 }]);
  });

  it("combines page and tree purges into one purged count", () => {
    expect(parts({ pagesPurged: 1, treePurged: 4 })).toEqual([{ key: "wPurged", count: 5 }]);
  });

  it("drops zero fields and keeps non-zero ones with their counts", () => {
    expect(parts({ pagesAdded: 2, pagesConflicted: 1 })).toEqual([
      { key: "wPagesPulled", count: 2 },
      { key: "wConflicts", count: 1 },
    ]);
  });

  it("carries the counts it is given", () => {
    expect(parts({ pagesUpdated: 9 })).toEqual([{ key: "wPagesUpdated", count: 9 }]);
  });
});

describe("summaryPartLabel (English plurals)", () => {
  it("renders the one branch for a single item", () => {
    expect(summaryPartLabel({ key: "wPagesPulled", count: 1 })).toBe("1 page pulled");
    expect(summaryPartLabel({ key: "wConflicts", count: 1 })).toBe("1 conflict copy");
  });

  it("renders the other branch with the count spliced in", () => {
    expect(summaryPartLabel({ key: "wPagesPulled", count: 3 })).toBe("3 pages pulled");
    expect(summaryPartLabel({ key: "wTrashed", count: 5 })).toBe("5 items moved to trash");
  });
});

describe("formatSyncSummary", () => {
  it("returns the up-to-date line for a no-op summary", () => {
    expect(formatSyncSummary(EMPTY)).toBe("Everything already in sync.");
  });

  it("joins parts with a middle dot and closes with a period", () => {
    expect(formatSyncSummary({ ...EMPTY, pagesAdded: 2, notebooksAdded: 1 })).toBe(
      "1 notebook · 2 pages pulled.",
    );
  });
});
