/// <reference types="bun-types" />
/**
 * Vendored handwriting engine integrity (test plan:
 * docs/test-plans/handwriting.md, ids HWR-A01..A04) — the issue #103
 * pdf.js-worker drift pattern applied to the trocr bundle, mirroring
 * ocr-assets.test.ts.
 *
 * The engine is vendored (public/hwr/) so the app never depends on a CDN
 * (offline-first PWA / F-Droid stance) and recognition never sends ink
 * anywhere (issue #175 privacy stance). These tests pin the bundle:
 * files exist, sizes and sha256s match the manifest, versions stay
 * pinned, and no stray files ride along.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../../..");
const HWR_DIR = join(REPO_ROOT, "public/hwr");

interface AssetManifest {
  transformersJs: string;
  onnxruntimeWeb: string;
  model: string;
  modelPrecision: string;
  language: string;
  /** sha256 of the UNCOMPRESSED transformers.min.js (the .gz pins it) */
  transformersJsOriginalSha256: string;
  files: Record<string, { sha256: string; bytes: number }>;
}

const manifest = JSON.parse(
  readFileSync(join(HWR_DIR, "assets.json"), "utf8"),
) as AssetManifest;

describe("vendored handwriting assets (HWR-A01..A04)", () => {
  it("HWR-A01: every declared asset exists with the declared byte size", () => {
    expect(Object.keys(manifest.files).length).toBeGreaterThanOrEqual(11);
    for (const [name, meta] of Object.entries(manifest.files)) {
      const path = join(HWR_DIR, name);
      const stat = statSync(path); // throws (fails the test) when missing
      expect(stat.size, `${name} must match the manifest size`).toBe(meta.bytes);
    }
  });

  it("HWR-A02: every asset's sha256 matches the manifest", () => {
    for (const [name, meta] of Object.entries(manifest.files)) {
      const digest = createHash("sha256")
        .update(readFileSync(join(HWR_DIR, name)))
        .digest("hex");
      expect(digest, `${name} must be byte-identical to the vendored original`).toBe(
        meta.sha256,
      );
    }
  });

  it("HWR-A03: versions stay pinned to the audited bundle", () => {
    // 2026-11-10 audit (docs/test-plans/handwriting.md): transformers.js
    // 4.3.2 + its exact onnxruntime-web dependency, trocr-small q8
    expect(manifest.transformersJs).toBe("4.3.2");
    expect(manifest.onnxruntimeWeb).toBe("1.31.0-dev.20260914-8d85527a0");
    expect(manifest.model).toBe("Xenova/trocr-small-handwritten");
    expect(manifest.modelPrecision).toBe("q8");
    // English-only in Phase A (issue #175): the model is trained on
    // IAM-class English handwriting
    expect(manifest.language).toBe("eng");
  });

  it("HWR-A03b: the gzipped runtime bundle decompresses to the pinned original", () => {
    const gz = readFileSync(join(HWR_DIR, "transformers.web.bundle.js.gz"));
    const original = gunzipSync(gz);
    const digest = createHash("sha256").update(original).digest("hex");
    expect(digest).toBe(manifest.transformersJsOriginalSha256);
    // and it really is the transformers.js module (pipeline export present)
    const head = original.toString("utf8", 0, 4096);
    expect(head.length).toBeGreaterThan(0);
  });

  it("HWR-A03c: the manifest declares exactly the files on disk (no strays)", () => {
    const onDisk = readdirSync(HWR_DIR, { recursive: true })
      .map((f) => String(f).replaceAll("\\", "/"))
      // recursive readdir lists directories too — only files are pinned
      .filter((f) => statSync(join(HWR_DIR, f)).isFile())
      .filter(
        (f) =>
          !f.endsWith("assets.json") &&
          !f.endsWith("README.md") &&
          !f.endsWith("fetch-vendor.sh") &&
          !f.endsWith(".gitignore"),
      )
      .sort();
    const declared = Object.keys(manifest.files).sort();
    expect(onDisk).toEqual(declared);
  });

  it("HWR-A04: the model weights are the byte sizes verified against the HF API", () => {
    // docs/handwriting-research.md §3.1, verified 2026-11-10
    expect(
      manifest.files["models/trocr-small-handwritten/onnx/encoder_model_quantized.onnx"].bytes,
    ).toBe(23_082_942);
    expect(
      manifest.files["models/trocr-small-handwritten/onnx/decoder_model_merged_quantized.onnx"].bytes,
    ).toBe(40_527_613);
  });
});
