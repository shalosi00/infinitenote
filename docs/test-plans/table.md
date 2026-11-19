# Test plan — tables on pages (issue #277)

OneNote "Insert > Table" parity. A table is a COMPOSED structure of native
Excalidraw elements: (rows+1) horizontal + (cols+1) vertical `line` borders and
rows×cols white-filled `rectangle` cell containers, all sharing one
`groupIds: [tableId]` entry and one `customData["infinitenote:table"]` marker
per element (`{ tableId, kind, row, col }`). Everything is native: it persists
with the scene, round-trips through every export path, exports as vectors in
the paginated PDF, and cell text is indexed by full-text search with ZERO
search changes (search.ts indexes every text element).

Pure policy lives in `src/lib/table-insert.ts` (no @excalidraw imports); the
runtime conversion + insertion live in `excalidraw-client.ts`
(`insertTable`, `applyTableOp`); the toolbar popover is in `note-app.tsx`;
the cell context menu is in `excalidraw-canvas.tsx`.

## Behavior under test

- Insert: 1-20 rows × 1-12 cols from the header toolbar popover
  (defaults 3×3, OneNote's starter grid; hidden below 640px where the
  header was already at capacity — the overlap audit pinned
  "Export@300,8 extends past the viewport edge" at 320×700); phones
  insert via the ⋯ page-actions menu's "Insert table 3×3"; out-of-bounds
  → explicit toast, no scene change.
- Typing: cells are opaque white containers — double-click inside a cell
  creates/edits its bound text (Excalidraw's non-transparent-container flow;
  transform.ts skips EMPTY labels, so untapped cells ship no text child).
- Structural ops from the cell's right-click menu: Add row below / Add
  column right / Delete row / Delete column / Delete table. Each op is one
  `updateScene` = one undo step. Texts survive rebuilds (rebuild-based ops
  carry the per-cell bound texts into the new grid).
- Guards: 1×1 is the deletion floor ("A table needs at least one row." /
  "...at least one column."), 20 rows / 12 columns the growth ceiling.
- Uniform grid: cell drags normalize to the grid's largest extents on the
  next op (OneNote's grid is uniform too; documented behavior).
- Deletion: Delete table removes the marked elements AND their bound labels
  (a tombstoned container with a live text child would restore as a ghost).
- Undo safety: the marker rides the element — undo removes whole elements
  including customData, so no stale flags are possible (contrast HWR-E06,
  where a flag had to survive on an element undo left in place).

## Unit suite (`src/lib/__tests__/table-insert*.test.ts`)

- Marker validation round-trips; malformed markers rejected; foreign
  customData (audio/pdf) never matches.
- Skeletons: (rows+1)+(cols+1) borders + rows×cols cells; exact grid
  geometry (border extents, cell origins); cells white-filled and
  stroke-transparent; borders carry the inherit-stroke sentinel.
- Geometry reconstruction from a live scene (origin, dims, rows/cols);
  per-cell bound-text extraction; deleted elements ignored; unknown/
  foreign tableIds isolated.
- Ops: insert/delete row/column preserve every text; delete-table plans;
  guards (1×1 floor, out-of-range indices, dead table); growth caps with
  explicit messages; grid normalization after a dragged cell; borders
  deleted by hand don't break reconstruction; hit-test hits cells only
  (never lines, never foreign rectangles, never deleted elements).

## E2E (`e2e/table.spec.ts`, ids TB-E01..E11)

- TB-E01: 2×3 insert from the toolbar — 6 cells / 3 h-borders / 4 v-borders
  (13 elements; empty labels ship no text children), one shared group, all
  marked.
- TB-E02: double-click types "revenue Q1" into cell (0,0); the text is
  bound to the marked container.
- TB-E03/E04: Add row below / Add column right grow the grid; texts survive.
- TB-E05: Delete row / Delete column shrink; texts survive.
- TB-E06: reload restores markers, texts, group.
- TB-E07: the 1×1 floor refuses with a visible toast; scene unchanged.
- TB-E08: 21×3 and 3×13 inserts toast out-of-bounds.
- TB-E09: Delete table leaves zero marked elements; "Table deleted." toast.
- TB-E10: cell text found by Ctrl+K full-text search (no search changes).
- TB-E11: the ⋯ page-actions path inserts OneNote's starter 3×3 grid (the
  phone entry; the popover trigger hides below 640px, pinned by the
  ui-overlap audit).

## Non-goals (this slice)

Merged cells, per-cell styling beyond theme, formula evaluation, CSV
paste-into-table (issue #277 keeps these out; the marker schema leaves room).
