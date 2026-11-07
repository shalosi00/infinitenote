/// <reference types="bun-types" />
/**
 * Unit tests pinning the Android TWA scaffold invariants: version parity with
 * the web app, theme-color parity with the PWA webmanifest, manifest/host
 * consistency, and a real invocation of scripts/generate-assetlinks.mjs.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const readJson = (p: string) => JSON.parse(read(p));

describe("android-twa version parity", () => {
  const pkg = readJson("package.json");
  const gradle = read("android-twa/app/build.gradle.kts");
  const twa = readJson("android-twa/twa-manifest.json");

  it("keeps versionName in lockstep with package.json", () => {
    expect(gradle).toContain(`versionName = "${pkg.version}"`);
  });

  it("encodes the same minor in versionCode (major*100 + minor*10)", () => {
    const [major, minor] = pkg.version.split(".").map(Number);
    expect(gradle).toContain(`versionCode = ${major * 100 + minor * 10}`);
    expect(twa.appVersionCode).toBe(major * 100 + minor * 10);
  });

  it("keeps the bubblewrap manifest in sync with the gradle config", () => {
    expect(twa.appVersionName).toBe(pkg.version);
    expect(twa.packageId).toBe("com.infinitenote.app");
    expect(twa.appId).toBe("com.infinitenote.app");
  });
});

describe("android-twa wrapper vs PWA parity", () => {
  const webmanifest = readJson("public/manifest.webmanifest");
  const colors = read("android-twa/app/src/main/res/values/colors.xml");

  it("mirrors the webmanifest theme/background colors", () => {
    expect(colors).toContain(webmanifest.theme_color.toUpperCase());
    expect(colors).toContain(webmanifest.background_color.toUpperCase());
  });

  it("shows the same app name as the webmanifest short_name", () => {
    const strings = read("android-twa/app/src/main/res/values/strings.xml");
    expect(strings).toContain(webmanifest.short_name);
  });

  it("uses a single host consistent between manifest and deep links", () => {
    const twa = readJson("android-twa/twa-manifest.json");
    const android = read("android-twa/app/src/main/AndroidManifest.xml");
    expect(twa.host).toBe("https://shalosi00.github.io");
    expect(android).toContain('android:host="shalosi00.github.io"');
    expect(android).toContain(`android:pathPrefix="${twa.startUrl.replace(/\/$/, "")}/"`);
  });

  it("keeps the INTERNET permission for the live-origin fallback", () => {
    const android = read("android-twa/app/src/main/AndroidManifest.xml");
    expect(android).toContain("android.permission.INTERNET");
  });
});

describe("bundled-asset launcher (issue #64)", () => {
  const android = read("android-twa/app/src/main/AndroidManifest.xml");
  const gradle = read("android-twa/app/build.gradle.kts");
  const activity = read(
    "android-twa/app/src/main/java/com/infinitenote/app/BundledSiteActivity.java",
  );

  it("makes BundledSiteActivity the single launcher activity", () => {
    expect(android).toContain('android:name=".BundledSiteActivity"');
    expect(android).toContain('android:name="android.intent.action.MAIN"');
    expect(android).toContain('android:name="android.intent.category.LAUNCHER"');
    // the Custom Tabs LauncherActivity is retired with the WebView wrapper
    expect(android).not.toContain("androidbrowserhelper");
  });

  it("keeps the verified https deep-link filter on the bundled launcher", () => {
    expect(android).toMatch(/BundledSiteActivity[\s\S]*autoVerify="true"/);
    expect(android).toContain('android:scheme="https"');
  });

  it("pins androidx.webkit for WebViewAssetLoader", () => {
    expect(gradle).toContain('implementation("androidx.webkit:webkit:');
  });

  it("syncs the static export into the APK assets before every build", () => {
    expect(gradle).toContain("val syncWebAssets by tasks.registering(Sync::class)");
    expect(gradle).toContain('from(rootProject.file("../out"))');
    expect(gradle).toContain('into(file("src/main/assets/www"))');
    // a missing export must SKIP (source-only builds still configure),
    // never fail the build
    expect(gradle).toContain("onlyIf { rootProject.file(\"../out/index.html\").exists() }");
    expect(gradle).toContain('tasks.named("preBuild") { dependsOn(syncWebAssets) }');
  });

  it("serves the bundled site from the reserved asset origin", () => {
    expect(activity).toContain("appassets.androidplatform.net");
    expect(activity).toContain("AssetsPathHandler");
    expect(activity).toContain('.addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))');
  });

  it("falls back to the deployed PWA origin when assets are missing", () => {
    const twa = readJson("android-twa/twa-manifest.json");
    expect(activity).toContain(`LIVE_ORIGIN = "${twa.host}${twa.startUrl}"`);
    expect(activity).toContain("hasBundledSite()");
  });

  it("keeps storage local to the app sandbox", () => {
    expect(activity).toContain("setDomStorageEnabled(true)");
    expect(activity).toContain("setAllowFileAccess(false)");
    expect(activity).toContain("setAllowContentAccess(false)");
    expect(android).toContain('android:usesCleartextTraffic="false"');
  });
});

describe("scripts/generate-assetlinks.mjs (real CLI run)", () => {
  const SAMPLE =
    "3f6a258bde71c40e9b2daf5314c7886219be0d45a37ecf10629d4be87136a50c";
  const out = join(tmpdir(), `assetlinks-test-${process.pid}.json`);

  it("writes a valid assetlinks.json for a raw-hex fingerprint", () => {
    const proc = Bun.spawnSync(["bun", "scripts/generate-assetlinks.mjs",
      "--package", "com.infinitenote.app",
      "--fingerprint", SAMPLE,
      "--out", out], { cwd: ROOT });
    expect(proc.exitCode).toBe(0);
    const doc = JSON.parse(readFileSync(out, "utf8"));
    expect(doc[0].target.package_name).toBe("com.infinitenote.app");
    expect(doc[0].target.sha256_cert_fingerprints[0]).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    rmSync(out);
  });

  it("exits non-zero on a malformed fingerprint without writing output", () => {
    const bad = join(tmpdir(), `assetlinks-bad-${process.pid}.json`);
    const proc = Bun.spawnSync(["bun", "scripts/generate-assetlinks.mjs",
      "--package", "com.infinitenote.app",
      "--fingerprint", "not-a-fingerprint",
      "--out", bad], { cwd: ROOT });
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toContain("64 hex");
  });
});
