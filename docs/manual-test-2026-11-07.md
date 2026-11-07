# Manual test report — 2026-11-07

> Full human-style pass of every user-facing feature, driven through a real
> Chromium browser (agent-browser CLI): real clicks, real mouse drawing,
> real file drops, real downloads. No unit-test shortcuts. This report is
> the record of what was verified and what was found.
>
> Environment: develop @ 7a03954, dev server (`next dev`), Chromium
> headless 1280x720 (plus a 390x844 mobile pass), fresh IndexedDB.

## Verdict

**Every feature works. 0 user-facing bugs found.** Two non-blocking
observations were filed: #122 (cosmetic element-status flag) and #123
(feature request: restore last-opened page). All console errors observed
were attributable to the test harness or dev mode, not the app (details at
the end).

## What was tested and how

### 1. First run & welcome seed

Loaded `/` cold. Welcome Notebook (Getting Started → "Start here", Ideas
section) and My Notebook seed appear; English-only UI (v1.9 direction);
no console errors; canvas interactive panel present.

### 2. Hierarchy CRUD

| Action | Result |
|---|---|
| Add notebook | ✅ "Notebook 3" created, auto-selected + expanded |
| Rename notebook (menu → inline field, Enter) | ✅ → "Test Journal" |
| Notebook color (menu → palette → emerald) | ✅ icon span = rgb(16,185,129) |
| Add section | ✅ "Section 1" under Test Journal |
| Add page | ✅ "Page 1" created + opened |
| Rename page (menu + double-click path) | ✅ → "Grocery Plans"; dblclick path tested on "Brainstorm" |
| Duplicate page | ✅ "Grocery Plans (copy)" |
| Reorder (Move up) | ✅ copy moved above original |
| Move to trash | ✅ gone from tree, selection moves on |
| Header title rename | ✅ DB + tree + header all updated (em-dash safe) |

### 3. Canvas

- **Rectangle**: selected tool, mouse drag (500,250)→(700,380) — ink
  verified by pixel analysis exactly in that region (4.0%), empty region
  0.0%.
- **Freehand draw**: squiggle strokes landed (11.4% ink in target region).
- **Text**: click-to-place, typed "Hello from human test", Escape commits
  (17.0% ink).
- **Move**: drag rectangle to new location — old region ink 0.0%, new
  region has the outline.
- **Paper styles**: Plain → Ruled (6.0% line ink in sample strip) → Grid
  (4.6%), radio state tracks, persisted across reload.

### 4. Imports — all 9 supported types on ONE canvas

Drag-dropped all nine fixtures in one batch onto one page
(`Grocery Plans`): image, .txt, .md, .pdf printout, .docx, OneNote HTML,
OneNote .mht (embedded image), .excalidraw scene, audio.

- Scene went 4 → **41 elements**: 31 text, 6 image, 2 rectangle, 1
  freedraw, 1 embeddable (audio). After annotating on top: **43**.
- **Parsed content verified by reading text elements**: docx produced
  headings, bullet lists, numbered lists and a table ("Owner | Status");
  OneNote HTML produced "Quarterly Review / Agenda…"; .mht produced its
  text **and** the embedded image; markdown and txt landed as text
  blocks; PDF printout arrived as page-sized images.
- Toast feedback verified (e.g. "Imported 1 text file").
- **Write/draw on top of imports**: squiggle + text annotation over the
  imported stack — both persisted (43 elements).

### 5. Exports (real downloads, all validated)

| Export | File | Validation |
|---|---|---|
| PNG | `Grocery-Plans.png` (1.16 MB) | opens, full scene, 2049×12498 |
| SVG | `Grocery-Plans.svg` (163 KB) | valid SVG, images embedded as base64 |
| Scene | `Grocery-Plans.excalidraw` (176 KB) | `type: excalidraw`, 43 elements, 6 files |
| PDF A4 portrait | 161 KB | 5 pages, MediaBox 595×842pt, vector text ops, paper ruling rendered |
| PDF A4 landscape | 165 KB | 10 pages, MediaBox 842×595pt, vector text ops |
| Backup | `infinitenote-backup-*.json` | 3 notebooks, nested sections, 4 live pages, Grocery Plans content intact; trash excluded by design |
| Sync ZIP | `infinitenote-sync-*.zip` | manifest + 7 page JSONs, valid manifest |

Filenames follow the page title (rename reflected) ✅.

### 6. Search, trash, tags

- **Ctrl+K search**: typed `quantumfrog` (a keyword buried inside imported
  .txt content) → found "Grocery Plans" with breadcrumb
  "Test Journal / Section 1" + content snippet; clicking the result jumps
  to the page ✅.
- **Trash**: dialog lists deleted page with type; **Restore** returned
  "Grocery Plans (copy)" to the tree ✅; **Delete forever** (icon → inline
  confirm) purged "Page 1" — row gone, DB row gone, tombstone recorded ✅.
- **Tags**: added `recipes` + `weekend` via the Page tags menu; chips
  render; tag filter view ("Pages tagged \"recipes\"") lists the page;
  click jumps to it; Clear returns the tree ✅.

### 7. Quick capture, Today, cheatsheet

- **New quick note** button → timestamped page under Quick Notes ✅.
- **Ctrl+Alt+N** → second quick note ✅.
- **Open today's daily page** → date-keyed "2026-11-07" page created +
  opened ✅.
- **?** → shortcuts cheatsheet with sections (General / Organizing /
  Canvas tools) ✅.

### 8. Themes, dark mode, mobile

- **Themes gallery**: six themes (Violet, Ocean, Forest, Sunset, Rose,
  Graphite); picked Forest → `data-theme=forest`, `--primary` flips to
  green, persisted in localStorage across reload ✅.
- **Dark mode**: toggle flips html class + color-scheme; persisted ✅.
- **Mobile (390×844)**: hamburger "Open navigation" opens the tree drawer ✅.

### 9. Multi-select & sync

- Select mode: per-page checkboxes + disabled bulk buttons until
  selection; checked 2 pages → **Move to…** dialog lists every section and
  correctly **disables the source section**; move verified in IndexedDB
  (both pages' sectionId updated) ✅.
- **Sync dialog**: Connect folder / Merge sync ZIP / Download sync ZIP all
  present; sync ZIP download validated above ✅.

### 10. Audio

- Imported audio (from the batch drop) renders a native player on canvas;
  double-click activates the embed (Excalidraw rule), clicking play
  advanced `currentTime` 0 → 0.186s of the 0.6s clip — decodes and plays ✅.
- **Record audio** with no microphone available → graceful
  "Could not start or finish the recording." toast (issue #93 handling) ✅.
  (The recording happy path is covered by CI e2e with a fake mic device.)

### 11. Persistence

Full reload mid-session: all 4 notebooks, 5 sections, 7 live pages (all
renames intact), 43-element annotated page, tags, grid paper, forest
theme and dark mode all restored; tombstone count consistent ✅.

## Findings

1. **#122 (cosmetic)** — an image imported via `.mht` persists with
   element `status: "pending"` although its file data is saved, it renders
   on canvas and exports. No user impact; flag should be `saved`.
2. **#123 (feature request)** — reload always lands on the first page;
   restoring the last-opened page would match OneNote muscle memory.

## Console-error triage (all non-app)

- 3× `NotReadableError` — triggered by the test harness's synthetic file
  injection; the app's drag-drop path and CI Playwright's
  `setInputFiles` (36 import checks) both work. Not an app defect.
- 2× Excalidraw "Failed to use workers for subsetting, falling back to
  the main thread" — dev-server-only cross-origin Worker restriction with
  a graceful fallback; production builds are unaffected.
