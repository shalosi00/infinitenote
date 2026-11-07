/// <reference types="bun-types" />
/**
 * Unit tests for the structured sync change summary (src/lib/sync/summary.ts,
 * issue #54 refactor): which changes surface, in which order, and how
 * deletions/purges combine across fields.
 */
import { describe, expect, it } from "bun:test";
import { summaryParts, type SummaryPart } from "../sync/summary";
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
