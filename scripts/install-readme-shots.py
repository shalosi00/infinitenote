#!/usr/bin/env python3
"""Install the captured README screenshots into assets/screenshots/.

Takes the raw 2x shots from /tmp/shots/out/, resizes them to README-appropriate
widths (LANCZOS), and writes them into the repo. Deletes the two superseded
originals (light.png / dark.png) from the open-sourcing commit.
"""
import os
from PIL import Image

SRC = "/tmp/shots/out"
DST = "assets/screenshots"
os.makedirs(DST, exist_ok=True)

# (source, destination, target display width in px)
PLAN = [
    ("light-hero.png", "hero-light.png", 2000),
    ("dark-hero.png", "hero-dark.png", 2000),
    ("handwriting.png", "handwriting.png", 1600),
    ("search.png", "search.png", 1600),
    ("version-history.png", "version-history.png", 1600),
    ("themes.png", "themes.png", 1600),
    ("mobile.png", "mobile.png", 780),
]

for src, dst, width in PLAN:
    path = os.path.join(SRC, src)
    if not os.path.exists(path):
        raise SystemExit(f"missing capture: {path}")
    im = Image.open(path)
    if im.width > width:
        height = round(im.height * width / im.width)
        im = im.resize((width, height), Image.LANCZOS)
    out = os.path.join(DST, dst)
    im.save(out, optimize=True)
    print(f"{dst}: {im.size} {os.path.getsize(out) // 1024}KB")

for old in ("light.png", "dark.png"):
    p = os.path.join(DST, old)
    if os.path.exists(p):
        os.remove(p)
        print(f"removed superseded {old}")
