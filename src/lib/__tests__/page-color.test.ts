/// <reference types="bun-types" />
/**
 * Page color — OneNote "View > Page Color" parity (issue #385), wave 27.
 *
 * Three layers pinned here:
 *   1. the pure color policy (src/lib/page-colors.ts) — palette integrity,
 *      safe parse matrix, the light-authored paint contract (PC-P1..P6);
 *   2. the Dexie data layer against fake-indexeddb — set/clear + updatedAt,
 *      backup round-trip (tint survives, hand-edited archive degrades),
 *      template save/apply carry (PC-D1..D6);
 *   3. the sync page-file surface — tint rides next to background/tags in
 *      both the plain and the sealed (enc) builder, malformed degrades,
 *      pre-#385 folders import clean (PC-S1..S4).
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  PAGE_COLOR_HEX,
  canvasColorFor,
  safePageColor,
} from "../page-colors";
import { PAGE_COLORS, type PageColor, type PageRow, type ScenePayload } from "../types";
import { buildSyncFolderFiles, parseSyncFolder } from "../sync/format";

/* ------------------------------------------------------------------ */
/* 1. pure color policy                                                */
/* ------------------------------------------------------------------ */

/** WCAG relative luminance of an sRGB hex (the test's own derivation). */
function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex: ${hex}`);
  const v = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

describe("page-color policy (issue #385)", () => {
  it("PC-P1: the palette mirrors NotebookColor's hue families with pale, ink-readable values", () => {
    // same hue families as the notebook/section palette, same order
    expect(PAGE_COLORS).toEqual([
      "violet", "rose", "orange", "amber", "emerald", "teal", "cyan", "pink",
    ]);
    for (const c of PAGE_COLORS) {
      const hex = PAGE_COLOR_HEX[c];
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      // every tint is pale: relative luminance ≥ 0.8 keeps dark ink readable
      // (white paper is 1.0; Tailwind-100 tints land ~0.85-0.94)
      expect(relativeLuminance(hex)).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("PC-P2: safePageColor passes palette names and reads everything else as none", () => {
    expect(safePageColor("rose")).toBe("rose");
    expect(safePageColor("amber")).toBe("amber");
    expect(safePageColor("hotpink")).toBeNull(); // off-palette string
    expect(safePageColor("AMBER")).toBeNull(); // palette is case-sensitive
    expect(safePageColor("#fef3c7")).toBeNull(); // a hex is not a palette id
    expect(safePageColor(42)).toBeNull();
    expect(safePageColor(null)).toBeNull();
    expect(safePageColor(undefined)).toBeNull();
    expect(safePageColor(["amber"])).toBeNull();
  });

  it("PC-P3: canvasColorFor returns the palette hex in BOTH themes — the v1.13 paint contract", () => {
    // the light-authored paint in both themes: dark mode dims it through
    // Excalidraw's invert(93%) hue-rotate(180deg) filter, exactly like the
    // paper-white and the ink (excalidraw-canvas.tsx sync effect)
    for (const c of PAGE_COLORS) {
      expect(canvasColorFor(c)).toBe(PAGE_COLOR_HEX[c]);
    }
  });

  it("PC-P4: canvasColorFor falls back to white paper for none and garbage", () => {
    expect(canvasColorFor(null)).toBe("#ffffff");
    expect(canvasColorFor(undefined)).toBe("#ffffff");
    expect(canvasColorFor("hotpink" as unknown as PageColor)).toBe("#ffffff"); // off-palette id
    expect(canvasColorFor(42 as unknown as PageColor)).toBe("#ffffff");
  });

  it("PC-P5: the palette ids resolve in PAGE_COLOR_HEX (no undefined paint)", () => {
    for (const c of PAGE_COLORS) {
      expect(PAGE_COLOR_HEX[c]).toBeDefined();
    }
    expect(Object.keys(PAGE_COLOR_HEX).sort()).toEqual([...PAGE_COLORS].sort());
  });

  it("PC-P6: every palette value differs from white paper and from every other tint", () => {
    const hexes = PAGE_COLORS.map((c) => PAGE_COLOR_HEX[c]);
    for (const hex of hexes) expect(hex.toLowerCase()).not.toBe("#ffffff");
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});

/* ------------------------------------------------------------------ */
/* 2. data layer (fake-indexeddb)                                      */
/* ------------------------------------------------------------------ */

let notes: typeof import("../notes-db");

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
});

beforeEach(async () => {
  await notes.db.delete();
  // fake-indexeddb settles deletes asynchronously — give it a beat before
  // reopening so the new connection never races the teardown (SC-P4 pattern)
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
  // eraseAllData is the app's own reset path — the DB is empty by CONSTRUCTION
  await notes.eraseAllData();
});

describe("page-color data layer (issue #385)", () => {
  it("PC-D1: setPageColor writes the tint and bumps updatedAt", async () => {
    const nb = await notes.createNotebook("Colors", "violet");
    const sec = await notes.createSection(nb.id, "Tinted");
    const secId = sec.id;
    const page = await notes.createPage(secId, "P");
    // backdate deterministically: a same-ms write (Date.now resolution) is
    // legal, so "bumped" needs a known older value to exceed
    await notes.db.pages.update(page.id, { updatedAt: 1_700_000_000_000 });
    await notes.setPageColor(page.id, "amber");
    const row = await notes.db.pages.get(page.id);
    expect(row?.pageColor).toBe("amber");
    expect(row!.updatedAt).toBeGreaterThan(1_700_000_000_000);
  });

  it("PC-D2: setPageColor(null) clears the tint back to white paper", async () => {
    const nb = await notes.createNotebook("Colors", "teal");
    const sec = await notes.createSection(nb.id, "Tinted");
    const nbId = nb.id;
    const secId = sec.id;
    const page = await notes.createPage(secId, "P");
    await notes.setPageColor(page.id, "cyan");
    await notes.setPageColor(page.id, null);
    const row = await notes.db.pages.get(page.id);
    expect(row?.pageColor).toBeNull();
  });

  it("PC-D3: duplicatePage copies the tint (whole-row copy)", async () => {
    const nb = await notes.createNotebook("Colors", "rose");
    const sec = await notes.createSection(nb.id, "Tinted");
    const nbId = nb.id;
    const secId = sec.id;
    const page = await notes.createPage(secId, "P");
    await notes.setPageColor(page.id, "pink");
    const copy = await notes.duplicatePage(page.id);
    expect(copy?.pageColor).toBe("pink");
  });

  it("PC-D4: a backup round-trip preserves the tint", async () => {
    const nb = await notes.createNotebook("Backed", "emerald");
    const sec = await notes.createSection(nb.id, "Tinted");
    const nbId = nb.id;
    const secId = sec.id;
    const page = await notes.createPage(secId, "Tinted page");
    await notes.setPageColor(page.id, "orange");
    const backup = await notes.buildBackup();
    // restore imports as NEW records without wiping (the SC-P9 empty-library
    // contract) so the find-by-name asserts stay unambiguous
    await notes.eraseAllData();
    await expect(notes.restoreBackup(backup)).resolves.toBe(1);
    const pages = await notes.listPages();
    expect(pages.find((p) => p.title === "Tinted page")?.pageColor).toBe("orange");
  });

  it("PC-D5: a hand-edited archive with an off-palette tint restores as none, not a crash", async () => {
    const nb = await notes.createNotebook("Monochrome", "cyan");
    const sec = await notes.createSection(nb.id, "Flat");
    const secId = sec.id;
    await notes.createPage(secId, "Flat page");
    const archive = JSON.parse(await notes.buildBackup()) as {
      notebooks: Array<{ sections: Array<{ pages: Array<{ pageColor?: unknown }> }> }>;
    };
    archive.notebooks[0].sections[0].pages[0].pageColor = "hotpink";
    await notes.eraseAllData();
    await expect(notes.restoreBackup(JSON.stringify(archive))).resolves.toBe(1);
    const pages = await notes.listPages();
    const row = pages.find((p) => p.title === "Flat page")!;
    expect(row.pageColor).toBeUndefined();
  });

  it("PC-D6: a template stores the tint it was saved from — and the archive round-trip carries it", async () => {
    const nb = await notes.createNotebook("Templated", "amber");
    const sec = await notes.createSection(nb.id, "Source");
    const secId = sec.id;
    const page = await notes.createPage(secId, "Source page");
    await notes.setPageColor(page.id, "violet");
    // a template stores the page's SCENE payload — a fresh untinted scene
    // is the honest fixture (getPageContent of a new page is null: no ink yet)
    const content = { elements: [], files: {} } as unknown as ScenePayload;
    const summary = await notes.saveTemplate("Tinted template", content, undefined, "violet");
    expect((await notes.listTemplates()).find((s) => s.id === summary.id)?.pageColor).toBe("violet");
    // an untinted template stores no color at all
    const plain = await notes.saveTemplate("Plain template", content);
    expect(plain.pageColor).toBeUndefined();
    // templates ride in backups (issue #279) — the tint rides with them
    const backup = await notes.buildBackup();
    const archive = JSON.parse(backup) as { templates?: Array<{ name?: string; pageColor?: unknown }> };
    expect(archive.templates?.find((tpl) => tpl.name === "Tinted template")?.pageColor).toBe("violet");
    await notes.eraseAllData();
    await expect(notes.restoreBackup(backup)).resolves.toBeGreaterThanOrEqual(0);
    const restored = (await notes.listTemplates()).find((s) => s.name === "Tinted template");
    expect(restored?.pageColor).toBe("violet");
  });
});

/* ------------------------------------------------------------------ */
/* 3. sync page-file surface                                           */
/* ------------------------------------------------------------------ */

const T = 1_700_000_000_000;

const pg = (id: string, sectionId: string, over: Partial<PageRow> = {}): PageRow => ({
  id,
  sectionId,
  title: `Page ${id}`,
  order: 1,
  createdAt: T,
  updatedAt: T,
  deletedAt: null,
  content: null,
  ...over,
});

describe("page-color sync carry (issue #385)", () => {
  it("PC-S1: the plain builder writes the tint and parseSyncFolder restores it", () => {
    const snap = {
      notebooks: [],
      sections: [],
      pages: [pg("p1", "s1", { content: JSON.stringify({ elements: [], files: {} }), pageColor: "amber" })],
    } as unknown as Parameters<typeof buildSyncFolderFiles>[0];
    const files = buildSyncFolderFiles(snap, [], T + 500);
    const file = JSON.parse(files[`pages/p1.json`]) as { pageColor?: string };
    expect(file.pageColor).toBe("amber");
    const parsed = parseSyncFolder(files);
    expect(parsed.pages.get("p1")?.pageColor).toBe("amber");
  });

  it("PC-S2: a malformed tint degrades to none — cosmetic, the tags contract", () => {
    const snap = {
      notebooks: [],
      sections: [],
      pages: [pg("p1", "s1", { pageColor: "hotpink" as unknown as PageColor })],
    } as unknown as Parameters<typeof buildSyncFolderFiles>[0];
    const files = buildSyncFolderFiles(snap, [], T + 500);
    const file = JSON.parse(files[`pages/p1.json`]) as { pageColor?: string };
    expect(file.pageColor).toBeUndefined();
    // a hand-edited FILE with a bad tint imports as none too
    const handEdited = JSON.parse(files[`pages/p1.json`]) as Record<string, unknown>;
    handEdited.pageColor = 42;
    const parsed = parseSyncFolder({ ...files, [`pages/p1.json`]: JSON.stringify(handEdited) });
    expect(parsed.pages.get("p1")?.pageColor).toBeUndefined();
    expect(parsed.pages.get("p1")?.title).toBe("Page p1"); // the row survives
  });

  it("PC-S3: a sealed page (enc marker) carries BOTH the marker and the tint", () => {
    // the protection wave's contract: the marker rides verbatim, scene null;
    // #385 adds the tint as ordinary row metadata next to it
    const snap = {
      notebooks: [],
      sections: [],
      pages: [pg("p1", "s1", {
        content: "enc1.AAAA.BBBB",
        pageColor: "rose",
      })],
    } as unknown as Parameters<typeof buildSyncFolderFiles>[0];
    const files = buildSyncFolderFiles(snap, [], T + 500);
    const file = JSON.parse(files[`pages/p1.json`]) as { enc?: string; scene?: unknown; pageColor?: string };
    expect(file.enc).toBe("enc1.AAAA.BBBB");
    expect(file.scene).toBeNull();
    expect(file.pageColor).toBe("rose");
    const parsed = parseSyncFolder(files);
    const row = parsed.pages.get("p1")!;
    expect(row.content).toBe("enc1.AAAA.BBBB");
    expect(row.pageColor).toBe("rose");
  });

  it("PC-S4: a pre-#385 folder (no pageColor field) imports clean", () => {
    const snap = {
      notebooks: [],
      sections: [],
      pages: [pg("p1", "s1", { content: JSON.stringify({ elements: [], files: {} }) })],
    } as unknown as Parameters<typeof buildSyncFolderFiles>[0];
    const files = buildSyncFolderFiles(snap, [], T + 500);
    const parsed = parseSyncFolder(files);
    const row = parsed.pages.get("p1")!;
    expect(row.pageColor).toBeUndefined();
    expect(row.background).toBeUndefined();
  });
});
