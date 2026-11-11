/// <reference types="bun-types" />
/**
 * Edge tests for the curated shape library (issue #65) — aspects beyond the
 * base catalog checks in shape-library.test.ts: inherit sentinel contracts,
 * catalog partitioning/grouping order, shape-local coordinate anchoring,
 * library-wide skeleton id uniqueness, bounding-box sanity, arrowhead and
 * roundness policies, the single pinned-look shape and exact-match lookups.
 */
import { describe, expect, it } from "bun:test";
import {
  INHERIT_FILL,
  INHERIT_STROKE,
  SHAPE_CATEGORIES,
  SHAPE_LIBRARY,
  getShapeDef,
  shapesByCategory,
} from "../shape-library";

/** Straight horizontal strokes — the only shapes with a zero-height box. */
const FLAT_LINE_SHAPES = new Set([
  "arrow-one-way",
  "arrow-two-way",
  "arrow-dashed",
  "connector-line",
]);

describe("inherit sentinels", () => {
  it("exposes two distinct sentinels under the inherit: namespace", () => {
    expect(INHERIT_STROKE).toBe("inherit:stroke");
    expect(INHERIT_FILL).toBe("inherit:fill");
    expect(new Set([INHERIT_FILL, INHERIT_STROKE]).size).toBe(2); // distinct sentinels
    for (const sentinel of [INHERIT_STROKE, INHERIT_FILL]) {
      expect(sentinel.startsWith("inherit:")).toBe(true);
      expect(sentinel.length).toBeGreaterThan("inherit:".length);
    }
  });
});

