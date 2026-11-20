/**
 * Checklists — OneNote "To Do tag" parity (issue #302).
 *
 * A checklist item is a NORMAL single-line text element whose text starts
 * with the `[ ]` / `[x]` task-list convention — no new element type, no
 * customData, no data-model change. The checked state IS the text itself,
 * so scene persistence, sync folders, backups and version history carry it
 * untouched, and the item text (prefix included) stays fully
 * full-text-searchable with zero search changes.
 *
 * OneNote behavior this mirrors (support.microsoft.com — "Create a To Do
 * checklist"): type a line, then apply the To Do tag to it; click the box
 * as you complete items. Joplin renders `- [ ]` / `- [x]` as interactive
 * checkboxes; Logseq's TODO keyword family cycles task state. Ours is the
 * GFM task-list token WITHOUT the markdown dash: `[ ] item` renders as the
 * plain text it already was, and the toggle surfaces flip the token.
 *
 * Measured desktop constraint that shapes the surfaces (0.18.1 dist:
 * `autoSelect: !device.isTouchScreen`): double-clicking an existing text
 * element opens the editor with ALL text selected, so typing after an
 * insert would REPLACE a pre-inserted prefix — the prefix can never be
 * delivered by inserting a bare `[ ] ` and asking the user to type around
 * it. The robust flow is OneNote's own: type first, then APPLY the tag.
 * The context menu therefore works on BOTH kinds of single-line standalone
 * text: a checklist item gets "Toggle checked", a plain text gets "Add To
 * Do tag". The Import-menu starter inserts a bare `[ ]` item for the
 * keyboard-confident flow (edit → arrows collapse the selection → type),
 * and anything it collapses into plain text can simply be re-tagged from
 * the menu.
 *
 * Strictness (the GFM task-list rule): the token must be the whole text or
 * be followed by exactly one space before the item — `[ ]Buy milk` is NOT
 * a checklist item, `[ ] Buy milk` is. `[X]` parses as checked (GFM
 * accepts both cases); the canonical stored form is lowercase `[x]`, which
 * a flip normalizes to. One text element = one item: multi-line text never
 * parses (v1 scope, issue #302).
 *
 * v1 scope is STANDALONE text elements only: bound labels (table cells,
 * containers) are the container's content, not a page-level item — the
 * classifier refuses them. Multi-line text is never actionable either:
 * one text element = one item, and the menu must never offer an action
 * (Toggle checked / Add To Do tag) it could not keep.
 *
 * This module is PURE — no imports from @excalidraw/excalidraw — so it
 * runs identically in the browser bundle, in bun unit tests and during
 * SSR. The runtime toggle/tag/insert live in `excalidraw-client.ts` (the
 * table-insert pattern).
 */

/** The unchecked task-list token. */
export const CHECK_UNCHECKED = "[ ]";

/** The checked task-list token (canonical stored form, lowercase). */
export const CHECK_CHECKED = "[x]";

export interface ChecklistItem {
  checked: boolean;
  /** Text after the token and its separating space ("" for a bare item). */
  item: string;
}

/**
 * Parse one single-line checklist item. GFM task-list strictness: the
 * token is the whole text, or one space follows it; multi-line text and
 * `[ ]Buy` (missing separator) never parse.
 */
export function parseChecklistItem(text: string): ChecklistItem | null {
  if (typeof text !== "string") return null;
  // One text element = one item (issue #302 v1 scope): a multi-line text
  // element is a paragraph, not a checkbox line.
  if (text.includes("\n")) return null;
  const m = /^\[( |x|X)\]( (.*))?$/.exec(text);
  if (!m) return null;
  return { checked: m[1] !== " ", item: m[3] ?? "" };
}

/** True when this text is a checklist item under the strict convention. */
export function isChecklistText(text: string): boolean {
  return parseChecklistItem(text) !== null;
}

/** Canonical form: lowercase token, one separator space when there is text. */
export function formatChecklistItem(checked: boolean, item: string): string {
  const box = checked ? CHECK_CHECKED : CHECK_UNCHECKED;
  return item ? `${box} ${item}` : box;
}

