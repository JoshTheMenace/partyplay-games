"""props.glb: instanced terrain props (no outlines) and the E&P fog cloud.
Run: blender -b --factory-startup -P art/props.py -- <out.glb> [--preview <png>]"""
import math, random, sys
sys.dont_write_bytecode = True; sys.path.insert(0, __import__('os').path.dirname(__file__))
from common import COLORS, EMIT, Part, args, export, reset

COLORS.update(pine='#2f6b40', pine_light='#3d8250', trunk='#6b4a2e', leaf='#4f9a52', wool=COLORS['cream'],
              wheat='#efc860', rock='#9aa0b3', peak='#a9aec0', snow=COLORS['cream'],
              brick='#c9754c', kiln='#7a3d28', dune='#e8d6a6', cactus='#5f8f4e', nugget='#ffd24a',
              palm='#3f8f55', palm_trunk='#8a6a45', reeds='#6b8a63', cattail='#6b4a2e', spice='#e0a060',
              cloud='#d9dde8')
EMIT['nugget'] = 0.15
BUDGET = dict(prop_pine=60, prop_round_tree=80, prop_sheep=120, prop_wheat=60, prop_rock=40, prop_peak=150,
              prop_bricks=60, prop_kiln=120, prop_dune=40, prop_cactus=80, prop_nugget=40, prop_palm=120,
              prop_reeds=60, prop_spice=80, fog_cloud=200)
FLAT = dict(outline=False)


def lump(rng, rx, ry, rz, at, n=9):
    """Points on a squashed ellipsoid with a little jitter, for convex rocks, puffs and canopies."""
    pts = [(0, ry, 0), (0, -ry * 0.2, 0)]
    for k in range(n):
        a = math.tau * k / n + rng.uniform(-0.2, 0.2)
        for h in (0.1, 0.65):
            r = math.cos(h * math.pi / 2) * rng.uniform(0.85, 1.1)
            pts.append((rx * r * math.cos(a), ry * math.sin(h * math.pi / 2), rz * r * math.sin(a)))
    return [(x + at[0], y + at[1], z + at[2]) for x, y, z in pts]


def prop_pine():
    p = Part(False).lathe([(0.025, 0), (0.025, 0.06)], 'trunk', n=4, cap=False, **FLAT)
    tiers = ((0.105, 0.04, 0.15, 'pine'), (0.08, 0.10, 0.19, 'pine_light'), (0.05, 0.16, 0.22, 'pine'))
    for r, y0, y1, m in tiers:
        p.lathe([(r, y0), (0, y1)], m, n=6, **FLAT)
    return p.blob(0.12, n=6)


def prop_round_tree():
    p = Part(False).lathe([(0.022, 0), (0.018, 0.09)], 'trunk', n=4, cap=False, **FLAT)
    p.convex(lump(random.Random(2), 0.09, 0.075, 0.09, (0, 0.13, 0), n=6), 'leaf', **FLAT)
    return p.blob(0.11, n=6)


def prop_sheep():
    p = Part(False)
    p.convex(lump(random.Random(3), 0.075, 0.05, 0.085, (0, 0.07, -0.01), n=6), 'wool', **FLAT)
    head = [(x, y, z) for x in (-0.02, 0.02) for y in (0.07, 0.105) for z in (0.07, 0.1)]
    p.convex(head + [(0, 0.08, 0.115)], 'ink', **FLAT)
    for x, z in ((-0.035, -0.05), (0.035, -0.05), (-0.035, 0.04), (0.035, 0.04)):
        p.lathe([(0.012, 0), (0.012, 0.05)], 'ink', n=3, cap=False, at=(x, 0, z), **FLAT)
    return p.blob(0.09, 0.12, n=6)


def prop_wheat():
    p = Part(False)
    for x, z, h in ((-0.045, 0.01, 0.17), (0.04, -0.02, 0.19), (0.0, 0.04, 0.16)):
        p.lathe([(0.02, 0), (0.045, h - 0.035), (0, h)], 'wheat', n=5, at=(x, 0, z), **FLAT)
    return p.blob(0.11, n=6)


def prop_rock():
    p = Part(False).convex(lump(random.Random(5), 0.09, 0.08, 0.07, (0, 0.0, 0), n=5), 'rock', **FLAT)
    return p.blob(0.1, n=6)


def prop_peak():
    p = Part(False)
    for x, z, r, h in ((0, 0, 0.13, 0.30), (0.08, 0.06, 0.08, 0.17)):
        p.lathe([(r, 0), (r * 0.42, h * 0.62)], 'peak', n=6, cap=False, at=(x, 0, z), **FLAT)
        p.lathe([(r * 0.44, h * 0.6), (r * 0.3, h * 0.68), (0, h)], 'snow', n=6, at=(x, 0, z), **FLAT)
    return p.blob(0.15, n=6)


