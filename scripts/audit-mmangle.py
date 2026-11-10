#!/usr/bin/env python3
"""Audit v1.11.1 tree for [m-stripping damage: markdown links whose opening
bracket was eaten (label missing but ](target) present)."""
import re
import subprocess

FILES = [
    "README.md", "PROJECT_STATUS.md", "docs/desktop.md", "docs/WORKLOG.md",
    "docs/ROADMAP.md", ".github/workflows/desktop.yml",
    "src/lib/__tests__/desktop-config.test.ts",
]
REF = "v1.11.1"

# A healthy link: [label](target) — the label part may be empty for images
# (![alt](src)). Damage looks like: "label](target)" where the char before
# the label-start is not '[' — i.e. an orphan '](target)'.
healthy = re.compile(r"\[[^\]]*\]\([^)]+\)")
orphan = re.compile(r"(?<!\])\]\(")

for f in FILES:
    try:
        text = subprocess.run(
            ["git", "show", f"{REF}:{f}"], capture_output=True, text=True,
            check=True).stdout
    except subprocess.CalledProcessError:
        print(f"!! {f}: not in {REF}")
        continue
    for i, line in enumerate(text.splitlines(), 1):
        # remove all healthy links, then look for leftover ]( orphans
        residue = healthy.sub("", line)
        if orphan.search(residue):
            print(f"{f}:{i}: ORPHAN-LINK -> {line.strip()[:120]}")
        # direct tell: 'ain]' where '[main]' was meant, or 'igration' etc.
        for token in ("ain]", "igration ", "enu ]", "igration guide"):
            if token in line and " branches: " not in line[:20]:
                pass  # handled by explicit review below
print("audit complete")
