/// <reference types="bun-types" />
/**
 * Web Share Target inbox tests (issue #247).
 *
 * Three layers:
 *  1. the pure composition helpers (body text, page title, File building);
 *  2. the raw-IndexedDB mailbox against fake-indexeddb (stash → drain in
 *     stash order, drain clears, malformed rows are dropped, drain on an
 *     empty mailbox is a no-op []);
 *  3. cross-file consistency pins — the service worker is a standalone
 *     classic script that mirrors the share-inbox constants, so the test
 *     asserts the manifest, sw.js, the fallback page and the app module
 *     all agree (they cannot import each other).
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

type SharedEntry = import("../share-inbox").SharedEntry;

let inbox: typeof import("../share-inbox");

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  inbox = await import("../share-inbox");
});

/* ------------------------- 1. pure composition ------------------------- */

describe("shareBodyText", () => {
  it("joins text and url as two paragraphs", () => {
    expect(
      inbox.shareBodyText({ text: "A note from the share sheet", url: "https://example.com/a" })
    ).toBe("A note from the share sheet\n\nhttps://example.com/a");
  });

  it("trims parts and drops empty ones (url-only share keeps the link)", () => {
    expect(inbox.shareBodyText({ text: "   ", url: " https://example.com/b " })).toBe(
      "https://example.com/b"
    );
    expect(inbox.shareBodyText({ text: "only text", url: "" })).toBe("only text");
  });

  it("is empty when the share carries no body", () => {
    expect(inbox.shareBodyText({ text: "", url: "" })).toBe("");
  });
});

describe("isEmptyShare", () => {
  it("is true only when nothing capturable is present", () => {
    expect(inbox.isEmptyShare({ title: "", text: "", url: "", files: [] })).toBe(true);
    expect(inbox.isEmptyShare({ title: "  ", text: "  ", url: "", files: [] })).toBe(true);
  });

  it("is false for a title-only share (OneNote behavior: a share produces a page)", () => {
    expect(inbox.isEmptyShare({ title: "Just a title", text: "", url: "", files: [] })).toBe(false);
  });

  it("is false for text, url or files", () => {
    expect(inbox.isEmptyShare({ title: "", text: "hi", url: "", files: [] })).toBe(false);
    expect(inbox.isEmptyShare({ title: "", text: "", url: "https://x", files: [] })).toBe(false);
    expect(
      inbox.isEmptyShare({
        title: "",
        text: "",
        url: "",
        files: [{ name: "a.png", type: "image/png", blob: new Blob(["x"]) }],
      })
    ).toBe(false);
  });
});

describe("sharePageTitle", () => {
  it("uses the shared title when present", () => {
    expect(inbox.sharePageTitle({ title: " Field survey " }, "Quick note 1")).toBe("Field survey");
  });

  it("falls back to the quick-note title when the share has none", () => {
    expect(inbox.sharePageTitle({ title: "   " }, "Quick note 2")).toBe("Quick note 2");
    expect(inbox.sharePageTitle({ title: "" }, "Quick note 3")).toBe("Quick note 3");
  });

  it("hard-caps runaway titles at the cap (ellipsis-terminated)", () => {
    const long = "x".repeat(10_000);
    const title = inbox.sharePageTitle({ title: long }, "fallback");
    expect(title.length).toBe(80);
    expect(title.endsWith("…")).toBe(true);
    // default cap 80 — a 10k-char share title must not blow the sidebar layout
    expect(inbox.sharePageTitle({ title: "y".repeat(80) }, "fallback").length).toBe(80);
    expect(inbox.sharePageTitle({ title: "z".repeat(79) }, "fallback").length).toBe(79);
  });
});

describe("sharedEntryToFiles", () => {
  it("wraps the composed body as the synthetic text file", () => {
    const files = inbox.sharedEntryToFiles({
      title: "",
      text: "shared body",
      url: "https://example.com",
      files: [],
      receivedAt: 0,
    });
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe(inbox.SHARE_TEXT_FILENAME);
    // bun's File constructor normalizes text/plain to "text/plain;charset=utf-8";
    // browsers keep the passed type verbatim — both land the "text" import kind
    expect(files[0].type).toMatch(/^text\/plain/);
  });

  it("passes shared files through with their name and type", async () => {
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    const files = inbox.sharedEntryToFiles({
      title: "",
      text: "",
      url: "",
      files: [{ name: "shot.png", type: "image/png", blob: png }],
      receivedAt: 0,
    });
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("shot.png");
    expect(files[0].type).toBe("image/png");
    expect(await files[0].arrayBuffer()).toEqual(await png.arrayBuffer());
  });

  it("produces body text AND files in one entry, body first", () => {
    const files = inbox.sharedEntryToFiles({
      title: "t",
      text: "body",
      url: "https://e",
      files: [{ name: "a.txt", type: "text/plain", blob: new Blob(["a"]) }],
      receivedAt: 0,
    });
    expect(files.map((f) => f.name)).toEqual([inbox.SHARE_TEXT_FILENAME, "a.txt"]);
  });

  it("produces no file for a body-less, file-less entry (drain skips those)", () => {
    const files = inbox.sharedEntryToFiles({
      title: "t",
      text: "",
      url: "",
      files: [],
      receivedAt: 0,
    });
    expect(files).toHaveLength(0);
  });
});

/* --------------------------- 2. mailbox I/O ---------------------------- */

