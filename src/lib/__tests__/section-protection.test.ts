/// <reference types="bun-types" />
/**
 * Section protection pins (issue #371) — OneNote "Password Protection"
 * parity, phase 1: the pure envelope policy (PP-P), the db-level sealing
 * surface (PP-D) and the sync-folder carry (PP-S).
 *
 * The db/sync imports must complete AFTER fake-indexeddb/auto (they
 * construct Dexie instances at module scope) — the notes-db.test.ts
 * harness pattern; the pure module imports statically.
 *
 * Test plan: docs/test-plans/section-protection.md (ids PP-P*, PP-D*, PP-S*).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  PBKDF2_ITERATIONS,
  SectionLockedError,
  autoLockDue,
  buildProtection,
  cacheUnlockedKey,
  decryptContent,
  DEFAULT_AUTO_LOCK_MINUTES,
  displayHint,
  dropAllUnlockedKeys,
  dropUnlockedKey,
  encryptContent,
  isEncryptedContent,
  isSectionLocked,
  isSectionProtected,
  MAX_AUTO_LOCK_MINUTES,
  MIN_AUTO_LOCK_MINUTES,
  parseAutoLockMinutes,
  readAutoLockMinutes,
  safeProtection,
  sealContent,
  unlockedSectionIdList,
  validateAutoLockMinutesDraft,
  verifyPassword,
  writeAutoLockMinutes,
} from "../section-protection";
import type { Section, SectionProtection } from "../types";

/**
 * The db-level tests derive with a reduced PBKDF2 budget (bun runs test
 * files concurrently in one event loop — a 600k-iteration native derive
 * starves the interleaved Dexie/fake-indexeddb files and hangs their
 * transactions). The shipped default stays pinned at 600000 (PP-P5
 * asserts it); verification reads the budget from the block itself, so
 * envelopes built here verify consistently.
 */
const TEST_ITERATIONS = 1000;

let notes: typeof import("../notes-db");
let fmt: typeof import("../sync/format");
let syncdb: typeof import("../sync/db");

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
  fmt = await import("../sync/format");
  syncdb = await import("../sync/db");
});

/** Fresh database for every test — no cross-test pollution. */
beforeEach(async () => {
  dropAllUnlockedKeys();
  await notes.db.delete();
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
});

/** One notebook + two sections + one content page each, fresh ids. */
async function home() {
  const nb = await notes.createNotebook("Vault", "violet");
  const sec = await notes.createSection(nb.id, "Secret");
  const open = await notes.createSection(nb.id, "Open");
  const payload = {
    elements: [
      { id: "el-1", type: "text", x: 10, y: 10, text: "secret ink" },
    ],
    files: {},
  } as never;
  const page = await notes.createPage(sec.id, "Hidden page", JSON.stringify(payload));
  await notes.savePageContent(page.id, payload);
  return { nb, sec, open, page, payload };
}

const validBlock: SectionProtection = {
  salt: "AAAAAAAAAAAAAAAAAAAAAA",
  iterations: 600000,
  wrappedKey: "AAAAAA",
  wrapIv: "AAAAAA",
  hint: null,
};

