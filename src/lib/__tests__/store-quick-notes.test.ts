/// <reference types="bun-types" />
/**
 * Store-level tests for quick capture (issue #19): createQuickNote and
 * openTodayPage drive the real Dexie layer (fake-indexeddb) through the
 * zustand store, asserting selection/expansion/focus side effects.
 *
 * Clock note: both actions stamp titles from the wall clock. Tests assert
 * the format (not a fixed date) so they hold at any time of day; the only
 * theoretical flake is a run that crosses local midnight mid-test.
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";

let notes: typeof import("../notes-db");
let store: typeof import("../store");
let quick: typeof import("../quick-notes");

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
  store = await import("../store");
  quick = await import("../quick-notes");
});

beforeEach(async () => {
  await notes.db.delete();
  await new Promise((r) => setTimeout(r, 25));
  await notes.db.open();
});

const state = () => store.useAppStore.getState();
const selectedPage = () => {
  const s = state();
  return s.pages.find((p) => p.id === s.selection?.pageId) ?? null;
};

describe("createQuickNote", () => {
  it("bootstraps the Quick Notes home and lands on a dated new page", async () => {
    await state().createQuickNote();

    const s = state();
    // home exists exactly once
    const homeNotebooks = s.notebooks.filter((n) => n.name === "Quick Notes");
    expect(homeNotebooks).toHaveLength(1);
    const homeSections = s.sections.filter((sec) => sec.name === "Quick Notes");
    expect(homeSections).toHaveLength(1);

    // a page was created inside it and is now selected
    const page = selectedPage();
    expect(page).not.toBeNull();
    expect(page?.sectionId).toBe(homeSections[0].id);
    expect(page?.title).toMatch(/^Quick note \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    // tree state: selection + expansion reveal the new page
    expect(s.selection?.notebookId).toBe(homeNotebooks[0].id);
    expect(s.expanded.has(homeNotebooks[0].id)).toBe(true);
    expect(s.expanded.has(homeSections[0].id)).toBe(true);
    // canvas was asked to take focus
    expect(s.canvasFocus).toBeGreaterThan(0);
  });

  it("appends further quick notes to the same section, selecting the newest", async () => {
    await state().createQuickNote();
    await state().createQuickNote();
    await state().createQuickNote();

    const s = state();
    expect(s.notebooks.filter((n) => n.name === "Quick Notes")).toHaveLength(1);
    const homeSection = s.sections.find((sec) => sec.name === "Quick Notes");
    expect(homeSection).toBeDefined();
    const pages = s.pages.filter((p) => p.sectionId === homeSection!.id);
    expect(pages).toHaveLength(3);

    const selected = selectedPage();
    // order is strictly increasing per create — createdAt can tie within 1ms
    expect(selected?.id).toBe(pages.sort((a, b) => b.order - a.order)[0]?.id);
  });
});

describe("openTodayPage", () => {
  it("creates today's daily page once and reuses it on every open", async () => {
    await state().openTodayPage();
    const first = selectedPage();
    expect(first?.title).toBe(quick.todayKey());

    await state().openTodayPage();
    await state().openTodayPage();

    const s = state();
    const homeSection = s.sections.find((sec) => sec.name === "Quick Notes");
    const daily = s.pages.filter((p) => p.sectionId === homeSection!.id && p.title === quick.todayKey());
    expect(daily).toHaveLength(1);
    expect(s.selection?.pageId).toBe(daily[0]!.id);
    expect(daily[0]!.id).toBe(first!.id);
  });

  it("re-creates the daily page after the previous one was trashed", async () => {
    await state().openTodayPage();
    const first = selectedPage();
    await notes.trashPage(first!.id);

    await state().openTodayPage();
    const second = selectedPage();
    expect(second?.title).toBe(quick.todayKey());
    expect(second?.id).not.toBe(first?.id);
  });

  it("keeps quick notes out of the daily slot (titles differ)", async () => {
    await state().createQuickNote();
    await state().openTodayPage();
    const s = state();
    const homeSection = s.sections.find((sec) => sec.name === "Quick Notes");
    const titles = s.pages
      .filter((p) => p.sectionId === homeSection!.id)
      .map((p) => p.title);
    expect(titles).toHaveLength(2);
    // exactly one daily page and one quick note — and never the same slot
    expect(titles.filter((t) => quick.isDailyPageTitle(t))).toHaveLength(1);
    expect(titles.filter((t) => !quick.isDailyPageTitle(t))).toHaveLength(1);
  });
});
