"""expansions.glb: Cities & Knights, Traders & Barbarians and Explorers & Pirates pieces.
Run: blender -b --factory-startup -P art/expansions.py -- <out.glb> [--preview <png>]"""
import math, sys
sys.dont_write_bytecode = True; sys.path.insert(0, __import__('os').path.dirname(__file__))
from common import COLORS, Part, args, export, ngon, reset
import pieces, landmarks
from pieces import ring, roof_paint

COLORS.update(gold='#ffd24a', merchant='#e8b23a', cargo='#8d93a6', crate='#3b7fb8', rust='#8c3b2a',
              sack='#a8502f', driftwood='#b89a74', science='#78d955', politics='#28c6e7')
BUDGET = dict(knight_1=380, knight_2=380, knight_3=380, wall=300, metropolis_science=800,
              metropolis_trade=800, metropolis_politics=800, merchant=500, wagon=600, settler=120, crew=120,
              crate_fish=60, sack_spice=60, fishing_sign=60, invader=200, **landmarks.BUDGET)


def knight(level):
    """Pawn with a tilted shield (emblem decal), `level` cream bands on the base and a crown at L3.
    Child `knight_N_active` holds the raised sun banner and the glowing halo."""
    top = (0.28, 0.34, 0.40)[level - 1]; ys = top - 0.10
    p = Part().lathe([(0.15, 0), (0.15, 0.04)], 'seat_dark', n=8)
    for i in range(level):
        y = 0.006 + i * 0.012
        p.lathe([(0.153, y), (0.153, y + 0.008)], 'cream', n=8, cap=False, outline=False)
    p.lathe([(0.10, 0.04), (0.065, 0.11), (0.055, ys - 0.015), (0.085, ys), (0.04, ys + 0.015),
             (0.058, top - 0.045), (0.036, top - 0.008), (0, top)], 'seat', n=6, base=False)
    shield = [(-0.045, 0.035), (0.045, 0.035), (0.045, -0.01), (0, -0.055), (-0.045, -0.01)]
    sy = 0.04 + (ys - 0.04) * 0.55
    p.extrude(shield, 0, 0.016, 'cream', axis='z', caps=(True, True), side='metal', pitch=-30,
              at=(-0.03, sy, 0.065))
    p.decal(0.055, (-0.03, sy + 0.012, 0.086), (0, math.sin(math.radians(30)), math.cos(math.radians(30))))
    if level == 3:
        crown = [(0.048 * math.cos(a), top - 0.03 + (0.045 if k % 2 == 0 else 0.018), -0.048 * math.sin(a))
                 for k, a in enumerate(math.tau * k / 8 for k in range(8))]
        p.loft([[(x, top - 0.035, z) for x, _, z in crown], crown], 'gold', cap=False)
    banner = Part().lathe([(0.009, 0.05), (0.009, top + 0.12)], 'wood', n=3, cap=False, at=(0.1, 0, 0.02))
    banner.extrude([(0.1, top + 0.02), (0.2, top + 0.04), (0.2, top + 0.1), (0.1, top + 0.115)],
                   0.012, 0.028, 'gold', axis='z', caps=(True, True))
    banner.flat(ngon(12, 0.20), 0.003, 'glow', outline=False)
    return p.child(f'knight_{level}_active', banner).blob(0.19, n=8)


def wall():
    """Stone ring around a city with a seat-coloured top band and merlons."""
    p = Part().lathe([(0.38, 0), (0.38, 0.06), (0.33, 0.06), (0.33, 0)], 'stone', n=10, cap=False,
                     paint=lambda n: 'seat' if n[1] > 0.9 else None)
    for k in range(6):
        a = math.degrees(math.tau * (k + 0.25) / 6)
        x, z = 0.355 * math.cos(math.radians(a)), -0.355 * math.sin(math.radians(a))
        p.box(0.07, 0.03, 0.05, 'stone', at=(x, 0.06, z), yaw=a + 90)
    return p


def metropolis(track):
    """City plus a taller keep: an aqueduct dome (science), a market dome (trade), a spire (politics)."""
    colour = dict(science='science', trade='gold', politics='politics')[track]

    def keep(p, x, z):
        p.box(0.22, 0.47, 0.22, 'seat', at=(x, 0.025, z), caps=(False, True))
        p.lathe([(0.17, 0.46), (0.17, 0.50)], 'seat_dark', n=4, at=(x, 0, z))
        p.box(0.05, 0.09, 0.012, 'ink', at=(x, 0.30, z + 0.11), outline=False)
        if track == 'politics':
            p.lathe([(0.10, 0.50), (0.07, 0.56), (0, 0.78)], colour, n=6, at=(x, 0, z))
        else:
            onion = [(0.1, 0.50), (0.12, 0.56), (0.1, 0.63), (0.05, 0.68)] if track == 'trade' else \
                [(0.115, 0.50), (0.11, 0.56), (0.08, 0.62), (0.03, 0.655)]
            p.lathe(onion + [(0.012, 0.70), (0.012, 0.78)], colour, n=8, at=(x, 0, z))
    return pieces.city(keep)


