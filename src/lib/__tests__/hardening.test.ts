/// <reference types="bun-types" />
/**
 * Bug-hunt wave 2, PR 6 — hardening:
 * - #100 addTagWithResult statuses (silent cap → user feedback)
 * - #102 the e2e test hooks are dev-only (no prod backdoor)
 * - #86 SyncFormatError carries stable locale-independent codes
 * - #103 the vendored pdf.worker matches the pinned pdfjs-dist version
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  addTagWithResult,
  MAX_TAGS_PER_PAGE,
  normalizeTags,
} from "../tags";
import { e2eHooksEnabled } from "../e2e-gate";
import { parseSyncFolder, SyncFormatError, type SyncErrorCode } from "../sync/format";

const REPO_ROOT = join(__dirname, "../../..");

describe("addTagWithResult (issue #100)", () => {
  it("reports added / duplicate / invalid", () => {
    const tags: string[] = [];
    expect(addTagWithResult(tags, "work")).toEqual({
      tags: ["work"],
      status: "added",
    });
    expect(addTagWithResult(["work"], "WORK").status).toBe("duplicate");
    expect(addTagWithResult(["work"], "   ").status).toBe("invalid");
  });

  it("reports capped when the page is at the maximum", () => {
    const full = normalizeTags(
      Array.from({ length: MAX_TAGS_PER_PAGE }, (_, i) => `tag-${i}`),
    );
    expect(full).toHaveLength(MAX_TAGS_PER_PAGE);
    const result = addTagWithResult(full, "one-more");
    expect(result.status).toBe("capped");
    expect(result.tags).toBe(full); // unchanged reference
  });
});

describe("e2e hook gate (issue #102)", () => {
  it("installs only in e2e-enabled builds AND with the ?e2e param", () => {
    expect(e2eHooksEnabled("?e2e=1", "1")).toBe(true);
    expect(e2eHooksEnabled("", "1")).toBe(false); // param still required
    expect(e2eHooksEnabled("?e2e=1", undefined)).toBe(false); // normal prod build
    expect(e2eHooksEnabled("?e2e=1", "")).toBe(false); // flag not set at build time
  });
});

describe("SyncFormatError codes (issue #86)", () => {
  it("carries a stable code for every malformed-folder case", () => {
    const cases: Array<[Record<string, string>, SyncErrorCode]> = [
      [{}, "noManifest"], // not even empty files — no manifest
      [{ "manifest.json": "{oops" }, "badManifest"],
      [
        {
          "manifest.json": JSON.stringify({
            app: "other",
            format: "sync-folder",
            version: 1,
            notebooks: [],
            sections: [],
            pages: [],
          }),
        },
        "badManifest",
      ],
      [
        {
          "manifest.json": JSON.stringify({
            app: "infinitenote",
            format: "sync-folder",
            version: 99,
            notebooks: [],
            sections: [],
            pages: [],
          }),
        },
        "badVersion",
      ],
      [
        {
          "manifest.json": JSON.stringify({
            app: "infinitenote",
            format: "sync-folder",
            version: 1,
            notebooks: [],
            sections: [],
            pages: [],
          }),
          "pages/bad.json": "{nope",
        },
        "badPageFile",
      ],
      [
        {
          "manifest.json": JSON.stringify({
            app: "infinitenote",
            format: "sync-folder",
            version: 1,
            notebooks: [],
            sections: [],
            pages: [],
          }),
          "trash.jsonl": "{garbage}\n",
        },
        "badTrash",
      ],
    ];
    for (const [files, expectedCode] of cases) {
      try {
        parseSyncFolder(files);
        throw new Error(`expected SyncFormatError for ${expectedCode}`);
      } catch (err) {
        expect(err).toBeInstanceOf(SyncFormatError);
        expect((err as SyncFormatError).code).toBe(expectedCode);
      }
    }
  });

  it("accepts a well-formed folder", () => {
    const manifest = {
      app: "infinitenote",
      format: "sync-folder",
      version: 1,
      exportedAt: 1,
      notebooks: [],
      sections: [],
      pages: [],
    };
    const parsed = parseSyncFolder({ "manifest.json": JSON.stringify(manifest) });
    expect(parsed.manifest.app).toBe("infinitenote");
  });
});

describe("pdfjs worker version pin (issue #103)", () => {
  it("pdfjs-dist is pinned exactly (no floating range)", () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    const spec = pkg.dependencies["pdfjs-dist"];
    expect(spec).toMatch(/^\d+\.\d+\.\d+$/); // exact — no ^, ~ or bare major
  });

  it("the vendored worker's version marker matches the pinned dependency", () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    const pinned = pkg.dependencies["pdfjs-dist"];
    const worker = readFileSync(
      join(REPO_ROOT, "public/pdf.worker.min.mjs"),
      "utf8",
    );
    const marker = worker.match(/"(\d+\.\d+\.\d+)"/);
    expect(marker?.[1]).toBe(pinned);
  });
});
