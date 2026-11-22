/**
 * Ink to shape unit pins (issue #329, docs/test-plans/ink-shapes.md, IS-P*).
 *
 * The classifier is pure — synthetic strokes with deterministic noise pin
 * every accepted class, every honest miss, the planner's selection
 * semantics and the skeleton contract. No Excalidraw runtime involved.
 */
import { describe, expect, test } from "bun:test";
import {
  classifyStrokePoints,
  inkShapeSkeletons,
  inkShapesSummary,
  planInkShapes,
  INK_MIN_DIAGONAL,
  type InkShapePlan,
  type Vec,
} from "../ink-shapes";
import { shouldHealConversion } from "../hwr-convert";
import type { ScenePayload } from "../types";

/* deterministic noise generator (LCG — stable across runs) */
function noiseGen(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5; // [-0.5, 0.5)
  };
}

function circlePoints(cx: number, cy: number, r: number, n = 28, noise = 1.5, seed = 7): Vec[] {
  const rnd = noiseGen(seed);
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({
      x: cx + r * Math.cos(t) + rnd() * 2 * noise,
      y: cy + r * Math.sin(t) + rnd() * 2 * noise,
    });
  }
  return pts;
}

function ellipsePoints(cx: number, cy: number, a: number, b: number, n = 28, noise = 1.5, seed = 11): Vec[] {
  const rnd = noiseGen(seed);
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({
      x: cx + a * Math.cos(t) + rnd() * 2 * noise,
      y: cy + b * Math.sin(t) + rnd() * 2 * noise,
    });
  }
  return pts;
}

function linePoints(x0: number, y0: number, x1: number, y1: number, noise = 1.5, seed = 3): Vec[] {
  const rnd = noiseGen(seed);
  const n = 16;
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({
      x: x0 + (x1 - x0) * t + rnd() * 2 * noise,
      y: y0 + (y1 - y0) * t + rnd() * 2 * noise,
    });
  }
  return pts;
}

function rectPoints(x0: number, y0: number, x1: number, y1: number, noise = 1.5, seed = 5): Vec[] {
  const rnd = noiseGen(seed);
  const pts: Vec[] = [];
  const push = (x: number, y: number) => pts.push({ x: x + rnd() * 2 * noise, y: y + rnd() * 2 * noise });
  // corners with ~8 intermediate points per edge, starting at a corner
  for (let i = 0; i <= 8; i++) push(x0 + ((x1 - x0) * i) / 8, y0);
  for (let i = 1; i <= 8; i++) push(x1, y0 + ((y1 - y0) * i) / 8);
  for (let i = 1; i <= 8; i++) push(x1 + ((x0 - x1) * i) / 8, y1);
  for (let i = 1; i <= 8; i++) push(x0, y1 + ((y0 - y1) * i) / 8);
  return pts;
}

function diamondPoints(cx: number, cy: number, w: number, h: number, noise = 1.2, seed = 9): Vec[] {
  const rnd = noiseGen(seed);
  const corners = [
    { x: cx, y: cy - h / 2 },
    { x: cx + w / 2, y: cy },
    { x: cx, y: cy + h / 2 },
    { x: cx - w / 2, y: cy },
  ];
  const pts: Vec[] = [];
  for (let c = 0; c < corners.length; c++) {
    const from = corners[c];
    const to = corners[(c + 1) % corners.length];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push({ x: from.x + (to.x - from.x) * t + rnd() * 2 * noise, y: from.y + (to.y - from.y) * t + rnd() * 2 * noise });
    }
  }
  return pts;
}

function trianglePoints(p0: Vec, p1: Vec, p2: Vec, noise = 1.2, seed = 13): Vec[] {
  const rnd = noiseGen(seed);
  const corners = [p0, p1, p2];
  const pts: Vec[] = [];
  for (let c = 0; c < corners.length; c++) {
    const from = corners[c];
    const to = corners[(c + 1) % corners.length];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push({ x: from.x + (to.x - from.x) * t + rnd() * 2 * noise, y: from.y + (to.y - from.y) * t + rnd() * 2 * noise });
    }
  }
  return pts;
}

function zigzagPoints(): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i <= 16; i++) {
    pts.push({ x: 100 + i * 12, y: 200 + (i % 2 === 0 ? -28 : 28) });
  }
  return pts;
}

const near = (actual: number, expected: number, tol = 6): void => {
  expect(Math.abs(actual - expected), `${actual} ≈ ${expected} ±${tol}`).toBeLessThanOrEqual(tol);
};

