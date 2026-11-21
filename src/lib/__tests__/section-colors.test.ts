/// <reference types="bun-types" />
/**
 * Section colors (OneNote "Section Color" parity, issue #319) — wave 17.
 *
 * Three layers pinned here:
 *   1. the pure color policy (src/lib/section-colors.ts) — external-input
 *      normalization, notebook inheritance vs explicit override (SC-P1..P3);
 *   2. the Dexie data layer against fake-indexeddb — set/clear + updatedAt,
 *      default rows stay inherit-only (SC-P4..P6);
 *   3. the two serialization surfaces — a sync manifest round-trip
 *      (whole-row LWW inputs) and a backup round-trip that preserves an
 *      explicit color and restores an invalid one as inherit (SC-P7..P9).
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildManifest, type LibrarySnapshot } from "../sync/format";
import { computeSyncPlan, type SyncInputs } from "../sync/merge";
import {
  effectiveSectionColor,
  safeSectionColor,
  sectionColorHex,
} from "../section-colors";
import { NOTEBOOK_COLOR_HEX, type Notebook, type PageRow, type Section } from "../types";
import { RestoreError } from "../restore-error";

/* ------------------------------------------------------------------ */
/* factories                                                           */
/* ------------------------------------------------------------------ */

const T = 1_700_000_000_000;

const nb = (id: string, over: Partial<Notebook> = {}): Notebook => ({
  id,
  name: `Notebook ${id}`,
  color: "violet",
  order: 1,
  createdAt: T,
  updatedAt: T,
  deletedAt: null,
  ...over,
});

const sec = (id: string, notebookId: string, over: Partial<Section> = {}): Section => ({
  id,
  notebookId,
  name: `Section ${id}`,
  order: 1,
  createdAt: T,
  updatedAt: T,
  deletedAt: null,
  ...over,
});

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

/* ------------------------------------------------------------------ */
/* 1. pure color policy                                                */
/* ------------------------------------------------------------------ */

