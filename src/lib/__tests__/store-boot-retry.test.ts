/// <reference types="bun-types" />
/**
 * Boot resilience (issue #77): a failing first load must (a) surface
 * `loadError` so the shell can offer a Retry button, and (b) clear the
 * single-flight guard so a retry actually re-runs the boot — instead of
 * caching the rejected promise forever (infinite "Opening…" spinner).
 *
 * This file must sort BEFORE the other store tests: it imports the store
 * module fresh (with a failing notes-db mock) and exercises its module-level
 * single-flight guard directly.
 */
import { beforeAll, describe, expect, it, mock } from "bun:test";

let notes: typeof import("../notes-db");
let store: typeof import("../store");

/** When true, every db list read throws — simulates a blocked IndexedDB. */
let failReads = false;

beforeAll(async () => {
  await import("fake-indexeddb/auto");
  notes = await import("../notes-db");
  const realListNotebooks = notes.listNotebooks;
  const mockedDb: typeof notes = {
    ...notes,
    listNotebooks: async () => {
      if (failReads) throw new Error("simulated db failure");
      return realListNotebooks();
    },
  };
  mock.module("../notes-db", () => mockedDb);
  store = await import("../store");
});

const state = () => store.useAppStore.getState();

describe("boot load resilience (issue #77)", () => {
  it("a rejected boot sets loadError and keeps loaded=false", async () => {
    // simulate a fresh boot: other test files may have run refresh() against
    // the shared store instance already
    store.useAppStore.setState({ loaded: false, loadError: null });
    failReads = true;
    await expect(state().load()).rejects.toThrow("simulated db failure");
    expect(state().loadError).toBe("loadFailed");
    expect(state().loaded).toBe(false);
  });

  it("retrying after the failure re-runs the boot and clears the error", async () => {
    failReads = false;
    // the guard was cleared on failure — this must be a REAL retry, not the
    // cached rejection
    await state().load();
    expect(state().loadError).toBeNull();
    expect(state().loaded).toBe(true);
    // first-run seeding still happened on the successful retry
    expect(state().notebooks.length).toBeGreaterThan(0);
  });

  it("a successful boot keeps loadError null and is single-flight", async () => {
    const p1 = state().load();
    const p2 = state().load();
    expect(p1).toBe(p2); // still single-flight while resolved
    await p1;
    expect(state().loadError).toBeNull();
  });
});
