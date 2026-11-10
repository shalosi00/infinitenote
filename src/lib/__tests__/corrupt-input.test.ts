/// <reference types="bun-types" />
/**
 * Corrupt-input hardening wave — "test unexpected cases like humans do".
 *
 * The sync folder and the backup file are documented, human-inspectable
 * JSON ("see and rescue your data with a text editor"), so hand-edits are
 * an EXPECTED input source, not an attack: a user fixes a typo in a page
 * file, forgets the brackets on "tags": "work", truncates a scene while
 * rescuing data, restores a backup from a text editor. Every test here
 * replays one of those human mistakes end-to-end and pins the contract:
 * degrade visibly (drop the bad field / throw a typed error naming the
 * file) — never crash the sidebar, the search dialog or the import batch
 * with an unattributed TypeError.
 *
 * Companion fixes: search.ts, tags.ts, sync/format.ts,
 * excalidraw-utils.ts (parseSceneFileText), notes-db.ts (restoreBackup).
 * Issue #183.
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { extractSearchableText, buildSearchIndex, searchIndex } from "../search";
import {
  addTagWithResult,
  collectTags,
  normalizeTags,
  pageHasTag,
  removeTag,
  safeTags,
} from "../tags";
import { parseSceneFileText } from "../excalidraw-utils";
import {
  buildSyncFolderFiles,
  parseSyncFolder,
  pageFilePath,
  SyncFormatError,
  type LibrarySnapshot,
} from "../sync/format";
import type { Notebook, PageMeta, Section } from "../types";

/* ------------------------------------------------------------------ */
/* shared fixtures                                                     */
/* ------------------------------------------------------------------ */

const nb: Notebook = { id: "nb1", name: "NB", color: "violet", order: 1, createdAt: 1, updatedAt: 1, deletedAt: null };
const sec: Section = { id: "s1", notebookId: "nb1", name: "S", order: 1, createdAt: 1, updatedAt: 1, deletedAt: null };

const page = (over: Record<string, unknown> = {}): PageMeta & { content: string | null } =>
  ({
    id: "p1",
    sectionId: "s1",
    title: "Page One",
    order: 1,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    content: null,
    ...over,
  }) as PageMeta & { content: string | null };

const manifestJson = JSON.stringify({
  app: "infinitenote",
  format: "sync-folder",
  version: 1,
  exportedAt: 1,
  notebooks: [],
  sections: [],
  pages: [],
});

/** A sync folder whose single page file carries arbitrary extra fields. */
const folderWithPage = (extra: Record<string, unknown>): Record<string, string> => ({
  "manifest.json": manifestJson,
  "pages/p1.json": JSON.stringify({
    id: "p1",
    sectionId: "s1",
    title: "T",
    order: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }),
});

const expectBadPageFile = (files: Record<string, string>, pathHint: string): void => {
  try {
    parseSyncFolder(files);
    expect.unreachable("parseSyncFolder must reject the corrupt page file");
  } catch (e) {
    expect(e).toBeInstanceOf(SyncFormatError);
    expect((e as SyncFormatError).code).toBe("badPageFile");
    expect((e as Error).message).toContain(pathHint);
  }
};

/* ------------------------------------------------------------------ */
/* 1. safeTags — the coercion boundary every tag consumer goes through */
/* ------------------------------------------------------------------ */

