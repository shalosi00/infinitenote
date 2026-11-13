/// <reference types="bun-types" />
/**
 * Conversion integrity guard — unit tests for the pure drop detector
 * (test plan: docs/test-plans/handwriting.md, ids HWR-C60..C64).
 *
 * detectDroppedConversion is the discriminator behind the runtime guard in
 * excalidraw-client.ts: a created text element that is TOMBSTONED
 * (isDeleted: true, still in the elements map) is a legitimate undo or
 * delete and must NEVER count as dropped — otherwise the guard would
 * re-apply a conversion the user just undid. Only an element missing from
 * the map ENTIRELY (the measured Excalidraw 0.18 store drop shape: applied
 * at +0 ms, gone at +1200 ms, no tombstone) is a real drop worth healing.
 */
import { describe, expect, it } from "bun:test";
import { detectDroppedConversion } from "../hwr-convert";

/** A minimal element-shaped row — the detector only reads `id`. */
const el = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });

describe("detectDroppedConversion (conversion integrity guard)", () => {
  it("HWR-C60: healthy scene — every created id present, live", () => {
    const created = ["t1", "t2"];
    const scene = [el("ink-a"), el("t1"), el("ink-b"), el("t2")];
    expect(detectDroppedConversion(created, scene)).toEqual([]);
  });

  it("HWR-C61: tombstoned created ids are NOT dropped (legit undo/delete)", () => {
    const created = ["t1", "t2"];
    const scene = [
      el("ink-a"),
      el("t1", { isDeleted: true }), // undone or deleted by the user
      el("t2"),
    ];
    expect(detectDroppedConversion(created, scene)).toEqual([]);
  });

  it("HWR-C62: ids missing from the map entirely ARE dropped, in created order", () => {
    const created = ["t1", "t2", "t3"];
    const scene = [el("ink-a"), el("t2")]; // t1 and t3 vanished, no tombstone
    expect(detectDroppedConversion(created, scene)).toEqual(["t1", "t3"]);
  });

  it("HWR-C63: empty created ids and an empty scene are both safe", () => {
    expect(detectDroppedConversion([], [el("ink-a")])).toEqual([]);
    expect(detectDroppedConversion(["t1"], [])).toEqual(["t1"]);
    expect(detectDroppedConversion([], [])).toEqual([]);
  });

  it("HWR-C64: junk rows are ignored, not crashes", () => {
    const scene = [null, el("t1"), { noId: true }, el(42 as unknown as string), undefined] as unknown as Array<{
      id?: unknown;
    }>;
    expect(detectDroppedConversion(["t1", "t2"], scene)).toEqual(["t2"]);
  });
});
