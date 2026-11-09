#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont

font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
# longer English passage
img = Image.new("RGB", (760, 180), "white")
d = ImageDraw.Draw(img)
d.text((24, 16), "THE QUICK BROWN FOX", fill="black", font=font)
d.text((24, 72), "JUMPS OVER THE LAZY DOG", fill="black", font=font)
d.text((24, 128), "MEETING NOTES SUMMARY", fill="black", font=font)
img.save("/tmp/ocr-verify/english-passage.png")

# mixed: English line + German line on ONE image (realistic printout)
img2 = Image.new("RGB", (760, 180), "white")
d2 = ImageDraw.Draw(img2)
d2.text((24, 16), "MEETING NOTES SUMMARY", fill="black", font=font)
d2.text((24, 72), "GÄSTEBUCH MÜNCHEN", fill="black", font=font)
d2.text((24, 128), "QUARTALSZAHLEN 2026", fill="black", font=font)
img2.save("/tmp/ocr-verify/mixed.png")
print("done")
