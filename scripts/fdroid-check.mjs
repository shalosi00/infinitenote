#!/usr/bin/env node
/**
 * F-Droid metadata validator (issue #56).
 *
 * Parses packaging/fdroid/com.infinitenote.app.yml (Bun.YAML) and enforces
 * every invariant the F-Droid build pipeline (and our own release flow)
 * relies on:
 *
 *   - required descriptive fields (Name/Summary/Description/License/…)
 *   - License is exactly "MIT" (matches LICENSE and the AppStream metainfo)
 *   - Repo/SourceCode point at the canonical GitHub repository
 *   - every Build: semver versionName, integer versionCode on the scheme
 *     major*100 + minor*10 + patch (1.6.0 → 160 — the same scheme the TWA
 *     scaffold and assetlinks generator already pin), a commit/tag ref,
 *     and a gradle build declaration
 *   - Builds sorted ascending by versionCode, unique
 *   - no TODO/TBD/FIXME placeholders anywhere
 *
 * Usage:
 *   bun scripts/fdroid-check.mjs [path-to-yml]        # exit 0 = valid
 *   bun scripts/fdroid-check.mjs --json [path-to-yml] # machine-readable
 *
 * `validateFdroidMetadata` is exported for the unit tests
 * (src/lib/__tests__/fdroid-config.test.ts).
 */

import { readFileSync } from "node:fs";

const REQUIRED_SCALARS = [
  "Name",
  "AutoName",
  "Summary",
  "Description",
  "License",
  "SourceCode",
  "IssueTracker",
  "RepoType",
  "Repo",
];

const REPO_URL = "https://github.com/shalosi00/infinitenote";

/** The repo-wide Android versionCode scheme (mirrors android-twa docs). */
export function expectedVersionCode(versionName) {
  const parts = String(versionName).split(".");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [major, minor, patch] = parts.map(Number);
  return major * 100 + minor * 10 + patch;
}

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Validate a parsed metadata object. Returns { ok, errors, warnings } —
 * errors make the CLI exit 1; warnings are informational only.
 */
export function validateFdroidMetadata(meta) {
  const errors = [];
  const warnings = [];

  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return { ok: false, errors: ["metadata is not a YAML mapping"], warnings };
  }

  for (const field of REQUIRED_SCALARS) {
    const value = meta[field];
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`missing or empty required field: ${field}`);
    }
  }

  if (typeof meta.License === "string" && meta.License !== "MIT") {
    errors.push(`License must be "MIT" (got ${JSON.stringify(meta.License)})`);
  }
  for (const field of ["SourceCode", "Repo"]) {
    const value = meta[field];
    if (typeof value === "string" && !value.replace(/\.git$/, "").startsWith(REPO_URL)) {
      errors.push(`${field} must point at ${REPO_URL} (got ${JSON.stringify(value)})`);
    }
  }
  if ("RepoType" in meta && meta.RepoType !== "git") {
    errors.push(`RepoType must be "git" (got ${JSON.stringify(meta.RepoType)})`);
  }
  if (!Array.isArray(meta.Categories) || meta.Categories.length === 0) {
    errors.push("Categories must be a non-empty list");
  }
  if (typeof meta.Description === "string" && meta.Description.trim().length < 80) {
    warnings.push("Description is suspiciously short for a store listing");
  }

  // ---- Builds ------------------------------------------------------------
  if (!Array.isArray(meta.Builds) || meta.Builds.length === 0) {
    errors.push("Builds must be a non-empty list");
  } else {
    let prevCode = -Infinity;
    const seen = new Set();
    meta.Builds.forEach((build, i) => {
      const label = `Builds[${i}]`;
      if (typeof build !== "object" || build === null) {
        errors.push(`${label}: not a mapping`);
        return;
      }
      const { versionName, versionCode, commit } = build;
      if (typeof versionName !== "string" || !SEMVER.test(versionName)) {
        errors.push(`${label}: versionName must be X.Y.Z (got ${JSON.stringify(versionName)})`);
      }
      if (!Number.isInteger(versionCode)) {
        errors.push(`${label}: versionCode must be an integer (got ${JSON.stringify(versionCode)})`);
      }
      if (Number.isInteger(versionCode) && typeof versionName === "string" && SEMVER.test(versionName)) {
        const expected = expectedVersionCode(versionName);
        if (versionCode !== expected) {
          errors.push(
            `${label}: versionCode ${versionCode} does not match the scheme major*100+minor*10+patch = ${expected} for ${versionName}`
          );
        }
      }
      if (typeof commit !== "string" || commit.trim() === "") {
        errors.push(`${label}: missing commit/tag reference`);
      } else if (typeof versionName === "string" && SEMVER.test(versionName)) {
        const tag = `v${versionName}`;
        if (commit !== tag && !/^[0-9a-f]{40}$/.test(commit)) {
          errors.push(`${label}: commit must be the release tag "${tag}" or a full sha (got ${JSON.stringify(commit)})`);
        }
      }
      if (!build.gradle || (Array.isArray(build.gradle) && build.gradle.length === 0)) {
        errors.push(`${label}: missing gradle build declaration`);
      }
      if (!("subdir" in build) || typeof build.subdir !== "string" || build.subdir === "") {
        errors.push(`${label}: missing subdir (the Gradle project root)`);
      }
      if (Number.isInteger(versionCode)) {
        if (versionCode <= prevCode) {
          errors.push(`${label}: versionCode ${versionCode} must be greater than the previous build's (${prevCode}) — F-Droid expects ascending order`);
        }
        prevCode = versionCode;
        if (seen.has(versionCode)) {
          errors.push(`${label}: duplicate versionCode ${versionCode}`);
        }
        seen.add(versionCode);
      }
    });
  }

  // ---- placeholders -------------------------------------------------------
  const flattened = JSON.stringify(meta);
  for (const marker of ["TODO", "TBD", "FIXME", "XXX"]) {
    if (flattened.includes(marker)) {
      errors.push(`placeholder marker "${marker}" found in metadata`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Parse + validate a YAML file from disk. */
export function validateFdroidFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return { ok: false, errors: [`cannot read ${path}: ${err.message}`], warnings: [] };
  }
  let meta;
  try {
    meta = Bun.YAML.parse(raw);
  } catch (err) {
    return { ok: false, errors: [`YAML parse error: ${err.message}`], warnings: [] };
  }
  return validateFdroidMetadata(meta);
}

// ---- CLI entry ------------------------------------------------------------
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("fdroid-check.mjs") || process.argv[1].endsWith("fdroid-check"));

if (isMain) {
  const args = process.argv.slice(2).filter((a) => a !== "--json");
  const json = args.length !== process.argv.slice(2).length;
  const path = args[0] ?? "packaging/fdroid/com.infinitenote.app.yml";
  const result = validateFdroidFile(path);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const w of result.warnings) console.log(`warning: ${w}`);
    if (result.ok) {
      console.log(`OK: ${path} passes all F-Droid metadata checks`);
    } else {
      for (const e of result.errors) console.error(`error: ${e}`);
      console.error(`FAIL: ${path} has ${result.errors.length} problem(s)`);
    }
  }
  process.exit(result.ok ? 0 : 1);
}
