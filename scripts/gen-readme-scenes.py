#!/usr/bin/env python3
"""Generate .excalidraw scenes for the README screenshot capture.

Outputs to /tmp/shots/:
  scene-a.excalidraw  — "Q4 product planning" (light hero): title, milestone
                        list, blue frame with bound label, decision diamond,
                        labeled arrow, yellow sticky, hand-drawn star accent.
  scene-b.excalidraw  — "Alpine field notes" (dark hero): light text on dark
                        canvas, freedraw mountain ridge + sun with rays +
                        accent underline, callout box, gear notes.
  scene-c.excalidraw  — "Ink sketchbook": title + the block-letter CAT
                        strokes lifted verbatim from the HWR e2e fixture
                        (so the real engine recognizes them) + hint text.

Element schema mirrors a real Excalidraw export (the app's importer and the
HWR pipeline both consume this exact shape — see
e2e/fixtures/handwriting-cat.excalidraw).
"""
import json
import math
import random
from pathlib import Path

random.seed(20261111)
OUT = Path("/tmp/shots")
OUT.mkdir(parents=True, exist_ok=True)


def base(eid, etype, x, y, w, h, **kw):
    el = {
        "id": eid,
        "type": etype,
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "angle": 0,
        "strokeColor": kw.get("stroke", "#1e1e1e"),
        "backgroundColor": kw.get("bg", "transparent"),
        "fillStyle": kw.get("fill", "solid"),
        "strokeWidth": kw.get("sw", 2),
        "strokeStyle": kw.get("style", "solid"),
        "roughness": kw.get("rough", 1),
        "opacity": kw.get("opacity", 100),
        "groupIds": [],
        "frameId": None,
        "roundness": None,
        "seed": random.randint(1, 2**31 - 1),
        "version": 1,
        "versionNonce": random.randint(1, 2**31 - 1),
        "isDeleted": False,
        "boundElements": None,
        "updated": 1762200000000,
        "link": None,
        "locked": False,
    }
    if etype in ("rectangle", "diamond", "ellipse", "arrow", "line"):
        el["roundness"] = {"type": 2}
    return el


def text(el, body, size=20, family=2, align="left", valign="top", color=None):
    """Fill a text element's content + measure its box."""
    if color:
        el["strokeColor"] = color
    lines = body.split("\n")
    factor = 0.60 if family == 1 else 0.53
    longest = max(len(ln) for ln in lines)
    el["width"] = max(el["width"], round(longest * size * factor) + 12)
    el["height"] = round(len(lines) * size * 1.25)
    el.update(
        {
            "text": body,
            "fontSize": size,
            "fontFamily": family,
            "textAlign": align,
            "verticalAlign": valign,
            "containerId": None,
            "originalText": body,
            "lineHeight": 1.25,
        }
    )
    return el


def standalone(eid, x, y, body, size=20, family=2, color="#1e1e1e", align="left"):
    el = base(eid, "text", x, y, 10, 10, stroke=color)
    return text(el, body, size=size, family=family, align=align)


def bind_label(container, label_id, body, size=20, family=1, color="#1e1e1e"):
    """Create a text element bound as container's label."""
    lw = round(len(body.split("\n")[0]) * size * 0.6) + 16
    lh = round(len(body.split("\n")) * size * 1.25)
    label = base(
        label_id,
        "text",
        container["x"] + (container["width"] - lw) / 2,
        container["y"] + (container["height"] - lh) / 2,
        lw,
        lh,
        stroke=color,
    )
    text(label, body, size=size, family=family, align="center", valign="middle")
    label["containerId"] = container["id"]
    container["boundElements"] = [{"id": label_id, "type": "text"}]
    return label


def arrow(eid, x1, y1, x2, y2, **kw):
    el = base(eid, "arrow", x1, y1, x2 - x1, y2 - y1, **kw)
    el["points"] = [[0, 0], [x2 - x1, y2 - y1]]
    el["startArrowhead"] = None
    el["endArrowhead"] = "arrow"
    return el


