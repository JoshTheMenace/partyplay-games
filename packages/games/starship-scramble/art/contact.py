"""Alignment contact sheets: tinted sprite with the game's room tiles, the paint mask, and TV-scale (1/2) previews.
Run: blender -b --factory-startup -P contact.py -- <public/games/starship-scramble> <outDir> [hullId ...]"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import load_rgba, save_rgba

PPC, MX, MY = 64, 2, 1.5
BG = np.array([.03, .04, .08])

def hexrgb(h): return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])
def over(bg, fg): a = fg[..., 3:]; return bg * (1 - a) + fg[..., :3] * a

def tinted(sprite, mask, paint):
    rgb = sprite[..., :3] * (1 - mask[..., 3:] + mask[..., 3:] * paint)
    return np.dstack([rgb, sprite[..., 3]])

def rooms(img, hull, scale=1., fill=(16 / 255, 24 / 255, 50 / 255, .84), line=(.02, .027, .1, 1)):
    """Room tiles drawn like render/ship.ts: translucent navy fill with an ink outline."""
    c = PPC * scale
    for r in hull['rooms']:
        x0, y0 = round((r['x'] + MX) * c), round((r['y'] + MY) * c); x1, y1 = round((r['x'] + r['w'] + MX) * c), round((r['y'] + r['h'] + MY) * c)
        img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - fill[3]) + np.array(fill[:3]) * fill[3]
        for sl in ((slice(y0, y0 + 2), slice(x0, x1)), (slice(y1 - 2, y1), slice(x0, x1)), (slice(y0, y1), slice(x0, x0 + 2)), (slice(y0, y1), slice(x1 - 2, x1))):
            img[sl] = img[sl] * (1 - line[3]) + np.array(line[:3]) * line[3]
    return img

def half(a): h, w = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2; return a[:h, :w].reshape(h // 2, 2, w // 2, 2, -1).mean((1, 3))

def sheet(pub, out, hull):
    sp = load_rgba(os.path.join(pub, 'ships', hull['id'] + '.png')); mk = load_rgba(os.path.join(pub, 'ships', hull['id'] + '-paint.png'))
    h, w = sp.shape[:2]; paint = hexrgb(hull['paint']); bg = np.broadcast_to(BG, (h, w, 3)).copy()
    a = rooms(over(bg, tinted(sp, mk, paint)), hull)
    b = over(bg, mk * np.array([1, 1, 1, 1]))
    b = rooms(b, hull, fill=(1, .3, .3, 0), line=(1, .35, .3, .9))
    t = over(np.broadcast_to(BG, (h, w, 3)), tinted(sp, mk, paint)); t = half(rooms(t, hull))
    raw = half(over(np.broadcast_to(BG, (h, w, 3)), sp))
    bottom = np.concatenate([t, raw], 1); bottom = np.pad(bottom, ((0, 0), (0, w - bottom.shape[1]), (0, 0)))
    img = np.concatenate([a, np.full((8, w, 3), .5), b, np.full((8, w, 3), .5), bottom], 0)
    save_rgba(np.dstack([img, np.ones(img.shape[:2])]), os.path.join(out, f'contact-{hull["id"]}.png'))

def gallery(pub, out, hulls, width=1800):
    """Every tinted hull at TV scale (32 px/cell) with faint room overlays, packed into rows."""
    tiles = []
    for hull in hulls:
        sp = load_rgba(os.path.join(pub, 'ships', hull['id'] + '.png')); mk = load_rgba(os.path.join(pub, 'ships', hull['id'] + '-paint.png'))
        t = over(np.broadcast_to(BG, sp.shape[:2] + (3,)), tinted(sp, mk, hexrgb(hull['paint'])))
        tiles.append(half(rooms(t, hull)))
    rows, row, w = [], [], 0
    for t in tiles:
        if w + t.shape[1] > width and row: rows.append(row); row, w = [], 0
        row.append(t); w += t.shape[1] + 12
    rows.append(row)
    strips = []
    for r in rows:
        hmax = max(t.shape[0] for t in r); parts = []
        for t in r: parts += [np.pad(t, ((0, hmax - t.shape[0]), (0, 12), (0, 0)), constant_values=.03)]
        strip = np.concatenate(parts, 1); strips.append(np.pad(strip, ((0, 12), (0, width + 12 - strip.shape[1]), (0, 0)), constant_values=.03))
    img = np.concatenate(strips, 0); save_rgba(np.dstack([img, np.ones(img.shape[:2])]), os.path.join(out, 'gallery.png'))

args = sys.argv[sys.argv.index('--') + 1:]
pub, out = args[0], args[1]; os.makedirs(out, exist_ok=True)
hulls = [h for h in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hulls.json'))) if os.path.exists(os.path.join(pub, 'ships', h['id'] + '.png'))]
for hull in hulls:
    if not args[2:] or hull['id'] in args[2:]: sheet(pub, out, hull)
gallery(pub, out, hulls)
