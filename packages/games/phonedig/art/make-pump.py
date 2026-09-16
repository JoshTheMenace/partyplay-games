"""Bakes the controller's Pump button into public/games/phonedig/pump.png.

The label is part of the image, not DOM text, so rapid taps cannot start a text
selection that steals the next presses. Run from anywhere:

    python3 packages/games/phonedig/art/make-pump.py

Requires Pillow and the Party Place checkout's public/fonts/LilitaOne-Regular.ttf (OFL).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

GAMES = Path(__file__).resolve().parents[4]
FONT = GAMES.parent / 'public' / 'fonts' / 'LilitaOne-Regular.ttf'
OUT = GAMES / 'public' / 'games' / 'phonedig' / 'pump.png'
SIZE, SUPERSAMPLE = 288, 4
INK, CORAL, HIGHLIGHT = (5, 7, 26, 255), (255, 87, 72, 255), (255, 150, 136, 255)

w = SIZE * SUPERSAMPLE
margin, drop, border = round(w * .03), round(w * .06), round(w * .035)
image = Image.new('RGBA', (w, w), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.ellipse([margin, margin + drop, w - margin, w - margin], fill=INK)  # hard drop shadow, like .kp-btn
draw.ellipse([margin, margin, w - margin, w - margin - drop], fill=INK)
face = [margin + border, margin + border, w - margin - border, w - margin - drop - border]
draw.ellipse(face, fill=CORAL)
inset = round(w * .06)
draw.arc([face[0] + inset, face[1] + inset, face[2] - inset, face[3] - inset], 200, 320, fill=HIGHLIGHT, width=round(w * .035))
font = ImageFont.truetype(str(FONT), round(w * .25))
draw.text((w / 2, (face[1] + face[3]) / 2), 'PUMP', font=font, fill=INK, anchor='mm')
OUT.parent.mkdir(parents=True, exist_ok=True)
image.resize((SIZE, SIZE), Image.LANCZOS).save(OUT, optimize=True)
print(f'Wrote {OUT} ({SIZE}x{SIZE})')