describe("safeTags — coerce anything into a clean string[]", () => {
  it("passes a well-formed string[] through unchanged", () => {
    expect(safeTags(["work", "Ideas"])).toEqual(["work", "Ideas"]);
  });

  it("drops non-string entries and keeps the string ones in order", () => {
    expect(safeTags([1, "a", null, "b", undefined, true, {}, ["x"]])).toEqual(["a", "b"]);
  });

  it("returns [] for every plausible hand-edit mistake", () => {
    // "tags": "work" — the classic forgotten brackets
    expect(safeTags("work")).toEqual([]);
    // "tags": {"length": 5} — an object, not an array
    expect(safeTags({ length: 5 })).toEqual([]);
    expect(safeTags(42)).toEqual([]);
    expect(safeTags(null)).toEqual([]);
    expect(safeTags(undefined)).toEqual([]);
    expect(safeTags(true)).toEqual([]);
  });

  it("is the contract the crash probes pinned: iterability must never be assumed", () => {
    for (const junk of ["work", 42, { length: 5 }, null]) {
      // the old code did `for (const t of tags)` / `...tags` directly —
      // each of these values threw or iterated characters
      expect(() => [...safeTags(junk as unknown as string[])]).not.toThrow();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. search — one corrupt page must never take the dialog down        */
/* ------------------------------------------------------------------ */

describe("extractSearchableText — shape-corrupt scene JSON", () => {
  it("returns [] for a non-array elements value instead of throwing", () => {
    // found by hand-editing a sync page file's scene field; each of these
    // crashed with "TypeError: number/object/boolean is not iterable"
    expect(extractSearchableText('{"elements":42}')).toEqual([]);
    expect(extractSearchableText('{"elements":{}}')).toEqual([]);
    expect(extractSearchableText('{"elements":true}')).toEqual([]);
    expect(extractSearchableText('{"elements":"ab"}')).toEqual([]);
  });

  it("returns [] when the JSON root is not even an object", () => {
    expect(extractSearchableText("42")).toEqual([]);
    expect(extractSearchableText('"hello"')).toEqual([]);
    expect(extractSearchableText("null")).toEqual([]);
    expect(extractSearchableText("[]")).toEqual([]);
  });

  it("returns [] for missing elements, unparseable text, null and empty input", () => {
    expect(extractSearchableText("{}")).toEqual([]);
    expect(extractSearchableText("{oops")).toEqual([]);
    expect(extractSearchableText(null)).toEqual([]);
    expect(extractSearchableText(undefined)).toEqual([]);
    expect(extractSearchableText("")).toEqual([]);
  });

  it("skips junk element entries but still extracts the good ones", () => {
    const scene = JSON.stringify({
      elements: [null, 42, "str", { type: "text", text: "real content" }, { text: "" }],
    });
    expect(extractSearchableText(scene)).toEqual(["real content"]);
  });

  it("still reads every recognized carrier (text, audio, pdf, ocr, handwriting)", () => {
    const scene = JSON.stringify({
      elements: [
        { type: "text", text: "body text" },
        { type: "embeddable", customData: { audioName: "interview.mp3" } },
        { type: "embeddable", customData: { pdfName: "contract.pdf" } },
        { type: "image", customData: { ocrText: "scanned words" } },
        { type: "freedraw", customData: { hwrText: "handwritten note" } },
      ],
    });
    expect(extractSearchableText(scene)).toEqual([
      "body text",
      "interview.mp3",
      "contract.pdf",
      "scanned words",
      "handwritten note",
    ]);
  });
});

describe("buildSearchIndex — corrupt tags and content degrade, not crash", () => {
  it("indexes a page whose tags are a hand-edited string", () => {
    const idx = buildSearchIndex([nb], [sec], [
      page({ tags: "work" as unknown as string[] }),
    ]);
    expect(idx[0].haystack).toEqual(["Page One"]); // no stray single chars
  });

  it("indexes a page whose tags are an object with a length key (old spread crash)", () => {
    expect(() =>
      buildSearchIndex([nb], [sec], [page({ tags: { length: 5 } as unknown as string[] })]),
    ).not.toThrow();
  });

  it("keeps the valid string tags of a mixed junk array", () => {
    const idx = buildSearchIndex([nb], [sec], [
      page({ tags: [1, "work", null] as unknown as string[] }),
    ]);
    expect(idx[0].haystack).toEqual(["Page One", "work"]);
  });

  it("a corrupt page does not stop its healthy sibling from being found", () => {
    const idx = buildSearchIndex([nb], [sec], [
      page({ id: "bad", title: "Corrupt", content: '{"elements":42}' }),
      page({ id: "good", title: "Healthy", content: JSON.stringify({ elements: [{ type: "text", text: "needle here" }] }) }),
    ]);
    const hits = searchIndex(idx, "needle");
    expect(hits.map((h) => h.pageId)).toEqual(["good"]);
  });
});

/* ------------------------------------------------------------------ */
/* 3. sidebar tag surfaces — corrupt rows render partially, not never  */
/* ------------------------------------------------------------------ */

describe("tag surfaces with corrupt rows", () => {
  it("collectTags counts only the string tags across junk rows", () => {
    const pages = [
      { tags: "work" as unknown as string[] }, // forgotten brackets
      { tags: [1, "a"] as unknown as string[] }, // numbers
      { tags: { length: 5 } as unknown as string[] }, // old for-of crash
      { tags: undefined },
      { tags: ["A"] },
    ];
    expect(collectTags(pages as Array<{ tags?: string[] }>)).toEqual([{ tag: "a", count: 2 }]);
  });

  it("pageHasTag ignores junk entries and stays case-insensitive", () => {
    expect(pageHasTag(["WORK", 1] as unknown as string[], "work")).toBe(true);
    expect(pageHasTag(["x", 2] as unknown as string[], "y")).toBe(false);
    expect(pageHasTag(undefined, "x")).toBe(false);
    expect(pageHasTag("work" as unknown as string[], "work")).toBe(false);
  });

  it("removeTag drops matches case-insensitively and filters junk", () => {
    expect(removeTag(["Keep", "WORK", 1] as unknown as string[], "work")).toEqual(["Keep"]);
  });

  it("normalizeTags ignores non-string entries instead of crashing on .replace", () => {
    expect(normalizeTags(["a", 1, null, "a", " b "] as unknown as string[])).toEqual(["a", "b"]);
  });

  it("addTagWithResult repairs a corrupt list while adding", () => {
    const res = addTagWithResult([1, "work"] as unknown as string[], "new");
    expect(res.status).toBe("added");
    expect(res.tags).toEqual(["work", "new"]);
  });

  it("addTagWithResult still detects duplicates against a corrupt list", () => {
    expect(addTagWithResult(["WORK", 1] as unknown as string[], "work").status).toBe("duplicate");
  });

  it("addTagWithResult cap semantics are unchanged for clean input (regression pin)", () => {
    const full = normalizeTags(Array.from({ length: 12 }, (_, i) => `t${i}`));
    expect(addTagWithResult(full, "one-more").status).toBe("capped");
    expect(addTagWithResult([], "first").status).toBe("added");
  });

  it("addTagWithResult reports capped — not a false 'added' — when imported data already exceeds the cap (deferred finding, 2026-11-10 sweep)", () => {
    // 15 tags can only arrive via imported/persisted rows; the old code
    // said "added" while the normalize cap silently dropped the new tag
    const over = normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`)).concat(
      Array.from({ length: 3 }, (_, i) => `extra-${i}`),
    );
    const res = addTagWithResult(over, "brand-new");
    expect(res.status).toBe("capped");
    expect(res.tags).toBe(over); // untouched — nothing silently truncated
  });
});

/* ------------------------------------------------------------------ */
/* 4. parseSyncFolder — hand-edited page files                         */
/* ------------------------------------------------------------------ */

describe("parseSyncFolder — malformed tags degrade to absent", () => {
  it('drops a "tags": "work" string (the classic forgotten brackets)', () => {
    const parsed = parseSyncFolder(folderWithPage({ scene: null, tags: "work" }));
    expect(parsed.pages.get("p1")?.tags).toBeUndefined();
  });

  it('keeps only the string entries of "tags": [1, "a", null]', () => {
    const parsed = parseSyncFolder(folderWithPage({ scene: null, tags: [1, "a", null] }));
    expect(parsed.pages.get("p1")?.tags).toEqual(["a"]);
  });

  it("treats an empty or junk-only tags array as absent", () => {
    expect(parseSyncFolder(folderWithPage({ scene: null, tags: [] })).pages.get("p1")?.tags).toBeUndefined();
    expect(parseSyncFolder(folderWithPage({ scene: null, tags: [1, 2] })).pages.get("p1")?.tags).toBeUndefined();
  });

  it("accepts well-formed tags untouched", () => {
    const parsed = parseSyncFolder(folderWithPage({ scene: null, tags: ["work", "Ideas"] }));
    expect(parsed.pages.get("p1")?.tags).toEqual(["work", "Ideas"]);
  });
});

describe("parseSyncFolder — malformed scene fails fast as badPageFile", () => {
  it("rejects a type-confused scene value, naming the file", () => {
    for (const scene of [42, "text", true, []]) {
      expectBadPageFile(folderWithPage({ scene }), "pages/p1.json");
    }
  });

  it('rejects {"elements": 42} — the value that used to crash the search index later', () => {
    expectBadPageFile(folderWithPage({ scene: { elements: 42 } }), "pages/p1.json");
  });

  it('rejects a non-object "files" inside an otherwise fine scene', () => {
    expectBadPageFile(folderWithPage({ scene: { elements: [], files: 7 } }), "pages/p1.json");
    expectBadPageFile(folderWithPage({ scene: { elements: [], files: [1] } }), "pages/p1.json");
  });

  it("names the RIGHT file when only one page file of several is corrupt", () => {
    const files: Record<string, string> = {
      "manifest.json": manifestJson,
      "pages/good.json": JSON.stringify({ id: "good", sectionId: "s1", title: "G", order: 1, createdAt: 1, updatedAt: 1, scene: null }),
      "pages/bad.json": JSON.stringify({ id: "bad", sectionId: "s1", title: "B", order: 2, createdAt: 1, updatedAt: 1, scene: 42 }),
    };
    expectBadPageFile(files, "pages/bad.json");
  });

  it("accepts the minimal hand-written scenes a rescuing user would type", () => {
    // undefined = the key omitted entirely — the documented minimal page file
    for (const scene of [undefined, null, {}, { elements: [] }, { files: {} }]) {
      const parsed = parseSyncFolder(folderWithPage({ scene }));
      expect(parsed.pages.get("p1")).toBeDefined();
    }
  });

  it("round-trips a real scene through content, elements first", () => {
    const scene = { elements: [{ type: "text", text: "hi" }], files: {} };
    const parsed = parseSyncFolder(folderWithPage({ scene }));
    expect(parsed.pages.get("p1")?.content).toBe(JSON.stringify(scene));
  });
});

describe("parseSyncFolder — the app's own writer still passes its own validator", () => {
  it("buildSyncFolderFiles output parses back with tags and content intact", () => {
    const snapshot: LibrarySnapshot = {
      notebooks: [nb],
      sections: [sec],
      pages: [
        {
          ...page(),
          content: JSON.stringify({ elements: [{ type: "text", text: "body" }], files: {} }),
          tags: ["work"],
        },
      ],
    };
    const files = buildSyncFolderFiles(snapshot, [], 5);
    const parsed = parseSyncFolder(files);
    const row = parsed.pages.get("p1");
    expect(row?.tags).toEqual(["work"]);
    expect(row?.content).toBe(snapshot.pages[0].content);
    // and the reconstructed row feeds the search index without a scratch
    const idx = buildSearchIndex([nb], [sec], [row! as PageMeta & { content: string | null }]);
    expect(searchIndex(idx, "body").map((h) => h.pageId)).toEqual(["p1"]);
  });

  it("a corrupt-legacy content row (unparseable JSON) still exports and reparses as null scene", () => {
    const snapshot: LibrarySnapshot = {
      notebooks: [nb],
      sections: [sec],
      pages: [{ ...page(), content: "{corrupt legacy", tags: undefined }],
    };
    const files = buildSyncFolderFiles(snapshot, [], 5);
    const parsed = parseSyncFolder(files);
    expect(parsed.pages.get("p1")?.content).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 5. .excalidraw scene import — truncated / renamed files             */
/* ------------------------------------------------------------------ */

describe("parseSceneFileText — the import seam", () => {
  it("accepts the minimal scene and defaults files to {}", () => {
    expect(parseSceneFileText('{"elements":[]}')).toEqual({ elements: [], files: {}, appState: undefined });
  });

  it("passes elements, files and appState through untouched", () => {
    const text = JSON.stringify({
      elements: [{ type: "rectangle", id: "r1" }],
      files: { f1: { dataURL: "x" } },
      appState: { viewBackgroundColor: "#fff" },
    });
    expect(parseSceneFileText(text)).toEqual({
      elements: [{ type: "rectangle", id: "r1" }],
      files: { f1: { dataURL: "x" } },
      appState: { viewBackgroundColor: "#fff" },
    });
  });

  it("treats a missing elements key as empty and a missing files key as {}", () => {
    expect(parseSceneFileText("{}")).toEqual({ elements: [], files: {}, appState: undefined });
  });

  it("says WHY a truncated file fails (the download that never finished)", () => {
    try {
      parseSceneFileText('{"elements":[{"type":"text"');
      expect.unreachable("must throw");
    } catch (e) {
      expect((e as Error).message).toContain("not valid JSON");
    }
  });

  it("rejects non-object roots with a clear reason (the renamed binary)", () => {
    for (const root of ["42", '"a string"', "[]", "null", "true"]) {
      try {
        parseSceneFileText(root);
        expect.unreachable(`root ${root} must throw`);
      } catch (e) {
        expect((e as Error).message).toContain("the root must be a scene object");
      }
    }
  });

  it('rejects "elements": 42 and "files": 7 with field-specific messages', () => {
    expect(() => parseSceneFileText('{"elements":42}')).toThrow('"elements" must be an array');
    expect(() => parseSceneFileText('{"files":7}')).toThrow('"files" must be an object');
    expect(() => parseSceneFileText('{"files":[1]}')).toThrow('"files" must be an object');
  });

  it("accepts junk element objects as-is — the envelope is the seam, restore() sanitizes elements", () => {
    const parsed = parseSceneFileText('{"elements":[null,42,"x"]}');
    expect(parsed.elements).toEqual([null, 42, "x"]);
  });
});

/* ------------------------------------------------------------------ */
/* 6. restoreBackup — hand-edited backup JSON                          */
/* ------------------------------------------------------------------ */

describe("restoreBackup — hand-edited tags and content restore as absent", () => {
  let notes: typeof import("../notes-db");

  beforeAll(async () => {
    await import("fake-indexeddb/auto");
    notes = await import("../notes-db");
  });

  beforeEach(async () => {
    await notes.db.delete();
    await new Promise((r) => setTimeout(r, 25));
    await notes.db.open();
  });

  const backupWithPage = (pageFields: Record<string, unknown>): string =>
    JSON.stringify({
      app: "infinitenote",
      notebooks: [
        {
          name: "Rescued",
          color: "violet",
          sections: [{ name: "S", pages: [{ title: "P", ...pageFields }] }],
        },
      ],
    });

  it('restores a page whose "tags" is a string and whose "content" is a number', async () => {
    const restored = await notes.restoreBackup(backupWithPage({ tags: "work", content: 42 }));
    expect(restored).toBe(1);
    const pages = await notes.listPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].tags).toBeUndefined();
    expect(await notes.getPageContent(pages[0].id)).toBeNull();
  });

  it('keeps the valid entries of "tags": [1, "work", null]', async () => {
    await notes.restoreBackup(backupWithPage({ tags: [1, "work", null], content: null }));
    const pages = await notes.listPages();
    expect(pages[0].tags).toEqual(["work"]);
  });

  it("restored rows feed the sidebar and search surfaces without throwing", async () => {
    await notes.restoreBackup(
      backupWithPage({ tags: { length: 5 } as unknown as string[], content: '{"elements":42}' }),
    );
    const pages = await notes.listPages();
    expect(() => collectTags(pages)).not.toThrow();
    const withContent = await Promise.all(
      pages.map(async (p) => ({ ...p, content: await notes.getPageContent(p.id).then((s) => (s ? JSON.stringify(s) : null)) })),
    );
    expect(() => buildSearchIndex([nb], [sec], withContent)).not.toThrow();
  });
});
