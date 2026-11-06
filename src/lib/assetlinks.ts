/**
 * Digital Asset Links (assetlinks.json) builder for the Android TWA wrapper.
 *
 * The TWA APK installed on Android is verified against
 * `https://<host>/.well-known/assetlinks.json` — it must contain a statement
 * linking the app's package name to the SHA-256 fingerprint of the signing
 * certificate. See docs/android-twa.md for the full runbook; the CLI that
 * writes the file lives in scripts/generate-assetlinks.mjs.
 */

export interface AssetLinksTarget {
  namespace: "android_app";
  package_name: string;
  sha256_cert_fingerprints: string[];
}

export interface AssetLinksStatement {
  relation: string[];
  target: AssetLinksTarget;
}

const HEX64 = /^[0-9A-F]{64}$/;
// Android package names: dot-separated segments of letters/digits/underscore,
// never starting with a digit. At least two segments.
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/**
 * Normalize a SHA-256 certificate fingerprint to the canonical uppercase,
 * colon-separated form used in assetlinks.json. Accepts colon-separated,
 * space-separated or raw hex input (e.g. keytool -list output).
 */
export function normalizeFingerprint(input: string): string {
  const hex = input.replace(/[\s:]/g, "").toUpperCase();
  if (!HEX64.test(hex)) {
    const cleaned = input.replace(/[\s:]/g, "");
    throw new Error(
      `Invalid SHA-256 certificate fingerprint: expected 64 hex characters ` +
        `(optionally ':'-separated), got ${cleaned.length} characters`,
    );
  }
  return (hex.match(/.{2}/g) as string[]).join(":");
}

/**
 * Build the assetlinks.json document (a single android_app statement).
 * Throws on malformed input so the CLI never writes a file Android would
 * silently reject.
 */
export function buildAssetLinks(packageName: string, fingerprint: string): AssetLinksStatement[] {
  if (!PACKAGE.test(packageName)) {
    throw new Error(`Invalid Android package name: ${packageName}`);
  }
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: [normalizeFingerprint(fingerprint)],
      },
    },
  ];
}
