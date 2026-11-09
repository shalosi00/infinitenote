#!/usr/bin/env python3
"""Generate the deterministic German OCR fixture (ocr-text-de.png).

Same recipe as e2e/fixtures/ocr-text.png: Pillow, DejaVu Sans Bold, black
on white, 480x120. Words carry umlauts + Eszett so a German-less engine
fails the spec loudly.
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 480, 120
img = Image.new("RGB", (W, H), "white")
draw = ImageDraw.Draw(img)
font = ImageFont.truetype(
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40
)
draw.text((24, 12), "GÄSTEBUCH", fill="black", font=font)
draw.text((24, 66), "GRÜßE KÖLN", fill="black", font=font)
img.save("/tmp/ocr-verify/ocr-text-de.png")
print("wrote /tmp/ocr-verify/ocr-text-de.png", img.size)
