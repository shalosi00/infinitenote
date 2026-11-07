/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import {
  INHERIT_FILL,
  INHERIT_STROKE,
  SHAPE_CATEGORIES,
  SHAPE_LIBRARY,
  getShapeDef,
  shapesByCategory,
  type ShapeSkeleton,
} from "../shape-library";

const ALLOWED_TYPES = new Set(["rectangle", "ellipse", "diamond", "arrow", "line", "text"]);

describe("shape library catalog (issue #65)", () => {
  it("covers every category with at least two shapes", () => {
    for (const category of SHAPE_CATEGORIES) {
      expect(shapesByCategory(category).length).toBeGreaterThanOrEqual(2);
    }
    expect(SHAPE_LIBRARY.length).toBeGreaterThanOrEqual(10);
  });

  it("has unique, stable ids and non-empty labels", () => {
    const ids = SHAPE_LIBRARY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shape of SHAPE_LIBRARY) {
      expect(shape.label.trim().length).toBeGreaterThan(0);
      expect(shape.skeletons.length).toBeGreaterThan(0);
    }
  });

  it("only uses native Excalidraw element types", () => {
    for (const shape of SHAPE_LIBRARY) {
      for (const sk of shape.skeletons) {
        expect(ALLOWED_TYPES.has(sk.type)).toBe(true);
        expect(typeof sk.id).toBe("string");
        expect(sk.id.length).toBeGreaterThan(0);
        expect(typeof sk.x).toBe("number");
        expect(typeof sk.y).toBe("number");
      }
    }
  });

  it("keeps skeleton ids unique inside each shape", () => {
    for (const shape of SHAPE_LIBRARY) {
      const ids = shape.skeletons.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("declares a bounding box matching the geometry", () => {
    for (const shape of SHAPE_LIBRARY) {
      const sk = shape.skeletons[0];
      const width = sk.points
        ? Math.max(...sk.points.map(([x]) => x))
        : (sk.width ?? 0);
      const height = sk.points
        ? Math.max(...sk.points.map(([, y]) => y))
        : (sk.height ?? 0);
      expect(width).toBeCloseTo(shape.width, 0);
      expect(height).toBeCloseTo(shape.height, 0);
    }
  });
});

describe("shape variants", () => {
  it("arrow variants differ in arrowheads and stroke style", () => {
    const oneWay = getShapeDef("arrow-one-way")!;
    expect((oneWay.skeletons[0] as ShapeSkeleton).endArrowhead).toBe("arrow");
    expect((oneWay.skeletons[0] as ShapeSkeleton).startArrowhead).toBeUndefined();

    const twoWay = getShapeDef("arrow-two-way")!;
    expect((twoWay.skeletons[0] as ShapeSkeleton).startArrowhead).toBe("arrow");
    expect((twoWay.skeletons[0] as ShapeSkeleton).endArrowhead).toBe("arrow");

    const dashed = getShapeDef("arrow-dashed")!;
    expect((dashed.skeletons[0] as ShapeSkeleton).strokeStyle).toBe("dashed");

    const curved = getShapeDef("arrow-curved")!;
    expect((curved.skeletons[0] as ShapeSkeleton).roundness).toEqual({ type: 2 });
    expect((curved.skeletons[0] as ShapeSkeleton).points).toHaveLength(3);
  });

  it("elbow connector bends through a mid point and ends in an arrowhead", () => {
    const elbow = getShapeDef("connector-elbow")!;
    const sk = elbow.skeletons[0] as ShapeSkeleton;
    expect(sk.type).toBe("arrow");
    expect(sk.points).toEqual([
      [0, 0],
      [100, 0],
      [100, 80],
    ]);
    expect(sk.endArrowhead).toBe("arrow");
  });

  it("sticky note pins its yellow look and carries a bound label", () => {
    const sticky = getShapeDef("sticky-note")!;
    const sk = sticky.skeletons[0] as ShapeSkeleton;
    expect(sk.backgroundColor).toBe("#facc15");
    expect(sk.fillStyle).toBe("solid");
    expect(sk.label?.text).toBe("Note");
    expect(sk.strokeColor).not.toBe(INHERIT_STROKE); // fixed, recognizable look
  });

  it("callout block inherits the user's toolbar colors", () => {
    const callout = getShapeDef("callout-block")!;
    const sk = callout.skeletons[0] as ShapeSkeleton;
    expect(sk.strokeColor).toBe(INHERIT_STROKE);
    expect(sk.backgroundColor).toBe(INHERIT_FILL);
  });

  it("outline shapes inherit stroke and stay transparent inside", () => {
    for (const id of ["frame-rectangle", "ellipse", "diamond", "arrow-one-way", "connector-elbow"]) {
      const shape = getShapeDef(id)!;
      const sk = shape.skeletons[0] as ShapeSkeleton;
      expect(sk.strokeColor).toBe(INHERIT_STROKE);
      expect(sk.backgroundColor).toBe("transparent");
    }
  });
});

describe("getShapeDef", () => {
  it("resolves known ids", () => {
    expect(getShapeDef("sticky-note")?.label).toBe("Sticky note");
  });

  it("returns null for unknown ids", () => {
    expect(getShapeDef("no-such-shape")).toBeNull();
    expect(getShapeDef("")).toBeNull();
  });
});
