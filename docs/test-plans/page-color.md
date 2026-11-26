# Test plan — Page color (OneNote "View > Page Color" parity)

Issue #385 · wave 27 of the product-parity direction · milestone v1.27.0

## Evidence and decision

OneNote's View tab carries a **Page Color** picker: the whole page surface
takes a pastel tint (support.microsoft.com, "Change the background color of
a page in OneNote"). Comparables: Joplin has only a long-open feature request
for note colors; Excalidraw/Logseq/AFFiNE/Standard Notes have no per-page
pastel surface — **OneNote-only among the five**. It is the third level of
the color hierarchy the app already ships: notebooks (v1.0) → sections
(issue #319, v1.20.0) → **pages (this wave)**.

Design decisions pinned here:

1. **Palette**: the app's eight hue families (violet/rose/orange/amber/
   emerald/teal/cyan/pink) as Tailwind-100 pale tints (`PAGE_COLOR_HEX` in
   `src/lib/page-colors.ts`) — names consistent with `NotebookColor`, every
   tint keeps dark ink readable (relative luminance ≥ 0.8, pinned PC-P1).
   null/absent = none (white paper).
2. **Additive data model**: `PageRow.pageColor?: PageColor | null`, NOT
   indexed — the section-color precedent (issue #319): no Dexie version
   bump, old rows / backups / sync folders stay valid.
3. **Dark-mode paint contract** (the v1.13 finding, `excalidraw-canvas.tsx`):
   Excalidraw 0.18 dark applies `invert(93%) hue-rotate(180deg)` to the
   canvas pixels, so the scene stays AUTHORED in light colors — white paper
   is painted in both themes. Tints follow the same contract: the pale hex
   is painted in both themes and dark mode dims it through the standard
   filter, exactly like the paper-white and the ink. No color math, no
   fighting the filter.
4. **Exports stay light-authored**: PNG/SVG/scene JSON pass the palette hex;
   page/section/notebook PDFs fill the sheet with the tint before ruled/grid
   lines, and raster snippets take the tint background so they blend into
   the colored sheet. PDFs are light artifacts — always the palette hex.
5. **Metadata surfaces ride for free**: sync page files carry `pageColor`
   next to `background`/`tags` (malformed degrades to none — the cosmetic
   tags contract); backups + templates save/restore it; duplicate copies
   the row whole.

Non-goals (issue body): custom/eyedropper colors; per-section default tint
or section-color inheritance; a print-with-background toggle.

## Pins

### Pure policy — `page-color.test.ts` PC-P

| Pin | Asserts |
|---|---|
| PC-P1 | palette mirrors NotebookColor's hue families in order; every hex is 6-digit; relative luminance ≥ 0.8 (ink readable) |
| PC-P2 | `safePageColor` passes palette ids; off-palette/hex/uppercase/number/null/array → null (case-sensitive, the SC-P1 matrix) |
| PC-P3 | `canvasColorFor` returns the palette hex in BOTH themes (the v1.13 light-authored paint contract) |
| PC-P4 | `canvasColorFor` falls back to white for null/undefined/off-palette id/number |
| PC-P5 | `PAGE_COLOR_HEX` resolves exactly the palette ids (no undefined paint, no stray keys) |
| PC-P6 | every tint differs from white and from every other tint |

### Data layer — PC-D

| Pin | Asserts |
|---|---|
| PC-D1 | `setPageColor` writes the tint and bumps `updatedAt` |
| PC-D2 | `setPageColor(null)` clears back to white paper |
| PC-D3 | `duplicatePage` copies the tint (whole-row copy) |
| PC-D4 | backup round-trip preserves the tint (empty-library restore, the SC-P9 contract) |
| PC-D5 | a hand-edited archive with an off-palette tint restores as none, not a crash |
| PC-D6 | templates store the tint they were saved from; untinted → absent; the archive round-trip carries it through restore |

### Sync — PC-S

| Pin | Asserts |
|---|---|
| PC-S1 | the plain builder writes the tint; `parseSyncFolder` restores it |
| PC-S2 | malformed tint (off-palette on the row OR a hand-edited file) degrades to none — the row survives |
| PC-S3 | a sealed page (enc marker) carries BOTH the marker verbatim (scene null) and the tint |
| PC-S4 | a pre-#385 folder (no field) imports clean |

## E2E — `e2e/page-color.spec.ts`

Seed: "My Notebook" (teal) → "New Section" → "Page 1".

| Check | Asserts |
|---|---|
| PC-N01 | picking Amber paints the canvas (`viewBackgroundColor` = `#fef3c7`), the header button reads the active tint, a reload persists the paint, the swatch is aria-checked |
| PC-N02 | switching to Cyan repaints immediately |
| PC-N03 | "None (white paper)" resets to `#ffffff` and survives a reload |
| PC-N04 | the tint does NOT flip on theme toggle (light-authored; dark dims it through the filter) — both directions asserted |
| PC-N05 | section PDF export: the inflated content stream contains the normalized fill `1. 0.95 0.78 rg` (jsPDF 2-decimal normalization, verified empirically against the exact tint) |

jsPDF color note: `setFillColor(254, 243, 199)` lands as `1. 0.95 0.78 rg`
(two decimals, normalized). The assertion greps the inflated streams — the
`pdfDecompressed` pattern of the section-pdf-export spec.
