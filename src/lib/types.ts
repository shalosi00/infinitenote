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
  /**
   * Parent section id when this section nests inside another (sub-sections,
   * issue #314). null/absent = top level under the notebook (the pre-#314
   * shape). Optional by design: old rows and old sync folders stay valid.
   */
  parentId?: string | null;
  /**
   * Explicit color override (OneNote "Section Color" parity, issue #319).
   * null/absent = inherit the notebook's color (`color ?? null` is the
   * canonical read; the policy lives in section-colors.ts). Additive and
   * NOT indexed — the parentId precedent: no Dexie version bump, old rows
   * and old sync folders stay valid.
   */
  color?: NotebookColor | null;
  /**
   * OneNote "Section Groups" parity (issue #337, sub-sections phase 3):
   * "group" marks the row as a section group — a container that holds
   * sections only, never pages. Absent/null = a plain section (the pre-
   * #337 shape). Additive and NOT indexed — the parentId/color precedent:
   * no Dexie version bump, old rows and old sync folders stay valid; the
   * policy lives in section-groups.ts.
   */
  kind?: "group" | null;
  /**
   * OneNote "Password Protection" parity (issue #371, phase 1): the
   * additive at-rest encryption envelope for the section's pages. Absent/
   * null = unprotected (the pre-#371 shape — old rows, old backups and
   * old sync folders stay byte-stable). Additive and NOT indexed — the
   * parentId/color/kind precedent: no Dexie version bump. The policy and
   * the crypto envelope live in section-protection.ts.
   */
  protection?: SectionProtection | null;
  name: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * The at-rest protection envelope (issue #371). A random per-section data
 * key is wrapped with a PBKDF2-derived key; the shape is validated by
 * safeProtection (hand-edited archives degrade to "unprotected", never
 * throw) and carried by whole-row LWW in sync manifests and backups.
 */
export interface SectionProtection {
  /** base64url PBKDF2 salt (fresh random per set / change) */
  salt: string;
  /** PBKDF2-HMAC-SHA256 iteration count (pinned; recorded per row) */
  iterations: number;
  /** base64url AES-GCM-encrypted raw data key (the wrap) */
  wrappedKey: string;
  /** base64url GCM IV of the wrap */
  wrapIv: string;
  /** optional user hint shown on the unlock card (OneNote's hint) */
  hint?: string | null;
}

/** Paper style of a page (OneNote-style ruled/grid backgrounds). */
export type PageBackground = "plain" | "ruled" | "grid";

export const PAGE_BACKGROUNDS: PageBackground[] = ["plain", "ruled", "grid"];

export const isPageBackground = (v: unknown): v is PageBackground =>
  typeof v === "string" && (PAGE_BACKGROUNDS as string[]).includes(v);

/**
 * OneNote "Page Color" parity (issue #385): a page surface carries a pale
 * tint. The ids reuse the app's eight hue families (NotebookColor naming)
 * but resolve to their own pale values — PAGE_COLOR_HEX in page-colors.ts.
 * null/absent = none (white paper). Additive and NOT indexed — the
 * section-color precedent (issue #319): no Dexie version bump, old rows,
 * old backups and old sync folders stay valid.
 */
export type PageColor =
  | "violet"
  | "rose"
  | "orange"
  | "amber"
  | "emerald"
  | "teal"
  | "cyan"
  | "pink";

export const PAGE_COLORS: PageColor[] = [
  "violet",
  "rose",
  "orange",
  "amber",
  "emerald",
  "teal",
  "cyan",
  "pink",
];

export interface PageRow {
  id: string;
  sectionId: string;
  /**
   * Parent page id when this page is a subpage (OneNote "Make subpage"
   * parity, issue #359). null/absent = top level in the section's page
   * list (the pre-#359 shape). Optional by design: old rows, old backups
   * and old sync folders stay valid. NOT indexed — the section parentId
   * precedent (issue #314): no Dexie version bump. The policy lives in
   * page-tree.ts; the OneNote depth cap is two tiers of subpages.
   */
  parentId?: string | null;
  title: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** paper style — plain by default (absent on pre-v1.2 rows) */
  background?: PageBackground;
  /** OneNote "Page Color" tint (issue #385) — pale value in page-colors.ts; absent = none */
  pageColor?: PageColor | null;
  /** short labels used by the sidebar tag filter and search */
  tags?: string[];
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

/** One template inside a backup archive (issue #279) — content included. */
export interface BackupTemplate {
  name: string;
  createdAt: number;
  elementCount: number;
  byteSize: number;
  background?: PageBackground;
  /** issue #385 — a template carries the tint it was saved from */
  pageColor?: PageColor | null;
  content: string;
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
  /** added with schema v4 — absent in archives exported before templates */
  templates?: BackupTemplate[];
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
