"""Genera los iconos PNG de la PWA. Uso: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)
BG, TRACK, ACCENT, INK = '#0b0f14', '#1b2430', '#34d399', '#e8eef5'

def font(size):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
              '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def icon(size, scale=1.0, rounded=True):
    S = size * 4  # supersampling
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, S, S], fill=BG)
    r = S * 0.29 * scale
    w = int(S * 0.11 * scale)
    box = [S / 2 - r, S / 2 - r, S / 2 + r, S / 2 + r]
    d.arc(box, 0, 360, fill=TRACK, width=w)
    d.arc(box, -90, 150, fill=ACCENT, width=w)
    f = font(int(S * 0.2 * scale))
    d.text((S / 2, S / 2), 'Bs', font=f, fill=INK, anchor='mm')
    return img.resize((size, size), Image.LANCZOS)

icon(192).save(os.path.join(OUT, 'icon-192.png'))
icon(512).save(os.path.join(OUT, 'icon-512.png'))
icon(512, scale=0.78, rounded=False).save(os.path.join(OUT, 'maskable-512.png'))
icon(180, rounded=False).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
print('Iconos generados en public/icons')
