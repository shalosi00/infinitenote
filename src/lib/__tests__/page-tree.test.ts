/// <reference types="bun-types" />
/**
 * Sub-page tree policy pins (issue #359) — pure module, no Dexie.
 *
 * OneNote "Make subpage" parity: pages indent under pages of the SAME
 * section, capped at TWO subpage tiers (OneNote's own cap). These pins
 * freeze the projection (visiblePageTree), the write guards
 * (canMakeSubpage / makeSubpageTarget / promoteTarget) and the read-time
 * tolerance for hand-edited parentId values (the sync folder is
 * human-editable JSON).
 *
 * Test plan: docs/test-plans/sub-pages.md (ids PG-P1..PG-P14).
 */
import { describe, expect, it } from "bun:test";
import {
  MAX_PAGE_DEPTH,
  ancestorPageIds,
  canMakeSubpage,
  canPromote,
  childPages,
  makeSubpageTarget,
  pageDepth,
  parentOf,
  previousSiblingOf,
  promoteTarget,
  subtreeHeight,
  subtreePageIds,
  topLevelPages,
  visiblePageOrder,
  visiblePageTree,
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

describe("sub-page tree policy (issue #359)", () => {
  it("PG-P1: the OneNote depth cap is two subpage tiers", () => {
    expect(MAX_PAGE_DEPTH).toBe(2);
  });

  it("PG-P2: topLevelPages and childPages project sibling scopes in order", () => {
    const pages = [pg("a", S, 2), pg("b", S, 1), pg("a1", S, 1, "a"), pg("a2", S, 2, "a"), pg("other", "sec-2", 1)];
    expect(topLevelPages(pages, S).map((p) => p.id)).toEqual(["b", "a"]);
    expect(childPages(pages, "a").map((p) => p.id)).toEqual(["a1", "a2"]);
    expect(childPages(pages, "b")).toEqual([]);
  });

  it("PG-P3: parentOf reads the absent field as top level", () => {
    expect(parentOf({ parentId: null })).toBeNull();
    expect(parentOf({})).toBeNull();
    expect(parentOf({ parentId: "a" })).toBe("a");
  });

  it("PG-P4: subtreePageIds walks depth-first in sibling order (raw — trashed rows stay reachable)", () => {
    const pages = [pg("root", S, 1), pg("r2", S, 1, "root"), pg("r1", S, 2, "root"), pg("r1x", S, 1, "r1"), pg("top", S, 2)];
    expect(subtreePageIds(pages, "root")).toEqual(["root", "r2", "r1", "r1x"]);
    expect(subtreePageIds(pages, "top")).toEqual(["top"]);
    // the raw walk reaches THROUGH a trashed intermediate row (the
    // subtreeSectionIds contract the data-layer cascades rely on)
    const broken = [
      pg("p", S, 1),
      pg("dead-kid", S, 1, "p", { deletedAt: 42 }),
      pg("alive-grandkid", S, 1, "dead-kid"),
    ];
    expect(subtreePageIds(broken, "p")).toEqual(["p", "dead-kid", "alive-grandkid"]);
  });

  it("PG-P5: a parentId loop can never hang the subtree walk", () => {
    const pages = [pg("x", S, 1, "y"), pg("y", S, 1, "x")];
    expect(subtreePageIds(pages, "x")).toEqual(["x", "y"]);
  });

  it("PG-P6: ancestorPageIds stops at dangling or trashed parents", () => {
    const pages = [
      pg("top", S, 1),
      pg("mid", S, 1, "top"),
      pg("leaf", S, 1, "mid"),
      pg("gone", S, 2, "top", { deletedAt: 42 }),
      pg("orphan", S, 3, "gone"),
    ];
    expect(ancestorPageIds(pages, "leaf")).toEqual(["mid", "top"]);
    // a trashed parent ends the chain — the orphan reads as a root
    expect(ancestorPageIds(pages, "orphan")).toEqual([]);
  });

  it("PG-P7: visiblePageTree orders top-level pages with their subpages inline", () => {
    const pages = [
      pg("a", S, 2),
      pg("b", S, 1),
      pg("a1", S, 1, "a"),
      pg("a2", S, 2, "a"),
      pg("a2x", S, 1, "a2"),
    ];
    const tree = visiblePageTree(pages, S);
    expect(tree.map((v) => v.page.id)).toEqual(["b", "a", "a1", "a2", "a2x"]);
    expect(tree.map((v) => v.depth)).toEqual([0, 0, 1, 1, 2]);
  });

  it("PG-P8: a page whose parent row is missing renders as a top-level root", () => {
    const pages = [pg("real", S, 1), pg("ghost-child", S, 2, "vanished")];
    const tree = visiblePageTree(pages, S);
    expect(tree.map((v) => v.page.id)).toEqual(["real", "ghost-child"]);
    expect(tree.map((v) => v.depth)).toEqual([0, 0]);
  });

  it("PG-P9: a trashed parent or a foreign-section parent both read as roots", () => {
    const pages = [
      pg("parent", S, 1),
      pg("child", S, 2, "parent"),
      pg("trashed-parent", S, 3, "parent", { deletedAt: 42 }),
      pg("its-child", S, 4, "trashed-parent"),
      pg("cross", S, 5, "sec-2-owner"),
      pg("sec-2-owner", "sec-2", 1),
    ];
    const tree = visiblePageTree(pages, S);
    // the alive family first; then the broken-chain roots appended in
    // sibling order (never dropped — an export never loses pages)
    expect(tree.map((v) => v.page.id)).toEqual(["parent", "child", "its-child", "cross"]);
    expect(tree.map((v) => v.depth)).toEqual([0, 1, 0, 0]);
  });

  it("PG-P10: a hand-edited parentId cycle renders as roots, never hangs", () => {
    const pages = [pg("loop-a", S, 2, "loop-b"), pg("loop-b", S, 1, "loop-a"), pg("plain", S, 3)];
    const tree = visiblePageTree(pages, S);
    // the explicit root first; the cycle members append in sibling order —
    // loop-a's structural parent (loop-b) becomes its visible parent
    expect(tree.map((v) => v.page.id)).toEqual(["plain", "loop-b", "loop-a"]);
    expect(tree.map((v) => v.depth)).toEqual([0, 0, 1]);
  });

  it("PG-P11: a hand-edited chain deeper than the cap renders clamped", () => {
    const pages = [
      pg("l0", S, 1),
      pg("l1", S, 1, "l0"),
      pg("l2", S, 1, "l1"),
      pg("l3", S, 1, "l2"),
    ];
    const depths = visiblePageTree(pages, S).map((v) => v.depth);
    expect(depths).toEqual([0, 1, 2, 2]); // structure kept, display clamped
    expect(pageDepth(pages, "l3")).toBe(3); // the raw chain depth stays honest
  });

  it("PG-P12: canMakeSubpage enforces section, cycle and the depth cap", () => {
    const pages = [
      pg("t0", S, 1),
      pg("t1", S, 2),
      pg("u0", S, 3),
      pg("u0a", S, 1, "u0"),
      pg("deep", S, 4),
      pg("deepa", S, 1, "deep"),
      pg("deepb", S, 2, "deep"),
      pg("other", "sec-2", 5),
    ];
    // a leaf demotes one tier anywhere within the cap
    expect(canMakeSubpage(pages, "t1", "t0")).toBe(true);
    // a parent with subpages fits only when the subtree still lands ≤ 2
    expect(canMakeSubpage(pages, "u0", "t0")).toBe(true); // depth 1 + height 1 = 2
    expect(canMakeSubpage(pages, "u0", "u0a")).toBe(false); // depth 2 + height 1 = 3
    // self and own-subtree targets are cycles
    expect(canMakeSubpage(pages, "u0", "u0")).toBe(false);
    expect(canMakeSubpage(pages, "u0", "deepa")).toBe(false);
    // sub-pages never cross sections
    expect(canMakeSubpage(pages, "t0", "other")).toBe(false);
    // a depth-0 parent with a height-1 subtree fits exactly at the cap
    expect(canMakeSubpage(pages, "deep", "t0")).toBe(true); // 0 + 1 + 1 = 2
  });

  it("PG-P13: makeSubpageTarget resolves the previous sibling or hides", () => {
    const pages = [pg("first", S, 1), pg("second", S, 2), pg("second-kid", S, 1, "second")];
    expect(makeSubpageTarget(pages, "second")?.id).toBe("first");
    expect(makeSubpageTarget(pages, "first")).toBeNull(); // no previous sibling
    expect(makeSubpageTarget(pages, "second-kid")).toBeNull(); // first child of its parent — no sibling to demote under
    // a parent whose subtree would overflow the cap hides the item
    const wide = [pg("p0", S, 1), pg("p1", S, 2), pg("p1a", S, 1, "p1"), pg("p1b", S, 2, "p1")];
    expect(makeSubpageTarget(wide, "p1")?.id).toBe("p0"); // height 1 → depth 1 ok
  });

  it("PG-P14: previousSiblingOf, promoteTarget and canPromote scope correctly", () => {
    const pages = [
      pg("t0", S, 1),
      pg("t1", S, 2),
      pg("t1a", S, 1, "t1"),
      pg("t1b", S, 2, "t1"),
    ];
    expect(previousSiblingOf(pages, "t1")?.id).toBe("t0");
    expect(previousSiblingOf(pages, "t1b")?.id).toBe("t1a"); // sibling scope, not the parent
    expect(subtreeHeight(pages, "t1")).toBe(1);
    // promote walks one level up: t1a → t1's parent scope (top level)
    expect(promoteTarget(pages, "t1a")).toBeNull();
    expect(promoteTarget(pages, "t1b")).toBeNull();
    expect(canPromote(pages, "t1a")).toBe(true);
    expect(canPromote(pages, "t1")).toBe(false);
    expect(promoteTarget(pages, "t1")).toBeNull();
  });

  it("PG-P15: visiblePageOrder matches visiblePageTree and skips trashed rows", () => {
    const pages = [
      pg("a", S, 1),
      pg("a1", S, 1, "a"),
      pg("b", S, 2, undefined, { deletedAt: 42 }),
      pg("c", S, 3),
    ];
    expect(visiblePageOrder(pages, S).map((p) => p.id)).toEqual(["a", "a1", "c"]);
  });
});
