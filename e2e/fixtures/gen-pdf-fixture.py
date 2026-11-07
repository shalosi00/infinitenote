#!/usr/bin/env python3
"""
Generate test-25pages.pdf — a 25-page A4 PDF used by e2e/import-pdf-truncation.spec.ts
(issue #75: the printout import must warn when the 20-page render cap truncates).

Dependency-free on purpose: plain text drawing ops per page, a proper xref
table, and a marker string per page so pdfjs parses it like any real PDF.
"""
from __future__ import annotations

PAGES = 25
PAGE_W, PAGE_H = 595, 842  # A4 portrait, points

objects: dict[int, bytes] = {}


def add(num: int, body: bytes) -> None:
    objects[num] = body


add(1, b"<< /Type /Catalog /Pages 2 0 R >>")

font_num = 3
add(font_num, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

# per page: one page object + one content stream (4,5 = page 1; 6,7 = page 2; …)
kids = []
next_num = 4
for i in range(1, PAGES + 1):
    page_num = next_num
    content_num = next_num + 1
    next_num += 2
    kids.append(f"{page_num} 0 R".encode())
    add(
        page_num,
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Contents {content_num} 0 R /Resources << /Font << /F1 {font_num} 0 R >> >> >>"
        ).encode(),
    )
    stream = f"BT /F1 24 Tf 72 770 Td (Truncation fixture - page {i} of {PAGES}) Tj ET".encode()
    add(content_num, b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")

add(2, b"<< /Type /Pages /Count " + str(PAGES).encode() + b" /Kids [" + b" ".join(kids) + b"] >>")

total = next_num - 1
out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
offsets: dict[int, int] = {}
for num in range(1, total + 1):
    offsets[num] = len(out)
    out += f"{num} 0 obj\n".encode() + objects[num] + b"\nendobj\n"

xref_at = len(out)
out += f"xref\n0 {total + 1}\n".encode()
out += b"0000000000 65535 f \n"
for num in range(1, total + 1):
    out += f"{offsets[num]:010d} 00000 n \n".encode()
out += (
    f"trailer\n<< /Size {total + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n"
).encode()

import os

dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-25pages.pdf")
with open(dest, "wb") as f:
    f.write(bytes(out))
print(f"wrote {dest}: {len(out)} bytes, {PAGES} pages, {total} objects")
