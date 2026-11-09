/// <reference types="bun-types" />
/**
 * Page version history — policy unit tests (test plan: docs/test-plans/
 * version-history.md, ids VH-P*).
 *
 * The policy module is pure: no Dexie, no DOM — clocks and payloads are
 * injected, so the auto-snapshot interval and the structural dedupe gate
 * are tested deterministically.
 */
import { describe, expect, it } from "bun:test";
import {
  AUTO_SNAPSHOT_MIN_INTERVAL_MS,
  MAX_VERSIONS_PER_PAGE,
  buildPageVersion,
  pruneToCapacity,
  relativeVersionTime,
  shouldAutoSnapshot,
  sortVersionsNewestFirst,
} from "../version-history";
import type { PageVersionRow } from "../version-history";

/* ------------------------------- fixtures ------------------------------- */

const T0 = 1_700_000_000_000;

const el = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  text: `body of ${id}`,
  version: 1,
  versionNonce: 1,
  updated: 1,
  ...extra,
});

const payload = (elements: Array<Record<string, unknown>> = []) => ({
  elements: elements as unknown[],
  files: {},
});

function makeVersion(overrides: Partial<PageVersionRow> = {}): PageVersionRow {
  const base = buildPageVersion("page-1", payload([el("a"), el("b")]), "manual", T0);
  return { ...base, ...overrides };
}

/* --------------------------- buildPageVersion ---------------------------- */

describe("buildPageVersion (VH-P01..P06)", () => {
  it("VH-P01: carries pageId, createdAt, source and a fresh uuid-shaped id", () => {
    const row = buildPageVersion("page-9", payload([el("a")]), "auto", T0 + 5_000);
    expect(row.pageId).toBe("page-9");
    expect(row.createdAt).toBe(T0 + 5_000);
    expect(row.source).toBe("auto");
    // uuid shape (36 chars, 4 dashes) — not the page id, not a constant
    expect(row.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    const second = buildPageVersion("page-9", payload([el("a")]), "auto", T0 + 5_000);
    expect(second.id).not.toBe(row.id);
  });

  it("VH-P02: elementCount counts live elements only (tombstones excluded)", () => {
    const live = [el("a"), el("b"), el("c")];
    const tombstone = el("dead", { isDeleted: true });
    const row = buildPageVersion("p", payload([...live, tombstone]), "manual", T0);
    expect(row.elementCount).toBe(3);
  });

  it("VH-P03: byteSize equals the serialized content length", () => {
    const row = buildPageVersion("p", payload([el("a")]), "manual", T0);
    expect(row.byteSize).toBe(row.content.length);
  });

  it("VH-P04: content round-trips through JSON", () => {
    const scene = payload([el("a", { deep: { nested: [1, 2, 3] } })]);
    const row = buildPageVersion("p", scene, "manual", T0);
    expect(JSON.parse(row.content)).toEqual(scene);
  });

  it("VH-P05: all three sources are recorded verbatim", () => {
    for (const source of ["auto", "manual", "pre-restore"] as const) {
      expect(buildPageVersion("p", payload(), source, T0).source).toBe(source);
    }
  });

  it("VH-P06: an empty scene still yields a valid row", () => {
    const row = buildPageVersion("p", payload(), "manual", T0);
    expect(row.elementCount).toBe(0);
    expect(row.byteSize).toBeGreaterThan(0);
    expect(JSON.parse(row.content).elements).toEqual([]);
  });
});

/* --------------------------- shouldAutoSnapshot -------------------------- */

describe("shouldAutoSnapshot (VH-P10..P16)", () => {
  const interval = AUTO_SNAPSHOT_MIN_INTERVAL_MS;
  const changed = payload([el("a"), el("b")]);
  const changedMore = payload([el("a"), el("b"), el("c")]);

  it("VH-P10: no previous version → snapshot", () => {
    expect(shouldAutoSnapshot(null, changed, T0)).toBe(true);
  });

  it("VH-P11: identical structure → never, even long after the interval", () => {
    const last = makeVersion({ createdAt: T0, content: JSON.stringify(changed) });
    expect(shouldAutoSnapshot(last, changed, T0 + interval * 50)).toBe(false);
  });

  it("VH-P12: changed structure + interval elapsed → snapshot", () => {
    const last = makeVersion({ createdAt: T0, content: JSON.stringify(changed) });
    expect(shouldAutoSnapshot(last, changedMore, T0 + interval)).toBe(true);
  });

  it("VH-P13: changed structure + interval NOT elapsed → skip", () => {
    const last = makeVersion({ createdAt: T0, content: JSON.stringify(changed) });
    expect(shouldAutoSnapshot(last, changedMore, T0 + interval - 1)).toBe(false);
  });

  it("VH-P14: boundary — exactly at the interval → snapshot (>=)", () => {
    const last = makeVersion({ createdAt: T0, content: JSON.stringify(changed) });
    expect(shouldAutoSnapshot(last, changedMore, T0 + interval)).toBe(true);
  });

  it("VH-P15: corrupt last-version content is treated as changed → snapshot", () => {
    const last = makeVersion({ content: "{not json" });
    expect(shouldAutoSnapshot(last, changed, T0)).toBe(true);
  });

  it("VH-P16: volatile-only metadata bumps are absorbed, not treated as change", () => {
    // same content, only version/versionNonce/updated re-stamped
    const stored = payload([el("a", { version: 1, versionNonce: 1, updated: 1 })]);
    const current = payload([el("a", { version: 42, versionNonce: 99, updated: 12345 })]);
    const last = makeVersion({ createdAt: T0, content: JSON.stringify(stored) });
    expect(shouldAutoSnapshot(last, current, T0 + interval)).toBe(false);
  });
});

/* ---------------------------- pruneToCapacity ---------------------------- */

describe("pruneToCapacity (VH-P20..P25)", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      makeVersion({ id: `v${String(i).padStart(3, "0")}`, createdAt: T0 + i * 1_000 })
    );

  it("VH-P20: under capacity → nothing to delete", () => {
    expect(pruneToCapacity(rows(3))).toEqual([]);
  });

  it("VH-P21: exactly at capacity → nothing deleted", () => {
    expect(pruneToCapacity(rows(MAX_VERSIONS_PER_PAGE))).toEqual([]);
  });

  it("VH-P22: capacity + 1 → exactly the oldest row is returned", () => {
    const over = rows(MAX_VERSIONS_PER_PAGE + 1);
    expect(pruneToCapacity(over)).toEqual(["v000"]);
  });

  it("VH-P23: far over capacity → newest `keep` survive", () => {
    const over = rows(MAX_VERSIONS_PER_PAGE + 10);
    const drop = pruneToCapacity(over);
    expect(drop).toHaveLength(10);
    expect(drop).toEqual(
      Array.from({ length: 10 }, (_, i) => `v${String(i).padStart(3, "0")}`)
    );
  });

  it("VH-P24: createdAt ties resolve deterministically — later id survives", () => {
    const tie = [
      makeVersion({ id: "aaa", createdAt: T0 }),
      makeVersion({ id: "zzz", createdAt: T0 }),
      makeVersion({ id: "mmm", createdAt: T0 }),
    ];
    // keep = 2 → the newest two by (createdAt desc, id desc) = zzz, mmm survive
    expect(pruneToCapacity(tie, 2)).toEqual(["aaa"]);
  });

  it("VH-P25: keep = 0 → every id returned (pure, no hidden floor)", () => {
    const two = rows(2);
    expect(pruneToCapacity(two, 0).sort()).toEqual(["v000", "v001"]);
  });
});

