#!/usr/bin/env python3
"""Final German OCR e2e fixture — generous spacing, 48px bold DejaVu.

Words chosen from the probe matrix (all 9/9 under the deu fast model at
this size): GÄSTEBUCH, MÜNCHEN, STRAßE.
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 640, 200
img = Image.new("RGB", (W, H), "white")
draw = ImageDraw.Draw(img)
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 48)
draw.text((24, 24), "GÄSTEBUCH", fill="black", font=font)
draw.text((24, 112), "MÜNCHEN STRAßE", fill="black", font=font)
img.save("/tmp/ocr-verify/ocr-text-de-final.png")
print("wrote", img.size)