describe("classifyStrokePoints — accepted classes", () => {
  test("IS-P01: a noisy circle becomes an ellipse sized by the fitted radius", () => {
    const s = classifyStrokePoints(circlePoints(200, 150, 60));
    expect(s?.kind).toBe("ellipse");
    near(s!.bounds.x, 200 - 60, 7);
    near(s!.bounds.y, 150 - 60, 7);
    near(s!.bounds.width, 120, 10);
    near(s!.bounds.height, 120, 10);
  });

  test("IS-P02: an axis-aligned ellipse (2:1) becomes an ellipse with the bbox bounds", () => {
    const s = classifyStrokePoints(ellipsePoints(300, 220, 90, 45));
    expect(s?.kind).toBe("ellipse");
    near(s!.bounds.x, 210, 7);
    near(s!.bounds.y, 175, 7);
    near(s!.bounds.width, 180, 10);
    near(s!.bounds.height, 90, 10);
  });

  test("IS-P03: a wobbly straight stroke becomes a line through its endpoints", () => {
    const s = classifyStrokePoints(linePoints(120, 320, 380, 328));
    expect(s?.kind).toBe("line");
    expect(s!.path).toBeDefined();
    near(s!.path![0].x, 120, 3);
    near(s!.path![0].y, 320, 3);
    near(s!.path![s!.path!.length - 1].x, 380, 3);
    near(s!.path![s!.path!.length - 1].y, 328, 3);
  });

  test("IS-P04: a noisy axis-aligned rectangle becomes a rectangle with the corner bounds", () => {
    const s = classifyStrokePoints(rectPoints(420, 150, 560, 240));
    expect(s?.kind).toBe("rectangle");
    near(s!.bounds.x, 420, 5);
    near(s!.bounds.y, 150, 5);
    near(s!.bounds.width, 140, 8);
    near(s!.bounds.height, 90, 8);
  });

  test("IS-P04b: a rectangle drawn starting mid-edge still classifies (wobble corners pruned)", () => {
    const pts = rectPoints(40, 40, 190, 130);
    // start from a point ON the top edge instead of the corner
    const startIdx = 4;
    const rotated = [...pts.slice(startIdx), ...pts.slice(0, startIdx)];
    const s = classifyStrokePoints(rotated);
    expect(s?.kind).toBe("rectangle");
    near(s!.bounds.x, 40, 5);
    near(s!.bounds.y, 40, 5);
    near(s!.bounds.width, 150, 8);
    near(s!.bounds.height, 90, 8);
  });

  test("IS-P05: a diamond becomes a diamond", () => {
    const s = classifyStrokePoints(diamondPoints(300, 200, 160, 120));
    expect(s?.kind).toBe("diamond");
    near(s!.bounds.x, 220, 6);
    near(s!.bounds.y, 140, 6);
    near(s!.bounds.width, 160, 8);
    near(s!.bounds.height, 120, 8);
  });

  test("IS-P05b: a 45°-rotated square (corners at bbox edge midpoints) becomes a diamond", () => {
    const s = classifyStrokePoints(diamondPoints(300, 200, 120, 120, 1.2, 17));
    expect(s?.kind).toBe("diamond");
  });

  test("IS-P06: a triangle becomes a closed 3-corner path", () => {
    const s = classifyStrokePoints(trianglePoints({ x: 100, y: 300 }, { x: 220, y: 300 }, { x: 160, y: 210 }));
    expect(s?.kind).toBe("triangle");
    expect(s!.path).toHaveLength(4); // 3 corners + closure back to the first
    expect(s!.path![0]).toEqual(s!.path![3]);
  });
});