def figure(body, n=5):
    """A tiny cargo person (0.10 wide, 8 px on the TV board): a peg body with a head."""
    return Part().lathe([(0.045, 0), (0.03, 0.085), (0.03, 0.115), (0, 0.125)], body, n=n)


def merchant():
    p = Part().lathe([(0.13, 0), (0.12, 0.05), (0.085, 0.2), (0.07, 0.25), (0.03, 0.265), (0.052, 0.285),
                      (0.05, 0.33), (0, 0.35)], 'merchant', n=8)
    p.box(0.20, 0.03, 0.02, 'seat', roll=-40, at=(-0.055, 0.12, 0.085), outline=False)
    p.lathe([(0.1, 0.325), (0.1, 0.34), (0.055, 0.34), (0.05, 0.40)], 'seat', n=8)
    return p.blob(0.17, n=8)


def wagon():
    """Cart along +x with a seat bed and ink wheels; children `cargo` and `level_1..3` pennants."""
    p = Part().box(0.30, 0.06, 0.16, 'seat', at=(-0.02, 0.07, 0), caps=(True, True), side='seat_dark')
    for z in (-0.075, 0.075): p.box(0.30, 0.04, 0.012, 'seat', at=(-0.02, 0.13, z))
    for x in (-0.11, 0.07):
        for z in (-0.09, 0.09):
            p.lathe([(0.055, 0), (0.055, 0.02)], 'ink', n=6, phase=0, pitch=90, at=(x, 0.055, z - 0.01))
    p.box(0.12, 0.015, 0.015, 'wood', at=(0.18, 0.085, 0))
    cargo = Part().box(0.12, 0.09, 0.11, 'cargo', at=(-0.04, 0.13, 0))
    p.child('cargo', cargo)
    for i in range(3):
        x = -0.15 + i * 0.07
        flag = Part().lathe([(0.006, 0.13), (0.006, 0.25)], 'wood', n=3, cap=False, at=(x, 0, -0.075))
        flag.extrude([(x, 0.21), (x + 0.06, 0.225), (x, 0.25)], -0.08, -0.07, 'cream', axis='z')
        p.child(f'level_{i + 1}', flag)
    return p.blob(0.22, 0.14, n=8)


def settler():
    return figure('cream').lathe([(0.042, 0.105), (0.02, 0.115), (0, 0.14)], 'seat', n=5)


def crew():
    p = figure('ink').lathe([(0.033, 0.1), (0.033, 0.115)], 'seat', n=5, cap=False)
    return p.box(0.02, 0.018, 0.02, 'seat', at=(0.0, 0.095, -0.035))


def crate_fish():
    p = Part().box(0.10, 0.10, 0.10, 'crate')
    fish = [(0.035, 0), (0.008, -0.02), (-0.018, -0.006), (-0.036, -0.02), (-0.036, 0.02), (-0.018, 0.006),
            (0.008, 0.02)]
    return p.flat(fish, 0.101, 'cream', outline=False)


def sack_spice():
    return Part().lathe([(0.045, 0), (0.05, 0.05), (0.02, 0.1)], 'sack', n=5)


def fishing_sign():
    """Driftwood disc lying on the water; the runtime draws the fish glyph and numbers on the decal."""
    p = Part().lathe([(0.2, 0), (0.2, 0.03)], 'driftwood', n=10, base=False)
    return p.decal(0.26, (0, 0.032, 0), (0, 1, 0))


def invader():
    p = Part().lathe([(0.06, 0), (0.065, 0.03), (0.045, 0.12), (0.03, 0.14), (0.045, 0.15), (0.045, 0.18)],
                     'rust', n=6, cap=False)
    p.lathe([(0.052, 0.175), (0.04, 0.205), (0, 0.22)], 'metal', n=6)
    for side in (-1, 1):
        p.lathe([(0.014, 0), (0, 0.06)], 'cream', n=3, roll=-side * 60, at=(side * 0.04, 0.19, 0))
    return p.blob(0.08, n=6)


NODES = dict(knight_1=lambda: knight(1), knight_2=lambda: knight(2), knight_3=lambda: knight(3), wall=wall,
             metropolis_science=lambda: metropolis('science'), metropolis_trade=lambda: metropolis('trade'),
             metropolis_politics=lambda: metropolis('politics'), merchant=merchant, wagon=wagon,
             settler=settler, crew=crew, crate_fish=crate_fish, sack_spice=sack_spice,
             fishing_sign=fishing_sign, invader=invader, **landmarks.NODES)

if __name__ == '__main__':
    out, prev = args(); reset()
    roots = [make().build(name, cream=name in landmarks.CREAM) for name, make in NODES.items()]
    export(roots, out, BUDGET)
    if prev:
        from preview import preview
        preview(roots, prev, rows=3, gap=0.18)
