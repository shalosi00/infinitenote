/// <reference types="bun-types" />
/**
 * Unit tests pinning the F-Droid packaging invariants (issue #56): the
 * metadata YAML structure, the repo-wide Android versionCode scheme, the
 * validator CLI behavior, and cross-file version parity with the TWA
 * scaffold (twa-manifest.json + app/build.gradle.kts).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expectedVersionCode,
  validateFdroidFile,
  validateFdroidMetadata,
} from "../../../scripts/fdroid-check.mjs";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const META_PATH = "packaging/fdroid/com.infinitenote.app.yml";

function baseMeta(): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify({
      Name: "InfiniteNote",
      AutoName: "InfiniteNote",
      Summary: "Local-first infinite-canvas notebook",
      Description: "A".repeat(120),
      License: "MIT",
      SourceCode: "https://github.com/shalosi00/infinitenote",
      IssueTracker: "https://github.com/shalosi00/infinitenote/issues",
      RepoType: "git",
      Repo: "https://github.com/shalosi00/infinitenote.git",
      Categories: ["Office"],
      Builds: [
        { versionName: "1.6.0", versionCode: 160, commit: "v1.6.0", subdir: "android-twa", gradle: ["yes"] },
      ],
    })
  );
}

describe("com.infinitenote.app.yml (F-Droid metadata)", () => {
  const result = validateFdroidFile(META_PATH);

  it("parses as YAML and passes every validator check", () => {
    expect(result.errors, result.errors.join("; ")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("declares the canonical identity + licensing", () => {
    const meta = Bun.YAML.parse(read(META_PATH)) as Record<string, unknown>;
    expect(meta.Name).toBe("InfiniteNote");
    expect(meta.AutoName).toBe("InfiniteNote");
    expect(meta.License).toBe("MIT");
    expect(meta.RepoType).toBe("git");
    expect(String(meta.Repo)).toContain("github.com/shalosi00/infinitenote");
    expect(String(meta.SourceCode)).toContain("github.com/shalosi00/infinitenote");
    expect(Array.isArray(meta.Categories)).toBe(true);
  });

  it("ships a build for the current app version on the repo-wide scheme", () => {
    const meta = Bun.YAML.parse(read(META_PATH)) as {
      Builds: Array<{ versionName: string; versionCode: number; commit: string }>;
    };
    const latest = meta.Builds[meta.Builds.length - 1];
    const pkg = JSON.parse(read("package.json")) as { version: string };
    const expectedCode = expectedVersionCode(pkg.version);
    if (expectedCode === null) throw new Error(`scheme rejected app version ${pkg.version}`);
    expect(latest.versionName).toBe(pkg.version);
    expect(latest.versionCode).toBe(expectedCode);
    expect(latest.commit).toBe(`v${pkg.version}`);
  });

  it("keeps version parity with the TWA scaffold", () => {
    const meta = Bun.YAML.parse(read(META_PATH)) as {
      Builds: Array<{ versionName: string; versionCode: number }>;
    };
    const latest = meta.Builds[meta.Builds.length - 1];
    const twa = JSON.parse(read("android-twa/twa-manifest.json")) as {
      appVersionName: string;
      appVersionCode: number;
    };
    const gradle = read("android-twa/app/build.gradle.kts");
    expect(latest.versionName).toBe(twa.appVersionName);
    expect(latest.versionCode).toBe(twa.appVersionCode);
    expect(gradle).toContain(`versionCode = ${twa.appVersionCode}`);
    expect(gradle).toContain(`versionName = "${twa.appVersionName}"`);
  });

  it("contains no placeholder markers", () => {
    const raw = read(META_PATH);
    for (const marker of ["TODO", "TBD", "FIXME", "XXX", "placeholder"]) {
      expect(raw.includes(marker), `marker ${marker}`).toBe(false);
    }
  });
});

describe("expectedVersionCode scheme", () => {
  it("matches major*100 + minor*10 + patch", () => {
    expect(expectedVersionCode("1.6.0")).toBe(160);
    expect(expectedVersionCode("1.7.0")).toBe(170);
    expect(expectedVersionCode("2.0.3")).toBe(203);
    expect(expectedVersionCode("10.0.0")).toBe(1000);
  });

  it("rejects malformed versions", () => {
    expect(expectedVersionCode("1.6")).toBeNull();
    expect(expectedVersionCode("1.x.0")).toBeNull();
    expect(expectedVersionCode("")).toBeNull();
  });
});

describe("validateFdroidMetadata", () => {
  it("accepts a well-formed metadata object", () => {
    const res = validateFdroidMetadata(baseMeta());
    expect(res.errors, res.errors.join("; ")).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("rejects non-mapping input", () => {
    expect(validateFdroidMetadata(null).ok).toBe(false);
    expect(validateFdroidMetadata([1, 2]).ok).toBe(false);
    expect(validateFdroidMetadata("nope").ok).toBe(false);
  });

  it("requires every descriptive scalar", () => {
    for (const field of ["Name", "AutoName", "Summary", "Description", "License", "Repo"]) {
      const meta = baseMeta();
      delete meta[field];
      const res = validateFdroidMetadata(meta);
      expect(res.ok, `deleting ${field} must fail`).toBe(false);
      expect(res.errors.some((e: string) => e.includes(field)), field).toBe(true);
    }
  });

  it("pins the MIT license", () => {
    const meta = baseMeta();
    meta.License = "Apache-2.0";
    const res = validateFdroidMetadata(meta);
    expect(res.ok).toBe(false);
    expect(res.errors.join("; ")).toContain("License");
  });

  it("pins the canonical repository URL", () => {
    const meta = baseMeta();
    meta.Repo = "https://github.com/someone-else/infinitenote.git";
    const res = validateFdroidMetadata(meta);
    expect(res.ok).toBe(false);
    expect(res.errors.join("; ")).toContain("Repo");
  });

  it("enforces the versionCode scheme per build", () => {
    const meta = baseMeta();
    (meta.Builds as Array<{ versionCode: number }>)[0].versionCode = 7;
    const res = validateFdroidMetadata(meta);
    expect(res.ok).toBe(false);
    expect(res.errors.join("; ")).toContain("versionCode");
  });

  it("requires the commit to be the release tag or a full sha", () => {
    const meta = baseMeta();
    (meta.Builds as Array<{ commit: string }>)[0].commit = "main";
    const res = validateFdroidMetadata(meta);
    expect(res.ok).toBe(false);
    expect(res.errors.join("; ")).toContain("release tag");
    // a 40-char sha is acceptable (e.g. tag re-pointed scenarios)
    const meta2 = baseMeta();
    (meta2.Builds as Array<{ commit: string }>)[0].commit = "a".repeat(40);
    expect(validateFdroidMetadata(meta2).ok).toBe(true);
  });

  it("requires gradle + subdir on every build", () => {
    const meta = baseMeta();
    delete (meta.Builds as Array<Record<string, unknown>>)[0].gradle;
    expect(validateFdroidMetadata(meta).ok).toBe(false);
    const meta2 = baseMeta();
    delete (meta2.Builds as Array<Record<string, unknown>>)[0].subdir;
    expect(validateFdroidMetadata(meta2).ok).toBe(false);
  });

  it("rejects non-ascending or duplicate versionCodes", () => {
    const meta = baseMeta();
    meta.Builds = [
      { versionName: "1.7.0", versionCode: 170, commit: "v1.7.0", subdir: "android-twa", gradle: ["yes"] },
      { versionName: "1.6.0", versionCode: 160, commit: "v1.6.0", subdir: "android-twa", gradle: ["yes"] },
    ];
    const res = validateFdroidMetadata(meta);
    expect(res.ok).toBe(false);
    expect(res.errors.join("; ")).toContain("ascending");

    const dup = baseMeta();
    dup.Builds = [
      { versionName: "1.6.0", versionCode: 160, commit: "v1.6.0", subdir: "android-twa", gradle: ["yes"] },
      { versionName: "1.6.0", versionCode: 160, commit: "v1.6.0", subdir: "android-twa", gradle: ["yes"] },
    ];
    expect(validateFdroidMetadata(dup).ok).toBe(false);
  });

  it("rejects placeholder markers anywhere in the metadata", () => {
    const meta = baseMeta();
    meta.Summary = "TODO: write a summary";
    expect(validateFdroidMetadata(meta).ok).toBe(false);
  });

  it("warns on a too-short store description but still passes", () => {
    const meta = baseMeta();
    meta.Description = "Short.";
    const res = validateFdroidMetadata(meta);
    expect(res.ok).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);
  });
});

describe("docs/fdroid.md runbook", () => {
  const doc = read("docs/fdroid.md");

  it("exists and references the recipe + checker", () => {
    expect(doc).toContain("com.infinitenote.app.yml");
    expect(doc).toContain("scripts/fdroid-check.mjs");
  });

  it("documents the fdroidserver test-build and submission flow", () => {
    expect(doc).toContain("fdroid");
    expect(doc.toLowerCase()).toContain("submit");
    expect(doc.toLowerCase()).toContain("policy");
  });

  it("documents the versionCode scheme", () => {
    expect(doc).toContain("160");
  });
});
