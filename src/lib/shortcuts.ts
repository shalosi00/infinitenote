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
 * Labels are English literals (the UI is English-only since v1.9; the
 * message-catalog indirection was removed with the rest of the i18n layer).
 */

export interface ShortcutEntry {
  keys: string;
  /** English label shown in the cheatsheet. */
  label: string;
}

export interface ShortcutGroup {
  /** English heading shown in the cheatsheet. */
  label: string;
  entries: ShortcutEntry[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "General",
    entries: [
      { keys: "Ctrl/Cmd+K", label: "Search all pages" },
      { keys: "Ctrl/Cmd+Alt+N", label: "New quick note (Quick Notes notebook)" },
      { keys: "?", label: "Show this shortcuts cheatsheet" },
      { keys: "Esc", label: "Close dialog / cancel editing" },
    ],
  },
  {
    label: "Organizing",
    entries: [
      { keys: "Double-click", label: "Rename a notebook, section or page in the sidebar" },
      { keys: "Enter", label: "Commit a rename" },
    ],
  },
  {
    label: "Canvas tools",
    entries: [
      { keys: "V / 1", label: "Select" },
      { keys: "H", label: "Hand (pan the canvas)" },
      { keys: "R / 2", label: "Rectangle" },
      { keys: "D / 3", label: "Diamond" },
      { keys: "O / 4", label: "Ellipse" },
      { keys: "A / 5", label: "Arrow" },
      { keys: "L / 6", label: "Line" },
      { keys: "P / 7", label: "Draw (pen / highlighter shapes)" },
      { keys: "T / 8", label: "Text" },
      { keys: "E", label: "Eraser" },
      { keys: "K", label: "Laser pointer" },
    ],
  },
  {
    label: "Canvas editing",
    entries: [
      { keys: "Ctrl/Cmd+Z", label: "Undo" },
      { keys: "Ctrl/Cmd+Shift+Z", label: "Redo" },
      { keys: "Ctrl/Cmd+A", label: "Select everything on the page" },
      { keys: "Del / Backspace", label: "Delete the selected elements" },
      { keys: "Hold Space", label: "Pan the canvas while held" },
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
