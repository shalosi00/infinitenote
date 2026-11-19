/// <reference types="bun-types" />
/**
 * Integration tests for the templates store (issue #279) — Dexie schema v4,
 * run against fake-indexeddb (the notes-db.test.ts harness).
 * docs/test-plans/page-templates.md, ids PT-D*.
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";

let notes: typeof import("../notes-db");

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
});

/** Fresh database for every test — no cross-test pollution. */
beforeEach(async () => {
  await notes.db.delete();
  // fake-indexeddb settles deletes asynchronously — give it a beat before
  // reopening so the new connection never races the teardown
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
});

const scene = (text: string, n = 1) => ({
  elements: Array.from({ length: n }, (_, i) => ({
    id: `el-${i}`,
    type: "text",
    text,
    isDeleted: false,
  })),
  files: {},
});

describe("templates crud (PT-D*)", () => {
  it("PT-D01: saves a template and lists it with summary fields only", async () => {
    const saved = await notes.saveTemplate("Weekly plan", scene("hello", 3), "grid");
    expect(saved.name).toBe("Weekly plan");
    expect(saved.elementCount).toBe(3);
    expect(saved.background).toBe("grid");
    expect(saved.byteSize).toBeGreaterThan(0);
    expect("content" in saved).toBe(false);

    const list = await notes.listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(saved.id);
    expect("content" in list[0]).toBe(false);
  });

  it("PT-D02: lists in picker order (name case-insensitive)", async () => {
    await notes.saveTemplate("banana", scene("b"), undefined);
    await notes.saveTemplate("Cherry", scene("c"), undefined);
    await notes.saveTemplate("apple", scene("a"), undefined);
    const names = (await notes.listTemplates()).map((t) => t.name);
    expect(names).toEqual(["apple", "banana", "Cherry"]);
  });

  it("PT-D03: refuses empty names and oversize payloads with typed errors", async () => {
    try {
      await notes.saveTemplate("   ", scene("x"));
      expect.unreachable();
    } catch (err) {
      expect((err as { name: string }).name).toBe("TemplateError");
    }
    const big = scene("a".repeat(10 * 1024 * 1024 + 1));
    try {
      await notes.saveTemplate("big", big);
      expect.unreachable();
    } catch (err) {
      expect((err as { name: string; code: string }).name).toBe("TemplateError");
      expect((err as { code: string }).code).toBe("too-large");
    }
    expect(await notes.listTemplates()).toHaveLength(0);
  });

  it("PT-D04: getTemplateRow returns the full row; missing ids return null", async () => {
    const saved = await notes.saveTemplate("Plan", scene("payload"), "ruled");
    const row = await notes.getTemplateRow(saved.id);
    expect(row).not.toBeNull();
    expect(row!.content).toContain("payload");
    expect(row!.background).toBe("ruled");
    expect(await notes.getTemplateRow("missing-id")).toBeNull();
    expect(await notes.getTemplateContent("missing-id")).toBeNull();
  });

  it("PT-D05: getTemplateContent round-trips the scene; corrupt rows restore nothing", async () => {
    const saved = await notes.saveTemplate("Plan", scene("roundtrip", 2));
    const content = await notes.getTemplateContent(saved.id);
    expect(content).not.toBeNull();
    expect(content!.elements).toHaveLength(2);

    // corrupt the row directly (bypasses the save path)
    await notes.db.templates.put({ ...saved, content: "{not json" });
    expect(await notes.getTemplateContent(saved.id)).toBeNull();

    // a structurally wrong scene restores nothing too
    await notes.db.templates.put({ ...saved, content: JSON.stringify({ files: {} }) });
    expect(await notes.getTemplateContent(saved.id)).toBeNull();
  });

  it("PT-D06: deleteTemplate removes one template and is a no-op for missing ids", async () => {
    const a = await notes.saveTemplate("A", scene("a"));
    const b = await notes.saveTemplate("B", scene("b"));
    await notes.deleteTemplate(a.id);
    await notes.deleteTemplate("never-existed");
    const names = (await notes.listTemplates()).map((t) => t.name);
    expect(names).toEqual(["B"]);
    expect(b.id).toBeTruthy();
  });

  it("PT-D07: templates survive page purges (independent of the tree)", async () => {
    const nb = await notes.createNotebook("NB", "violet");
    const sec = await notes.createSection(nb.id, "S");
    const page = await notes.createPage(sec.id, "P");
    const saved = await notes.saveTemplate("Keeper", scene("keep"));
    await notes.purgePage(page.id);
    const names = (await notes.listTemplates()).map((t) => t.name);
    expect(names).toEqual(["Keeper"]);
    expect(saved.id).toBeTruthy();
  });

  it("PT-D08: eraseAllData clears templates too", async () => {
    await notes.saveTemplate("Doomed", scene("x"));
    await notes.eraseAllData();
    expect(await notes.listTemplates()).toHaveLength(0);
  });
});