def freedraw(eid, x, y, pts, stroke="#1e1e1e", sw=2):
    el = base(eid, "freedraw", x, y, 10, 10, stroke=stroke, sw=sw, rough=0)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    el["x"] = x + min(xs)
    el["y"] = y + min(ys)
    rel = [[p[0] - min(xs), p[1] - min(ys)] for p in pts]
    el["points"] = rel
    el["width"] = max(xs) - min(xs)
    el["height"] = max(ys) - min(ys)
    el["pressures"] = [None] * len(rel)
    el["simulatePressure"] = False
    el["lastCommittedPoint"] = None
    return el


def scene(elements):
    return {
        "type": "excalidraw",
        "version": 2,
        "source": "https://excalidraw.com",
        "elements": elements,
        "appState": {"viewBackgroundColor": "#ffffff"},
        "files": {},
    }


# --------------------------------------------------------------------------
# Scene A — Q4 product planning (light hero)
# --------------------------------------------------------------------------
a = []
a.append(standalone("ra-title", 60, 40, "Q4 product planning", size=44, family=1))
underline = base("ra-underline", "line", 62, 118, 480, 4, stroke="#1971c2", sw=4, rough=0)
underline["points"] = [[0, 0], [480, 2]]
a.append(underline)
a.append(standalone("ra-miles-h", 60, 160, "Milestones", size=28, family=1))
a.append(
    standalone(
        "ra-miles",
        80,
        214,
        "1. Handwriting search — shipped Nov 10\n2. Ink-to-text conversion — Phase B study\n3. Sync folder merge — hardening pass",
        size=20,
        family=2,
    )
)
frame = base("ra-frame", "rectangle", 560, 160, 340, 230, stroke="#1971c2", bg="#a5d8ff", fill="solid", sw=2)
a.append(frame)
a.append(bind_label(frame, "ra-frame-t", "Release v1.13", size=26, family=1))
dia = base("ra-dia", "diamond", 1030, 176, 210, 170, stroke="#2f9e44", bg="#d3f9d8", fill="solid")
a.append(dia)
a.append(bind_label(dia, "ra-dia-t", "Beta\ngate?", size=22, family=1))
arr = arrow("ra-arr", 905, 275, 1025, 262, stroke="#495057", sw=3)
a.append(arr)
lbl = base("ra-arr-t", "text", 912, 236, 90, 24, stroke="#343a40")
text(lbl, "after QA", size=18, family=2, align="center")
lbl["containerId"] = "ra-arr"
arr["boundElements"] = [{"id": "ra-arr-t", "type": "text"}]
a.append(lbl)
a.append(standalone("ra-openq-h", 60, 430, "Open questions", size=28, family=1))
a.append(
    standalone(
        "ra-openq",
        80,
        484,
        "Does Phase B accuracy hold on cursive ink?\nHow large is the AppImage after model caching?",
        size=20,
        family=2,
    )
)
sticky = base("ra-sticky", "rectangle", 560, 470, 280, 160, stroke="#f08c00", bg="#fff3bf", fill="solid")
a.append(sticky)
a.append(bind_label(sticky, "ra-sticky-t", "Don't forget:\nrefresh the README\nscreenshots", size=18, family=1))
# hand-drawn star accent right of milestone 1 (clear of the list text)
star_pts = []
cx, cy, R = 525, 214, 20
for i in range(10):
    r = R if i % 2 == 0 else R * 0.42
    th = -math.pi / 2 + i * math.pi / 5
    star_pts.append([round(cx + r * math.cos(th)), round(cy + 12 + r * math.sin(th))])
a.append(freedraw("ra-star", 0, 0, star_pts, stroke="#f08c00", sw=2))
json.dump(scene(a), open(OUT / "scene-a.excalidraw", "w"), indent=1)
print(f"scene-a: {len(a)} elements")

