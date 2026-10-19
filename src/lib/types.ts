/**
 * InfiniteNote domain types.
 *
 * OneNote-style hierarchy: Notebook → Section → Page.
 * Each Page owns one Excalidraw scene (elements + binary files) stored as JSON.
 */

export type NotebookColor =
  | "violet"
  | "rose"
  | "orange"
  | "amber"
  | "emerald"
  | "teal"
  | "cyan"
  | "pink";

export const NOTEBOOK_COLORS: NotebookColor[] = [
  "violet",
  "rose",
  "orange",
  "amber",
  "emerald",
  "teal",
  "cyan",
  "pink",
];

export const NOTEBOOK_COLOR_HEX: Record<NotebookColor, string> = {
  violet: "#8b5cf6",
  rose: "#f43f5e",
  orange: "#f97316",
  amber: "#f59e0b",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  pink: "#ec4899",
};

export interface Notebook {
  id: string;
  name: string;
  color: NotebookColor;
  order: number;
  createdAt: number;
  updatedAt: number;
  /** epoch ms when soft-deleted, null when alive */
  deletedAt: number | null;
}

export interface Section {
  id: string;
  notebookId: string;
  name: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface PageRow {
  id: string;
  sectionId: string;
  title: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** serialized Excalidraw scene: { elements, files } — kept out of tree listings */
  content?: string | null;
}

/** A page without heavy content — used for the sidebar tree + listings. */
export type PageMeta = Omit<PageRow, "content">;

/** Serialized scene payload persisted per page. */
export interface ScenePayload {
  elements: readonly unknown[];
  files: Record<string, { id: string; dataURL: string; mimeType: string; created: number }>;
}

export interface BackupFile {
  app: "infinitenote";
  version: 1;
  exportedAt: number;
  notebooks: Array<
    Notebook & {
      sections: Array<Section & { pages: Array<PageMeta & { content: string | null }> }>;
    }
  >;
}

export const isNotebookColor = (v: unknown): v is NotebookColor =>
  typeof v === "string" && NOTEBOOK_COLORS.includes(v as NotebookColor);

/**
 * Deterministic order comparator used everywhere the tree is sorted:
 * order asc → createdAt asc → id asc (uuid tie-break keeps tests stable).
 */
export function byOrder<
  T extends { order: number; createdAt: number; id: string },
>(a: T, b: T): number {
  return (
    a.order - b.order ||
    a.createdAt - b.createdAt ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
