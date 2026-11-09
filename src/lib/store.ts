"use client";

/**
 * App store — thin Zustand wrapper around the Dexie layer.
 * Holds the notebook/section/page tree + selection; content stays in the DB
 * and is loaded by the canvas on page switch.
 */
import { create } from "zustand";
import * as db from "./notes-db";
import { defaultExpandedState, firstPageSelection, nextSelectionAfterPageDelete, type Selection } from "./tree-ops";
import { loadLastSelection, pickRestoredSelection, saveLastSelection } from "./last-page";
import { quickNoteTitle, todayKey } from "./quick-notes";
import { generatedNames } from "./generated-names";
import type { Notebook, NotebookColor, PageMeta, Section } from "./types";
import type { PageBackground } from "./types";

export type SaveIndicator = "idle" | "saving" | "saved" | "error";

interface AppStore {
  loaded: boolean;
  /** "loadFailed" after a rejected boot load; cleared once a retry succeeds. */
  loadError: string | null;
  notebooks: Notebook[];
  sections: Section[];
  pages: PageMeta[];
  selection: Selection | null;
  expanded: Set<string>;
  saveIndicator: SaveIndicator;
  searchOpen: boolean;
  trashOpen: boolean;
  shortcutsOpen: boolean;
  historyOpen: boolean;

  load: () => Promise<void>;
  refresh: () => Promise<void>;

  selectPage: (sel: Selection) => void;
  /** Select AND expand the containing notebook + section (search / tag jumps). */
  revealSelection: (sel: Selection) => void;
  toggleExpanded: (id: string) => void;

  addNotebook: (name?: string) => Promise<void>;
  renameNotebook: (id: string, name: string) => Promise<void>;
  recolorNotebook: (id: string, color: NotebookColor) => Promise<void>;
  moveNotebook: (id: string, dir: -1 | 1) => Promise<void>;
  deleteNotebook: (id: string) => Promise<void>;

  addSection: (notebookId: string, name?: string) => Promise<void>;
  renameSection: (id: string, name: string) => Promise<void>;
  moveSection: (id: string, dir: -1 | 1) => Promise<void>;
  deleteSection: (id: string) => Promise<void>;

  addPage: (sectionId: string, title?: string) => Promise<void>;
  renamePage: (id: string, title: string) => Promise<void>;
  movePage: (id: string, dir: -1 | 1) => Promise<void>;
  duplicatePage: (id: string) => Promise<void>;
  deletePage: (id: string) => Promise<void>;

  /** Sidebar multi-select bulk actions (issue #27). Both return the number of pages affected. */
  bulkMovePages: (pageIds: string[], targetSectionId: string) => Promise<number>;
  bulkDeletePages: (pageIds: string[]) => Promise<number>;
  setPageBackground: (id: string, background: PageBackground) => Promise<void>;
  setPageTags: (id: string, tags: string[]) => Promise<void>;
  tagFilter: string | null;
  setTagFilter: (tag: string | null) => void;

  /** OneNote-style quick capture (issue #19). */
  createQuickNote: () => Promise<void>;
  openTodayPage: () => Promise<void>;
  /** Monotonic counter — the canvas focuses itself whenever it changes. */
  canvasFocus: number;
  requestCanvasFocus: () => void;

  setSaveIndicator: (s: SaveIndicator) => void;
  setSearchOpen: (open: boolean) => void;
  setTrashOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setHistoryOpen: (open: boolean) => void;

  // trash actions (result in refresh)
  restoreFromTrash: (kind: "notebook" | "section" | "page", id: string) => Promise<void>;
  purgeFromTrash: (kind: "notebook" | "section" | "page", id: string) => Promise<void>;
  restoreBackupArchive: (json: string) => Promise<number>;
  eraseEverything: () => Promise<void>;
}

/**
 * Issue #123: swap the firstPageSelection default (set by refresh()) for the
 * persisted last-opened page when the stored selection still resolves in the
 * freshly loaded tree.
 */
function restoreLastOpenedPage(stored: Selection | null): void {
  if (!stored) return;
  const s = useAppStore.getState();
  const tree = { notebooks: s.notebooks, sections: s.sections, pages: s.pages };
  const restored = pickRestoredSelection(stored, tree);
  if (!restored) return;
  useAppStore.setState({
    selection: restored,
    expanded: defaultExpandedState(tree, restored),
  });
}

const DEFAULT_NOTEBOOK_COLORS: NotebookColor[] = ["violet", "teal", "rose", "amber"];
const nextColor = (n: number) => DEFAULT_NOTEBOOK_COLORS[n % DEFAULT_NOTEBOOK_COLORS.length];

