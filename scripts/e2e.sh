#!/usr/bin/env bash
# =============================================================================
# InfiniteNote E2E test suite — runs the real app in a headless browser
# (agent-browser) against the dev server on :3000.
#
# Covers: seeding, drawing, typing, autosave+persistence across reload,
# page switching, notebook/section/page CRUD, imports (image / text / PDF
# printout / .excalidraw), export serialization, search, trash,
# dark mode, mobile drawer, console-error cleanliness.
#
# NOTE on determinism: the suite starts from a hard data reset
# (window.__NOTE_RESET__ is exposed only with ?e2e=1), so page titles
# ("Page 2", "Page 3"…) and counts are stable.
# =============================================================================
BASE="http://localhost:3000/?e2e=1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FX="$ROOT/scripts/e2e-fixtures"
SHOTS="${E2E_SHOTS:-$ROOT/e2e-artifacts}"
mkdir -p "$SHOTS"
AB="agent-browser"
PASS=0
FAIL=0

pass() { PASS=$((PASS+1)); echo "  ✓ PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ✗ FAIL: $1"; echo "    └─ $2"; }
check() { # check <desc> <expected> <actual>
  if [ "$2" == "$3" ]; then pass "$1"; else fail "$1" "expected [$2] got [$3]"; fi
}
contains() { # contains <desc> <needle> <haystack>
  if [[ "$3" == *"$2"* ]]; then pass "$1"; else fail "$1" "[$2] not found in: ${3:0:200}"; fi
}
ujeval() { # eval + unescape the JSON-quoted result
  $AB eval "$1" | python3 -c "import json,sys; s=sys.stdin.read().strip(); print(json.loads(s) if s.startswith('\"') else s)" 2>/dev/null
}
elcount() { ujeval "window.__NOTE_E2E__.elementCount()" ; }
type_on_canvas() { # per-character keyboard input to the focused canvas editor
  local text="$1" ch
  for ch in $(echo "$text" | sed 's/./& /g'); do
    $AB press "$ch" >/dev/null
  done
  $AB press Space >/dev/null
  for ch in $(echo "$2" | sed 's/./& /g'); do
    $AB press "$ch" >/dev/null
  done
}
click_page_row() { ujeval "(() => { const row = [...document.querySelectorAll('[data-testid=page-row]')].find(r => r.textContent.trim() === '$1'); row?.querySelector('button')?.click(); return 'ok'; })()" > /dev/null; }
click_notebook_row() { ujeval "(() => { const row = [...document.querySelectorAll('[data-testid=notebook-row]')].find(r => r.textContent.includes('$1')); row?.querySelector('button')?.click(); return 'ok'; })()" > /dev/null; }
# click a button visible inside a specific notebook's subtree
click_in_notebook() { # <notebook name> <button text>
  ujeval "(() => { const nb = [...document.querySelectorAll('[data-testid=notebook-row]')].find(r => r.textContent.includes('$1')); const btn = nb ? [...nb.parentElement.querySelectorAll('button')].find(b => b.textContent.trim() === '$2') : null; btn?.click(); return btn ? 'ok' : 'not-found'; })()" > /dev/null
}

echo "══════════════════════════════════════════════════════════════"
echo " InfiniteNote E2E — $(date '+%H:%M:%S')"
echo "══════════════════════════════════════════════════════════════"

# ---------- 0. hard reset for a deterministic run -----------------------------
$AB open "$BASE" >/dev/null
$AB wait --load networkidle >/dev/null 2>&1 || true
sleep 3
$AB eval "window.__NOTE_RESET__()" >/dev/null
sleep 5   # erase + reload + reseed

# ---------- 1. fresh boot + seed ---------------------------------------------
echo "── 1. fresh boot + seed"
check "boot: page title" "InfiniteNote — infinite canvas notebook" "$($AB get title)"
check "boot: seeded welcome scene has 2 elements" "2" "$(elcount)"
contains "boot: notebook tree shows Welcome Notebook" "Welcome Notebook" "$(ujeval "document.querySelector('[data-testid=sidebar]')?.innerText || 'MISSING'")"
SELECTED=$(ujeval "document.querySelector('[data-testid=page-row][data-selected=true]')?.innerText")
check "boot: Start here auto-selected" "Start here" "$SELECTED"
CANVAS_H=$(ujeval "document.querySelector('.excalidraw').getBoundingClientRect().height")
if [ "$CANVAS_H" -lt 2000 ] 2>/dev/null; then pass "boot: canvas CSS loaded (h=$CANVAS_H)"; else fail "boot: canvas CSS" "height=$CANVAS_H"; fi

