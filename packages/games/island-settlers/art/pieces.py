"""pieces.glb: base-game player pieces, robber, pirate, harbour settlement and the finale die.
Run: blender -b --factory-startup -P art/pieces.py -- <out.glb> [--preview <png>]"""
import math, sys
sys.dont_write_bytecode = True; sys.path.insert(0, __import__('os').path.dirname(__file__))
from common import COLORS, Part, args, export, ngon, pose, reset

COLORS.update(plum='#463a5c', plum_dark='#342a47', hull='#2a2433', blackened='#1a1522')
BUDGET = dict(settlement=300, city=520, road=60, ship=620, robber=800, pirate=900, harbor=520, die=300)


def roof_paint(n):
    """Roof planes facing the camera and key light (south or west) carry the seat colour."""
    return 'seat' if n[1] > 0.2 and n[2] - n[0] > 0.2 else 'seat_dark'


def house(p, w, d, wall, ridge, x=0, z=0, gable=False, door=True, mark=-0.02, eave=0.03):
    """Gabled house standing on a plinth top (y = 0.025). Built with the ridge along x, then
    turned so the gable faces the camera when `gable`. The emblem decal sits on the lit slope."""
    y0, r, t = 0.025, ridge + 0.012, 0.028
    kw = dict(at=(x, 0, z), yaw=-90 if gable else 0)
    if gable: w, d = d, w
    p.extrude([(-d / 2, y0), (d / 2, y0), (d / 2, wall), (0, ridge - 0.02), (-d / 2, wall)],
              -w / 2, w / 2, 'seat', axis='x', caps=(True, True), **kw)
    e = d / 2 + eave; lo = wall - eave * (ridge - wall) / (d / 2)
    p.extrude([(-e, lo), (0, r), (e, lo), (e, lo - t), (0, r - t), (-e, lo - t)], -w / 2 - eave,
              w / 2 + eave, 'seat_dark', axis='x', caps=(True, True), paint=roof_paint, **kw)
    if door:  # on the gable end (local +x) or the long front wall (local +z)
        size, spot = ((0.012, 0.085, 0.05), (w / 2, y0, 0.035)) if gable else \
            ((0.05, 0.1, 0.012), (0.07, y0, d / 2))
        p.box(*size, 'ink', outline=False, yaw=kw['yaw'], at=pose(spot, **kw))
    slope = math.atan2(e, r - lo); k = 0.004
    spot = (mark, (lo + r) / 2 + k * math.sin(slope), e / 2 + k * math.cos(slope))
    p.decal(0.12, pose(spot, **kw), pose((0, math.sin(slope), math.cos(slope)), yaw=kw['yaw']))
    return p


def plinth(p, pts, x=0):
    return p.extrude(pts, 0, 0.025, 'ink', at=(x, 0, 0))


def rounded(w, d, c):
    """Rectangle with chamfered corners (8 points)."""
    x, z = w / 2, d / 2
    return [(-x + c, -z), (x - c, -z), (x, -z + c), (x, z - c), (x - c, z), (-x + c, z), (-x, z - c),
            (-x, -z + c)]


def settlement():
    p = plinth(Part(), ngon(8, 0.22))
    house(p, 0.26, 0.24, 0.19, 0.34, gable=True)
    p.box(0.05, 0.1, 0.05, 'seat_dark', at=(0.065, 0.26, -0.05))
    return p.blob(0.22 * 1.25)


def city(keep=None):
    """Hall with its ridge east-west plus a tower at the back-west; `keep(p, x, z)` replaces the
    tower (metropolis)."""
    p = plinth(Part(), rounded(0.58, 0.42, 0.07))
    house(p, 0.46, 0.30, 0.19, 0.29, x=0.03, z=0.03, mark=0.08, eave=0.018)
    for x in (-0.03, 0.19): p.box(0.045, 0.05, 0.012, 'ink', at=(x, 0.10, 0.18), outline=False)
    tx, tz = -0.16, -0.07
    if keep: keep(p, tx, tz)
    else:
        p.box(0.20, 0.36, 0.20, 'seat', at=(tx, 0.025, tz), caps=(False, False))
        p.lathe([(0.15, 0.37), (0.15, 0.385), (0, 0.60)], 'seat_dark', n=4, at=(tx, 0, tz),
                paint=lambda n: 'seat' if n[1] > 0.2 and n[2] > 0.3 else None)
        p.box(0.05, 0.08, 0.012, 'ink', at=(tx, 0.26, tz + 0.10), outline=False)
    return p.blob(0.36 * 1.25, 0.30 * 1.25)


