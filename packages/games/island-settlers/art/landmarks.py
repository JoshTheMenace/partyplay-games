"""Neutral landmarks and big expansion pieces for expansions.glb: bridge, castle, barbarian
longship and the three T&B depots. Imported by expansions.py."""
import math
from common import COLORS, Part, ngon
from pieces import hull, rounded

COLORS.update(stone_dark='#9d968a', slate='#5b6378', longship='#5a1f22', deck='#7a3a2c', stripe='#b23a30',
              marble='#e6e0d4', glass='#b7d8e8', furnace='#a8502f', gold='#ffd24a')
BUDGET = dict(bridge=200, castle=1500, barbarian_ship=900, depot_castle=600, depot_quarry=600,
              depot_glassworks=600)
CREAM = {'barbarian_ship'}


def bridge():
    """Stone arch along +x with a seat-coloured deck (a road on a river edge)."""
    arch = [(-0.2, 0), (-0.13, 0), (-0.1, 0.04), (-0.05, 0.058), (0.05, 0.058), (0.1, 0.04), (0.13, 0),
            (0.2, 0), (0.2, 0.09), (-0.2, 0.09)]
    p = Part().extrude(arch, -0.07, 0.07, 'stone', axis='z', caps=(True, True))
    p.box(0.40, 0.03, 0.16, 'seat', at=(0, 0.09, 0), side='seat_dark')
    return p.blob(0.24, 0.12, n=8)


def merlons(p, a, b, y, n, mat='stone', size=0.05):
    """n merlons evenly spaced from point a to point b (x, z) at height y."""
    yaw = math.degrees(math.atan2(-(b[1] - a[1]), b[0] - a[0]))
    for i in range(n):
        t = i / (n - 1)
        at = (a[0] + (b[0] - a[0]) * t, y, a[1] + (b[1] - a[1]) * t)
        p.box(size, size * 0.8, size * 0.6, mat, yaw=yaw, at=at)
    return p


def tower(p, x, z, r, h, roof='slate', n=8):
    p.lathe([(r, 0.04), (r, h), (r * 1.2, h + 0.02), (r * 1.2, h + 0.06)], 'stone', n=n, cap=False,
            at=(x, 0, z))
    p.lathe([(r * 1.15, h + 0.06), (0, h + 0.26)], roof, n=n, at=(x, 0, z))
    p.box(0.035, 0.06, 0.01, 'ink', at=(x, h - 0.12, z + r), outline=False)
    return p


def flag(p, x, z, y0, y1, mat='gold'):
    p.lathe([(0.01, y0), (0.01, y1)], 'wood', n=3, cap=False, at=(x, 0, z))
    return p.extrude([(x, y1 - 0.1), (x + 0.14, y1 - 0.07), (x, y1 - 0.02)], z - 0.008, z + 0.008, mat,
                     axis='z')


def castle():
    """Stone keep with four round corner towers, curtain walls, a gate and a sun flag."""
    p = Part().extrude(rounded(1.0, 0.9, 0.18), 0, 0.04, 'stone_dark')
    wx, wz = 0.36, 0.3
    for x, z in ((0, wz), (0, -wz), (wx, 0), (-wx, 0)):
        p.box(2 * wx if z else 0.08, 0.22, 0.08 if z else 2 * wz, 'stone', at=(x, 0.04, z))
    p.flat([(-0.06, 0), (0.06, 0), (0.06, -0.1), (0.035, -0.14), (-0.035, -0.14), (-0.06, -0.1)], 0, 'ink',
           outline=False, pitch=90, at=(0, 0.04, wz + 0.041))
    for x in (-wx, wx):
        for z in (-wz, wz): tower(p, x, z, 0.12, 0.40)
    p.box(0.34, 0.48, 0.30, 'stone', at=(0, 0.04, -0.04))
    for a, b in (((-0.15, 0.09), (0.15, 0.09)), ((-0.15, -0.17), (0.15, -0.17))): merlons(p, a, b, 0.52, 4)
    for x in (-0.15, 0.15): merlons(p, (x, 0.0), (x, -0.08), 0.52, 2)
    return flag(p, 0.0, -0.04, 0.52, 0.95).blob(0.55, 0.5)


