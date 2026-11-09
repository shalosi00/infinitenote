#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont

bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
reg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 36)

img = Image.new("RGB", (780, 300), "white")
d = ImageDraw.Draw(img)
d.text((24, 16), "THOUGH THROUGH THOROUGH", fill="black", font=bold)
d.text((24, 72), "MEETING NOTES AND IDEAS", fill="black", font=bold)
d.text((24, 128), "Quarterly report 2026", fill="black", font=reg)
d.text((24, 178), "The quick brown fox jumps", fill="black", font=reg)
d.text((24, 228), "LICENSE AGREEMENT v1.2", fill="black", font=bold)
img.save("/tmp/ocr-verify/english-tricky.png")
print("done")
