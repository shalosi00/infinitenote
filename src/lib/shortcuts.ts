/**
 * Keyboard shortcut cheatsheet data (issue #28).
 *
 * Single source of truth for the in-app shortcuts dialog. Truthful by
 * construction: every entry corresponds to a handler that really exists —
 * app-level shortcuts live in note-app.tsx / dialogs, canvas entries were
 * verified against the embedded Excalidraw (v0.18.1) via its appState.
 *
 * `keys` uses the literal token "Ctrl/Cmd" where the binding is Ctrl on
 * Linux/Windows and Cmd (⌘) on macOS; displayKeys() renders per platform.
 *
 * Group and entry labels are NOT stored here — only stable ids. The text
 * lives in the message catalogs (messages/{en,zh-CN}.json under
 * shortcuts.groups.* / shortcuts.entries.*) so the cheatsheet localizes
 * (issue #54); the catalog-parity unit tests pin the id ↔ message mapping.
 */

export interface ShortcutEntry {
  keys: string;
  /** Catalog key under shortcuts.entries.* */
  id: string;
}

export interface ShortcutGroup {
  /** Catalog key under shortcuts.groups.* */
  id: string;
  entries: ShortcutEntry[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: "general",
    entries: [
      { keys: "Ctrl/Cmd+K", id: "search" },
      { keys: "Ctrl/Cmd+Alt+N", id: "quickNote" },
      { keys: "?", id: "cheatsheet" },
      { keys: "Esc", id: "closeDialog" },
    ],
  },
  {
    id: "organizing",
    entries: [
      { keys: "Double-click", id: "rename" },
      { keys: "Enter", id: "commitRename" },
    ],
  },
  {
    id: "canvasTools",
    entries: [
      { keys: "V / 1", id: "select" },
      { keys: "H", id: "hand" },
      { keys: "R / 2", id: "rectangle" },
      { keys: "D / 3", id: "diamond" },
      { keys: "O / 4", id: "ellipse" },
      { keys: "A / 5", id: "arrow" },
      { keys: "L / 6", id: "line" },
      { keys: "P / 7", id: "draw" },
      { keys: "T / 8", id: "text" },
      { keys: "E", id: "eraser" },
      { keys: "K", id: "laser" },
    ],
  },
  {
    id: "canvasEditing",
    entries: [
      { keys: "Ctrl/Cmd+Z", id: "undo" },
      { keys: "Ctrl/Cmd+Shift+Z", id: "redo" },
      { keys: "Ctrl/Cmd+A", id: "selectAll" },
      { keys: "Del / Backspace", id: "deleteElements" },
      { keys: "Hold Space", id: "panHeld" },
    ],
  },
];

/** True on Apple platforms — decides ⌘ vs Ctrl rendering. */
export function isApplePlatform(userAgent: string): boolean {
  return /Mac|iPhone|iPad/i.test(userAgent);
}

/**
 * Render a key combination for the platform: replaces the literal
 * "Ctrl/Cmd" token with ⌘ (macOS) or Ctrl (everything else) and Alt with ⌥.
 * Anything else passes through unchanged.
 */
export function displayKeys(keys: string, apple: boolean): string {
  return keys
    .replaceAll("Ctrl/Cmd", apple ? "⌘" : "Ctrl")
    .replaceAll("Alt", apple ? "⌥" : "Alt");
}