describe("catalog structure", () => {
  it("lists the four OneNote-style categories in menu order", () => {
    expect(SHAPE_CATEGORIES).toEqual(["Blocks", "Arrows", "Connectors", "Sticky notes"]);
  });

  it("is partitioned by category — grouping reproduces the catalog exactly", () => {
    const grouped = SHAPE_CATEGORIES.flatMap((c) => shapesByCategory(c));
    expect(grouped).toHaveLength(SHAPE_LIBRARY.length);
    // same entries in the same order (reference identity, not just deep equality)
    expect(grouped.every((shape, i) => shape === SHAPE_LIBRARY[i])).toBe(true);
  });

  it("groups categories contiguously — the toolbar never interleaves them", () => {
    const ranks = SHAPE_LIBRARY.map((s) => SHAPE_CATEGORIES.indexOf(s.category));
    expect(ranks.every((r, i) => i === 0 || r >= ranks[i - 1])).toBe(true);
  });

  it("anchors every skeleton in shape-local coordinates at (0, 0)", () => {
    for (const shape of SHAPE_LIBRARY) {
      for (const sk of shape.skeletons) {
        expect(sk.x, `${shape.id}/${sk.id}`).toBe(0);
        expect(sk.y, `${shape.id}/${sk.id}`).toBe(0);
      }
    }
  });

  it("keeps skeleton ids unique across the whole library", () => {
    const all = SHAPE_LIBRARY.flatMap((s) => s.skeletons.map((sk) => sk.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it("namespaces every skeleton id under 'shape-'", () => {
    for (const shape of SHAPE_LIBRARY) {
      for (const sk of shape.skeletons) {
        expect(sk.id.startsWith("shape-"), sk.id).toBe(true);
      }
    }
  });
});

describe("geometry sanity", () => {
  it("declares positive widths, and zero height only for flat horizontal strokes", () => {
    for (const shape of SHAPE_LIBRARY) {
      expect(shape.width, shape.id).toBeGreaterThan(0);
      expect(shape.height, shape.id).toBeGreaterThanOrEqual(0);
      expect(shape.height === 0, shape.id).toBe(FLAT_LINE_SHAPES.has(shape.id));
    }
  });

  it("keeps point-based skeletons in the positive quadrant starting at the origin", () => {
    for (const shape of SHAPE_LIBRARY) {
      for (const sk of shape.skeletons) {
        if (sk.type === "arrow" || sk.type === "line") {
          expect(sk.points, `${shape.id}: point-based`).toBeDefined();
          expect(sk.points!.length).toBeGreaterThanOrEqual(2);
          expect(Math.min(...sk.points!.map(([x]) => x)), `${shape.id}: min x`).toBe(0);
          expect(Math.min(...sk.points!.map(([, y]) => y)), `${shape.id}: min y`).toBe(0);
        } else {
          expect(sk.points, `${shape.id}: closed shapes are box-sized`).toBeUndefined();
        }
      }
    }
  });

  it("carries an end arrowhead on every arrow, and arrowheads on nothing else", () => {
    for (const shape of SHAPE_LIBRARY) {
      for (const sk of shape.skeletons) {
        if (sk.type === "arrow") {
          expect(sk.endArrowhead, shape.id).toBe("arrow");
        } else {
          expect(sk.startArrowhead, shape.id).toBeUndefined();
          expect(sk.endArrowhead, shape.id).toBeUndefined();
        }
      }
    }
  });

  it("rounds exactly the sticky notes and the curved arrow", () => {
    const expectedRoundness: Record<string, number> = {
      "arrow-curved": 2,
      "sticky-note": 3,
      "callout-block": 3,
    };
    for (const shape of SHAPE_LIBRARY) {
      const sk = shape.skeletons[0];
      const expected = expectedRoundness[shape.id];
      if (expected === undefined) {
        expect(sk.roundness, `${shape.id}: sharp corners`).toBeUndefined();
      } else {
        expect(sk.roundness, shape.id).toEqual({ type: expected });
      }
    }
  });
});

describe("color and label policy", () => {
  it("pins exactly one fixed-look shape: the yellow sticky note", () => {
    const pinned = SHAPE_LIBRARY.filter((s) =>
      s.skeletons.some((sk) => sk.strokeColor !== INHERIT_STROKE)
    ).map((s) => s.id);
    expect(pinned).toEqual(["sticky-note"]);
  });

  it("gives the filled block a translucent solid tint while inheriting the stroke", () => {
    const sk = getShapeDef("filled-block")!.skeletons[0];
    expect(sk.strokeColor).toBe(INHERIT_STROKE); // stroke follows the toolbar
    expect(sk.backgroundColor).toBe("#94a3b8"); // slate tint…
    expect(sk.fillStyle).toBe("solid"); // …as a solid fill…
    expect(sk.opacity).toBe(55); // …at 55% so ink underneath shows through
  });

  it("binds labels only to Sticky notes shapes, with readable font sizes", () => {
    const labeled = SHAPE_LIBRARY.filter((s) => s.skeletons.some((sk) => sk.label));
    expect(labeled.map((s) => s.id).sort()).toEqual(["callout-block", "sticky-note"]);
    for (const shape of labeled) {
      expect(shape.category, `${shape.id}: labeled shapes live in Sticky notes`).toBe("Sticky notes");
      for (const sk of shape.skeletons) {
        if (!sk.label) continue;
        expect(sk.label.text.trim().length).toBeGreaterThan(0);
        expect(sk.label.fontSize ?? 0).toBeGreaterThanOrEqual(16);
      }
    }
  });
});

describe("getShapeDef lookups", () => {
  it("resolves every catalog id to the exact library entry (reference identity)", () => {
    for (const shape of SHAPE_LIBRARY) {
      expect(getShapeDef(shape.id), shape.id).toBe(shape);
    }
  });

  it("matches ids exactly — no case, prefix, plural or whitespace fallback", () => {
    expect(getShapeDef("arrow")).toBeNull(); // prefix of real ids
    expect(getShapeDef("Arrow-One-Way")).toBeNull(); // case-sensitive
    expect(getShapeDef(" arrow-one-way")).toBeNull(); // no trimming
    expect(getShapeDef("arrow-one-way ")).toBeNull();
    expect(getShapeDef("sticky-notes")).toBeNull(); // plural trap
  });
});
