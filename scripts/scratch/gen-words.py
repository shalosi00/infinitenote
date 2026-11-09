#!/usr/bin/env python3
"""Render candidate German words as individual fixture PNGs."""
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
WORDS = ["MÜNCHEN", "STRAßE", "GRÜßE", "SCHÖN", "ÜBUNG", "ÄPFEL", "ÖFFNEN", "ZÜRICH", "GÄSTEBUCH"]
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 48)
for w in WORDS:
    img = Image.new("RGB", (640, 100), "white")
    d = ImageDraw.Draw(img)
    d.text((24, 24), w, fill="black", font=font)
    img.save(f"{OUT}/{w}.png")
print("done", len(WORDS))
