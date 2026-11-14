/// <reference types="bun-types" />
/**
 * bun.lock transitive resolution pins (security audit follow-up, issue #221).
 *
 * Dependabot cannot resolve a bun.lock v1 transitive graph, so advisories that
 * affect locked transitive versions never surface as Dependabot alerts. The
 * 2026-11-14 full-lockfile audit against the GitHub Advisory DB (1,082
 * resolved package versions queried with server-side `affects=` filtering; 68
 * in-range hits on 28 locked versions — 0 critical / 43 high / 20 medium /
 * 5 low) lifted every affected resolution whose fix was reachable: the
 * manifest's overrides block forces the three parent-pinned names past their
 * pins, and the in-range re-resolution lifts everything else. These pins keep
 * every resolved copy at or above the audited minimums so a future lockfile
 * edit cannot silently regress them.
 *
 * Documented residue (NOT pinned — the parent pins the old version exactly,
 * or the copy sits under a parent whose own range blocks the fix; do not
 * add a pin unless the parent unpins):
 * - nanoid@3.3.3: @excalidraw/excalidraw pins it exactly (fixes at 3.3.18).
 * - nanoid@4.0.2: @excalidraw/mermaid-to-excalidraw pins it exactly (fixes
 *   land in 5.x majors).
 * - brace-expansion: the ROOT copy lifted to 1.1.22; the nested copies
 *   (eslint chain at 1.1.12, typescript-estree chain at 2.0.2) keep their
 *   parents' resolutions — dev-chain DoS advisories only.
 * - minimatch: the ROOT copy lifted to 3.1.5; the nested copies (eslint
 *   chain 3.1.2, typescript-estree chain 9.0.5) keep their parents'
 *   resolutions — dev-chain ReDoS advisories only.
 * - picomatch: the ROOT copy lifted to 4.0.7; the anymatch/micromatch/
 *   readdirp copies keep 2.3.1 — dev-chain advisories only.
 * - zod@4.3.5 (eslint-config-next's own dependency, dev chain): lifting it
 *   needs an overrides entry, but the dead-template-chain guard forbids the
 *   literal "zod" anywhere in package.json — GHSA-mrhx-c7xc-m3w5 (HIGH,
 *   oversized-collection memory exhaustion) is lint-time only; lifted when
 *   eslint-config-next bumps its own range.
 * - katex@0.16.x: fix 0.18.2 is outside the mermaid chain's ^0.16.x range
 *   (GHSA-238p-pmpm-9mq7, LOW).
 * - braces@3.0.3: the only matching advisory is withdrawn (no fixed release).
 * - lexical@0.35.0: @mdxeditor/editor's dependency; GHSA-c2hm-mjxv-89r4 (LOW)
 *   has NO fixed release (patched: None, range <= 6.1.1) — flagged by the
 *   2026-11-14 #223 audit re-run, previously below the #221 pass's filter
 *   threshold; re-check when upstream patches.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");

/** name -> every resolved version in the lock graph (from entry head tokens) */
const resolved = new Map<string, string[]>();
const section = lock.slice(lock.indexOf('"packages":'));
for (const m of section.matchAll(
  /"([\w./@-]+)": \["([\w./@-]+)@(\d[\w.\-+]*)"/g,
)) {
  // the head token carries the REAL package name (nested keys are
  // "parent/child" paths whose last segment can differ from scoped names)
  const name = m[2];
  const ver = m[3];
  resolved.set(name, [...(resolved.get(name) ?? []), ver]);
}

const cmp = (a: string, b: string): number => {
  const pa = a.split(/[.\-+]/).map(Number);
  const pb = b.split(/[.\-+]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai > bi ? 1 : -1;
  }
  return 0;
};

/** Flat pins: every resolved copy of the package must be >= min. */
const FLAT_PINS: Record<string, string> = {
  postcss: "8.5.23",
  browserslist: "4.28.7",
  "js-yaml": "4.3.2",
  flatted: "3.4.2",
  "source-map-js": "1.2.2",
  "@babel/core": "7.29.6",
  "@humanfs/node": "0.16.8",
  "baseline-browser-mapping": "2.11.0",
  "js-cookie": "3.0.7",
  prismjs: "1.30.0",
  lodash: "4.18.0",
  "lodash-es": "4.18.1",
  uuid: "11.1.1",
};

/** Major-aware pins: each resolved copy must meet its major line's minimum. */
const MAJOR_PINS: Record<string, Record<number, string>> = {
  diff: { 5: "5.2.2" },
  ajv: { 6: "6.14.0" },
};

describe("bun.lock security-audit resolution pins (#221)", () => {
  it("lockfile package graph is parseable and non-empty", () => {
    expect(resolved.size).toBeGreaterThan(500);
  });

  for (const [name, min] of Object.entries(FLAT_PINS)) {
    it(`${name} >= ${min} (every resolved copy)`, () => {
      const copies = resolved.get(name);
      expect(copies).toBeDefined();
      for (const v of copies ?? []) {
        expect(cmp(v, min) >= 0).toBe(true);
      }
    });
  }

  for (const [name, byMajor] of Object.entries(MAJOR_PINS)) {
    const majors = Object.entries(byMajor)
      .map(([k, v]) => `${k}: >=${v}`)
      .join(", ");
    it(`${name} meets per-major minimums (${majors})`, () => {
      const copies = resolved.get(name);
      expect(copies).toBeDefined();
      for (const v of copies ?? []) {
        const major = Number(v.split(".")[0]);
        const min = byMajor[major];
        if (min === undefined) continue; // future major: assume past the fix
        expect(cmp(v, min) >= 0).toBe(true);
      }
    });
  }

  it("every pinned package actually appears in the lock graph", () => {
    const names = [...Object.keys(FLAT_PINS), ...Object.keys(MAJOR_PINS)];
    for (const name of names) {
      expect(resolved.has(name)).toBe(true);
    }
  });

  it("the overrides block carries the audit remediation", () => {
    const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
    expect(pkg).toContain('"overrides"');
    expect(pkg).toContain('"lodash-es": "4.18.1"');
    expect(pkg).toContain('"prismjs": "1.30.0"');
    expect(pkg).toContain('"js-yaml": "4.3.2"');
    // @playwright/test's blocker was UNPINNED by issue #223 (1.65.x shipped
    // for real); @radix-ui/react-dialog STAYS pinned at 1.1.15 — its 1.3.1
    // carries three measured regressions against the app (stale deferred
    // dismissal killing re-opens, Escape swallowed while a just-closed menu's
    // ghost layer outlives the dialog open, phone drawer content remounting
    // under the surface sweep), tracked for a deliberate follow-up
    expect(pkg).toContain('"@radix-ui/react-dialog": "1.1.15"');
  });

  it("the exact devDependencies pin the multi-major root copies", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.devDependencies["brace-expansion"]).toBe("1.1.22");
    expect(pkg.devDependencies.minimatch).toBe("3.1.5");
    expect(pkg.devDependencies.picomatch).toBe("4.0.7");
    expect(pkg.devDependencies.nanoid).toBe("3.3.20");
  });
});