def road():
    p = Part().extrude(rounded(0.54, 0.12, 0.035), 0, 0.10, 'seat', side='seat_dark', caps=(False, True))
    return p.blob(0.54 * 0.62, 0.12 * 0.9, n=8)


def hull(p, length, beam, depth, mat, y=0.0, stern_mat='wood'):
    """Boat hull along +x (bow at +x): a narrow keel ring lofted to a wider deck ring."""
    h, b = length / 2, beam / 2
    deck = [(-h, -b * 0.8), (-h * 0.35, -b), (h * 0.45, -b * 0.85), (h, 0), (h * 0.45, b * 0.85),
            (-h * 0.35, b), (-h, b * 0.8)]
    rings = [[(x * 0.82, y, z * 0.55) for x, z in deck], [(x, y + depth, z) for x, z in deck]]
    rings[1][3] = (h * 1.04, y + depth + 0.035, 0)  # raised prow
    return p.loft(rings, mat, top=stern_mat)


def ship():
    p = hull(Part(), 0.52, 0.18, 0.10, 'seat', stern_mat='seat_dark')
    p.box(0.10, 0.05, 0.12, 'seat', at=(-0.17, 0.10, 0))
    p.lathe([(0.012, 0.10), (0.012, 0.44)], 'wood', n=4, cap=False, at=(0.02, 0, 0))
    sail = [(-0.14, 0.15), (0.13, 0.15), (0.11, 0.40), (-0.12, 0.40)]
    p.extrude(sail, -0.008, 0.008, 'sail', axis='z', caps=(True, True), at=(0.01, 0, 0.02))
    p.extrude([(-0.137, 0.17), (0.127, 0.17), (0.124, 0.21), (-0.134, 0.21)], -0.012, 0.012, 'seat',
              axis='z', caps=(True, True), at=(0.01, 0, 0.02))
    p.extrude([(0, 0.40), (0.09, 0.425), (0, 0.45)], -0.006, 0.006, 'seat', axis='z', caps=(True, True),
              at=(0.02, 0, 0))
    p.decal(0.09, (0.0, 0.30, 0.0295), (0, 0, 1))
    return p.blob(0.30, 0.13)


def ring(n, r, y, z=0, sx=1):
    return [(x, y, z + zz) for x, zz in ngon(n, r, 0.5, sx)] if r else [(0, y, z)]


def robber():
    """Hooded thief: a bell robe, a cowl whose peak folds back, a dark face and sun eyes."""
    rows = [(0.17, 0), (0.165, 0.035), (0.14, 0.18), (0.115, 0.32), (0.125, 0.37), (0.135, 0.44),
            (0.12, 0.50, -0.01), (0.075, 0.555, -0.04), (0, 0.60, -0.085)]
    p = Part().loft([ring(10, *row) for row in rows], 'plum')
    p.lathe([(0.16, 0.25), (0.135, 0.32), (0.1, 0.335)], 'plum_dark', n=10, cap=False)
    p.lathe([(0.085, 0), (0.09, 0.015), (0.07, 0.04), (0, 0.05)], 'blackened', n=10, outline=False,
            pitch=90 - 30, scale=(1, 1, 0.85), at=(0, 0.45, 0.10))
    for x in (-0.034, 0.034):
        eye = ((-0.02, 0), (0.02, 0), (0, 0.014), (0, -0.012))
        p.convex([(x + dx, 0.455 + dy, 0.156 + dy * 0.6) for dx, dy in eye] + [(x, 0.45, 0.14)], 'glow',
                 outline=False)
    return p.blob(0.17 * 1.25)