describe("section-color policy (issue #319)", () => {
  it("SC-P1: safeSectionColor passes palette names and reads everything else as inherit", () => {
    expect(safeSectionColor("rose")).toBe("rose");
    expect(safeSectionColor("teal")).toBe("teal");
    expect(safeSectionColor("hotpink")).toBeNull(); // off-palette string
    expect(safeSectionColor("VIOLET")).toBeNull(); // palette is case-sensitive
    expect(safeSectionColor(42)).toBeNull();
    expect(safeSectionColor(null)).toBeNull();
    expect(safeSectionColor(undefined)).toBeNull();
    expect(safeSectionColor({ color: "rose" })).toBeNull();
    expect(safeSectionColor(["rose"])).toBeNull();
  });

  it("SC-P2: effectiveSectionColor inherits when the override is absent or null", () => {
    const notebook = nb("nb1", { color: "teal" });
    expect(effectiveSectionColor({ color: undefined }, notebook)).toBe("teal");
    expect(effectiveSectionColor({ color: null }, notebook)).toBe("teal");
    // an off-palette override reads as inherit, never as a render crash
    expect(effectiveSectionColor({ color: "hotpink" as Section["color"] }, notebook)).toBe("teal");
    // an explicit override wins
    expect(effectiveSectionColor({ color: "rose" }, notebook)).toBe("rose");
    // a section with NO color field at all (old rows, old sync folders)
    expect(effectiveSectionColor({}, notebook)).toBe("teal");
  });

  it("SC-P3: sectionColorHex resolves through the shared palette table", () => {
    const notebook = nb("nb1", { color: "violet" });
    const inherited = sec("s1", "nb1");
    const overridden = sec("s2", "nb1", { color: "rose" });
    expect(sectionColorHex(inherited, notebook)).toBe(NOTEBOOK_COLOR_HEX.violet);
    expect(sectionColorHex(overridden, notebook)).toBe(NOTEBOOK_COLOR_HEX.rose);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Dexie data layer (fake-indexeddb)                                */
/* ------------------------------------------------------------------ */

let notes: typeof import("../notes-db");

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
});

beforeEach(async () => {
  await notes.db.delete();
  // fake-indexeddb settles deletes asynchronously — give it a beat before
  // reopening so the new connection never races the teardown
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
  // belt and braces (issue #319 CI evidence): the delete-settle window is a
  // heuristic — under CI load a slower settle could leak the previous
  // test's rows into this one. eraseAllData is the app's own reset path;
  // after it, the DB is empty by CONSTRUCTION, not by timing.
  await notes.eraseAllData();
});

describe("section-color data layer (issue #319)", () => {
  it("SC-P4: setSectionColor persists the override and bumps updatedAt", async () => {
    const notebook = await notes.createNotebook("Palette", "violet");
    const top = await notes.createSection(notebook.id, "Tinted");
    const before = (await notes.listSections()).find((s) => s.id === top.id)!;
    await notes.setSectionColor(top.id, "rose");
    const after = (await notes.listSections()).find((s) => s.id === top.id)!;
    expect(after.color).toBe("rose");
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
    expect(after.notebookId).toBe(notebook.id);
    // the policy resolves it as the override
    expect(
      effectiveSectionColor(after, notebook),
    ).toBe("rose");
  });

  it("SC-P5: clearing with null restores the inherited read", async () => {
    const notebook = await notes.createNotebook("Palette", "teal");
    const top = await notes.createSection(notebook.id, "Tinted");
    await notes.setSectionColor(top.id, "rose");
    await notes.setSectionColor(top.id, null);
    const row = (await notes.listSections()).find((s) => s.id === top.id)!;
    expect(row.color).toBeNull();
    expect(effectiveSectionColor(row, notebook)).toBe("teal");
    expect(sectionColorHex(row, notebook)).toBe(NOTEBOOK_COLOR_HEX.teal);
  });

  it("SC-P6: a fresh section has no color field — old rows and old callers stay valid", async () => {
    const notebook = await notes.createNotebook("Palette", "violet");
    const top = await notes.createSection(notebook.id, "Tinted");
    const row = (await notes.listSections()).find((s) => s.id === top.id)!;
    expect("color" in row ? row.color : undefined).toBeUndefined();
    expect(effectiveSectionColor(row, notebook)).toBe("violet");
    // createSection with a parentId (wave-16 signature) also stays color-less
    const child = await notes.createSection(notebook.id, "Hue", top.id);
    const childRow = (await notes.listSections()).find((s) => s.id === child.id)!;
    expect(childRow.color).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 3. serialization surfaces — sync manifest + backup round-trips      */
/* ------------------------------------------------------------------ */

describe("section colors survive sync and backups (issue #319)", () => {
  it("SC-P7: the sync manifest carries the whole row, override included", () => {
    const notebook = nb("nb1", { color: "violet" });
    const overridden = sec("s1", "nb1", { color: "rose" });
    const inherited = sec("s2", "nb1");
    const snapshot: LibrarySnapshot = {
      notebooks: [notebook],
      sections: [overridden, inherited],
      pages: [pg("p1", "s1", { content: null })],
    };
    const manifest = buildManifest(snapshot, T);
    const json = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
    const byId = new Map(json.sections.map((s) => [s.id, s]));
    expect(byId.get("s1")!.color).toBe("rose");
    expect("color" in byId.get("s2")! ? byId.get("s2")!.color : undefined).toBeUndefined();
  });

  it("SC-P8: whole-row LWW merge moves a newer row's color across devices", () => {
    const notebook = nb("nb1", { color: "violet" });
    const localRow = sec("s1", "nb1", { updatedAt: T });
    // the same section, recolored later on the other device
    const remoteRow = sec("s1", "nb1", { color: "rose", updatedAt: T + 5_000 });
    const inputs: SyncInputs = {
      local: { notebooks: [notebook], sections: [localRow], pages: [] },
      localPurges: [],
      remote: { notebooks: [notebook], sections: [remoteRow], pages: [] },
      remoteTrash: [],
      base: null,
    };
    const plan = computeSyncPlan(inputs, { now: T + 10_000 });
    const merged = plan.sections.find((s) => s.id === "s1")!;
    expect(merged.color).toBe("rose");
  });

  it("SC-P9: a backup round-trip preserves an explicit color and an invalid one restores as inherit", async () => {
    const notebook = await notes.createNotebook("Colorful", "violet");
    const colored = await notes.createSection(notebook.id, "Tinted");
    await notes.setSectionColor(colored.id, "rose");
    const plain = await notes.createSection(notebook.id, "Untinted");
    await notes.createPage(colored.id, "Tinted page");

    const backup = await notes.buildBackup();
    // restore imports as NEW records without wiping — import into an
    // EMPTY library (the real-world restore flow) so the find-by-name
    // asserts below can never be ambiguous between the setup generation
    // and the restored one (full-suite CI evidence, issue #319)
    await notes.eraseAllData();
    const restoredCount = await notes.restoreBackup(backup);
    expect(restoredCount).toBe(1);

    const notebooks = await notes.listNotebooks();
    const newNb = notebooks.find((n) => n.name === "Colorful")!;
    expect(newNb.color).toBe("violet");
    const sections = await notes.listSections();
    const newColored = sections.find((s) => s.name === "Tinted")!;
    const newPlain = sections.find((s) => s.name === "Untinted")!;
    expect(newColored.color).toBe("rose");
    expect(newPlain.color).toBeUndefined();
    expect(effectiveSectionColor(newColored, newNb)).toBe("rose");
    expect(effectiveSectionColor(newPlain, newNb)).toBe("violet");
    // the page landed back inside the colored section
    const pages = await notes.listPages();
    expect(pages.find((p) => p.title === "Tinted page")!.sectionId).toBe(
      newColored.id,
    );
  });

  it("SC-P9b: a hand-edited archive with an off-palette color restores as inherit, not a crash", async () => {
    const notebook = await notes.createNotebook("Monochrome", "teal");
    const flat = await notes.createSection(notebook.id, "Flat");
    await notes.createPage(flat.id, "Flat page");
    const archive = JSON.parse(await notes.buildBackup()) as {
      notebooks: Array<{ sections: Array<{ color?: string }> }>;
    };
    archive.notebooks[0].sections[0].color = "hotpink";
    // same empty-library import as SC-P9 (see the comment there)
    await notes.eraseAllData();
    await expect(notes.restoreBackup(JSON.stringify(archive))).resolves.toBe(1);
    const sections = await notes.listSections();
    const row = sections.find((s) => s.name === "Flat")!;
    expect(row.color).toBeUndefined();
    expect(effectiveSectionColor(row, notebook)).toBe("teal");
  });

  it("restoreBackup still rejects non-InfiniteNote archives", async () => {
    await expect(notes.restoreBackup(JSON.stringify({ app: "other" }))).rejects.toBeInstanceOf(
      RestoreError
    );
  });
});