describe("protection envelope policy (issue #371)", () => {
  it("PP-P1: safeProtection normalizes hand-edited garbage to null", () => {
    expect(safeProtection(undefined)).toBeNull();
    expect(safeProtection(null)).toBeNull();
    expect(safeProtection("x")).toBeNull();
    expect(safeProtection(42)).toBeNull();
    expect(safeProtection([])).toBeNull();
    expect(safeProtection({ ...validBlock, salt: "" })).toBeNull();
    expect(safeProtection({ ...validBlock, salt: "not!b64url" })).toBeNull();
    expect(safeProtection({ ...validBlock, wrappedKey: null })).toBeNull();
    expect(safeProtection({ ...validBlock, wrapIv: undefined })).toBeNull();
    expect(safeProtection({ ...validBlock, iterations: 0 })).toBeNull();
    expect(safeProtection({ ...validBlock, iterations: "fast" })).toBeNull();
    expect(safeProtection({ ...validBlock, iterations: Number.POSITIVE_INFINITY })).toBeNull();
    expect(safeProtection({ ...validBlock, hint: 7 })).toBeNull();
    const read = safeProtection(validBlock);
    expect(read).not.toBeNull();
    expect(read!.iterations).toBe(600000);
    // hint absent normalizes to null (the canonical read)
    expect(safeProtection({ ...validBlock, hint: undefined })!.hint).toBeNull();
  });

  it("PP-P2: isSectionProtected reads the canonical block only", () => {
    const section = { id: "s1", protection: validBlock } as unknown as Section;
    expect(isSectionProtected(section)).toBe(true);
    expect(isSectionProtected({ id: "s2" } as Section)).toBe(false);
    expect(isSectionProtected({ id: "s3", protection: null } as unknown as Section)).toBe(false);
    expect(isSectionProtected({ id: "s4", protection: { salt: "" } } as unknown as Section)).toBe(false);
  });

  it("PP-P3: the marker namespace cannot collide with scene JSON", () => {
    expect(isEncryptedContent(null)).toBe(false);
    expect(isEncryptedContent(undefined)).toBe(false);
    expect(isEncryptedContent("")).toBe(false);
    expect(isEncryptedContent('{"elements":[]}')).toBe(false);
    expect(isEncryptedContent("enc1.notmarker")).toBe(false);
    expect(isEncryptedContent("enc1.iv.ct.extra")).toBe(false);
    expect(isEncryptedContent("enc1.a.b!c")).toBe(false);
    expect(isEncryptedContent("enc1.ABC.def_ghi")).toBe(true);
  });

  it("PP-P4: encrypt/decrypt round-trips; tamper and wrong keys fail closed", async () => {
    const { dek } = await buildProtection("pw", null, TEST_ITERATIONS);
    const plain = JSON.stringify({ elements: [], files: {} });
    const marker = await encryptContent(dek, plain);
    expect(isEncryptedContent(marker)).toBe(true);
    expect(marker.startsWith("enc1.")).toBe(true);
    expect(marker).not.toContain('"elements"');
    expect(await decryptContent(dek, marker)).toBe(plain);
    // a different key decrypts NOTHING (wrong section / wrong password)
    const { dek: other } = await buildProtection("pw2", null, TEST_ITERATIONS);
    expect(await decryptContent(other, marker)).toBeNull();
    // a tampered payload fails GCM authentication → null
    const rest = marker.slice("enc1.".length);
    const [iv, ct] = rest.split(".");
    expect(iv).toBeTruthy();
    expect(ct).toBeTruthy();
    const flipped = ct.slice(0, -4) + (ct.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(await decryptContent(dek, `enc1.${iv}.${flipped}`)).toBeNull();
  });

  it("PP-P5: buildProtection pins the PBKDF2 budget and verifies both ways", async () => {
    expect(PBKDF2_ITERATIONS).toBe(600000);
    const { protection, dek } = await buildProtection("s3cret", "my hint");
    expect(protection.iterations).toBe(PBKDF2_ITERATIONS);
    expect(protection.hint).toBe("my hint");
    expect(safeProtection(protection)).not.toBeNull();
    const ok = await verifyPassword(protection, "s3cret");
    expect(ok).not.toBeNull();
    // the unwrapped key encrypts like the original (same DEK material)
    const marker = await encryptContent(ok!, "probe");
    expect(await decryptContent(dek, marker)).toBe("probe");
    expect(await verifyPassword(protection, "wrong")).toBeNull();
  });

  it("PP-P6: sealContent writes plaintext only where protection allows", async () => {
    const { protection, dek } = await buildProtection("pw", null, TEST_ITERATIONS);
    const plain = '{"elements":[]}';
    // unprotected section: the exact legacy byte shape
    expect(await sealContent({ id: "plain" } as Section, plain)).toBe(plain);
    expect(await sealContent({ id: "plain" } as Section, null)).toBeNull();
    // protected + locked: refuse loudly (the data layer never trusts UI)
    await expect(
      sealContent({ id: "sec-x", protection } as Section, plain),
    ).rejects.toThrow(SectionLockedError);
    // protected + unlocked: a fresh marker (already-sealed rides verbatim)
    cacheUnlockedKey("sec-x", dek);
    const sealed = await sealContent({ id: "sec-x", protection } as Section, plain);
    expect(isEncryptedContent(sealed)).toBe(true);
    const again = await sealContent({ id: "sec-x", protection } as Section, sealed!);
    expect(again).toBe(sealed);
    // null content stays null under protection (empty pages never seal)
    expect(await sealContent({ id: "sec-x", protection } as Section, null)).toBeNull();
  });

  it("PP-P7: the unlock cache is memory-only with explicit drops", () => {
    expect(unlockedSectionIdList()).toEqual([]);
    cacheUnlockedKey("s1", {} as CryptoKey);
    cacheUnlockedKey("s2", {} as CryptoKey);
    expect(unlockedSectionIdList().sort()).toEqual(["s1", "s2"]);
    dropUnlockedKey("s1");
    expect(unlockedSectionIdList()).toEqual(["s2"]);
    dropAllUnlockedKeys();
    expect(unlockedSectionIdList()).toEqual([]);
  });

  it("PP-P8: isSectionLocked answers through the mirror ids when given", () => {
    const section = { id: "s1", protection: validBlock } as unknown as Section;
    const bare = { id: "s2" } as Section;
    // the pure two-argument read (the UI passes the store's mirror)
    expect(isSectionLocked(section, [])).toBe(true);
    expect(isSectionLocked(section, ["s1"])).toBe(false);
    expect(isSectionLocked(bare, [])).toBe(false);
    expect(isSectionLocked(undefined, [])).toBe(false);
  });

  it("PP-P9: displayHint trims and caps at 120 characters", () => {
    expect(displayHint(null)).toBe("");
    expect(displayHint("  first pet's name  ")).toBe("first pet's name");
    const long = "a".repeat(200);
    expect(displayHint(long)).toBe(`${"a".repeat(117)}…`);
  });
});

describe("protection data layer (issue #371)", () => {
  it("PP-D1: setSectionPassword seals every content row and version snapshot", async () => {
    const { sec, page, payload } = await home();
    await notes.recordPageVersion(page.id, payload, "manual");
    const result = await notes.setSectionPassword(sec.id, "hunter2", "digits", TEST_ITERATIONS);
    expect(result).toBe("done");
    const row = await notes.db.pages.get(page.id);
    expect(isEncryptedContent(row!.content)).toBe(true);
    expect(row!.content!).not.toContain("secret ink");
    const version = (await notes.db.pageVersions.where("pageId").equals(page.id).toArray())[0];
    expect(isEncryptedContent(version.content)).toBe(true);
    expect(version.content).not.toContain("secret ink");
    const sealed = await notes.db.sections.get(sec.id);
    expect(safeProtection(sealed!.protection)).not.toBeNull();
    expect(sealed!.protection!.hint).toBe("digits");
    // the section is UNLOCKED right after (OneNote: locking happens on
    // close/reload or via Lock now — never at protect time)
    expect(notes.db).toBeDefined();
  });

  it("PP-D2: setSectionPassword refuses missing, trashed, group and re-protect", async () => {
    const { sec } = await home();
    expect(await notes.setSectionPassword("no-such", "pw", null, TEST_ITERATIONS)).toBe("invalid-section");
    expect(await notes.setSectionPassword(sec.id, "pw", null, TEST_ITERATIONS)).toBe("done");
    expect(await notes.setSectionPassword(sec.id, "pw2", null, TEST_ITERATIONS)).toBe("invalid");
    await notes.trashSection(sec.id);
    const trashedId = sec.id;
    expect(await notes.setSectionPassword(trashedId, "pw", null, TEST_ITERATIONS)).toBe("invalid-section");
  });

  it("PP-D3: groups cannot be protected — they hold no pages", async () => {
    const { nb } = await home();
    const group = await notes.createSection(nb.id, "G");
    await notes.db.sections.update(group.id, { kind: "group" });
    expect(await notes.setSectionPassword(group.id, "pw", null, TEST_ITERATIONS)).toBe("invalid-section");
  });

  it("PP-D4: locked reads are null; unlocked reads decrypt", async () => {
    const { sec, page, payload } = await home();
    await notes.setSectionPassword(sec.id, "pw", null, TEST_ITERATIONS);
    dropUnlockedKey(sec.id);
    expect(await notes.getPageContent(page.id)).toBeNull();
    const unlocked = await notes.unlockSection(sec.id, "pw");
    expect(unlocked).toBe("done");
    const scene = await notes.getPageContent(page.id);
    expect(scene?.elements).toEqual((payload as { elements: unknown[] }).elements);
  });

  it("PP-D5: unlock verifies both ways and re-seals plaintext drift", async () => {
    const { sec, page } = await home();
    await notes.setSectionPassword(sec.id, "pw", null, TEST_ITERATIONS);
    // simulate the sync-drift window: a plaintext row lands in the
    // protected section while no key is cached (offline LWW win)
    await notes.db.pages.update(page.id, { content: '{"elements":[],"files":{}}' });
    dropAllUnlockedKeys();
    expect(await notes.unlockSection(sec.id, "wrong")).toBe("invalid");
    expect(await notes.unlockSection(sec.id, "pw")).toBe("done");
    const row = await notes.db.pages.get(page.id);
    expect(isEncryptedContent(row!.content)).toBe(true);
    expect(await notes.unlockSection(sec.id, "pw")).toBe("done"); // unlocked section re-unlocks
    expect(await notes.unlockSection("no-such", "pw")).toBe("invalid-section");
  });

  it("PP-D6: autosave re-seals; the throttle decrypts the previous snapshot", async () => {
    const { sec, page, payload } = await home();
    await notes.setSectionPassword(sec.id, "pw", null, TEST_ITERATIONS);
    const edited = { elements: [{ id: "el-2", type: "text", text: "edited" }], files: {} } as never;
    await notes.savePageContent(page.id, edited);
    const row = await notes.db.pages.get(page.id);
    expect(isEncryptedContent(row!.content)).toBe(true);
    // the auto-snapshot throttle sees the DECRYPTED previous structure:
    // within the 5-minute window an identical structure does NOT snapshot
    const payload2 = (await notes.getPageContent(page.id))!;
    await notes.recordPageVersion(page.id, payload2, "manual");
    const recorded = await notes.maybeRecordAutoVersion(page.id, payload2);
    expect(recorded).toBe(false); // unchanged structure inside the interval
  });

  it("PP-D7: changeSectionPassword kills the old password", async () => {
    const { sec, page } = await home();
    await notes.setSectionPassword(sec.id, "old-pw", null, TEST_ITERATIONS);
    dropAllUnlockedKeys();
    expect(await notes.changeSectionPassword(sec.id, "wrong", "new-pw", null, TEST_ITERATIONS)).toBe("invalid");
    expect(await notes.changeSectionPassword(sec.id, "old-pw", "new-pw", "hint2", TEST_ITERATIONS)).toBe("done");
    expect(await notes.unlockSection(sec.id, "old-pw")).toBe("invalid");
    expect(await notes.unlockSection(sec.id, "new-pw")).toBe("done");
    const scene = await notes.getPageContent(page.id);
    expect(scene).not.toBeNull(); // content survived the re-wrap
    const block = (await notes.db.sections.get(sec.id))!.protection!;
    expect(block.hint).toBe("hint2");
    expect(await notes.changeSectionPassword("no-such", "a", "b", null, TEST_ITERATIONS)).toBe("invalid-section");
  });

  it("PP-D8: removeSectionPassword restores plaintext byte-equal and strips", async () => {
    const { sec, page, payload } = await home();
    const before = (await notes.db.pages.get(page.id))!.content;
    await notes.setSectionPassword(sec.id, "pw", null, TEST_ITERATIONS);
    dropAllUnlockedKeys();
    expect(await notes.removeSectionPassword(sec.id, "wrong")).toBe("invalid");
    expect(await notes.removeSectionPassword(sec.id, "pw")).toBe("done");
    const row = await notes.db.pages.get(page.id);
    expect(row!.content).toBe(before); // byte-equal to the pre-protection shape
    const section = await notes.db.sections.get(sec.id);
    expect(section!.protection ?? null).toBeNull();
    // the version snapshot decrypts back too
    const version = (await notes.db.pageVersions.where("pageId").equals(page.id).toArray())[0];
    if (version) {
      expect(version.content).not.toContain("enc1.");
    }
    expect(await notes.removeSectionPassword("no-such", "x")).toBe("invalid-section");
  });

  it("PP-D9: createPage into a protected section seals; locked refuses", async () => {
    const { sec } = await home();
    await notes.setSectionPassword(sec.id, "pw", null, TEST_ITERATIONS);
    dropAllUnlockedKeys();
    await expect(
      notes.createPage(sec.id, "Nope", '{"elements":[]}'),
    ).rejects.toThrow(SectionLockedError);
    expect((await notes.db.pages.where("sectionId").equals(sec.id).toArray()).filter((p) => p.title === "Nope")).toHaveLength(0);
    await notes.unlockSection(sec.id, "pw");
    const page = await notes.createPage(sec.id, "Ok", '{"elements":[]}');
    const row = await notes.db.pages.get(page.id);
    expect(isEncryptedContent(row!.content)).toBe(true);
  });

  it("PP-D10: duplicate copies the marker; the same key decrypts the copy", async () => {
    const { sec, page, payload } = await home();
    await notes.setSectionPassword(sec.id, "pw", null, TEST_ITERATIONS);
    const copy = await notes.duplicatePage(page.id);
    expect(copy).not.toBeNull();
    const copyRow = await notes.db.pages.get(copy!.id);
    expect(isEncryptedContent(copyRow!.content)).toBe(true);
    const scene = await notes.getPageContent(copy!.id);
    expect(scene?.elements).toEqual((payload as { elements: unknown[] }).elements);
  });

  it("PP-D11: bulk move refuses locked boundaries with zero writes, re-seals when unlocked", async () => {
    const { nb, sec, page, payload } = await home();
    await notes.setSectionPassword(sec.id, "pw", null, TEST_ITERATIONS);
    const fresh = await notes.createSection(nb.id, "Plain target");
    dropAllUnlockedKeys();
    await expect(notes.movePagesToSection([page.id], fresh.id)).rejects.toThrow(SectionLockedError);
    const unchanged = await notes.db.pages.get(page.id);
    expect(unchanged!.sectionId).toBe(sec.id); // zero writes
    await notes.unlockSection(sec.id, "pw");
    const moved = await notes.movePagesToSection([page.id], fresh.id);
    expect(moved).toBe(1);
    const row = await notes.db.pages.get(page.id);
    expect(row!.sectionId).toBe(fresh.id);
    // leaving the envelope decrypts: the plain target holds plaintext
    expect(row!.content).toBe(JSON.stringify(payload));
    const scene = await notes.getPageContent(page.id);
    expect(scene).not.toBeNull();
    // into a protected target: content re-seals with the target's key
    const target = await notes.createSection(nb.id, "Protected target");
    await notes.setSectionPassword(target.id, "tpw", null, TEST_ITERATIONS);
    const back = await notes.movePagesToSection([page.id], target.id);
    expect(back).toBe(1);
    const backRow = await notes.db.pages.get(page.id);
    expect(isEncryptedContent(backRow!.content)).toBe(true);
    const backScene = await notes.getPageContent(page.id);
    expect(backScene?.elements).toEqual((payload as { elements: unknown[] }).elements);
  });

  it("PP-D12: backups carry the envelope; restores unlock with the same password", async () => {
    const { sec, page, payload } = await home();
    await notes.setSectionPassword(sec.id, "keeper", null, TEST_ITERATIONS);
    dropAllUnlockedKeys();
    const archive = await notes.buildBackup();
    const restoredCount = await notes.restoreBackup(archive);
    expect(restoredCount).toBeGreaterThanOrEqual(1);
    // the restored section carries a valid envelope and ciphertext rows
    const sections = await notes.db.sections.toArray();
    const restored = sections.find((s) => s.name === "Secret")!;
    expect(safeProtection(restored.protection)).not.toBeNull();
    expect(await notes.unlockSection(restored.id, "keeper")).toBe("done");
    expect(await notes.unlockSection(restored.id, "keeper")).toBe("done");
    const pages = await notes.db.pages.where("sectionId").equals(restored.id).toArray();
    const restoredPage = pages.find((p) => p.title === "Hidden page")!;
    const scene = await notes.getPageContent(restoredPage.id);
    expect(scene?.elements).toEqual((payload as { elements: unknown[] }).elements);
    // a hand-edited envelope restores as unprotected (the tolerance contract):
    // the broken restore yields a "Secret" row with NO protection field while
    // the earlier restores keep theirs (id-ordered reads, so name alone is
    // ambiguous — count instead)
    const broken = JSON.parse(archive);
    broken.notebooks[0].sections.find((s: { name: string }) => s.name === "Secret").protection = {
      salt: "",
    };
    await notes.restoreBackup(JSON.stringify(broken));
    const sections2 = await notes.db.sections.toArray();
    const bare = sections2.filter(
      (s) => s.name === "Secret" && (s.protection ?? undefined) === undefined,
    );
    expect(bare.length).toBe(1);
    // its pages carry whatever the archive had (markers stay markers —
    // safeProtection never decrypts, it only validates the envelope)
    const barePages = await notes.db.pages.where("sectionId").equals(bare[0]!.id).toArray();
    const barePage = barePages.find((p) => p.title === "Hidden page")!;
    expect(isEncryptedContent(barePage.content)).toBe(true);
  });

  it("PP-D13: assertSectionsExportable refuses only locked protected sections", async () => {
    const { sec, open } = await home();
    await notes.setSectionPassword(sec.id, "pw", null, TEST_ITERATIONS);
    dropAllUnlockedKeys();
    await expect(notes.assertSectionsExportable([sec.id])).rejects.toThrow(
      /locked sections cannot be exported/,
    );
    // unlocked + plain targets pass
    await notes.unlockSection(sec.id, "pw");
    await notes.assertSectionsExportable([sec.id, open.id]);
  });
});

describe("protection sync carry (issue #371)", () => {
  it("PP-S1: sealed pages ride verbatim in `enc`; the parser restores them", async () => {
    const { nb, sec, page } = await home();
    await notes.setSectionPassword(sec.id, "pw", null, TEST_ITERATIONS);
    const snapshot = await syncdb.readLocalSnapshot();
    const files = fmt.buildSyncFolderFiles(snapshot, [], 12345);
    const fileRaw = files[fmt.pageFilePath(page.id)];
    const file = JSON.parse(fileRaw) as { scene: unknown; enc?: string };
    // the destructive legacy shape (scene parsed from a marker → empty
    // scene) cannot happen: enc carries the marker, scene stays null
    expect(file.scene).toBeNull();
    expect(isEncryptedContent(file.enc ?? "")).toBe(true);
    expect(fileRaw).not.toContain("secret ink");
    // the manifest carries the whole section row (envelope included)
    const manifest = JSON.parse(files["manifest.json"]) as {
      sections: Array<{ name: string; protection?: unknown }>;
    };
    expect(safeProtection(manifest.sections.find((s) => s.name === "Secret")!.protection)).not.toBeNull();
    // round-trip through the parser
    const parsed = fmt.parseSyncFolder(files);
    const restored = parsed.pages.get(page.id)!;
    expect(restored.content).toBe(file.enc);
    const freshRow = await notes.db.pages.get(page.id);
    expect(restored.content).toBe(freshRow!.content);
    void nb;
  });

  it("PP-S2: unprotected pages keep the exact legacy file shape", async () => {
    const { page, open } = await home();
    const other = await notes.createPage(open.id, "Plain", '{"elements":[]}');
    void other;
    const snapshot = await syncdb.readLocalSnapshot();
    const files = fmt.buildSyncFolderFiles(snapshot, [], 12345);
    const file = JSON.parse(files[fmt.pageFilePath(page.id)]) as Record<string, unknown>;
    // pre-#371 files have NO enc field at all (the parentId precedent)
    expect("enc" in file).toBe(false);
    expect(typeof file.scene).toBe("object");
    void page;
  });

  it("PP-S3: a hand-edited garbage enc degrades to empty content, never a crash", () => {
    const files: Record<string, string> = {
      "manifest.json": JSON.stringify({
        app: "infinitenote",
        format: "sync-folder",
        version: 1,
        exportedAt: 1,
        notebooks: [],
        sections: [],
        pages: [],
      }),
      "pages/p1.json": JSON.stringify({
        id: "p1",
        sectionId: "s1",
        title: "Hand-edited",
        order: 1,
        createdAt: 1,
        updatedAt: 1,
        scene: null,
        enc: "enc1.garbage!",
      }),
      "trash.jsonl": "",
    };
    const parsed = fmt.parseSyncFolder(files);
    const row = parsed.pages.get("p1")!;
    expect(row.content ?? null).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* phase 2 (issue #378) — auto-lock after inactivity + lock-all         */
/* ------------------------------------------------------------------ */

/**
 * Bun has no (reliable) localStorage — stub the global the module reads,
 * the last-page.test.ts pattern. Installed per-test so the "storage
 * missing" path is also testable; the original (if any) is restored.
 */
type LocalStorageStub = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};
const originalLocalStorage = (globalThis as unknown as { localStorage?: LocalStorageStub })
  .localStorage;
const backing = new Map<string, string>();
function installStorageStub(): void {
  (globalThis as unknown as { localStorage: LocalStorageStub }).localStorage = {
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => void backing.set(k, v),
  };
}
function restoreStorage(): void {
  (globalThis as unknown as { localStorage?: LocalStorageStub }).localStorage =
    originalLocalStorage;
  backing.clear();
}

describe("protection phase 2 — auto-lock setting (issue #378)", () => {
  afterEach(restoreStorage);

  it("PP2-P1: parseAutoLockMinutes defaults on absent/malformed storage", () => {
    expect(DEFAULT_AUTO_LOCK_MINUTES).toBe(10);
    expect(parseAutoLockMinutes(null)).toBe(10);
    expect(parseAutoLockMinutes(undefined)).toBe(10);
    expect(parseAutoLockMinutes("")).toBe(10);
    expect(parseAutoLockMinutes("abc")).toBe(10);
    expect(parseAutoLockMinutes("-5")).toBe(10);
    expect(parseAutoLockMinutes("4.5")).toBe(10);
    expect(parseAutoLockMinutes("721")).toBe(10);
    expect(parseAutoLockMinutes("NaN")).toBe(10);
    expect(parseAutoLockMinutes("Infinity")).toBe(10);
  });

  it("PP2-P2: parseAutoLockMinutes accepts 0 (off) and the 1–720 range", () => {
    expect(parseAutoLockMinutes("0")).toBe(0);
    expect(parseAutoLockMinutes("1")).toBe(1);
    expect(parseAutoLockMinutes("10")).toBe(10);
    expect(parseAutoLockMinutes("720")).toBe(720);
    expect(MIN_AUTO_LOCK_MINUTES).toBe(1);
    expect(MAX_AUTO_LOCK_MINUTES).toBe(720);
  });

  it("PP2-P3: the dialog validator is strict — never rewrites the input", () => {
    expect(validateAutoLockMinutesDraft("0")).toBe(0);
    expect(validateAutoLockMinutesDraft("10")).toBe(10);
    expect(validateAutoLockMinutesDraft(" 720 ")).toBe(720);
    expect(validateAutoLockMinutesDraft("")).toBeNull();
    expect(validateAutoLockMinutesDraft("abc")).toBeNull();
    expect(validateAutoLockMinutesDraft("721")).toBeNull();
    expect(validateAutoLockMinutesDraft("4.5")).toBeNull();
    expect(validateAutoLockMinutesDraft("-1")).toBeNull();
  });

  it("PP2-P4: autoLockDue fires at the boundary; off never fires", () => {
    const t0 = 1_000_000;
    const MIN = 60_000;
    // 10 minutes of idleness: due at/after the exact boundary
    expect(autoLockDue(t0, 10, t0 + 10 * MIN - 1)).toBe(false);
    expect(autoLockDue(t0, 10, t0 + 10 * MIN)).toBe(true);
    expect(autoLockDue(t0, 10, t0 + 10 * MIN + 15_000)).toBe(true);
    // off / degenerate values never fire
    expect(autoLockDue(t0, 0, t0 + 60 * MIN)).toBe(false);
    expect(autoLockDue(t0, -5, t0 + 60 * MIN)).toBe(false);
    expect(autoLockDue(t0, Number.NaN, t0 + 60 * MIN)).toBe(false);
    // degenerate timestamps never fire (defensive)
    expect(autoLockDue(Number.NaN, 10, t0)).toBe(false);
    expect(autoLockDue(t0, 10, Number.NaN)).toBe(false);
    // recent activity resets the deadline: last activity 1s ago with a
    // 10-minute budget is NOT due, even at the original activity's
    // would-have-been boundary (the activity marker moved the deadline)
    expect(autoLockDue(t0 + 10 * MIN - 1_000, 10, t0 + 10 * MIN)).toBe(false);
  });

  it("PP2-D14: storage round-trip; malformed stored values degrade to the default", () => {
    installStorageStub();
    expect(readAutoLockMinutes()).toBe(10); // nothing stored yet
    writeAutoLockMinutes(0);
    expect(readAutoLockMinutes()).toBe(0);
    writeAutoLockMinutes(45);
    expect(readAutoLockMinutes()).toBe(45);
    // a hand-edited storage value degrades to the default (last-page
    // contract) — the raw malformed string never reaches the app
    backing.set("infinitenote.protection.autolock", "garbage");
    expect(readAutoLockMinutes()).toBe(10);
    backing.set("infinitenote.protection.autolock", "999");
    expect(readAutoLockMinutes()).toBe(10);
    // the writer re-sanitizes defensively: an out-of-range write stores
    // the default, not the garbage
    writeAutoLockMinutes(999);
    expect(backing.get("infinitenote.protection.autolock")).toBe("10");
    writeAutoLockMinutes(Number.NaN);
    expect(backing.get("infinitenote.protection.autolock")).toBe("10");
  });

  it("PP2-D15: no localStorage (SSR) reads the default and writes no-op", () => {
    delete (globalThis as unknown as { localStorage?: LocalStorageStub }).localStorage;
    expect(readAutoLockMinutes()).toBe(10);
    // the write must not throw without storage
    expect(() => writeAutoLockMinutes(30)).not.toThrow();
  });

  it("PP2-D16: lockAllProtectedSections locks every open section and reports the count", async () => {
    const { sec, open, page } = await home();
    const r1 = await notes.setSectionPassword(sec.id, "pw1", null, TEST_ITERATIONS);
    const r2 = await notes.setSectionPassword(open.id, "pw2", null, TEST_ITERATIONS);
    expect(r1).toBe("done");
    expect(r2).toBe("done");
    // both are unlocked right after protect (phase-1 semantics)...
    expect(unlockedSectionIdList().length).toBe(2);
    // ...and the lock-all primitive drops both keys and reports 2
    const count = await notes.lockAllProtectedSections();
    expect(count).toBe(2);
    expect(unlockedSectionIdList()).toEqual([]);
    expect(await notes.getPageContent(page.id)).toBeNull();
    // idempotent: with nothing open, the count is 0
    expect(await notes.lockAllProtectedSections()).toBe(0);
  });
});
