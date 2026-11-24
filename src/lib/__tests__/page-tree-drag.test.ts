/// <reference types="bun-types" />
/**
 * Drag-to-indent gesture gates (issue #365) — pure pins, no Dexie.
 *
 * Phase 2 of the sub-pages feature (issue #359): the sidebar's page rows
 * become drag sources and drop targets. The UI highlights only targets
 * the pure policy accepts, so these pins freeze the two gesture gates:
 * drop-on-page (canMakeSubpage, shared with the menu's Make subpage) and
 * drop-on-own-section (canPromoteWithin, the menu Promote command's
 * gesture path). Every rejection here is a target that never highlights
 * and never writes in the UI.
 *
 * Test plan: docs/test-plans/sub-pages.md (phase-2 ids PG-P15..PG-P17).
 */
import { describe, expect, it } from "bun:test";
import {
  canMakeSubpage,
  canPromoteWithin,
  promoteTarget,
} from "../page-tree";
import type { PageMeta } from "../types";

let seq = 0;
/** Minimal alive page row: distinct order + createdAt keep byOrder stable. */
function pg(
  id: string,
  sectionId: string,
  order: number,
  parentId?: string | null,
  extra?: Partial<PageMeta>
): PageMeta {
  seq += 1;
  return {
    id,
    sectionId,
    ...(parentId ? { parentId } : {}),
    title: `Page ${id}`,
    order,
    createdAt: 1700000000000 + seq,
    updatedAt: 1700000000000 + seq,
    deletedAt: null,
    ...extra,
  };
}

const S = "sec-1";
const OTHER = "sec-2";

describe("drag-to-indent gates (issue #365)", () => {
  it("PG-P15: drop-on-page accepts exactly what the menu command accepts", () => {
    // A(0) > B(1) with a top-level C — same-section drop-on-page gates
    const pages = [
      pg("A", S, 1),
      pg("B", S, 2, "A"),
      pg("C", S, 3),
      pg("X", OTHER, 1),
    ];
    // C onto A: same section, no cycle, fits — the gesture indents
    expect(canMakeSubpage(pages, "C", "A")).toBe(true);
    // B onto A: same section, fits (height(B)=0 → depth(A)+1+0 = 1 ≤ cap);
    // B is already A's child, so the db write would answer "noop" — the
    // gate passes, the write layer makes it a no-op
    expect(canMakeSubpage(pages, "B", "A")).toBe(true);
    // A onto B: B sits inside A's own subtree — cycle, never accepted
    expect(canMakeSubpage(pages, "A", "B")).toBe(false);
    // A onto X: cross-section — pages never re-home by drag
    expect(canMakeSubpage(pages, "A", "X")).toBe(false);
    // X onto anything here: foreign mover, same rule
    expect(canMakeSubpage(pages, "X", "C")).toBe(false);
  });

  it("PG-P16: the depth cap rejects the drop-on-page gesture for oversized subtrees", () => {
    // two families: A>B>C (height 2) and a top-level D
    const pages = [
      pg("A", S, 1),
      pg("B", S, 2, "A"),
      pg("C", S, 3, "B"),
      pg("D", S, 4),
    ];
    // A onto D would land A at depth 1 with its height-2 subtree → 3 > cap
    expect(canMakeSubpage(pages, "A", "D")).toBe(false);
    // B onto D fits exactly (depth 1 + height 1 + 1 = 2)
    expect(canMakeSubpage(pages, "B", "D")).toBe(true);
    // and the two-tier chain builds purely by drags: D onto C → 2+1 = 3 → no
    expect(canMakeSubpage(pages, "D", "C")).toBe(false);
    // ...while C onto D → depth(D)=0 + 1 + height(C)=0 → fits
    expect(canMakeSubpage(pages, "C", "D")).toBe(true);
  });

  it("PG-P17: drop-on-own-section accepts only subpages of THAT section", () => {
    const pages = [
      pg("A", S, 1),
      pg("B", S, 2, "A"),
      pg("C", S, 3, "B"),
      pg("D", OTHER, 1),
      pg("E", OTHER, 2, "D"),
      pg("T", S, 4, "ghost-parent"), // dangling parent id (hand-edited)
    ];
    // B (subpage of A) dropped on its own section: promote one level → the
    // TOP level (promoteTarget answers the grandparent, A's parent = null)
    expect(canPromoteWithin(pages, "B", S)).toBe(true);
    expect(promoteTarget(pages, "B")).toBeNull();
    // C (sub-subpage) dropped on its own section: promote one level →
    // subpage of A (the grandparent)
    expect(canPromoteWithin(pages, "C", S)).toBe(true);
    expect(promoteTarget(pages, "C")).toBe("A");
    // A (top level) dropped on its own section: no-op — never a write
    expect(canPromoteWithin(pages, "A", S)).toBe(false);
    // a page of ANOTHER section dropped here: never accepted
    expect(canPromoteWithin(pages, "E", S)).toBe(false);
    // foreign mover on its own foreign section row is still its own business
    expect(canPromoteWithin(pages, "E", OTHER)).toBe(true);
    // a trashed page is no longer a drag source
    expect(canPromoteWithin([pg("Z", S, 9, "A", { deletedAt: 1 })], "Z", S)).toBe(false);
    // a dangling parent id still promotes (the write heals to top level)
    expect(canPromoteWithin(pages, "T", S)).toBe(true);
    expect(promoteTarget(pages, "T")).toBeNull();
  });
});
