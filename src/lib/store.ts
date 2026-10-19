"use client";

/**
 * App store — thin Zustand wrapper around the Dexie layer.
 * Holds the notebook/section/page tree + selection; content stays in the DB
 * and is loaded by the canvas on page switch.
 */
import { create } from "zustand";
import * as db from "./notes-db";
import { defaultExpandedState, firstPageSelection, nextSelectionAfterPageDelete, type Selection } from "./tree-ops";
import type { Notebook, NotebookColor, PageMeta, Section } from "./types";
import type { PageBackground } from "./types";

export type SaveIndicator = "idle" | "saving" | "saved" | "error";

interface AppStore {
  loaded: boolean;
  notebooks: Notebook[];
  sections: Section[];
  pages: PageMeta[];
  selection: Selection | null;
  expanded: Set<string>;
  saveIndicator: SaveIndicator;
  searchOpen: boolean;
  trashOpen: boolean;

  load: () => Promise<void>;
  refresh: () => Promise<void>;

  selectPage: (sel: Selection) => void;
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
  setPageBackground: (id: string, background: PageBackground) => Promise<void>;

  setSaveIndicator: (s: SaveIndicator) => void;
  setSearchOpen: (open: boolean) => void;
  setTrashOpen: (open: boolean) => void;

  // trash actions (result in refresh)
  restoreFromTrash: (kind: "notebook" | "section" | "page", id: string) => Promise<void>;
  purgeFromTrash: (kind: "notebook" | "section" | "page", id: string) => Promise<void>;
  restoreBackupArchive: (json: string) => Promise<number>;
  eraseEverything: () => Promise<void>;
}

const DEFAULT_NOTEBOOK_COLORS: NotebookColor[] = ["violet", "teal", "rose", "amber"];
const nextColor = (n: number) => DEFAULT_NOTEBOOK_COLORS[n % DEFAULT_NOTEBOOK_COLORS.length];

/** Single-flight guard so StrictMode double-mount never seeds twice. */
let initialLoadPromise: Promise<void> | null = null;

export const useAppStore = create<AppStore>((set, get) => ({
  loaded: false,
  notebooks: [],
  sections: [],
  pages: [],
  selection: null,
  expanded: new Set<string>(),
  saveIndicator: "idle",
  searchOpen: false,
  trashOpen: false,

  load: () => {
    if (!initialLoadPromise) {
      initialLoadPromise = (async () => {
        await get().refresh();
        const s = get();
        // First run → seed a small welcome notebook so the app is never empty.
        if (!s.notebooks.length && !s.sections.length && !s.pages.length) {
          await seedWelcomeData();
          await get().refresh();
        }
      })();
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
  toggleExpanded: (id) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expanded: next };
    }),

  addNotebook: async (name) => {
    const n = get().notebooks.length;
    const nb = await db.createNotebook(name?.trim() || `Notebook ${n + 1}`, nextColor(n));
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
    const sec = await db.createSection(notebookId, name?.trim() || `Section ${count + 1}`);
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
    const page = await db.createPage(sectionId, title?.trim() || `Page ${count + 1}`);
    await get().refresh();
    const sec = get().sections.find((s) => s.id === sectionId);
    set((s) => ({
      selection: {
        notebookId: sec?.notebookId ?? s.selection?.notebookId ?? "",
        sectionId,
        pageId: page.id,
      },
      expanded: new Set([...s.expanded, sectionId]),
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

  setSaveIndicator: (si) => set({ saveIndicator: si }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setTrashOpen: (open) => set({ trashOpen: open }),

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

/** Welcome content shown on first launch (also makes E2E deterministic). */
async function seedWelcomeData(): Promise<void> {
  const nb = await db.createNotebook("Welcome Notebook", "violet");
  const sec = await db.createSection(nb.id, "Getting Started");
  const scene = JSON.stringify({
    elements: [
      {
        type: "text",
        id: crypto.randomUUID(),
        x: 80,
        y: 60,
        width: 640,
        text: "Welcome to InfiniteNote",
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
        originalText: "Welcome to InfiniteNote",
        autoResize: true,
      },
      {
        type: "text",
        id: crypto.randomUUID(),
        x: 80,
        y: 160,
        width: 560,
        text: "An open-source notebook with an infinite canvas.\n\nLeft: your Notebooks, Sections and Pages — like OneNote.\nHere: draw anywhere with pen, highlighter, shapes and text.\n\nImport (top right): images, text, Markdown and PDF printouts.\nEverything is saved locally in your browser — offline first.",
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
  await db.createPage(sec.id, "Start here", scene);
  const sec2 = await db.createSection(nb.id, "Ideas");
  await db.createPage(sec2.id, "Brainstorm", null);
  const nb2 = await db.createNotebook("My Notebook", "teal");
  const sec3 = await db.createSection(nb2.id, "New Section");
  await db.createPage(sec3.id, "Page 1", null);
}