def prop_bricks():
    p = Part(False)
    for x, y, z, yaw in ((-0.035, 0, 0, 0), (0.035, 0, 0.005, 0), (0, 0.04, 0.0, 12)):
        p.box(0.065, 0.04, 0.11, 'brick', at=(x, y, z), yaw=yaw, **FLAT)
    return p.blob(0.1, n=6)


def prop_kiln():
    p = Part(False).lathe([(0.10, 0), (0.10, 0.05), (0.08, 0.11), (0.04, 0.15), (0, 0.16)], 'kiln', n=8, **FLAT)
    p.box(0.05, 0.06, 0.02, 'ink', at=(0, 0, 0.09), **FLAT)
    p.lathe([(0.022, 0.1), (0.022, 0.21)], 'brick', n=4, at=(0.045, 0, -0.03), **FLAT)
    return p.blob(0.13, n=6)


def prop_dune():
    p = Part(False).lathe([(0.14, 0), (0.08, 0.05), (0, 0.07)], 'dune', n=6, sz=0.6, **FLAT)
    return p.blob(0.14, 0.09, n=6)


def prop_cactus():
    p = Part(False).lathe([(0.03, 0), (0.03, 0.17), (0, 0.19)], 'cactus', n=5, **FLAT)
    for side in (-1, 1):
        y = 0.07 if side < 0 else 0.1
        p.box(0.05, 0.022, 0.025, 'cactus', at=(side * 0.045, y, 0), **FLAT)
        p.box(0.022, 0.06, 0.022, 'cactus', at=(side * 0.07, y, 0), **FLAT)
    return p.blob(0.08, n=6)


def prop_nugget():
    rng = random.Random(7); p = Part(False)
    for x, z, s in ((-0.035, 0.01, 1.0), (0.045, -0.02, 0.8)):
        pts = lump(rng, 0.06, 0.06, 0.05, (0, 0, 0), n=3)
        p.convex([(x + px * s, py * s, z + pz * s) for px, py, pz in pts], 'nugget', **FLAT)
    return p.blob(0.08, n=6)


def prop_palm():
    p = Part(False)
    for i, (x, y) in enumerate(((0, 0), (0.012, 0.07), (0.03, 0.13))):
        p.box(0.03, 0.075, 0.03, 'palm_trunk', at=(x, y, 0), roll=-10 * i, caps=(False, i == 2), **FLAT)
    top = (0.045, 0.2, 0)
    for k in range(5):
        a = math.tau * k / 5 + 0.3
        tip = (math.cos(a) * 0.13, -0.07, -math.sin(a) * 0.13); mid = [c * 0.55 for c in tip]
        side = (-math.sin(a) * 0.03, 0, -math.cos(a) * 0.03)
        pts = [(0, 0.01, 0), (mid[0] + side[0], mid[1] + 0.04, mid[2] + side[2]), tip,
               (mid[0] - side[0], mid[1] + 0.04, mid[2] - side[2])]
        p.add([(x + top[0], y + top[1], z + top[2]) for x, y, z in pts], [(0, 3, 2, 1)], 'palm', **FLAT)
    return p.blob(0.1, n=6)


def prop_reeds():
    p = Part(False)
    blades = ((-0.04, 0.01, 0.19, 8), (0.0, -0.03, 0.22, -4), (0.04, 0.02, 0.17, -10), (0.015, 0.05, 0.14, 5))
    for x, z, h, lean in blades:
        p.lathe([(0.012, 0), (0, h)], 'reeds', n=3, roll=lean, at=(x, 0, z), **FLAT)
    for x, z, h in ((-0.04, 0.01, 0.13), (0.0, -0.03, 0.15)):
        p.lathe([(0.017, h), (0.017, h + 0.045)], 'cattail', n=4, at=(x + 0.003, 0, z), **FLAT)
    return p.blob(0.09, n=6)


def prop_spice():
    p = Part(False)
    for x, z, s in ((-0.03, 0.0, 1.0), (0.05, 0.02, 0.8)):
        prof = [(0.05 * s, 0), (0.062 * s, 0.05 * s), (0.02 * s, 0.1 * s), (0.034 * s, 0.125 * s)]
        p.lathe(prof, 'spice', n=5, at=(x, 0, z), **FLAT)
    return p.blob(0.11, n=6)


def fog_cloud():
    rng = random.Random(11); p = Part(False)
    for x, y, z, r in ((-0.07, 0.0, 0.01, 0.075), (0.02, 0.03, -0.01, 0.09), (0.09, 0.0, 0.02, 0.065),
                       (0.0, 0.0, 0.05, 0.07)):
        p.convex(lump(rng, r, r * 0.8, r, (x, y + 0.02, z), n=6), 'cloud', **FLAT)
    return p


NODES = {name: fn for name, fn in globals().items() if name.startswith(('prop_', 'fog_')) and callable(fn)}

if __name__ == '__main__':
    out, prev = args(); reset()
    roots = [make().build(name) for name, make in NODES.items()]
    export(roots, out, BUDGET)
    if prev:
        from preview import preview
        preview(roots, prev, rows=2, seats=False, gap=0.16)