/* ------------------------- sort + relative time -------------------------- */

describe("sortVersionsNewestFirst (VH-P30)", () => {
  it("sorts by createdAt descending; tolerates empty input", () => {
    const unsorted = [
      makeVersion({ id: "old", createdAt: T0 }),
      makeVersion({ id: "new", createdAt: T0 + 60_000 }),
      makeVersion({ id: "mid", createdAt: T0 + 30_000 }),
    ];
    expect(sortVersionsNewestFirst(unsorted).map((v) => v.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
    expect(sortVersionsNewestFirst([])).toEqual([]);
  });
});

describe("relativeVersionTime (VH-P31, VH-P32)", () => {
  const now = T0;

  it("VH-P31: covers the just-now / seconds / minutes / hours / days buckets", () => {
    expect(relativeVersionTime(now, now)).toBe("just now");
    expect(relativeVersionTime(now - 9_000, now)).toBe("just now");
    expect(relativeVersionTime(now - 10_000, now)).toBe("10 seconds ago");
    expect(relativeVersionTime(now - 59_000, now)).toBe("59 seconds ago");
    expect(relativeVersionTime(now - 60_000, now)).toBe("1 minute ago");
    expect(relativeVersionTime(now - 119_999, now)).toBe("1 minute ago");
    expect(relativeVersionTime(now - 120_000, now)).toBe("2 minutes ago");
    expect(relativeVersionTime(now - 3_600_000, now)).toBe("1 hour ago");
    expect(relativeVersionTime(now - 7_200_000, now)).toBe("2 hours ago");
    expect(relativeVersionTime(now - 86_400_000, now)).toBe("1 day ago");
    expect(relativeVersionTime(now - 5 * 86_400_000, now)).toBe("5 days ago");
  });

  it("VH-P32: long spans use locale-free month/year buckets", () => {
    expect(relativeVersionTime(now - 31 * 86_400_000, now)).toBe("over a month ago");
    expect(relativeVersionTime(now - 366 * 86_400_000, now)).toBe("over a year ago");
  });
});