# --------------------------------------------------------------------------
# Scene B — Alpine field notes (dark hero, light ink on dark canvas)
# --------------------------------------------------------------------------
b = []
LG = "#e9ecef"  # light gray text
MG = "#ced4da"  # muted
AC = "#74c0fc"  # accent blue
b.append(standalone("rb-title", 60, 40, "Alpine field notes", size=40, family=1, color=LG))
b.append(standalone("rb-sub", 62, 108, "Nov 8–10, 2026 · Mont Blanc massif", size=18, family=2, color=MG))
b.append(standalone("rb-route-h", 60, 170, "Route", size=26, family=1, color=AC))
b.append(
    standalone(
        "rb-route",
        80,
        222,
        "Refugio Torino → Aiguille du Midi\nSkyline ridge to Pointe Helbronner\nDescent via the Vallée Blanche",
        size=20,
        family=2,
        color=LG,
    )
)
b.append(standalone("rb-gear-h", 60, 420, "Gear notes", size=26, family=1, color=AC))
b.append(
    standalone(
        "rb-gear",
        80,
        472,
        "Crampons bitten in on the ridge ice\nNew mittens: warm, but the palm\ngrip is too slick on the axe",
        size=20,
        family=2,
        color=LG,
    )
)
# freedraw mountain ridge
ridge = []
for i in range(0, 61):
    t = i / 60
    x = 600 + t * 420
    y = 300 - 90 * math.sin(math.pi * t) * (0.55 + 0.45 * math.sin(3.1 * t + 0.6)) - 18 * math.sin(9 * t)
    ridge.append([round(x), round(y)])
b.append(freedraw("rb-ridge", 0, 0, ridge, stroke=AC, sw=2))
# baseline
base_line = [[600, 300], [1020, 300]]
b.append(freedraw("rb-base", 0, 0, base_line, stroke="#495057", sw=2))
# sun with rays — reads unmistakably as a doodled sun
sun = [
    [round(660 + 26 * math.cos(math.radians(i * 12))), round(120 + 26 * math.sin(math.radians(i * 12)))]
    for i in range(31)
]
b.append(freedraw("rb-sun", 0, 0, sun, stroke="#ffd43b", sw=2))
for i in range(8):
    th = math.radians(i * 45)
    x1, y1 = 660 + 32 * math.cos(th), 120 + 32 * math.sin(th)
    x2, y2 = 660 + 44 * math.cos(th), 120 + 44 * math.sin(th)
    b.append(freedraw(f"rb-sunray-{i}", 0, 0, [[round(x1), round(y1)], [round(x2), round(y2)]], stroke="#ffd43b", sw=2))
# accent underline under the route headline (clear of descenders)
b.append(freedraw("rb-hl", 0, 0, [[60, 214], [140, 212], [60, 215]], stroke="#f59f00", sw=3))
# callout box
call = base("rb-call", "rectangle", 640, 385, 380, 92, stroke=AC, bg="#343a40", fill="solid")
b.append(call)
b.append(
    bind_label(call, "rb-call-t", "Wind 40 km/h NE — turned back\nat 4,100 m on the skyline", size=18, family=2, color=LG)
)
# hand-drawn arrow from the callout up to the ridge high point
b.append(
    freedraw(
        "rb-arr",
        0,
        0,
        [[830, 381], [818, 350], [806, 300], [800, 260]],
        stroke="#ffd43b",
        sw=2,
    )
)
json.dump(scene(b), open(OUT / "scene-b.excalidraw", "w"), indent=1)
print(f"scene-b: {len(b)} elements")

# --------------------------------------------------------------------------
# Scene C — Ink sketchbook (CAT strokes lifted verbatim from the HWR fixture)
# --------------------------------------------------------------------------
fixture = json.load(open("e2e/fixtures/handwriting-cat.excalidraw"))
ink = [e for e in fixture["elements"] if e["type"] == "freedraw"]
# ink sits left, hint paragraph right of it — a wide, short bbox keeps the
# fitted content clear of the floating canvas toolbar
dx, dy = -80, 40
c = []
c.append(standalone("rc-title", 60, 40, "Ink sketchbook", size=40, family=1))
c.append(
    standalone(
        "rc-hint",
        420,
        190,
        "Freehand ink stays ink — page actions → Recognize\nhandwriting (English) reads it on-device and indexes\nthe words for search.",
        size=18,
        family=2,
        color="#495057",
    )
)
for e in ink:
    e = dict(e)
    e["x"] += dx
    e["y"] += dy
    e["isDeleted"] = False
    c.append(e)
# arrow from the hint pointing at the ink
ink_arrow = arrow("rc-arr", 336, 252, 420, 258, stroke="#868e96", sw=2)
ink_arrow["startArrowhead"] = "arrow"
ink_arrow["endArrowhead"] = None
c.append(ink_arrow)
json.dump(scene(c), open(OUT / "scene-c.excalidraw", "w"), indent=1)
print(f"scene-c: {len(c)} elements ({len(ink)} lifted ink strokes)")
