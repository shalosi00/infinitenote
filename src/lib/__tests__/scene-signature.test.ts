/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { sanitizeScene, sceneSignature, structuralSceneJson } from "../excalidraw-utils";
import type { ScenePayload } from "../types";

/**
 * The autosave gate (flickering "Saved" indicator fix): the signature must
 * move on every change to the PERSISTED content (elements / files) and stay
 * byte-identical for appState-only changes (pan / zoom / selection), which
 * Excalidraw also reports through onChange.
 */

let seq = 0;
const mkEl = (over: Partial<{ id: string; version: number; type: string }> = {}) => ({
  id: over.id ?? `el-${++seq}`,
  type: over.type ?? "rectangle",
  version: over.version ?? 1,
});

const mkFile = (id: string): ScenePayload["files"][string] => ({
  id,
  dataURL: `data:image/png;base64,${id}`,
  mimeType: "image/png",
  created: 1,
});

const payload = (
  elements: unknown[] = [],
  files: ScenePayload["files"] = {},
): ScenePayload => ({ elements, files });


describe("structuralSceneJson (the gate's absorb second opinion)", () => {
  it("ignores the volatile metadata Excalidraw re-stamps on its own", () => {
    const a = payload([mkEl({ id: "x", version: 2 })], { f1: mkFile("f1") });
    const b = payload(
      [{ ...mkEl({ id: "x", version: 99 }), versionNonce: 123, updated: 456 }],
      { f1: mkFile("f1") },
    );
    // version/versionNonce/updated differ — the signature moves, the
    // structure must not
    expect(sceneSignature(a)).not.toBe(sceneSignature(b));
    expect(structuralSceneJson(a)).toBe(structuralSceneJson(b));
  });

  it("is insensitive to object key order (DB-parsed vs fresh onChange)", () => {
    const a = payload([{ id: "x", type: "text", text: "hi", version: 1 }]);
    const b = payload([{ version: 1, text: "hi", type: "text", id: "x" }]);
    expect(structuralSceneJson(a)).toBe(structuralSceneJson(b));
  });

  it("keeps element ARRAY order significant (z-order is persisted content)", () => {
    const a = payload([mkEl({ id: "a", version: 1 }), mkEl({ id: "b", version: 1 })]);
    const b = payload([mkEl({ id: "b", version: 1 }), mkEl({ id: "a", version: 1 })]);
    expect(structuralSceneJson(a)).not.toBe(structuralSceneJson(b));
  });

  it("moves when real content changes (the absorb path must never hide edits)", () => {
    const a = payload([mkEl({ id: "x", version: 1 })]);
    const b = payload([{ ...mkEl({ id: "x", version: 1 }), text: "edited" } as never]);
    expect(structuralSceneJson(a)).not.toBe(structuralSceneJson(b));
  });

  it("moves when a file's data changes", () => {
    const a = payload([mkEl({ id: "x" })], { f1: mkFile("f1") });
    const b = payload(
      [mkEl({ id: "x" })],
      { f1: { ...mkFile("f1"), dataURL: "data:image/png;base64,DIFFERENT" } },
    );
    expect(structuralSceneJson(a)).not.toBe(structuralSceneJson(b));
  });
});

describe("sceneSignature", () => {
  it("is stable for identical payloads", () => {
    const a = payload([mkEl({ id: "x", version: 3 })], { f1: mkFile("f1") });
    const b = payload([mkEl({ id: "x", version: 3 })], { f1: mkFile("f1") });
    expect(sceneSignature(a)).toBe(sceneSignature(b));
  });

  it("ignores element order (z-reorder without version bump cannot be faked)", () => {
    const a = payload([mkEl({ id: "a", version: 2 }), mkEl({ id: "b", version: 5 })]);
    const b = payload([mkEl({ id: "b", version: 5 }), mkEl({ id: "a", version: 2 })]);
    expect(sceneSignature(a)).toBe(sceneSignature(b));
  });

  it("changes when an element is edited (version bump)", () => {
    const a = payload([mkEl({ id: "a", version: 2 })]);
    const b = payload([mkEl({ id: "a", version: 3 })]);
    expect(sceneSignature(a)).not.toBe(sceneSignature(b));
  });

  it("changes when an element is added or removed", () => {
    const one = payload([mkEl({ id: "a" })]);
    const two = payload([mkEl({ id: "a" }), mkEl({ id: "b" })]);
    expect(sceneSignature(one)).not.toBe(sceneSignature(two));
    expect(sceneSignature(payload([]))).not.toBe(sceneSignature(one));
  });

  it("changes when an element id changes even at the same version", () => {
    const a = payload([mkEl({ id: "a", version: 1 })]);
    const b = payload([mkEl({ id: "b", version: 1 })]);
    expect(sceneSignature(a)).not.toBe(sceneSignature(b));
  });

  it("changes when a file is added or removed", () => {
    const a = payload([mkEl({ id: "a" })], { f1: mkFile("f1") });
    const b = payload([mkEl({ id: "a" })], { f1: mkFile("f1"), f2: mkFile("f2") });
    expect(sceneSignature(a)).not.toBe(sceneSignature(b));
    expect(sceneSignature(a)).not.toBe(sceneSignature(payload([mkEl({ id: "a" })], {})));
  });

  it("does not change when file keys are reordered", () => {
    const a = payload([], { f1: mkFile("f1"), f2: mkFile("f2") });
    const b = payload([], { f2: mkFile("f2"), f1: mkFile("f1") });
    expect(sceneSignature(a)).toBe(sceneSignature(b));
  });

  it("tolerates malformed elements without throwing", () => {
    const sig = sceneSignature(payload([null, {}, { id: 42, version: "x" }]));
    expect(typeof sig).toBe("string");
    expect(sig).not.toBe(sceneSignature(payload([null, {}, { id: 42, version: "x" }, mkEl()])));
  });

  it("gives the empty scene one stable signature", () => {
    expect(sceneSignature(payload())).toBe("0||");
  });

  it("is compositional with the sanitizer: clean scenes pass the gate, stale ones do not", () => {
    // A freshly loaded clean scene (image status already "saved", file
    // registered) sanitizes to itself → the mount replay of the restored
    // scene must NOT re-trigger a save.
    const clean = {
      elements: [{ id: "img", type: "image", version: 1, status: "saved", fileId: "f1" }],
      files: { f1: mkFile("f1") },
    } as unknown as ScenePayload;
    expect(sceneSignature(sanitizeScene(clean))).toBe(sceneSignature(clean));

    // A legacy scene with a stale "pending" image (file data registered)
    // sanitizes to a "saved" status → the signature must move so the gate
    // lets the normalizing save through (issue #122's DB guarantee).
    const legacy = {
      elements: [{ id: "img", type: "image", version: 1, status: "pending", fileId: "f1" }],
      files: { f1: mkFile("f1") },
    } as unknown as ScenePayload;
    expect(sceneSignature(sanitizeScene(legacy))).not.toBe(sceneSignature(legacy));

    // An orphan file (no image references it) is dropped by the sanitizer
    // → the gate must let that cleanup save through as well.
    const orphan = {
      elements: [{ id: "a", type: "rectangle", version: 1 }],
      files: { f1: mkFile("f1") },
    } as unknown as ScenePayload;
    expect(sceneSignature(sanitizeScene(orphan))).not.toBe(sceneSignature(orphan));
  });
});
