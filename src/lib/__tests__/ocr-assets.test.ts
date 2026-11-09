/// <reference types="bun-types" />
/**
 * Vendored OCR engine integrity (test plan: docs/test-plans/ocr.md,
 * OCR-A01..A04) — the issue #103 pdf.js-worker drift pattern applied to
 * the tesseract bundle.
 *
 * The engine is vendored (public/ocr/) so the app never depends on a CDN
 * (offline-first PWA / F-Droid stance). These tests pin the bundle: files
 * exist, sizes and sha256s match the manifest, versions stay pinned, and
 * the service worker actually serves the /ocr/ prefix from cache.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { OCR_LANG_FILES } from "../ocr";

const REPO_ROOT = join(import.meta.dir, "../../..");
const OCR_DIR = join(REPO_ROOT, "public/ocr");

interface AssetManifest {
  tesseractJs: string;
  tesseractJsCore: string;
  tessdata: string;
  language: string;
  files: Record<string, { sha256: string; bytes: number }>;
}

const manifest = JSON.parse(
  readFileSync(join(OCR_DIR, "assets.json"), "utf8"),
) as AssetManifest;

describe("vendored OCR assets (OCR-A01..A04)", () => {
  it("OCR-A01: every declared asset exists with the declared byte size", () => {
    expect(Object.keys(manifest.files).length).toBeGreaterThanOrEqual(5);
    for (const [name, meta] of Object.entries(manifest.files)) {
      const path = join(OCR_DIR, name);
      const stat = statSync(path); // throws (fails the test) when missing
      expect(stat.size, `${name} must match the manifest size`).toBe(meta.bytes);
    }
  });

  it("OCR-A02: every asset's sha256 matches the manifest", () => {
    for (const [name, meta] of Object.entries(manifest.files)) {
      const digest = createHash("sha256")
        .update(readFileSync(join(OCR_DIR, name)))
        .digest("hex");
      expect(digest, `${name} must be byte-identical to the vendored original`).toBe(
        meta.sha256,
      );
    }
  });

  it("OCR-A03: versions stay pinned to the audited bundle", () => {
    expect(manifest.tesseractJs).toBe("6.0.1");
    expect(manifest.tesseractJsCore).toBe("6.0.0"); // the version embedded in the 6.0.1 worker
    expect(manifest.tessdata).toBe("4.0.0_fast");
    // 2026-11-09 addendum: the German fast model drives the engine (it also
    // recognizes English flawlessly; the combination modes strip umlauts —
    // see docs/test-plans/ocr.md for the evidence table)
    expect(manifest.language).toBe("deu");
  });

  it("OCR-A03b: the manifest declares exactly the files on disk (no strays)", () => {
    const onDisk = readdirSync(OCR_DIR, { recursive: true })
      .map((f) => String(f).replaceAll("\\", "/"))
      .filter(
        (f) =>
          !f.endsWith("assets.json") &&
          !f.endsWith("README.md") &&
          // readdirSync(recursive) lists directories too; only compare files
          statSync(join(OCR_DIR, f)).isFile(),
      );
    expect([...onDisk].sort()).toEqual([...Object.keys(manifest.files)].sort());
  });

  it("OCR-A04: the service worker serves /ocr/ from cache (static prefix)", () => {
    const sw = readFileSync(join(REPO_ROOT, "public/sw.js"), "utf8");
    expect(sw).toMatch(/\/ocr\//);
  });

  it("OCR-A05: the manifest's lang files equal the policy's OCR_LANG_FILES", () => {
    // policy (src/lib/ocr.ts) and bundle (assets.json) cannot drift apart:
    // every language file the worker loads is declared, and every declared
    // lang file is one the worker actually uses
    const manifestLangFiles = Object.keys(manifest.files)
      .filter((f) => f.startsWith("lang/"))
      .sort();
    expect(manifestLangFiles).toEqual([...OCR_LANG_FILES].map((f) => `lang/${f}`).sort());
    for (const f of OCR_LANG_FILES) {
      expect(manifest.files[`lang/${f}`], `lang/${f} must be declared`).toBeDefined();
    }
  });

  it("OCR-A06: the driver hands OCR_LANGS to createWorker (no drift)", () => {
    // source-level check, the issue #103 pattern: ocr-client.ts must load
    // the languages the policy declares, never a hardcoded string
    const client = readFileSync(join(REPO_ROOT, "src/lib/ocr-client.ts"), "utf8");
    expect(client).toContain("OCR_LANGS");
    expect(client).not.toMatch(/createWorker\(\s*["']/);
  });
});
