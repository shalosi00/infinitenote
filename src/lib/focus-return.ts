/**
 * Focus-return memory for programmatically-opened overlays.
 *
 * Radix Dialog/Sheet return focus to the element that opened the overlay —
 * but only when it was opened through a `DialogTrigger`. Every InfiniteNote
 * overlay opens from CONTROLLED state (a plain button's onClick, or a global
 * keyboard shortcut), so Radix has no trigger to return to and focus falls
 * to `<body>`: keyboard users lose their place and must Tab from the top of
 * the document after closing Themes / Sync / Search / Shortcuts / Trash /
 * the mobile drawer (WCAG 2.4.3).
 *
 * Fix: a capture-phase `focusin` listener remembers the last element
 * focused OUTSIDE any overlay; overlay content restores it on close. The
 * listener must exist BEFORE the first overlay opens, so it installs
 * eagerly at module load (all importers are client components; the module
 * is part of the main chunk). `lastOutsideFocus()` re-checks installation
 * as a safety net for lazy chunking.
 */

interface FocusReturnState {
  last: HTMLElement | null;
}

const WINDOW_KEY = "__noteFocusReturn";

function install(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w[WINDOW_KEY]) return;
  const state: FocusReturnState = { last: null };
  w[WINDOW_KEY] = state;
  window.addEventListener(
    "focusin",
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target || !target.isConnected) return;
      // Focus inside an overlay (its content or backdrop) is never a
      // return target — overlays must not hijack the memory.
      if (
        target.closest(
          '[role="dialog"], [data-slot="dialog-overlay"], [data-slot="sheet-overlay"]'
        )
      ) {
        return;
      }
      state.last = target;
    },
    true
  );
}

if (typeof window !== "undefined") {
  install();
}

/**
 * The last element focused outside any overlay (null before the first
 * focus, or when only overlays have held focus). Callers should treat a
 * disconnected element as "no target" and fall back to the Radix default.
 */
export function lastOutsideFocus(): HTMLElement | null {
  if (typeof window === "undefined") return null;
  install(); // safety net when the module landed in a lazily loaded chunk
  const state = (window as unknown as Record<string, unknown>)[WINDOW_KEY] as
    | FocusReturnState
    | undefined;
  return state?.last ?? null;
}
