/**
 * Custom page templates — pure policy for the OneNote "Page Templates"
 * parity feature (issue #279). No Dexie, no DOM, no Excalidraw imports:
 * everything here runs identically in the browser bundle, in bun unit
 * tests and during SSR.
 *
 * OneNote's model (probed 2026-11-19, issue #279): save any page as a
 * template, create new pages from a template gallery; templates are
 * per-machine by design. InfiniteNote follows it exactly — the data layer
 * lives in notes-db.ts (additive `templates` store, schema v4), the UI in
 * save-template-dialog.tsx + templates-dialog.tsx.
 *
 * A template stores the page's full scene payload (elements + files) under
 * a user-chosen name plus the page's paper style, so a page created from a
 * template is a true copy of the page it was saved from. The payload cap
 * reuses the file-attachment policy (MAX_FILE_ATTACHMENT_BYTES): a
 * template's payload is a base64-bearing JSON string inside the scene
 * JSON — it duplicates on every page created from it, so anything past
 * the 10 MiB attachment cap is refused.
 */
import { MAX_FILE_ATTACHMENT_BYTES } from "./file-attachment";
import { safePageColor } from "./page-colors";
import type { PageBackground, PageColor, ScenePayload } from "./types";

/** One template as listed in the picker — content stays in the DB. */
export interface TemplateSummary {
  id: string;
  name: string;
  createdAt: number;
  /** live (non-tombstone) element count of the stored scene */
  elementCount: number;
  /** serialized JSON size in bytes */
  byteSize: number;
  /** paper style carried onto created pages (absent = plain) */
  background?: PageBackground;
  /** page tint carried onto created pages (issue #385; absent = none) */
  pageColor?: PageColor | null;
}

/** A stored template row (the summary plus the serialized scene). */
export interface TemplateRow extends TemplateSummary {
  /** serialized ScenePayload — the exact bytes `savePageContent` would store */
  content: string;
}

/** Same size policy as file attachments (issue #278). */
export const MAX_TEMPLATE_BYTES = MAX_FILE_ATTACHMENT_BYTES;

/** Names are display labels; the picker sorts by them. */
export const TEMPLATE_NAME_MAX = 120;

export type TemplateErrorCode = "invalid-name" | "too-large";

export class TemplateError extends Error {
  constructor(public readonly code: TemplateErrorCode) {
    super(code);
    this.name = "TemplateError";
  }
}

/** Toast-ready English messages, keyed by code (the restore-error pattern). */
export const TEMPLATE_ERROR_MESSAGES: Record<TemplateErrorCode, string> = {
  "invalid-name": "Give the template a name (1-120 characters).",
  "too-large":
    "This page is too large to save as a template — the 10 MiB file-attachment cap also applies here.",
};

/**
 * Validate + normalize a template name. Empty/whitespace-only names and
 * names past 120 characters are refused with the typed error — the UI
 * maps the code to an explicit toast instead of guessing.
 */
export function validateTemplateName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.length > TEMPLATE_NAME_MAX) {
    throw new TemplateError("invalid-name");
  }
  return name;
}

/** Build a full template row for a scene — deterministic, no clock reads. */
export function buildTemplateRow(
  name: string,
  payload: ScenePayload,
  background: PageBackground | undefined,
  at: number,
  pageColor?: PageColor | null,
): TemplateRow {
  const content = JSON.stringify(payload);
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: at,
    content,
    elementCount: payload.elements.filter(
      (el) => !(el as { isDeleted?: boolean } | null)?.isDeleted,
    ).length,
    byteSize: content.length,
    ...(background ? { background } : {}),
    ...(safePageColor(pageColor) ? { pageColor } : {}),
  };
}

/**
 * The scene a stored template holds. Corrupt rows (bad JSON, wrong shape)
 * restore nothing rather than garbage — null means "skip this template",
 * never "crash the picker".
 */
export function parseTemplateContent(content: string): ScenePayload | null {
  try {
    const payload = JSON.parse(content) as ScenePayload;
    if (!Array.isArray(payload.elements)) return null;
    if (
      payload.files !== null &&
      payload.files !== undefined &&
      (typeof payload.files !== "object" || Array.isArray(payload.files))
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Template rows, picker order: name A→Z case-insensitive, newest first on ties. */
export function sortTemplatesForPicker<
  T extends { name: string; createdAt: number; id: string },
>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      b.createdAt - a.createdAt ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
