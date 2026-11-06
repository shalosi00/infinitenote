/// <reference types="bun-types" />
/**
 * Unit tests for the Digital Asset Links builder used by the Android TWA
 * (src/lib/assetlinks.ts + scripts/generate-assetlinks.mjs).
 */
import { describe, expect, it } from "bun:test";
import { buildAssetLinks, normalizeFingerprint } from "../assetlinks";

// Any well-formed 64-hex digest; NOT a real certificate (docs/android-twa.md
// explains how to derive the real one from the signing keystore).
const SAMPLE =
  "3f:6a:25:8b:de:71:c4:0e:9b:2d:af:53:14:c7:88:62:19:be:0d:45:a3:7e:cf:10:62:9d:4b:e8:71:36:a5:0c";

describe("normalizeFingerprint", () => {
  it("passes a colon-separated digest through unchanged", () => {
    expect(normalizeFingerprint(SAMPLE)).toBe(SAMPLE.toUpperCase());
  });

  it("uppercases and colon-splits raw lowercase hex", () => {
    const raw = SAMPLE.replaceAll(":", "").toLowerCase();
    expect(normalizeFingerprint(raw)).toBe(SAMPLE.toUpperCase());
  });

  it("tolerates spaces (keytool -list output wraps fingerprints)", () => {
    const spaced = SAMPLE.replace(/:/g, " ");
    expect(normalizeFingerprint(spaced)).toBe(SAMPLE.toUpperCase());
  });

  it("rejects wrong lengths", () => {
    expect(() => normalizeFingerprint("AA:BB")).toThrow(/64 hex/);
    expect(() => normalizeFingerprint("Z".repeat(64))).toThrow(/64 hex/);
  });
});

describe("buildAssetLinks", () => {
  const statements = buildAssetLinks("com.infinitenote.app", SAMPLE);

  it("emits a single android_app statement with the canonical relation", () => {
    expect(statements).toHaveLength(1);
    expect(statements[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(statements[0].target.namespace).toBe("android_app");
    expect(statements[0].target.package_name).toBe("com.infinitenote.app");
  });

  it("carries exactly one normalized fingerprint", () => {
    expect(statements[0].target.sha256_cert_fingerprints).toEqual([SAMPLE.toUpperCase()]);
  });

  it("round-trips through JSON.stringify as a valid assetlinks.json", () => {
    const parsed = JSON.parse(JSON.stringify(statements));
    expect(parsed).toEqual(statements);
  });

  it("rejects malformed package names", () => {
    expect(() => buildAssetLinks("infinitenote", SAMPLE)).toThrow(/package name/);
    expect(() => buildAssetLinks("com..app", SAMPLE)).toThrow(/package name/);
    expect(() => buildAssetLinks("", SAMPLE)).toThrow(/package name/);
  });
});