describe("classifyStrokePoints — honest misses stay null", () => {
  test("IS-P07: a zigzag is not a shape", () => {
    expect(classifyStrokePoints(zigzagPoints())).toBeNull();
  });

  test("IS-P08: a rotated (30°) rectangle stays ink", () => {
    // un-rotated base then rotate every point by 30° around the center
    const base = rectPoints(400, 400, 520, 470);
    const cx = 460;
    const cy = 435;
    const a = (30 * Math.PI) / 180;
    const rot = base.map((p) => ({
      x: cx + (p.x - cx) * Math.cos(a) - (p.y - cy) * Math.sin(a),
      y: cy + (p.x - cx) * Math.sin(a) + (p.y - cy) * Math.cos(a),
    }));
    const s = classifyStrokePoints(rot);
    expect(s?.kind === "rectangle").toBe(false);
  });

  test("IS-P09: an open C arc is not a shape", () => {
    const pts: Vec[] = [];
    for (let i = -60; i <= 60; i += 4) {
      const t = (i * Math.PI) / 180;
      pts.push({ x: 300 + 70 * Math.cos(t), y: 200 + 70 * Math.sin(t) });
    }
    expect(classifyStrokePoints(pts)).toBeNull();
  });

  test("IS-P10: a tiny dot is below the size floor", () => {
    const pts: Vec[] = [];
    for (let i = 0; i <= 6; i++) pts.push({ x: 500 + i, y: 500 + i * 0.5 });
    expect(500 - (500 + 6) < 0).toBe(true);
    expect(classifyStrokePoints(pts)).toBeNull();
    expect(INK_MIN_DIAGONAL).toBe(18);
  });

  test("IS-P11: fewer than 3 usable points is never a shape", () => {
    expect(classifyStrokePoints([{ x: 0, y: 0 }, { x: 50, y: 50 }])).toBeNull();
    expect(classifyStrokePoints([])).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* planner semantics                                                   */
/* ------------------------------------------------------------------ */

function strokeEl(id: string, pts: Vec[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  return {
    id,
    type: "freedraw",
    isDeleted: false,
    x: minX,
    y: minY,
    strokeColor: "#be4b25",
    strokeWidth: 2,
    roughness: 1,
    points: pts.map((p) => [p.x - minX, p.y - minY]),
    ...extra,
  };
}

function payloadOf(...elements: Array<Record<string, unknown> | null>): ScenePayload {
  return { elements: elements.filter((e): e is Record<string, unknown> => e !== null), files: {} };
}

describe("planInkShapes", () => {
  test("IS-P12: only selected alive freedraw strokes are targeted; others are ignored or unrecognized", () => {
    const circle = circlePoints(200, 150, 60);
    const zigzag = zigzagPoints();
    const payload = payloadOf(
      strokeEl("s-circle", circle),
      strokeEl("s-zigzag", zigzag),
      strokeEl("s-deleted", circle, { isDeleted: true }),
      { id: "s-rect", type: "rectangle", isDeleted: false, x: 0, y: 0, points: [] },
    );
    const plan = planInkShapes(payload, new Set(["s-circle", "s-zigzag"]));
    expect(plan.targets.map((t) => t.id)).toEqual(["s-circle"]);
    expect(plan.targets[0].kind).toBe("ellipse");
    expect(plan.unrecognized).toEqual(["s-zigzag"]);
  });

  test("IS-P13: ids missing from the scene are skipped silently (heal re-entry contract)", () => {
    const plan = planInkShapes(payloadOf(strokeEl("s-circle", circlePoints(200, 150, 60))), new Set(["gone-1", "s-circle"]));
    expect(plan.targets.map((t) => t.id)).toEqual(["s-circle"]);
    expect(plan.unrecognized).toEqual([]);
  });

  test("IS-P14: an empty selection plans nothing (the caller guides)", () => {
    const plan = planInkShapes(payloadOf(strokeEl("s-circle", circlePoints(200, 150, 60))), new Set());
    expect(plan.targets).toEqual([]);
    expect(plan.unrecognized).toEqual([]);
  });

  test("IS-P15: garbage points never crash the classifier (safeTags contract)", () => {
    const payload = payloadOf(
      {
        id: "s-bad",
        type: "freedraw",
        isDeleted: false,
        x: 0,
        y: 0,
        points: [[1], ["a", "b"], [NaN, 5], [10, 20], null, "nope", [30, 40, 0.5]],
      },
    );
    const plan = planInkShapes(payload, new Set(["s-bad"]));
    expect(plan.targets).toEqual([]);
    expect(plan.unrecognized).toEqual(["s-bad"]);
  });

  test("IS-P16: a four-stroke rectangle degrades to four perfect lines", () => {
    const sides = [
      linePoints(100, 100, 300, 100, 1.5, 21),
      linePoints(300, 100, 300, 220, 1.5, 22),
      linePoints(300, 220, 100, 220, 1.5, 23),
      linePoints(100, 220, 100, 100, 1.5, 24),
    ].map((pts, i) => strokeEl(`side-${i}`, pts));
    const plan = planInkShapes(payloadOf(...sides), new Set(["side-0", "side-1", "side-2", "side-3"]));
    expect(plan.targets).toHaveLength(4);
    expect(plan.targets.every((t) => t.kind === "line")).toBe(true);
    expect(plan.unrecognized).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* skeletons + toast copy                                              */
/* ------------------------------------------------------------------ */

describe("inkShapeSkeletons", () => {
  test("IS-P17: line skeletons are canonical (points[0] = [0,0] at the anchor)", () => {
    const payload = payloadOf(strokeEl("s-line", linePoints(100, 200, 260, 204)));
    const plan = planInkShapes(payload, new Set(["s-line"]));
    const sk = inkShapeSkeletons(plan);
    expect(sk).toHaveLength(1);
    expect(sk[0].type).toBe("line");
    near(sk[0].x, 100, 3);
    near(sk[0].y, 200, 3);
    expect(sk[0].points![0]).toEqual([0, 0]);
    near(sk[0].points![1][0], 160, 3);
    near(sk[0].points![1][1], 4, 3);
  });

  test("IS-P18: skeletons inherit the stroke's own style and close triangles", () => {
    const payload = payloadOf(
      strokeEl("s-tri", trianglePoints({ x: 100, y: 300 }, { x: 220, y: 300 }, { x: 160, y: 210 })),
    );
    const plan: InkShapePlan = planInkShapes(payload, new Set(["s-tri"]));
    const sk = inkShapeSkeletons(plan);
    expect(sk[0].type).toBe("line");
    expect(sk[0].strokeColor).toBe("#be4b25");
    expect(sk[0].strokeWidth).toBe(2);
    expect(sk[0].backgroundColor).toBe("transparent");
    expect(sk[0].points![0]).toEqual([0, 0]);
    expect(sk[0].points![sk[0].points!.length - 1]).toEqual([0, 0]); // closed loop
    expect(sk[0].points).toHaveLength(4);
  });

  test("IS-P19: ellipse skeletons carry the fitted bounds", () => {
    const payload = payloadOf(strokeEl("s-circle", circlePoints(200, 150, 60)));
    const plan = planInkShapes(payload, new Set(["s-circle"]));
    const sk = inkShapeSkeletons(plan);
    expect(sk[0].type).toBe("ellipse");
    near(sk[0].x, 140, 7);
    near(sk[0].y, 90, 7);
    near(sk[0].width!, 120, 10);
    near(sk[0].height!, 120, 10);
  });
});

describe("shouldHealConversion (the #329 guard hardening, shared with hwr-convert)", () => {
  const scene = (els: Array<Record<string, unknown>>): Array<Record<string, unknown>> => els;

  test("IS-P21: heals while at least one original ink stroke is still alive", () => {
    const els = scene([
      { id: "stroke-1", type: "freedraw", isDeleted: false },
      { id: "stroke-2", type: "freedraw", isDeleted: true },
    ]);
    expect(shouldHealConversion(["stroke-1", "stroke-2"], els)).toBe(true);
  });

  test("IS-P22: skips when the ink is gone — page switched (foreign scene), strokes deleted, or non-ink ids", () => {
    expect(shouldHealConversion(["stroke-1"], [])).toBe(false);
    const deleted = scene([{ id: "stroke-1", type: "freedraw", isDeleted: true }]);
    expect(shouldHealConversion(["stroke-1"], deleted)).toBe(false);
    const foreign = scene([{ id: "text-9", type: "text", isDeleted: false }]);
    expect(shouldHealConversion(["stroke-1"], foreign)).toBe(false);
    const wrongType = scene([{ id: "stroke-1", type: "rectangle", isDeleted: false }]);
    expect(shouldHealConversion(["stroke-1"], wrongType)).toBe(false);
  });
});

describe("inkShapesSummary", () => {
  test("IS-P20: every toast branch is exact", () => {
    expect(inkShapesSummary({ converted: 0, leftAsInk: 0, selected: false })).toBe(
      "Select the ink strokes to convert, then run Ink to shape again.",
    );
    expect(inkShapesSummary({ converted: 0, leftAsInk: 0, selected: true })).toBe(
      "No ink in the selection — Ink to shape converts drawn (freedraw) strokes.",
    );
    expect(inkShapesSummary({ converted: 0, leftAsInk: 2, selected: true })).toBe(
      "Nothing shape-like in the selection — the ink stays as is.",
    );
    expect(inkShapesSummary({ converted: 1, leftAsInk: 0, selected: true })).toBe("Converted 1 stroke to shapes.");
    expect(inkShapesSummary({ converted: 3, leftAsInk: 0, selected: true })).toBe("Converted 3 strokes to shapes.");
    expect(inkShapesSummary({ converted: 3, leftAsInk: 1, selected: true })).toBe(
      "Converted 3 strokes to shapes. 1 stroke stays as ink — not shape-like.",
    );
    expect(inkShapesSummary({ converted: 2, leftAsInk: 2, selected: true })).toBe(
      "Converted 2 strokes to shapes. 2 strokes stay as ink — not shape-like.",
    );
  });
});