/**
 * Flip a checklist item's done state, preserving the item text exactly
 * (extra inner spacing included). `[X]` normalizes to `[x]` on the way
 * out. Returns null for anything that is not a checklist item.
 */
export function flipChecklistText(text: string): string | null {
  const parsed = parseChecklistItem(text);
  if (!parsed) return null;
  return formatChecklistItem(!parsed.checked, parsed.item);
}

/**
 * OneNote "Home > To Do tag": apply the unchecked token to a plain
 * single-line text. Empty, whitespace-only, multi-line and already-tagged
 * texts refuse (null) — the menu only offers the tag when it can apply.
 */
export function applyToDoTag(text: string): string | null {
  if (typeof text !== "string") return null;
  if (text.includes("\n")) return null;
  if (parseChecklistItem(text)) return null;
  if (!text.trim()) return null;
  return `${CHECK_UNCHECKED} ${text}`;
}

/* ------------------------------------------------------------------ */
/* element level                                                       */
/* ------------------------------------------------------------------ */

/** The minimal scene-element shape this module needs (structural typing). */
export interface TodoElementLike {
  id?: string;
  type?: string;
  isDeleted?: boolean;
  /** Bound labels (table cells, containers) are refused — v1 standalone. */
  containerId?: string | null;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
}

/**
 * What a right-click hit can act on: an existing checklist item (toggle)
 * or a plain single-line text (apply the To Do tag). Mutually exclusive
 * by construction — the classifier decides.
 */
export type TodoTextHit =
  | { kind: "checklist"; elementId: string; checked: boolean; item: string }
  | { kind: "plain"; elementId: string; text: string };

/**
 * Classify ONE element for the checklist surfaces: a live, standalone,
 * single-line text element is either a checklist item (its text parses)
 * or taggable plain text (non-empty after trimming). Everything else —
 * non-text types, deleted elements, bound labels, empty texts, shapes —
 * classifies as null.
 */
export function classifyTodoText(el: TodoElementLike | null | undefined): TodoTextHit | null {
  if (!el || el.isDeleted || el.type !== "text") return null;
  if (el.containerId != null) return null;
  if (typeof el.id !== "string" || !el.id) return null;
  const text = typeof el.text === "string" ? el.text : "";
  // One text element = one item (issue #302 v1 scope): a multi-line text
  // element is a paragraph — neither a checklist item nor taggable, so the
  // right-click menu never offers an action it could not keep.
  if (text.includes("\n")) return null;
  const parsed = parseChecklistItem(text);
  if (parsed) {
    return { kind: "checklist", elementId: el.id, checked: parsed.checked, item: parsed.item };
  }
  if (text.trim()) return { kind: "plain", elementId: el.id, text };
  return null;
}

/** One rotation-exact containment probe (the attachment-chip frame math). */
function containsPoint(
  el: { x?: number; y?: number; width?: number; height?: number; angle?: number },
  sceneX: number,
  sceneY: number,
): boolean {
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  if (!(w > 0) || !(h > 0)) return false; // corrupt geometry never hits
  const cx = (el.x ?? 0) + w / 2;
  const cy = (el.y ?? 0) + h / 2;
  const angle = el.angle ?? 0;
  const dx = sceneX - cx;
  const dy = sceneY - cy;
  // rotate the offset INTO the element's local frame (by -angle)
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

/**
 * Hit-test the checklist surfaces at scene coords (the context-menu entry
 * point): the TOPMOST live standalone text element that contains the point
 * and classifies as actionable. Table cells are handled by the caller
 * BEFORE this (a cell hit opens the table menu and never reaches here),
 * so a checklist inside a cell's bound label is out of scope by both the
 * classifier and the ordering.
 */
export function hitTestTodoText(
  elements: readonly TodoElementLike[],
  sceneX: number,
  sceneY: number,
): TodoTextHit | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el || el.isDeleted || el.type !== "text") continue;
    if (!containsPoint(el, sceneX, sceneY)) continue;
    const hit = classifyTodoText(el);
    if (hit) return hit;
  }
  return null;
}
