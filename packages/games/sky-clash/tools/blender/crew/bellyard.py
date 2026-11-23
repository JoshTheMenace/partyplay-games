"""The Bellyard: Toll's foundry deck in a storm. One long flat deck and a cargo pallet hung on chains above its middle (collision in src/arenas.ts; the numbers below must match, tests check).
blender -b --factory-startup --python-exit-code 1 --python tools/blender/crew/bellyard.py -- [--stage color|full|meta] [--tex 2048]

Stage space is the game's: meters, +X right, +Y up, fighters stand on the plane z = 0 and the camera looks down -Z. Walkable tops and walls are exact; everything else is dressing.
"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from kit import *

MAIN = dict(left=-6.6, right=6.6, top=0.0, bottom=-1.5); UNDER = dict(left=-5.2, right=5.2, top=-1.5, bottom=-3.4)
PLATS = [dict(id='pallet', left=-1.7, right=1.7, y=2.4)]
ZF, ZB = 1.3, -2.7
SLOTS = {
    'deck':   dict(surface='grate', color='#5d6470', pattern='#3a3f48'),
    'iron':   dict(surface='iron', color='#33363f', pattern='#1f2127'),
    'bronze': dict(surface='bronze', color='#4f8f80', pattern='#a8884a'),
    'brass':  dict(surface='metal', color='#c9963f', pattern='#8a5a22'),
    'wood':   dict(surface='planks', color='#5a4032', pattern='#3a2a22'),
    'brick':  dict(surface='stone', color='#6a4a44', pattern='#3f2c2a'),
    'far':    dict(surface='flat', color='#232b3a', pattern='#232b3a'),
    'ember':  dict(surface='glow', color='#ff9a3c', pattern='#ff6a1c', glow=1.9),
}
SLOTS['bronze']['mask'] = mask_noise(1.1, .56, .7)
b = Build('bellyard', 'Bellyard', {'root': ((0, 0, 0), None)}, SLOTS, [], height=8.0, tex=2048); b.ao = .7
def add(*parts, density=1.0):
    for p in parts: p.density *= density; b.add(p.bone('root'))
def slab(x0, x1, y0, y1, z0, z1, bevel=.03, slot='iron', name='slab', density=1.0): return box((x1 - x0, y1 - y0, z1 - z0), bevel, name=name, slot=slot, density=density, at=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
def rod(a, c, r, slot='iron', name='rod', seg=8): return loft([dict(p=a, r=r), dict(p=c, r=r)], seg=seg, caps=('flat', 'flat'), fwd=(1, 0, 0) if abs(unit(A(c) - A(a))[0]) < .9 else (0, 1, 0), name=name, slot=slot)
def bell(x, y, z, r, name='bell', slot='bronze'):
    """A hanging bell with its crown at (x, y, z): yoke, bell, lip and clapper."""
    h = r * 1.5; return [lathe([(r * .28, 0), (r * .5, -h * .08), (r * .62, -h * .3), (r * .7, -h * .62), (r * .92, -h * .9), (r * 1.02, -h), (r * .9, -h * 1.0)], seg=20, name=name, slot=slot, at=(x, y, z)),
                         torus(r * .97, r * .06, seg=20, rseg=6, flat=1.3, name=name + 'lip', slot='brass', at=(x, y - h * .98, z)), box((r * 1.5, r * .16, r * .22), .02, name=name + 'yoke', slot='iron', at=(x, y + r * .1, z)),
                         lathe([(.03, 0), (.03, -h * .9), (r * .16, -h * 1.02), (r * .1, -h * 1.12)], seg=8, name=name + 'clapper', slot='iron', at=(x, y - h * .1, z))]

# ── The deck: riveted plate (exact top), a brass-banded edge, the hull tapering away below ──
W = MAIN['right'] - MAIN['left']; ZC = (ZF + ZB) / 2
add(slab(MAIN['left'], MAIN['right'], -.18, 0, ZB, ZF, .03, 'deck', 'deck'), density=2.2)
add(slab(MAIN['left'] + .03, MAIN['right'] - .03, -.3, -.18, ZB + .02, ZF - .02, .02, 'brass', 'band'), slab(MAIN['left'] + .1, MAIN['right'] - .1, MAIN['bottom'], -.3, ZB + .1, ZF - .1, .04, 'iron', 'side'), density=1.6)
for i in range(11):   # ribs along the front of the hull, with glowing ports between them
    x = MAIN['left'] + .6 + i * (W - 1.2) / 10; add(slab(x - .1, x + .1, MAIN['bottom'] + .04, -.3, ZF - .14, ZF + .03, .025, 'iron', f'rib{i}'), density=1.3)
    if i < 10 and i % 2 == 0: add(disc(.1, .06, seg=14, name=f'port{i}', slot='ember', axis=(0, 0, 1), at=(x + (W - 1.2) / 20, -.82, ZF - .08)), torus(.115, .03, seg=14, rseg=6, name=f'portrim{i}', slot='brass', axis=(0, 0, 1), at=(x + (W - 1.2) / 20, -.82, ZF - .06)))
hull = loft([dict(p=(0, -1.4, ZC), r=(6.2, 1.9), sq=4), dict(p=(0, -2.1, ZC), r=(5.4, 1.75), sq=3.4), dict(p=(0, -3.2, ZC), r=(4.6, 1.5), sq=3), dict(p=(0, -4.6, ZC), r=(3.0, 1.1), sq=2.6), dict(p=(0, -6.2, ZC), r=(1.2, .6), sq=2.2), dict(p=(0, -7.4, ZC), r=(.2, .15))],
            n=18, seg=36, caps=('flat', 'round'), fwd=(0, 0, 1), name='hull', slot='iron'); add(hull, density=1.0)
for i, (y, rx, rz) in enumerate(((-2.1, 5.4, 1.75), (-3.2, 4.6, 1.5), (-4.6, 3.0, 1.1))): add(torus(rx + .03, .07, seg=40, rseg=6, rz=(rz + .03) / (rx + .03), flat=1.4, sq=3.2, name=f'hullband{i}', slot='bronze', at=(0, y, ZC)), density=.8)
for s in (-1, 1):   # two great chains anchor the deck to nothing in particular
    add(rod((s * 5.9, -1.5, ZC), (s * 7.6, -8, ZC - 1), .07, 'iron', f'anchorchain{s}'), density=.5)
# ── Along the back of the deck: a pipe rail, furnace vents that glow, ingot stacks, a hand winch ──
for i in range(9):
    x = MAIN['left'] + .5 + i * (W - 1) / 8; add(lathe([(.06, 0), (.07, .04), (.04, .1), (.035, .82), (.06, .86), (.06, .92)], seg=8, name=f'post{i}', slot='iron', at=(x, 0, ZB + .2)), density=.8)
add(rod((MAIN['left'] + .5, .88, ZB + .2), (MAIN['right'] - .5, .88, ZB + .2), .035, 'brass', 'rail'), rod((MAIN['left'] + .5, .5, ZB + .2), (MAIN['right'] - .5, .5, ZB + .2), .025, 'iron', 'rail2'), density=.8)
VENTS = (-4.6, -1.6, 1.6, 4.6)
for i, x in enumerate(VENTS):
    add(slab(x - .5, x + .5, 0, .28, ZB + .45, ZB + 1.15, .03, 'iron', f'vent{i}'), slab(x - .4, x + .4, .28, .3, ZB + .53, ZB + 1.07, .005, 'ember', f'ventglow{i}'))
    for k in range(5): add(slab(x - .42, x + .42, .29, .33, ZB + .56 + k * .115, ZB + .6 + k * .115, .008, 'iron', f'ventbar{i}{k}'), density=.6)
for i, (x, n) in enumerate(((-3.1, 3), (3.1, 2), (5.6, 3))):
    for k in range(n): add(slab(x - .34 + k * .03, x + .34 - k * .03, k * .16, k * .16 + .15, ZB + .5, ZB + 1.0, .03, 'bronze' if k % 2 else 'brass', f'ingot{i}{k}'), density=.8)
add(lathe([(.22, 0), (.24, .05), (.24, .4), (.2, .45)], seg=14, name='winch', slot='iron', axis=(1, 0, 0), at=(-5.9, .34, ZB + .8)), slab(-6.0, -5.35, 0, .12, ZB + .5, ZB + 1.1, .02, 'iron', 'winchbase'), torus(.25, .03, seg=14, rseg=6, name='winchwheel', slot='brass', axis=(1, 0, 0), at=(-5.3, .34, ZB + .8)))
for i, x in enumerate((-6.25, 6.25)): add(lathe([(.11, 0), (.13, .04), (.08, .1), (.08, .32), (.13, .38), (.11, .46), (.04, .48)], seg=10, name=f'bollard{i}', slot='iron', at=(x, 0, ZF - .34)))

# ── The cargo pallet: planks on an iron frame (exact top), four chains to a spreader bar, one chain up to the gantry ──
pl = PLATS[0]; x0, x1, y = pl['left'], pl['right'], pl['y']
add(slab(x0, x1, y - .1, y, -.85, .85, .025, 'wood', 'pallet'), slab(x0 + .04, x1 - .04, y - .2, y - .1, -.8, .8, .02, 'iron', 'palletframe'), density=2.2)
for s in (-1, 1):
    add(slab(s * 1.4 - .08, s * 1.4 + .08, y - .3, y - .2, -.84, .84, .02, 'iron', f'palletskid{s}'))
    for z in (-.78, .78): add(rod((s * 1.62, y - .05, z), (s * .7, y + 2.5, 0), .022, 'iron', f'sling{s}{z}'), lathe([(.05, 0), (.06, .03), (.03, .07)], seg=8, name=f'eye{s}{z}', slot='brass', at=(s * 1.62, y - .02, z)), density=.6)
add(slab(-.85, .85, y + 2.46, y + 2.62, -.09, .09, .03, 'iron', 'spreader'), lathe([(.1, 0), (.16, .1), (.16, .3), (.08, .42)], seg=10, name='hookblock', slot='brass', at=(0, y + 2.62, 0)), rod((0, y + 3.0, 0), (0, 13.5, -.4), .035, 'iron', 'hoist'), density=.7)
# ── Behind the deck: the gantry between two casting towers, three bells hanging from it ──
GY, GZ = 7.9, -5.2
add(slab(-11, 11, GY, GY + .5, GZ - .3, GZ + .3, .05, 'iron', 'gantry'), slab(-11, 11, GY + 1.2, GY + 1.45, GZ - .2, GZ + .2, .04, 'iron', 'gantrytop'), density=.5)
for i in range(12): x = -10.4 + i * 1.9; add(rod((x, GY + .5, GZ), (x + .95, GY + 1.2, GZ), .06, 'iron', f'truss{i}a'), rod((x + .95, GY + 1.2, GZ), (x + 1.9, GY + .5, GZ), .06, 'iron', f'truss{i}b'), density=.4)
for i, (x, r, drop) in enumerate(((-4.7, 1.0, 1.0), (.5, 1.35, .5), (5.2, .8, 1.5))):
    add(rod((x, GY, GZ), (x, GY - drop, GZ), .05, 'iron', f'bellchain{i}'), *bell(x, GY - drop, GZ, r, f'bell{i}'), density=.6)
for s in (-1, 1):
    TX, TZ = s * 10.6, -6.4
    tower = lathe([(2.3, -6), (2.15, 0), (1.9, 5.5), (1.7, 10.2), (1.95, 10.6), (1.95, 11.1), (1.4, 11.5)], seg=8, name=f'tower{s}', slot='brick', at=(TX, 0, TZ)); add(tower, density=.7)
    for k, yy in enumerate((2.6, 6.2, 9.4)): add(torus(2.08 - yy * .04, .09, seg=8, rseg=6, flat=2.4, name=f'towerband{s}{k}', slot='iron', at=(TX, yy, TZ)), density=.5)
    add(lathe([(.7, 0), (.62, 2.6), (.75, 2.8), (.75, 3.1)], seg=10, name=f'chimney{s}', slot='iron', at=(TX + s * .3, 11.4, TZ)), disc(.6, .08, seg=10, name=f'chimneyglow{s}', slot='ember', axis=(0, 1, 0), at=(TX + s * .3, 14.46, TZ)), density=.5)
    # the furnace mouth faces the deck
    q = math.radians(90 + s * 22); fx, fz = TX + math.cos(q) * 2.02, TZ + math.sin(q) * 2.02
    add(slab(-.62, .62, .8, 2.3, 0, .14, .04, 'ember', f'furnace{s}').turn((0, 1, 0), -s * 22).move((fx, 0, fz)), slab(-.78, .78, .6, .8, 0, .2, .03, 'iron', f'furnacesill{s}').turn((0, 1, 0), -s * 22).move((fx, 0, fz)),
        slab(-.78, .78, 2.3, 2.52, 0, .2, .03, 'iron', f'furnacelintel{s}').turn((0, 1, 0), -s * 22).move((fx, 0, fz)), density=.6)
    for k, yy in enumerate((4.4, 7.6)): add(slab(-.2, .2, yy, yy + .7, 0, .08, .02, 'ember', f'window{s}{k}').turn((0, 1, 0), -s * 22).move((TX + math.cos(q) * (1.96 - yy * .04), 0, TZ + math.sin(q) * (1.96 - yy * .04))), density=.5)
    add(loft([dict(p=(TX, -5.6, TZ), r=(3.2, 2.6), sq=3), dict(p=(TX, -8, TZ), r=(2.0, 1.6)), dict(p=(TX, -11, TZ), r=(.3, .3))], n=8, seg=14, caps=('flat', 'round'), fwd=(0, 0, 1), name=f'towerkeel{s}', slot='iron'), density=.4)
# ── Far yards in the storm (the renderer fades them into the haze) ──
for i, (x, y, z, s) in enumerate([(-24, -1, -58, 6), (22, -3, -70, 7.5), (-6, 3, -110, 9), (40, 2, -120, 8)]):
    add(loft([dict(p=(x, y + s * .1, z), r=(s * .7, s * .3), sq=3.4), dict(p=(x, y - s * .2, z), r=(s * .8, s * .34), sq=3), dict(p=(x, y - s * .9, z), r=(s * .4, s * .2)), dict(p=(x, y - s * 1.5, z), r=(.1, .1))], n=9, seg=14, name=f'yard{i}', slot='far'), density=.25)
    add(lathe([(s * .1, 0), (s * .08, s * .5), (s * .11, s * .55)], seg=6, name=f'yardstack{i}', slot='far', at=(x - s * .3, y + s * .1, z)), lathe([(s * .13, 0), (s * .1, s * .34)], seg=6, name=f'yardstack{i}b', slot='far', at=(x + s * .25, y + s * .1, z)), disc(s * .07, .05, seg=6, name=f'yardglow{i}', slot='ember', axis=(0, 1, 0), at=(x - s * .3, y + s * .66, z)), density=.25)

b.anchors = {}
b.extras = {'collision': {'blocks': [dict(id='main', **MAIN), dict(id='under', **UNDER)], 'platforms': PLATS}, 'lights': [[x, .7, ZB + .8] for x in VENTS]}
stage = flag('stage', 'color'); b.mesh(); b.rig()
SHOTS = [(0, (0, 2.0, 0), 30, 50), (35, (0, 2.0, 0), 30, 50), (0, (0, .8, 0), 10, 50)]
if stage == 'meta': b.write_meta(os.path.getsize(os.path.join(GAME, 'assets', 'stages', 'bellyard.glb')))
elif stage == 'color': b.materials(baked=False); b.render(SHOTS, os.path.join(OUT, 'bellyard-color'), size=(900, 600), samples=16)
else: b.bake(); b.materials(); b.export('stages')