describe("share inbox mailbox (fake-indexeddb)", () => {
  const entry = (over: Partial<SharedEntry> = {}): SharedEntry => ({
    title: "Shared page",
    text: "some shared text",
    url: "https://example.com/x",
    files: [],
    receivedAt: 1_700_000_000_000,
    ...over,
  });

  it("stashes and drains in stash order, then clears", async () => {
    await inbox.stashSharedEntry(entry({ title: "first" }));
    await inbox.stashSharedEntry(entry({ title: "second" }));

    const drained = await inbox.drainSharedEntries();
    expect(drained.map((e) => e.title)).toEqual(["first", "second"]);
    expect(drained[0].text).toBe("some shared text");

    // the drain cleared the mailbox — a second boot must not re-import
    expect(await inbox.drainSharedEntries()).toEqual([]);
  });

  it("resolves [] on an empty mailbox (the common boot)", async () => {
    expect(await inbox.drainSharedEntries()).toEqual([]);
  });

  it("drops malformed rows instead of crashing the boot drain", async () => {
    // hand-seed one good entry and two malformed rows through the same store
    await inbox.stashSharedEntry(entry({ title: "good" }));
    const { SHARE_INBOX_DB, SHARE_INBOX_STORE } = inbox;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(SHARE_INBOX_DB);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SHARE_INBOX_STORE, "readwrite");
      tx.objectStore(SHARE_INBOX_STORE).add({ broken: true });
      tx.objectStore(SHARE_INBOX_STORE).add(null);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const drained = await inbox.drainSharedEntries();
    expect(drained).toHaveLength(1);
    expect(drained[0].title).toBe("good");
  });

  it("keeps File blobs intact through the structured clone", async () => {
    const blob = new Blob(["audio-bytes"], { type: "audio/webm" });
    await inbox.stashSharedEntry(
      entry({ text: "", url: "", files: [{ name: "clip.webm", type: "audio/webm", blob }] })
    );
    const [drained] = await inbox.drainSharedEntries();
    expect(drained.files).toHaveLength(1);
    expect(drained.files[0].name).toBe("clip.webm");
    expect(drained.files[0].type).toBe("audio/webm");
    expect(await drained.files[0].blob.text()).toBe("audio-bytes");
  });
});

/* ------------------- 3. cross-file consistency pins -------------------- */

describe("share-target wiring across manifest / sw.js / app / fallback", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
    share_target: {
      action: string;
      method: string;
      enctype: string;
      params: Record<string, unknown>;
    };
  };
  const sw = read("public/sw.js");

  it("declares the share_target the SW and app implement", () => {
    expect(manifest.share_target.action).toBe(inbox.SHARE_TARGET_PATH);
    expect(manifest.share_target.method).toBe("POST");
    expect(manifest.share_target.enctype).toBe("multipart/form-data");
  });

  it("maps every param the SW parses (title/text/url + files)", () => {
    const params = manifest.share_target.params;
    for (const field of inbox.SHARE_TEXT_FIELDS) {
      expect(params[field]).toBe(field);
    }
    expect(params[inbox.SHARE_FILE_FIELD]).toEqual([
      { name: inbox.SHARE_FILE_FIELD, accept: ["image/*", "audio/*", "application/pdf", "text/*"] },
    ]);
  });

  it("sw.js intercepts exactly the manifest action with a same-shape mailbox", () => {
    // the standalone script mirrors the share-inbox constants verbatim
    expect(sw).toContain(`const SHARE_TARGET_PATH = "${inbox.SHARE_TARGET_PATH}"`);
    expect(sw).toContain(`const SHARE_FILE_FIELD = "${inbox.SHARE_FILE_FIELD}"`);
    expect(sw).toContain(`const SHARE_INBOX_DB = "${inbox.SHARE_INBOX_DB}"`);
    expect(sw).toContain(`const SHARE_INBOX_STORE = "${inbox.SHARE_INBOX_STORE}"`);
    const swFields = sw.match(/const SHARE_TEXT_FIELDS = (\[[^\n]*\]);/)?.[1];
    expect(swFields).toBeDefined();
    expect(JSON.parse(swFields as string)).toEqual([...inbox.SHARE_TEXT_FIELDS]);
    // the interceptor sits BEFORE the GET fast-path (POSTs would fall through)
    const postIdx = sw.indexOf('req.method === "POST" && url.pathname === SHARE_TARGET_PATH');
    const getIdx = sw.indexOf('if (req.method !== "GET") return;');
    expect(postIdx).toBeGreaterThan(-1);
    expect(getIdx).toBeGreaterThan(postIdx);
    // stash → redirect, and the redirect fires even when parsing fails
    expect(sw).toContain('Response.redirect("/", 303)');
    expect(sw).toContain(".catch(() => undefined)");
    // the entry shape matches SharedEntry: text fields + files + receivedAt
    expect(sw).toContain("receivedAt: Date.now()");
  });

  it("keeps the manifest accept list inside what classifyFile can land", () => {
    // the import pipeline classifies image/*, audio/*, application/pdf and
    // text/* into real import kinds; anything else (docx/html MIMEs arrive
    // as vendor types) would hit the "unsupported type" toast — so the
    // accept list stays exactly at the four safe classes
    const accept = (
      manifest.share_target.params[inbox.SHARE_FILE_FIELD] as {
        accept: string[];
      }[]
    )[0].accept;
    expect(accept).toEqual(["image/*", "audio/*", "application/pdf", "text/*"]);
  });

  it("ships a static fallback page that lands the user back in the app", () => {
    const fallback = read("public/share-target/index.html");
    expect(fallback).toContain('http-equiv="refresh"');
    expect(fallback).toContain('content="0;url=/"');
  });
});
