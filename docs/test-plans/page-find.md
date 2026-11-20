# Test plan — in-page find (OneNote "Find on this page" parity)

Issue #301 (wave 14, v1.17.0). Every E2E id below is pinned in
`e2e/page-find.spec.ts`; every unit id group in
`src/lib/__tests__/page-find.test.ts` (+ `page-find-edges.test.ts`).

## Policy (pure module `src/lib/page-find.ts`)

- Findable text = VISIBLE text elements only — standalone text AND the
  bound labels of containers/arrows/table cells (bound labels ARE text
  elements with `containerId`). OCR text, recognized handwriting and
  attachment file names deliberately do NOT match: they are not visible
  page text (Ctrl+K covers them cross-page). Deleted tombstones never
  match; elements without a usable id or non-empty text are skipped;
  missing/non-finite coordinates coerce to 0 (never NaN).
- Matching is case-insensitive substring per OCCURRENCE — non-overlapping,
  stepping by the needle length (browser semantics: "aaaa" holds 2 of
  "aa", not 3). An EMPTY query matches nothing (the bar's no-query state);
  a lone space finds spaces — only "" is special.
- Reading order: top → bottom, left → right (stable sort — elements at
  identical positions keep scene order); occurrences inside one element
  follow text order with real character offsets. The bar's "n of m"
  counter is derived from the same array navigation steps through, so the
  display can never drift from the cycling.
- `stepMatchIndex` wraps in both directions and is negative-safe;
  total <= 0 or non-finite inputs → -1 (the no-match state).
- Defensive by contract (the search.ts precedent): null/garbage element
  rows are skipped, never crash the bar. Duplicate ids in a corrupt scene
  surface as separate matches (no dedupe theater — the live API never
  produces them).

## Client surface (`CanvasApi`, no focus movement)

- `findMatches(query)` computes matches over the LIVE scene
  (`api.getSceneElements()`) — nothing is cached between keystrokes, so
  undo/delete/sync changes are reflected on the very next navigation; a
  match whose element vanished between find and goto is skipped silently.
- `gotoFindMatch` selects via `appState.selectedElementIds` (the
  shape-library auto-select precedent) and scrolls via
  `api.scrollToContent(el)`. DOM focus NEVER moves — the find bar's input
  keeps it, which is what makes Enter/Shift+Enter cycling work at all
  (the HWR focus-race lesson applied in reverse: here the editor that
  must survive is the find input, not a canvas editor).
- The store closes the bar on every page switch (`selectPage` /
  `revealSelection` set `findOpen: false`): stale element ids from a
  previous page must never navigate. Esc closes from anywhere while the
  bar is open (capture-phase global handler, stopPropagation keeps
  Excalidraw's deselect from acting) and returns focus to the canvas via
  `requestCanvasFocus`. Closing UNMOUNTS the bar — reopening starts
  fresh (empty query, no counter), matching browser-find reopen
  semantics.
- Ctrl/Cmd+F opens the bar in the app's capture-phase global handler
  (`preventDefault` — the browser find never fires; a second Ctrl+F
  re-focuses the input, browser behavior). The cheatsheet entry is in
  SHORTCUT_GROUPS (truthful by construction) and the ⋯ page-actions menu
  carries "Find on page" (the header hides below 640px — the tables-wave
  mobile precedent).

## E2E (`e2e/page-find.spec.ts`)

- **PF-E01** — Ctrl+F opens the bar with the input focused; a case-FLIPPED
  query derived from the seed scene still matches (case-insensitivity);
  the counter shows the honest "1 of N" (N computed spec-side from the
  serialized scene — the oracle does not trust the UI); the
  reading-order-first match is selected (appState.selectedElementIds) and
  the viewport scrolled to it.
- **PF-E02** — one element holding the query twice: "1 of 2" → Enter →
  "2 of 2" → Enter wraps to "1 of 2" → Shift+Enter wraps back to "2 of 2";
  selection never moves (both occurrences share the element).
- **PF-E03** — a second element ABOVE the first: reading order puts it at
  "1 of 3"; Enter steps DOWN to the lower element (selection switches
  element ids); find-next/find-prev buttons cycle with wrap-around.
- **PF-E04** — a non-matching query shows "No matches"; Enter is a no-op;
  prev/next are disabled; an empty query clears the counter.
- **PF-E05** — CJK content ("读书笔记与查找", query "笔记") matches like
  any other text; cycling wraps to itself at "1 of 1".
- **PF-E06** — Esc closes the bar and returns focus to the canvas
  (activeElement inside .excalidraw); Ctrl+F re-opens FRESH (empty
  counter — the close unmounted the bar) and still works.
- **PF-E07** — switching pages closes the bar (store-driven; stale ids
  from the previous page can never navigate).
- **PF-E08** — the ⋯ page-actions menu entry opens the bar on desktop (the
  TB-E11 menu-container dance); on a 390px phone viewport the pin is the
  entry's presence in the opened menu plus the keyboard path (Ctrl+F opens
  the bar at every width) — CI measured Radix's menu-item click-through at
  phone widths as hardware-metric-sensitive (trigger landed, item click
  timed out twice), so the spec asserts what is deterministic.

## Invariants covered elsewhere

- No data-model change: selection + viewport ride the existing app state;
  matching never mutates the scene; the autosave gate is untouched (an
  appState-only updateScene cannot change the scene signature). Exercised
  by the existing persistence / sync / round-trip specs.
- Ctrl+K (cross-page search) is unchanged; Ctrl+F is additive — the
  shortcuts cheatsheet now documents both side by side.
- Foreign-key semantics: the find bar never writes to the scene; export
  paths, sync folders, backups and version history need no changes.