/** Single-flight guard so StrictMode double-mount never seeds twice. */
let initialLoadPromise: Promise<void> | null = null;

export const useAppStore = create<AppStore>((set, get) => ({
  loaded: false,
  loadError: null,
  notebooks: [],
  sections: [],
  pages: [],
  selection: null,
  expanded: new Set<string>(),
  saveIndicator: "idle",
  searchOpen: false,
  trashOpen: false,
  shortcutsOpen: false,
  historyOpen: false,
  tagFilter: null,
  canvasFocus: 0,

  load: () => {
    if (!initialLoadPromise) {
      const run = (async () => {
        // Issue #123: read the persisted selection BEFORE any refresh() —
        // the boot refresh sets the firstPageSelection default, which is a
        // selection change and would overwrite the stored value first.
        const storedSelection = loadLastSelection();
        await get().refresh();
        const s = get();
        // First run → seed a small welcome notebook so the app is never empty.
        if (!s.notebooks.length && !s.sections.length && !s.pages.length) {
          await seedWelcomeData();
          await get().refresh();
        }
        // Issue #123: reopen the page the user was working on before the
        // reload. A page trashed or deleted between sessions fails the tree
        // validation and boot keeps the firstPageSelection default.
        restoreLastOpenedPage(storedSelection);
        set({ loadError: null });
      })();
      // A rejected boot promise must never be cached (issue #77): a transient
      // IndexedDB failure would otherwise brick the session with an infinite
      // spinner. Clear the single-flight guard so the next load() retries, and
      // record the failure so the shell can offer a Retry button.
      initialLoadPromise = run.catch((err: unknown) => {
        initialLoadPromise = null;
        set({ loadError: "loadFailed" });
        throw err;
      });
    }
    return initialLoadPromise;
  },

  refresh: async () => {
    const [notebooks, sections, pages] = await Promise.all([
      db.listNotebooks(),
      db.listSections(),
      db.listPages(),
    ]);
    const prev = get();
    const prevSelection = prev.selection;
    const stillValid =
      prevSelection &&
      pages.some((p) => p.id === prevSelection.pageId) &&
      sections.some((s) => s.id === prevSelection.sectionId) &&
      notebooks.some((n) => n.id === prevSelection.notebookId);
    const selection = stillValid ? prevSelection : firstPageSelection({ notebooks, sections, pages });
    const expanded =
      prev.expanded.size || !selection
        ? prev.expanded
        : defaultExpandedState({ notebooks, sections, pages }, selection);
    set({ loaded: true, notebooks, sections, pages, selection, expanded });
  },

  selectPage: (sel) => set({ selection: sel }),

  /** Programmatic jumps (search, tag filter) must make the sidebar show
   *  where the user landed — expand the ancestors of the target page. */
  revealSelection: (sel) =>
    set((s) => ({
      selection: sel,
      expanded: new Set([...s.expanded, sel.notebookId, sel.sectionId]),
    })),
  toggleExpanded: (id) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expanded: next };
    }),

  addNotebook: async (name) => {
    const n = get().notebooks.length;
    const nb = await db.createNotebook(
      name?.trim() || generatedNames().notebook(n + 1),
      nextColor(n),
    );
    await get().refresh();
    set((s) => ({ expanded: new Set([...s.expanded, nb.id]) }));
  },
  renameNotebook: async (id, name) => {
    await db.renameNotebook(id, name);
    await get().refresh();
  },
  recolorNotebook: async (id, color) => {
    await db.setNotebookColor(id, color);
    await get().refresh();
  },
  moveNotebook: async (id, dir) => {
    await db.moveNotebook(id, dir);
    await get().refresh();
  },
  deleteNotebook: async (id) => {
    await db.trashNotebook(id);
    await get().refresh();
  },

  addSection: async (notebookId, name) => {
    const nb = get().notebooks.find((n) => n.id === notebookId);
    const count = get().sections.filter((s) => s.notebookId === notebookId).length;
    const sec = await db.createSection(
      notebookId,
      name?.trim() || generatedNames().section(count + 1),
    );
    await get().refresh();
    set((s) => ({ expanded: new Set([...s.expanded, nb ? nb.id : "", sec.id]) }));
  },
  renameSection: async (id, name) => {
    await db.renameSection(id, name);
    await get().refresh();
  },
  moveSection: async (id, dir) => {
    await db.moveSection(id, dir);
    await get().refresh();
  },
  deleteSection: async (id) => {
    await db.trashSection(id);
    await get().refresh();
  },

  addPage: async (sectionId, title) => {
    const count = get().pages.filter((p) => p.sectionId === sectionId).length;
    const page = await db.createPage(
      sectionId,
      title?.trim() || generatedNames().page(count + 1),
    );
    await get().refresh();
    const sec = get().sections.find((s) => s.id === sectionId);
    set((s) => ({
      selection: {
        notebookId: sec?.notebookId ?? s.selection?.notebookId ?? "",
        sectionId,
        pageId: page.id,
      },
      expanded: new Set([...s.expanded, sectionId]),
      // a freshly created page must grab keyboard focus (issue #81): the
      // canvas focuses itself whenever this counter moves — same mechanism
      // as quick capture, so typing works immediately after "+ Page"
      canvasFocus: s.canvasFocus + 1,
    }));
  },
  renamePage: async (id, title) => {
    await db.renamePage(id, title);
    await get().refresh();
  },
  setPageBackground: async (id, background) => {
    await db.setPageBackground(id, background);
    await get().refresh();
  },
  setPageTags: async (id, tags) => {
    await db.setPageTags(id, tags);
    await get().refresh();
  },
  setTagFilter: (tag) => set({ tagFilter: tag }),

  /**
   * Quick capture (issue #19): append a fresh page to the Quick Notes
   * section (bootstrapped on first use), title stamped with today's date,
   * then select it so the user lands on a ready-to-type canvas.
   */
  createQuickNote: async () => {
    const home = await db.ensureQuickNotesHome(
      generatedNames().quickNotesNotebook,
      generatedNames().quickNotesSection
    );
    const page = await db.createPage(home.section.id, quickNoteTitle());
    await get().refresh();
    set((s) => ({
      selection: {
        notebookId: home.notebook.id,
        sectionId: home.section.id,
        pageId: page.id,
      },
      expanded: new Set([...s.expanded, home.notebook.id, home.section.id]),
      canvasFocus: s.canvasFocus + 1,
    }));
  },

  /**
   * Today smart page (issue #19): open the daily page titled with today's
   * local date key, creating it in Quick Notes when missing. Re-clicking
   * (or reloading) always reuses the same page for the day.
   */
  openTodayPage: async () => {
    const home = await db.ensureQuickNotesHome(
      generatedNames().quickNotesNotebook,
      generatedNames().quickNotesSection
    );
    const key = todayKey();
    const existing = await db.findPageByTitle(home.section.id, key);
    const page = existing ?? (await db.createPage(home.section.id, key));
    await get().refresh();
    set((s) => ({
      selection: {
        notebookId: home.notebook.id,
        sectionId: home.section.id,
        pageId: page.id,
      },
      expanded: new Set([...s.expanded, home.notebook.id, home.section.id]),
      canvasFocus: s.canvasFocus + 1,
    }));
  },

  requestCanvasFocus: () => set((s) => ({ canvasFocus: s.canvasFocus + 1 })),

  movePage: async (id, dir) => {
    await db.movePage(id, dir);
    await get().refresh();
  },
  duplicatePage: async (id) => {
    const copy = await db.duplicatePage(id);
    if (!copy) return;
    await get().refresh();
    const sec = get().sections.find((s) => s.id === copy.sectionId);
    set((s) => ({
      selection: {
        notebookId: sec?.notebookId ?? s.selection?.notebookId ?? "",
        sectionId: copy.sectionId,
        pageId: copy.id,
      },
      expanded: new Set([...s.expanded, copy.sectionId]),
      // focus the duplicated page's canvas too (issue #81)
      canvasFocus: s.canvasFocus + 1,
    }));
  },
  deletePage: async (id) => {
    const tree = {
      notebooks: get().notebooks,
      sections: get().sections,
      pages: get().pages,
    };
    const selection = get().selection;
    const next =
      selection && selection.pageId === id ? nextSelectionAfterPageDelete(tree, selection) : selection;
    await db.trashPage(id);
    await get().refresh();
    if (next) set({ selection: next });
  },

  /**
   * Bulk move (issue #27): append the selected pages to the target section
   * (cross-notebook allowed). When the currently open page is part of the
   * batch, the selection follows it to its new home so the canvas keeps
   * showing the same page; the target section is expanded to reveal it.
   */
  bulkMovePages: async (pageIds, targetSectionId) => {
    const moved = await db.movePagesToSection(pageIds, targetSectionId);
    if (moved === 0) return 0;
    await get().refresh();
    const target = get().sections.find((s) => s.id === targetSectionId);
    if (!target) return moved;
    const selection = get().selection;
    const selectionFollowed =
      selection && pageIds.includes(selection.pageId)
        ? {
            notebookId: target.notebookId,
            sectionId: target.id,
            pageId: selection.pageId,
          }
        : null;
    set((s) => ({
      ...(selectionFollowed ? { selection: selectionFollowed } : {}),
      expanded: new Set([...s.expanded, target.notebookId, target.id]),
    }));
    return moved;
  },

  /**
   * Bulk delete (issue #27): trash all selected pages in one transaction.
   * When the open page is deleted, the next selection is computed against
   * the tree minus the whole batch (never lands on another deleted page).
   */
  bulkDeletePages: async (pageIds) => {
    const ids = [...new Set(pageIds)];
    if (ids.length === 0) return 0;
    const tree = {
      notebooks: get().notebooks,
      sections: get().sections,
      pages: get().pages,
    };
    const selection = get().selection;
    let next = selection;
    if (selection && ids.includes(selection.pageId)) {
      // candidates must exclude every deleted page, but keep the open one
      // for the order lookup inside nextSelectionAfterPageDelete
      const others = tree.pages.filter(
        (p) => !ids.includes(p.id) || p.id === selection.pageId
      );
      next = nextSelectionAfterPageDelete({ ...tree, pages: others }, selection);
    }
    const trashed = await db.trashPages(ids);
    await get().refresh();
    if (next) set({ selection: next });
    return trashed;
  },

  setSaveIndicator: (si) => set({ saveIndicator: si }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setTrashOpen: (open) => set({ trashOpen: open }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  setHistoryOpen: (open) => set({ historyOpen: open }),

  restoreFromTrash: async (kind, id) => {
    if (kind === "notebook") await db.restoreNotebook(id);
    else if (kind === "section") await db.restoreSection(id);
    else await db.restorePage(id);
    await get().refresh();
  },
  purgeFromTrash: async (kind, id) => {
    if (kind === "notebook") await db.purgeNotebook(id);
    else if (kind === "section") await db.purgeSection(id);
    else await db.purgePage(id);
    await get().refresh();
  },
  restoreBackupArchive: async (json) => {
    const count = await db.restoreBackup(json);
    await get().refresh();
    return count;
  },
  eraseEverything: async () => {
    await db.eraseAllData();
    await seedWelcomeData();
    await get().refresh();
  },
}));

