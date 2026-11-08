/// <reference types="bun-types" />
/**
 * Unit tests for the File System Access adapter's folder write: the folder
 * must mirror the library EXACTLY after every write — including the
 * zero-alive-pages case, where a skipped cleanup used to leave stale page
 * files behind (and a stale page file + its tombstone resurrects a deleted
 * page on the next device that syncs — see sync-merge.test.ts).
 *
 * The FSA interfaces are structural, so an in-memory mock exercises the
 * real writeSyncFolder/readSyncFolder logic without a browser.
 */
import { describe, expect, it } from "bun:test";
import {
  readSyncFolder,
  writeSyncFolder,
  type FsaDirectoryHandle,
  type FsaFileHandle,
} from "../sync/fsa";

/** In-memory FSA directory mock: one flat namespace, "pages/" is a child dir. */
function mockFsa(): { root: FsaDirectoryHandle; rootFiles: Map<string, string>; pageFiles: Map<string, string> } {
  const rootFiles = new Map<string, string>();
  const pageFiles = new Map<string, string>();

  const dirOf = (files: Map<string, string>): FsaDirectoryHandle => ({
    kind: "directory",
    name: files === pageFiles ? "pages" : "root",
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name) && !options?.create) throw new Error("NotFoundError");
      const current = files.get(name);
      return {
        kind: "file",
        name,
        async getFile() {
          return { text: async () => current ?? "" } as unknown as File;
        },
        async createWritable() {
          let buf = "";
          return {
            async write(data: BufferSource | Blob | string) {
              buf = typeof data === "string" ? data : "";
            },
            async close() {
              files.set(name, buf);
            },
          };
        },
      } as FsaFileHandle;
    },
    async getDirectoryHandle(name: string) {
      if (name !== "pages") throw new Error("TypeError");
      return pagesDir;
    },
    async removeEntry(name: string) {
      files.delete(name);
    },
    async *entries() {
      for (const [name, text] of files) {
        yield [
          name,
          {
            kind: "file",
            name,
            getFile: async () => ({ text: async () => text }) as unknown as File,
          } as FsaFileHandle,
        ];
      }
    },
  });

  const pagesDir = dirOf(pageFiles);
  const root = dirOf(rootFiles);
  return { root, rootFiles, pageFiles };
}

describe("writeSyncFolder mirrors the library exactly", () => {
  it("writes root files and page files", async () => {
    const { root, rootFiles, pageFiles } = mockFsa();
    await writeSyncFolder(root, {
      "manifest.json": '{"app":"infinitenote"}',
      "trash.jsonl": "\n",
      "pages/p1.json": '{"id":"p1"}',
    });
    expect(rootFiles.get("manifest.json")).toBe('{"app":"infinitenote"}');
    expect(rootFiles.get("trash.jsonl")).toBe("\n");
    expect(pageFiles.get("p1.json")).toBe('{"id":"p1"}');
  });

  it("removes stale page files the write did not produce", async () => {
    const { root, pageFiles } = mockFsa();
    pageFiles.set("old.json", "{}");
    pageFiles.set("kept.json", "{}");
    await writeSyncFolder(root, {
      "manifest.json": "{}",
      "trash.jsonl": "",
      "pages/kept.json": '{"id":"kept"}',
    });
    expect(pageFiles.has("old.json")).toBe(false);
    expect(pageFiles.get("kept.json")).toBe('{"id":"kept"}');
  });

  it("removes stale page files even when the write has ZERO page files", async () => {
    // Every page deleted since the last sync: the file map carries only
    // manifest + trash. The stale files must go, or the next fresh device
    // that syncs this folder resurrects all those pages.
    const { root, pageFiles } = mockFsa();
    pageFiles.set("p1.json", "{}");
    pageFiles.set("p2.json", "{}");
    await writeSyncFolder(root, {
      "manifest.json": "{}",
      "trash.jsonl": "",
    });
    expect(pageFiles.size).toBe(0);
  });

  it("leaves non-JSON files in pages/ alone (future extras)", async () => {
    const { root, pageFiles } = mockFsa();
    pageFiles.set("notes.txt", "keep me");
    await writeSyncFolder(root, {
      "manifest.json": "{}",
      "trash.jsonl": "",
      "pages/p1.json": '{"id":"p1"}',
    });
    expect(pageFiles.has("notes.txt")).toBe(true);
    expect(pageFiles.has("p1.json")).toBe(true);
  });
});

describe("readSyncFolder", () => {
  it("reads manifest, trash and pages/*.json; ignores non-JSON entries", async () => {
    const { root, rootFiles, pageFiles } = mockFsa();
    rootFiles.set("manifest.json", '{"m":1}');
    rootFiles.set("trash.jsonl", "{}\n");
    pageFiles.set("a.json", '{"id":"a"}');
    pageFiles.set("b.txt", "not a page file");
    const files = await readSyncFolder(root);
    expect(files["manifest.json"]).toBe('{"m":1}');
    expect(files["trash.jsonl"]).toBe("{}\n");
    expect(files["pages/a.json"]).toBe('{"id":"a"}');
    expect(files["pages/b.txt"]).toBeUndefined();
  });

  it("returns an empty map for a fresh folder (no pages dir)", async () => {
    const { root } = mockFsa();
    const files = await readSyncFolder(root);
    expect(Object.keys(files)).toEqual([]);
  });
});
