#!/usr/bin/env python3
"""Verify screenshots are non-blank: prints size + non-background pixel ratio."""
import sys
from PIL import Image

for p in sys.argv[1:]:
    im = Image.open(p).convert("RGB")
    w, h = im.size
    small = im.resize((min(w, 200), min(h, 200)))
    px = list(small.getdata())
    # background = most common color
    from collections import Counter
    common, cnt = Counter(px).most_common(1)[0]
    non_bg = sum(1 for c in px if c != common) / len(px)
    status = "OK" if non_bg > 0.02 else "SUSPICIOUS(near-blank)"
    print(f"{p}: {w}x{h} bg={common} non-bg={non_bg:.1%} {status}")