/** Welcome content shown on first launch (also makes E2E deterministic).
 * Localized via the generated-names registry (issue #63): the default
 * locale is English, which keeps the E2E seed byte-stable. */
async function seedWelcomeData(): Promise<void> {
  const names = generatedNames().welcome;
  const nb = await db.createNotebook(names.notebook, "violet");
  const sec = await db.createSection(nb.id, names.section);
  const scene = JSON.stringify({
    elements: [
      {
        type: "text",
        id: crypto.randomUUID(),
        x: 80,
        y: 60,
        width: 640,
        text: names.title,
        fontSize: 44,
        fontFamily: 5,
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: "#1e1b4b",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        angle: 0,
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
        groupIds: [],
        frameId: null,
        roundness: null,
        baseline: 40,
        lineHeight: 1.25,
        containerId: null,
        originalText: names.title,
        autoResize: true,
      },
      {
        type: "text",
        id: crypto.randomUUID(),
        x: 80,
        y: 160,
        width: 560,
        text: names.body,
        fontSize: 22,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: "#334155",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        angle: 0,
        seed: 2,
        version: 1,
        versionNonce: 2,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
        groupIds: [],
        frameId: null,
        roundness: null,
        baseline: 20,
        lineHeight: 1.25,
        containerId: null,
        originalText: "",
        autoResize: true,
      },
    ],
    files: {},
  });
  await db.createPage(sec.id, names.startHere, scene);
  const sec2 = await db.createSection(nb.id, names.ideasSection);
  await db.createPage(sec2.id, names.brainstorm, null);
  const nb2 = await db.createNotebook(names.myNotebook, "teal");
  const sec3 = await db.createSection(nb2.id, names.mySection);
  await db.createPage(sec3.id, names.pageOne, null);
}

// Issue #123: persist every selection change so a reload reopens where the
// user left off. Subscribing once at module level covers ALL writers —
// sidebar clicks, deletes, bulk moves, quick notes, programmatic jumps —
// without touching each action. Browser-only: the store module also loads
// during SSR, where localStorage does not exist.
if (typeof window !== "undefined") {
  useAppStore.subscribe((state, prev) => {
    if (state.selection && state.selection !== prev.selection) {
      saveLastSelection(state.selection);
    }
  });
}