describe("backup / restore includes templates (PT-D*)", () => {
  it("PT-D10: buildBackup embeds every template with its scene", async () => {
    await notes.saveTemplate("First", scene("one"), "grid");
    await notes.saveTemplate("Second", scene("two", 2), undefined);
    const backup = JSON.parse(await notes.buildBackup()) as {
      templates?: Array<{ name: string; content: string; background?: string }>;
    };
    expect(backup.templates).toHaveLength(2);
    const names = backup.templates!.map((t) => t.name).sort();
    expect(names).toEqual(["First", "Second"]);
    const first = backup.templates!.find((t) => t.name === "First")!;
    expect(first.background).toBe("grid");
    expect(JSON.parse(first.content)).toEqual(scene("one"));
  });

  it("PT-D11: restoreBackup brings templates back with fresh ids and valid content", async () => {
    await notes.saveTemplate("Archived", scene("payload", 3), "ruled");
    const json = await notes.buildBackup();

    await notes.eraseAllData();
    expect(await notes.listTemplates()).toHaveLength(0);

    const pages = await notes.restoreBackup(json);
    expect(pages).toBe(0); // the archive had a tree? no — only templates here
    const list = await notes.listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Archived");
    expect(list[0].background).toBe("ruled");
    expect(list[0].elementCount).toBe(3);
    const content = await notes.getTemplateContent(list[0].id);
    expect(content!.elements).toHaveLength(3);
  });

  it("PT-D12: restore is field-tolerant — corrupt/oversize templates are skipped", async () => {
    const json = JSON.stringify({
      app: "infinitenote",
      version: 1,
      exportedAt: 1,
      notebooks: [],
      templates: [
        { name: "Good", content: JSON.stringify(scene("ok")), background: "plain" },
        { name: "Corrupt", content: "{nope" },
        { name: "WrongShape", content: JSON.stringify({ files: {} }) },
        { name: "Oversize", content: JSON.stringify(scene("a".repeat(10 * 1024 * 1024 + 2))) },
        { name: "NoContent" },
        "not-an-object",
      ],
    });
    await notes.restoreBackup(json);
    const names = (await notes.listTemplates()).map((t) => t.name);
    expect(names).toEqual(["Good"]);
  });

  it("PT-D13: restore falls back to a generated name when the field is blank", async () => {
    const json = JSON.stringify({
      app: "infinitenote",
      version: 1,
      exportedAt: 1,
      notebooks: [],
      templates: [{ name: "   ", content: JSON.stringify(scene("x")) }],
    });
    await notes.restoreBackup(json);
    const names = (await notes.listTemplates()).map((t) => t.name);
    expect(names).toEqual(["Restored template"]);
  });

  it("PT-D14: old backups without a templates field restore untouched", async () => {
    const json = JSON.stringify({
      app: "infinitenote",
      version: 1,
      exportedAt: 1,
      notebooks: [
        {
          name: "NB",
          color: "teal",
          sections: [{ name: "S", pages: [{ title: "P", content: null }] }],
        },
      ],
    });
    const pages = await notes.restoreBackup(json);
    expect(pages).toBe(1);
    expect(await notes.listTemplates()).toHaveLength(0);
  });
});
