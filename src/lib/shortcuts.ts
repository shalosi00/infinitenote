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
 */

export interface ShortcutEntry {
  keys: string;
  description: string;
}

export interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "General",
    entries: [
      { keys: "Ctrl/Cmd+K", description: "Search all pages" },
      { keys: "Ctrl/Cmd+Alt+N", description: "New quick note (Quick Notes notebook)" },
      { keys: "?", description: "Show this shortcuts cheatsheet" },
      { keys: "Esc", description: "Close dialog / cancel editing" },
    ],
  },
  {
    title: "Organizing",
    entries: [
      { keys: "Double-click", description: "Rename a notebook, section or page in the sidebar" },
      { keys: "Enter", description: "Commit a rename" },
    ],
  },
  {
    title: "Canvas tools",
    entries: [
      { keys: "V / 1", description: "Select" },
      { keys: "H", description: "Hand (pan the canvas)" },
      { keys: "R / 2", description: "Rectangle" },
      { keys: "D / 3", description: "Diamond" },
      { keys: "O / 4", description: "Ellipse" },
      { keys: "A / 5", description: "Arrow" },
      { keys: "L / 6", description: "Line" },
      { keys: "P / 7", description: "Draw (pen / highlighter shapes)" },
      { keys: "T / 8", description: "Text" },
      { keys: "E", description: "Eraser" },
      { keys: "K", description: "Laser pointer" },
    ],
  },
  {
    title: "Canvas editing",
    entries: [
      { keys: "Ctrl/Cmd+Z", description: "Undo" },
      { keys: "Ctrl/Cmd+Shift+Z", description: "Redo" },
      { keys: "Ctrl/Cmd+A", description: "Select everything on the page" },
      { keys: "Del / Backspace", description: "Delete the selected elements" },
      { keys: "Hold Space", description: "Pan the canvas while held" },
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