def pirate():
    p = hull(Part(), 0.60, 0.22, 0.13, 'hull', stern_mat='blackened')
    p.box(0.13, 0.06, 0.16, 'blackened', at=(-0.21, 0.13, 0))
    p.lathe([(0.015, 0.12), (0.015, 0.60)], 'wood', n=4, cap=False, at=(0.02, 0, 0))
    sail = [(-0.17, 0.19), (0.17, 0.19), (0.15, 0.52), (-0.15, 0.52)]
    p.extrude(sail, -0.01, 0.01, 'blackened', axis='z', caps=(True, True), at=(0.02, 0, 0.025))
    s = (0.02, 0.37, 0.037)
    p.lathe([(0.065, 0), (0.07, 0.015), (0.058, 0.03), (0, 0.035)], 'cream', n=8, outline=False,
            pitch=90, at=(s[0], s[1] + 0.02, s[2]))
    p.box(0.05, 0.035, 0.01, 'cream', at=(s[0], s[1] - 0.04, s[2] - 0.005), outline=False)
    for r in (35, -35):
        p.box(0.16, 0.022, 0.008, 'cream', roll=r, at=(s[0], s[1] - 0.08, s[2]), outline=False)
    p.extrude([(0, 0.57), (0.1, 0.59), (0.08, 0.60), (0.1, 0.61), (0, 0.62)], -0.006, 0.006, 'blackened',
              axis='z', caps=(True, True), at=(0.035, 0, 0))
    return p.blob(0.34, 0.16)


def harbor():
    """Settlement body on the west, a pier running east (+x) toward the sea, and a lantern mast."""
    p = plinth(Part(), rounded(0.28, 0.30, 0.06), x=-0.06)
    house(p, 0.24, 0.22, 0.18, 0.32, x=-0.06, gable=True)
    p.box(0.20, 0.018, 0.08, 'wood', at=(0.10, 0.012, 0.05))
    for x in (0.04, 0.17): p.box(0.025, 0.03, 0.10, 'wood', at=(x, 0, 0.05))
    p.lathe([(0.014, 0.03), (0.014, 0.40)], 'wood', n=4, cap=False, at=(0.16, 0, -0.01))
    p.box(0.05, 0.05, 0.05, 'glow', at=(0.16, 0.39, -0.01), outline=False)
    p.lathe([(0.04, 0.44), (0, 0.46)], 'ink', n=4, base=False, at=(0.16, 0, -0.01))
    return p.blob(0.25, 0.21)


def die():
    s, c, h = 0.36, 0.05, 0.18
    corners = [(sx * (h - c * (i == 0)), sy * (h - c * (i == 1)), sz * (h - c * (i == 2)))
               for i in range(3) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    p = Part().convex(corners, 'cream', at=(0, h, 0))
    pips = {1: [(0, 0)], 2: [(-1, -1), (1, 1)], 3: [(-1, -1), (0, 0), (1, 1)],
            4: [(-1, -1), (-1, 1), (1, -1), (1, 1)], 5: [(-1, -1), (-1, 1), (0, 0), (1, -1), (1, 1)],
            6: [(-1, -1), (-1, 0), (-1, 1), (1, -1), (1, 0), (1, 1)]}
    faces = {1: dict(pitch=-90), 6: dict(pitch=90), 2: {}, 5: dict(yaw=180), 3: dict(yaw=90), 4: dict(yaw=-90)}
    for face, rot in faces.items():
        for u, v in pips[face]:
            pts = [(0.03 * math.cos(a) + u * 0.085, 0.03 * math.sin(a) + v * 0.085, h + 0.002)
                   for a in (math.tau * k / 6 for k in range(6))]
            p.add(pts, [tuple(range(6))], 'ink', outline=False, at=(0, h, 0), **rot)
    return p.blob(0.24)


NODES = dict(settlement=settlement, city=city, road=road, ship=ship, robber=robber, pirate=pirate,
             harbor=harbor, die=die)
CREAM = {'robber', 'pirate'}

if __name__ == '__main__':
    out, prev = args(); reset()
    roots = [make().build(name, cream=name in CREAM) for name, make in NODES.items()]
    export(roots, out, BUDGET)
    if prev:
        from preview import preview, vignette
        preview(roots, prev, rows=2)
        vignette(prev.with_name(prev.stem + '-tv.png'))
