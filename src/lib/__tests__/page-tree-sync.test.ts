/// <reference types="bun-types" />
/**
 * Sub-page sync carry pins (issue #359) — pure format + merge policy, no
 * IndexedDB. The page FILE picks explicit fields (unlike sections, which
 * ride the manifest via Omit), so `SyncPageFile.parentId` is the one
 * additive format field sub-pages need; these pins freeze the contract:
 * written only when set, parsed as top level when absent, sibling scopes
 * renumber per (section, parent), and a reparent-only divergence is a
 * conflict, never a silent collapse.
 */
import { describe, expect, it } from "bun:test";
import type { Notebook, PageRow, Section } from "../types";
import {
  buildSyncFolderFiles,
  pageFilePath,
  parseSyncFolder,
  type LibrarySnapshot,
} from "../sync/format";
import { computeSyncPlan } from "../sync/merge";

const t0 = 1_700_000_000_000;

const nb = (id: string): Notebook => ({
  id,
  name: `Notebook ${id}`,
  color: "violet",
  order: 1,
  createdAt: t0,
  updatedAt: t0,
  deletedAt: null,
});

const sec = (id: string, notebookId: string): Section => ({
  id,
  notebookId,
  name: `Section ${id}`,
  order: 1,
  createdAt: t0,
  updatedAt: t0,
  deletedAt: null,
});

const pg = (id: string, sectionId: string, order: number, parentId?: string | null): PageRow => ({
  id,
  sectionId,
  ...(parentId ? { parentId } : {}),
  title: `Page ${id}`,
  order,
  createdAt: t0,
  updatedAt: t0,
  deletedAt: null,
  content: null,
});

const snapshot = (pages: PageRow[], sections: Section[]): LibrarySnapshot => ({
  notebooks: [nb("n1")],
  sections,
  pages,
});

describe("sub-page sync carry (issue #359)", () => {
  it("PG-S1: a subpage round-trips the folder with its parentId; a flat page keeps the old shape", () => {
    const pages = [pg("p1", "s1", 1), pg("p2", "s1", 1, "p1")];
    const files = buildSyncFolderFiles(snapshot(pages, [sec("s1", "n1")]), [], t0);
    const subFile = JSON.parse(files[pageFilePath("p2")]) as Record<string, unknown>;
    expect(subFile.parentId).toBe("p1");
    const flatFile = JSON.parse(files[pageFilePath("p1")]) as Record<string, unknown>;
    // pre-#359 rows produce the exact old file shape — no parentId key
    expect("parentId" in flatFile).toBe(false);
    const parsed = parseSyncFolder(files);
    expect(parsed.pages.get("p2")?.parentId).toBe("p1");
    expect(parsed.pages.get("p1")?.parentId ?? null).toBeNull();
  });

  it("PG-S2: an old folder without the field parses as top level", () => {
    const files = buildSyncFolderFiles(snapshot([pg("p1", "s1", 1)], [sec("s1", "n1")]), [], t0);
    // strip the field — a pre-#359 device's page file
    const raw = JSON.parse(files[pageFilePath("p1")]) as Record<string, unknown>;
    delete raw.parentId;
    files[pageFilePath("p1")] = JSON.stringify(raw);
    const parsed = parseSyncFolder(files);
    expect(parsed.pages.get("p1")?.parentId ?? null).toBeNull();
  });

  it("PG-S3: sibling orders renumber per (section, parent) scope", () => {
    // local: p1 top + p2 sub; remote: same rows with interleaved orders —
    // the merge renumbers each (section, parent) group independently, so
    // a subpage's order never competes with a top-level page's
    const local: LibrarySnapshot = snapshot(
      [pg("p1", "s1", 5), pg("p2", "s1", 9, "p1")],
      [sec("s1", "n1")]
    );
    const remotePages = [pg("p1", "s1", 7), pg("p2", "s1", 1, "p1")];
    remotePages.forEach((p) => (p.updatedAt = t0 + 1));
    const remote: LibrarySnapshot = snapshot(remotePages, [sec("s1", "n1")]);
    const plan = computeSyncPlan({ local, localPurges: [], remote, remoteTrash: [], base: null });
    const merged = new Map(plan.pages.map((p) => [p.id, p]));
    // remote rows are newer → they win whole-record (parentId rides)
    expect(merged.get("p2")?.parentId).toBe("p1");
    // renumbered per scope: top level 1..n, subpage scope restarts at 1
    expect(merged.get("p1")?.order).toBe(1);
    expect(merged.get("p2")?.order).toBe(1);
  });
});
