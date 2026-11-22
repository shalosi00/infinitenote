# Test plan — Ink to shape (issue #329)

Feature: OneNote "Ink to Shape" parity — "Draw a shape on the page. From
the Shapes gallery on the ribbon select Ink to Shape" (support.microsoft.com,
"Convert your Ink to Shapes and Math Equations"). Selected freedraw strokes
that classify as a shape are REPLACED by the perfect Excalidraw geometry
(`ellipse` / `line` / `rectangle` / `diamond` / closed-line triangle);
strokes that do not classify stay ink — never mutated, never deleted — and
are counted for the guidance toast. Selection-scoped only (OneNote's model:
select the ink, then convert) — there is deliberately no page-wide mode
because conversion replaces ink. Evidence pass (2026-11-22): Joplin has no
native inking and its only drawing path is a third-party beta plugin
(js-draw "Freehand Drawing", joplinapp.org/plugins) with no shape
recognition; AppFlowy's freehand board is still an open feature request
(AppFlowy-IO/AppFlowy#2091, 2023).

Status: **shipped 2026-11-22 (wave 19)** — all evidence below is from
actual runs.

## Design summary

| Aspect | Decision |
|---|---|
| Classifier | Pure geometry in `ink-shapes.ts` (no DOM / @excalidraw imports — the shape-library.ts / hwr-convert.ts contract): per-stroke → `line` (every point within max(6 px, 7% of chord) of the chord), closed-loop circle via Kasa least-squares fit (max radial error ≤ 16% of r, fit sanity r ≤ 4× bbox diagonal — a line wearing a circle costume is rejected), axis-aligned bbox-ellipse fallback (max point error ≤ 25% of the larger semi-axis), then corner analysis: RDP on the closed loop (ε = 3.5% of diagonal) + near-straight-vertex pruning (a square drawn starting mid-edge still yields exactly 4 corners) |
| Rectangles | 4 corners, interior angles within 14° of 90°, every edge nearly horizontal/vertical → axis-aligned rectangle from the corner bounds. A 45°-rotated square (corners at the bbox edge midpoints) falls through to the diamond test and becomes a native `diamond`; other rotations are an honest v1 miss and stay ink |
| Diamonds | 4 corners each within 28% of max(w,h) of a distinct bbox edge midpoint → native `diamond` |
| Triangles | 3 corners, min interior angle ≥ 18° → a closed 3-corner `line` loop (Excalidraw has no triangle primitive — the closed loop IS the perfect triangle) |
| Rejections | zigzags (deviation ≫ tolerance), open C-arcs (endpoints a diameter apart → open, deviation ≫ line tolerance), dots (bbox diagonal < 18 px), degenerate slivers (min interior angle < 18°), garbage points (NaN / non-array / pressure triplets — the safeTags contract: external input never crashes the classifier) |
| Planner | `planInkShapes(payload, ids)` — selection-scoped; ids not present as alive freedraw strokes are skipped silently (the integrity-heal re-entry contract); unrecognized strokes are reported, never touched |
| Runtime | `convertInkToShapes(api)` in excalidraw-client.ts: ONE `updateScene` (CaptureUpdateAction.IMMEDIATELY) tombstones the converted strokes and appends the fitted shapes — one Ctrl+Z restores the original ink; deselect-on-purpose (the #231 precedent — selecting fresh shapes mounts Excalidraw's shape-actions panel and races the canvas for keyboard focus); structural idempotency (no customData flag — the measured HWR-E06 undo hazard: Excalidraw's undo does not revert customData; restored ink is simply convertible again) |
| Style inheritance | Shapes inherit EACH stroke's own strokeColor/strokeWidth/roughness — the replacement must look like the ink drew itself |
| Integrity guard | The hwr-convert pattern: ~1.5 s after the run the created shape ids are re-checked against the elements map INCLUDING tombstones; a tombstone is a legitimate undo (never touched), a shape missing from the map entirely is the measured store drop — healed by re-running over the remembered stroke ids (bounded at one pass; converted strokes are gone from the scene, so re-entry never duplicates). **Same-scene check (#329, shared with hwr-convert via `shouldHealConversion`)**: the heal only re-applies while an original stroke is still ALIVE in the scene — a page switch inside the window would otherwise re-apply on a foreign page |
| Trigger | "Ink to shape" item in the Page-actions (⋯) menu beside "Convert handwriting to text"; toasts report converted / left-as-ink counts; empty selection and no-ink selection are friendly no-ops |
| Graceful degradation | A four-stroke rectangle degrades usefully: each side is a straight stroke and converts to its own perfect line (no data loss, the drawing gets straighter) |

Unit tests never touch the runtime: the classifier, planner, skeleton
builder and toast copy are pure; the runtime path is proven by
e2e/ink-shapes.spec.ts against the real Excalidraw scene, and the committed
E2E fixture (`e2e/fixtures/ink-shapes.excalidraw` — noisy circle, wobbly
line, zigzag, noisy rectangle, deterministic LCG noise) is byte-identical
with the unit fixtures' generators.

## Unit tests — `src/lib/__tests__/ink-shapes.test.ts`

| ID | Assertion |
|---|---|
| IS-P01..P06 | accepted classes: noisy circle → ellipse with fitted bounds (±7 px), axis-aligned 2:1 ellipse → ellipse with bbox bounds, wobbly straight stroke → line through its endpoints, noisy rectangle → rectangle with corner bounds (±5 px), rectangle drawn starting mid-edge still classifies (straight-vertex pruning), diamond → diamond, 45°-rotated square → diamond |
| IS-P07..P11 | honest misses: zigzag, 30°-rotated rectangle, open C-arc, sub-floor dot (INK_MIN_DIAGONAL = 18), < 3 usable points — all null |
| IS-P12..P16 | planner semantics: only selected alive freedraw strokes targeted (deleted rows, non-freedraw elements and unselected ids ignored), unrecognized counted, missing ids skipped silently (heal contract), empty selection plans nothing, garbage points never crash (safeTags), four-stroke rectangle → four perfect lines |
| IS-P17..P19 | skeletons: line skeletons canonical (points[0] = [0,0] at the stroke's first endpoint), triangles close the loop (4 points, first = last), styles inherited from the stroke (color / width / transparent fill), ellipse skeletons carry the fitted bounds |
| IS-P20 | `inkShapesSummary` — every toast branch exact (guidance / no ink / nothing shape-like / singular / plural / mixed) |
| IS-P21..P22 | `shouldHealConversion` (the guard hardening shared with hwr-convert): heals only while an original ink stroke is still ALIVE in the hosted scene; a foreign scene (page switched inside the ~1.5 s window), deleted strokes or non-freedraw ids never re-apply — found twice locally by HWR-E04's afterAll error-catcher ("re-apply found nothing to convert" after a page switch) |

## E2E — `e2e/ink-shapes.spec.ts`

| ID | Assertion |
|---|---|
| IS-N01 | import the fixture, select all, run Ink to shape: toast "Converted 3 strokes to shapes. 1 stroke stays as ink — not shape-like."; alive count unchanged (3 in, 3 out) but the types prove it (freedraw 1, ellipse 1, rectangle 1, line 1); fitted bounds match the probed classifier geometry (±5–8 px); every created shape inherits #1e1e1e |
| IS-N02 | one Ctrl+Z restores the original ink (freedraw 4, no shape types), the undone scene outlives a reload |
| IS-N03 | re-running after the undo re-converts (structural idempotency) and the converted scene persists across a reload |
| IS-N04 | an empty selection on a page without ink is the guidance toast, no scene change |
| IS-N05 | a circle drawn live with the mouse (freedraw tool, 18-step arc, real input path) converts to one ellipse — freedraw 0, ellipse 1 |