# ---------- 2. draw a rectangle -----------------------------------------------
echo "── 2. draw rectangle"
$AB eval "window.__NOTE_E2E__.excalidraw.setActiveTool({type:'rectangle'})" >/dev/null
read -r CX CY CW CH < <(ujeval "(() => { const r = document.querySelector('.excalidraw').getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}); })()" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(int(d['x']), int(d['y']), int(d['w']), int(d['h']))")
X1=$((CX + CW*30/100)); Y1=$((CY + CH*32/100))
X2=$((CX + CW*55/100)); Y2=$((CY + CH*55/100))
$AB mouse move $X1 $Y1 >/dev/null
$AB mouse down left >/dev/null
$AB mouse move $X2 $Y2 >/dev/null
$AB mouse up left >/dev/null
sleep 0.6
$AB eval "window.__NOTE_E2E__.excalidraw.setActiveTool({type:'selection'})" >/dev/null
check "draw: element count after rectangle" "3" "$(elcount)"

# ---------- 3. type a text element ---------------------------------------------
echo "── 3. type text"
$AB eval "window.__NOTE_E2E__.excalidraw.setActiveTool({type:'text'})" >/dev/null
TX=$((CX + CW*35/100)); TY=$((CY + CH*70/100))
$AB mouse move $TX $TY >/dev/null
$AB mouse down left >/dev/null
$AB mouse up left >/dev/null
sleep 0.8
type_on_canvas "Hello" "E2E"
sleep 0.5
$AB press Escape >/dev/null
sleep 0.8
$AB eval "window.__NOTE_E2E__.excalidraw.setActiveTool({type:'selection'})" >/dev/null
check "type: element count after typing" "4" "$(elcount)"
TYPES=$(ujeval "JSON.stringify([...window.__NOTE_E2E__.excalidraw.getSceneElements()].map(e=>e.type))")
contains "type: a text element exists" '"text"' "$TYPES"

# ---------- 4. autosave + persistence across reload ---------------------------
echo "── 4. persistence"
sleep 1.2
$AB eval "window.__NOTE_E2E__.saveNow()" >/dev/null
sleep 0.6
$AB reload >/dev/null
$AB wait --load networkidle >/dev/null 2>&1 || true
sleep 4
check "persistence: elements survive reload" "4" "$(elcount)"
contains "persistence: save indicator shows Saved" "Saved" "$(ujeval "document.querySelector('[data-testid=save-indicator]')?.innerText || ''")"

# ---------- 5. new page + canvas switching ------------------------------------
echo "── 5. page switching"
$AB find role button click --name "Add page" >/dev/null
sleep 1.5
check "pages: fresh page (Page 2) is empty" "0" "$(elcount)"
click_page_row "Start here"
sleep 1.5
check "pages: switching back restores 4 elements" "4" "$(elcount)"

# ---------- 6. imports --------------------------------------------------------
echo "── 6. imports"
$AB find role button click --name "Add page" >/dev/null
sleep 1.5

$AB upload "input[aria-label='Import files']" "$FX/test-image.png" >/dev/null
sleep 2
check "imports: image import adds 1 element" "1" "$(elcount)"
contains "imports: imported element is an image" '"image"' "$(ujeval "JSON.stringify([...window.__NOTE_E2E__.excalidraw.getSceneElements()].map(e=>e.type))")"

$AB upload "input[aria-label='Import files']" "$FX/test-notes.txt" >/dev/null
sleep 2
check "imports: text import adds 1 element" "2" "$(elcount)"

$AB upload "input[aria-label='Import files']" "$FX/test.pdf" >/dev/null
sleep 3.5
check "imports: PDF printout adds 2 pages" "4" "$(elcount)"

$AB upload "input[aria-label='Import files']" "$FX/test-scene.excalidraw" >/dev/null
sleep 2
check "imports: scene import adds 2 elements" "6" "$(elcount)"

$AB eval "window.__NOTE_E2E__.saveNow()" >/dev/null
sleep 0.6
$AB reload >/dev/null
$AB wait --load networkidle >/dev/null 2>&1 || true
sleep 4
# after reload the first page opens — navigate to the imports page (Page 3)
click_page_row "Page 3"
sleep 2
check "imports: imported content persists across reload" "6" "$(elcount)"

# ---------- 7. notebook / section / page CRUD ---------------------------------
echo "── 7. tree CRUD"
$AB find role button click --name "Add notebook" >/dev/null
sleep 1.5
NB_COUNT=$(ujeval "document.querySelectorAll('[data-testid=notebook-row]').length")
check "crud: new notebook appears (3 total)" "3" "$NB_COUNT"
# addNotebook() auto-expands the new notebook — no need to toggle it open
click_in_notebook "Notebook 3" "Add section"
sleep 1.5
contains "crud: Section 1 created inside Notebook 3" "Section 1" "$(ujeval "document.querySelector('[data-testid=sidebar]').innerText")"
# addSection() auto-expands the new section — add a page directly inside it
ujeval "(() => { const nb = [...document.querySelectorAll('[data-testid=notebook-row]')].find(r => r.textContent.includes('Notebook 3')); const btn = nb ? [...nb.parentElement.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add page') : null; btn?.click(); return 'ok'; })()" > /dev/null
sleep 1.5
check "crud: page in new notebook renders empty canvas" "0" "$(elcount)"

# rename via title bar
ujeval "(() => { document.querySelector('button[title=\"Click to rename this page\"]').click(); return 1; })()" >/dev/null
sleep 0.5
ujeval "(() => { const inp = document.querySelector('input[aria-label=\"Page title\"]'); if(!inp) return 'missing'; const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(inp,'Renamed E2E Page'); inp.dispatchEvent(new Event('input',{bubbles:true})); inp.blur(); return 'set'; })()" >/dev/null
sleep 1.2
contains "crud: title bar shows renamed page" "Renamed E2E Page" "$(ujeval "document.body.innerText")"

# ---------- 8. export serialization --------------------------------------------
echo "── 8. export"
click_page_row "Page 3"
sleep 1.8
SER=$(ujeval "window.__NOTE_E2E__.serializeCurrentPage()")
contains "export: serialized scene has elements" '"elements"' "$SER"
contains "export: serialized scene includes imported text" "QUANTUMFROG" "$SER"
contains "export: scene mixes image+text+rectangle" '"rectangle"' "$SER"

# ---------- 9. search -----------------------------------------------------------
echo "── 9. search"
$AB press Control+k >/dev/null
sleep 1
ujeval "(() => { const inp = document.querySelector('[cmdk-input]'); const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(inp,'QUANTUMFROG'); inp.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()" >/dev/null
sleep 1.5
RESULTS=$(ujeval "document.querySelector('[cmdk-list]')?.innerText || 'NO RESULTS'")
contains "search: finds the page containing keyword" "Page 3" "$RESULTS"
contains "search: snippet includes matching text" "QUANTUMFROG" "$RESULTS"
$AB press Escape >/dev/null
sleep 0.6

# ---------- 10. trash ----------------------------------------------------------
echo "── 10. trash"
ujeval "(() => { const rows=[...document.querySelectorAll('[data-testid=page-row]')]; const t=rows.find(r=>r.textContent.includes('Renamed E2E Page')); t?.querySelector('button[aria-label^=\"Actions for page\"]')?.click(); return 1; })()" >/dev/null
sleep 0.8
ujeval "(() => { const m=[...document.querySelectorAll('[role=menuitem]')]; m.find(x=>x.textContent.includes('Move to trash'))?.click(); return 1; })()" >/dev/null
sleep 1.5
$AB find role button click --name "Trash" >/dev/null
sleep 1.5
contains "trash: deleted page listed in trash dialog" "Renamed E2E Page" "$(ujeval "document.body.innerText")"
ujeval "(() => { const b=[...document.querySelectorAll('button')]; b.find(x=>x.textContent.trim()==='Restore')?.click(); return 1; })()" >/dev/null
sleep 1.5
contains "trash: page restored to sidebar" "Renamed E2E Page" "$(ujeval "document.querySelector('[data-testid=sidebar]')?.innerText")"
$AB press Escape >/dev/null
sleep 0.8

# ---------- 11. dark mode --------------------------------------------------------
echo "── 11. dark mode"
BEFORE=$(ujeval "window.__NOTE_E2E__.excalidraw.getAppState().viewBackgroundColor")
$AB find role button click --name "Toggle theme" >/dev/null
sleep 1.8
AFTER=$(ujeval "window.__NOTE_E2E__.excalidraw.getAppState().viewBackgroundColor")
if [ "$BEFORE" != "$AFTER" ]; then pass "dark mode: canvas background follows theme ($BEFORE → $AFTER)"; else fail "dark mode: canvas background" "expected change, got $BEFORE both times"; fi
$AB screenshot "$SHOTS/e2e-dark-mode.png" >/dev/null
$AB find role button click --name "Toggle theme" >/dev/null
sleep 1

# ---------- 12. mobile viewport ---------------------------------------------------
echo "── 12. mobile"
$AB set viewport 390 844 >/dev/null
sleep 1.5
MENU_OK=$(ujeval "!!document.querySelector('button[aria-label=\"Open navigation\"]')")
check "mobile: hamburger menu visible at 390px" "true" "$MENU_OK"
$AB find role button click --name "Open navigation" >/dev/null
sleep 1.2
DRAWER_OK=$(ujeval "!!document.querySelector('[data-slot=sheet-content]')")
check "mobile: navigation drawer opens" "true" "$DRAWER_OK"
$AB screenshot "$SHOTS/e2e-mobile.png" >/dev/null
ujeval "(() => { const rows=[...document.querySelectorAll('[data-slot=sheet-content] [data-testid=page-row]')]; rows.find(r=>r.textContent.trim()==='Start here')?.querySelector('button')?.click(); return 1; })()" >/dev/null
sleep 2
check "mobile: navigation from drawer works (4 elements)" "4" "$(elcount)"
$AB screenshot "$SHOTS/e2e-mobile-canvas.png" >/dev/null
$AB set viewport 1440 900 >/dev/null
sleep 1

# ---------- 13. console cleanliness ------------------------------------------------
echo "── 13. console"
ERRORS=$($AB errors 2>&1 | grep -v "Download the React DevTools" | grep -v "^✗ *$" | head -5)
if [ -z "$ERRORS" ]; then pass "console: no page errors"; else fail "console: page errors" "$ERRORS"; fi

# ---------- summary ----------------------------------------------------------------
echo ""
echo "══════════════════════════════════════════════════════════════"
echo " E2E RESULT: $PASS passed, $FAIL failed"
echo "══════════════════════════════════════════════════════════════"
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