def barbarian_ship():
    """Dark red longship along +x with a striped square sail and a row of shields (cream outline)."""
    p = hull(Part(), 0.80, 0.26, 0.12, 'longship', stern_mat='deck')
    for x, sign in ((0.40, 1), (-0.40, -1)):
        p.box(0.03, 0.14, 0.05, 'longship', roll=-sign * 25, at=(x - sign * 0.02, 0.10, 0))
    p.lathe([(0.015, 0.1), (0.015, 0.58)], 'wood', n=4, cap=False)
    p.extrude([(-0.19, 0.22), (0.19, 0.22), (0.2, 0.52), (-0.2, 0.52)], 0.02, 0.036, 'cream', axis='z',
              caps=(True, True))
    for y in (0.28, 0.40):
        p.box(0.39, 0.06, 0.004, 'stripe', at=(0, y, 0.037), outline=False)
    for i, x in enumerate((-0.24, -0.12, 0.0, 0.12, 0.24)):
        p.lathe([(0.04, 0), (0.04, 0.012)], 'cream' if i % 2 else 'metal', n=6, pitch=90 - 25,
                at=(x, 0.1, 0.12), outline=False)
    return p.blob(0.44, 0.18)


def depot_castle():
    p = Part().extrude(ngon(8, 0.34), 0, 0.03, 'stone_dark')
    tower(p, -0.08, -0.06, 0.13, 0.22)
    p.box(0.34, 0.14, 0.08, 'stone', at=(0.08, 0.03, 0.10))
    merlons(p, (-0.07, 0.10), (0.23, 0.10), 0.17, 4)
    return flag(p, 0.18, 0.1, 0.17, 0.48, 'stripe').blob(0.36)


def depot_quarry():
    p = Part().extrude(ngon(8, 0.34), 0, 0.03, 'stone_dark')
    for x, y, z, w, h, d in ((-0.12, 0.03, 0.08, 0.16, 0.10, 0.14), (0.06, 0.03, 0.12, 0.14, 0.08, 0.12),
                             (-0.1, 0.13, 0.08, 0.12, 0.08, 0.1), (0.14, 0.03, -0.1, 0.12, 0.12, 0.12)):
        p.box(w, h, d, 'marble', at=(x, y, z))
    for side in (-1, 1):
        p.box(0.03, 0.44, 0.03, 'wood', roll=side * 12, at=(-0.02 + side * 0.05, 0.03, -0.12))
    p.box(0.42, 0.03, 0.03, 'wood', roll=-8, at=(0.1, 0.45, -0.12))
    p.lathe([(0.004, 0.3), (0.004, 0.46)], 'ink', n=3, cap=False, at=(0.26, 0, -0.12))
    p.box(0.08, 0.06, 0.08, 'marble', at=(0.26, 0.24, -0.12))
    return p.blob(0.36)


def depot_glassworks():
    p = Part().extrude(ngon(8, 0.34), 0, 0.03, 'stone_dark')
    p.lathe([(0.17, 0.03), (0.16, 0.12), (0.11, 0.22), (0, 0.27)], 'furnace', n=8, at=(-0.06, 0, -0.03))
    p.flat([(-0.045, 0), (0.045, 0), (0.045, -0.05), (0, -0.08), (-0.045, -0.05)], 0, 'glow', outline=False,
           pitch=70, at=(-0.06, 0.04, 0.15))
    p.lathe([(0.04, 0.2), (0.04, 0.50)], 'furnace', n=6, at=(-0.14, 0, -0.12))
    for i in range(3):
        p.box(0.012, 0.16, 0.12, 'glass', yaw=0, at=(0.12 + i * 0.05, 0.03, 0.1))
    p.box(0.16, 0.012, 0.012, 'wood', at=(0.17, 0.19, 0.1))
    return p.blob(0.36)


NODES = dict(bridge=bridge, castle=castle, barbarian_ship=barbarian_ship, depot_castle=depot_castle,
             depot_quarry=depot_quarry, depot_glassworks=depot_glassworks)
