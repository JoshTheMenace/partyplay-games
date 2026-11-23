"""Beacon Rock: Sola's lighthouse isle at dusk. A main terrace with three floating slabs (collision in src/arenas.ts; the numbers below must match, tests check).
blender -b --factory-startup --python-exit-code 1 --python tools/blender/crew/beacon_rock.py -- [--stage color|full] [--tex 2048]

Stage space is the game's: meters, +X right, +Y up, fighters stand on the plane z = 0 and the camera looks down -Z. Walkable tops and walls are exact; everything else is dressing.
"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from kit import *

MAIN = dict(left=-5.6, right=5.6, top=0.0, bottom=-1.4); UNDER = dict(left=-4.2, right=4.2, top=-1.4, bottom=-3.2)
PLATS = [dict(id='left', left=-3.9, right=-1.5, y=2.1), dict(id='right', left=1.5, right=3.9, y=2.1), dict(id='top', left=-1.2, right=1.2, y=4.1)]
ZF, ZB = 1.3, -2.5   # front and back of the terrace
SLOTS = {
    'stone':   dict(surface='stone', color='#93867a', pattern='#7d7268'),
    'paving':  dict(surface='stone', color='#a2968a', pattern='#8a7d70'),
    'rock':    dict(surface='rock', color='#6f6a78', pattern='#4d4a5c'),
    'far':     dict(surface='rock', color='#5c6488', pattern='#48507a'),
    'brass':   dict(surface='metal', color='#c9963f', pattern='#8a5a22'),
    'iron':    dict(surface='iron', color='#3c3d48', pattern='#25262e'),
    'wood':    dict(surface='planks', color='#5a4032', pattern='#3a2a22'),
    'plaster': dict(surface='stone', color='#c4b8a6', pattern='#b03a2e'),
    'roof':    dict(surface='plate', color='#2f5560', pattern='#1f3a44'),
    'moss':    dict(surface='moss', color='#5f7a4a', pattern='#3f5a3a'),
    'ember':   dict(surface='glow', color='#ffc060', pattern='#ff6a1c', glow=2.0),
}
b = Build('beacon-rock', 'Beacon Rock', {'root': ((0, 0, 0), None)}, SLOTS, [], height=6.0, tex=2048); b.ao = .7
def add(*parts, density=1.0):
    for p in parts: p.density *= density; b.add(p.bone('root'))
def slab(x0, x1, y0, y1, z0, z1, bevel=.03, slot='stone', name='slab', density=1.0): return box((x1 - x0, y1 - y0, z1 - z0), bevel, name=name, slot=slot, density=density, at=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
def hashn(p):
    """Smooth value noise in 0..1 (rock displacement)."""
    i = np.floor(p); f = p - i; f = f * f * (3 - 2 * f); out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                h = math.sin((i[0] + dx) * 127.1 + (i[1] + dy) * 311.7 + (i[2] + dz) * 74.7) * 43758.5453; h -= math.floor(h)
                out += h * (f[0] if dx else 1 - f[0]) * (f[1] if dy else 1 - f[1]) * (f[2] if dz else 1 - f[2])
    return out
def rough(part, amp, scale, seed=0.0, keep=lambda p: 1.0): return part.warp(lambda p: p + unit(p - A(part.v.mean(axis=0))) * (hashn(p * scale + seed) - .5) * 2 * amp * keep(p))

# ── Terrace: paved top (exact), cap course with a lip, coursed wall, then the island's rock tapering away below ──
W = MAIN['right'] - MAIN['left']
add(slab(MAIN['left'], MAIN['right'], -.16, 0, ZB, ZF, .035, 'paving', 'cap'), density=2.2)
add(slab(MAIN['left'] + .06, MAIN['right'] - .06, -.42, -.16, ZB + .05, ZF - .06, .03, 'stone', 'course1'), slab(MAIN['left'] + .02, MAIN['right'] - .02, -.5, -.42, ZB, ZF - .02, .02, 'brass', 'band'), density=1.8)
add(slab(MAIN['left'] + .1, MAIN['right'] - .1, MAIN['bottom'], -.5, ZB + .08, ZF - .1, .04, 'stone', 'wall'), density=1.8)
for i in range(9):   # buttress pilasters along the front wall
    x = MAIN['left'] + .7 + i * (W - 1.4) / 8; add(slab(x - .16, x + .16, MAIN['bottom'] + .05, -.5, ZF - .12, ZF + .02, .03, 'stone', f'pilaster{i}'), density=1.4)
ZC = (ZF + ZB) / 2
rock = loft([dict(p=(0, -1.25, ZC), r=(5.35, 1.85), sq=3.4), dict(p=(0, -1.9, ZC), r=(4.5, 1.7), sq=3), dict(p=(.2, -2.7, ZC), r=(4.1, 1.5), sq=2.6), dict(p=(.3, -3.6, ZC - .1), r=(3.0, 1.25), sq=2.4),
             dict(p=(.1, -4.9, ZC - .1), r=(1.9, .9), sq=2.2), dict(p=(-.3, -6.3, ZC), r=(.9, .5), sq=2.1), dict(p=(-.5, -7.6, ZC), r=(.15, .1))], n=22, seg=40, caps=('flat', 'round'), fwd=(0, 0, 1), name='rock', slot='rock')
rough(rock, .32, .9, 3.0, lambda p: float(smooth(-1.3, -2.0, p[1]))); rough(rock, .12, 2.6, 9.0, lambda p: float(smooth(-1.3, -1.8, p[1]))); add(rock, density=1.1)
for i, (x, y, r) in enumerate([(-3.2, -2.2, .7), (2.6, -2.6, .8), (-1.0, -3.9, .6), (3.6, -1.9, .5), (-4.2, -1.7, .45)]):   # boulders breaking the silhouette
    add(rough(loft([dict(p=(x, y + r * .8, ZF - .3), r=r * .4), dict(p=(x, y, ZF - .25), r=(r, r * .8)), dict(p=(x + .1, y - r * .9, ZF - .3), r=r * .3)], n=7, seg=12, name=f'boulder{i}', slot='rock'), .12, 2.2, i * 5.0))
# ── Parapet and lamp posts along the back edge ──
add(slab(MAIN['left'] + .1, MAIN['right'] - .1, 0, .42, ZB + .02, ZB + .3, .03, 'stone', 'parapet'), density=1.4)
for i in range(12):
    x = MAIN['left'] + .55 + i * (W - 1.1) / 11; add(slab(x - .22, x + .22, .42, .62, ZB + .02, ZB + .3, .03, 'stone', f'merlon{i}'))
def lamp(x, z, h=2.7, name='lamp'):
    out = [lathe([(.11, 0), (.13, .05), (.07, .14), (.045, .3), (.04, h - .5), (.06, h - .44), (.03, h - .4)], seg=10, name=name + 'post', slot='iron', at=(x, 0, z)),
           lathe([(.02, 0), (.13, .05), (.15, .09), (.05, .16), (.02, .2)], seg=8, name=name + 'cap', slot='brass', at=(x, h - .12, z)),
           lathe([(.07, 0), (.11, .06), (.11, .24), (.08, .28)], seg=8, name=name + 'glass', slot='ember', at=(x, h - .4, z)),
           lathe([(.02, 0), (.12, .03), (.12, .06), (.05, .1)], seg=8, name=name + 'base', slot='brass', at=(x, h - .5, z))]
    return out
for i, x in enumerate((-5.1, -1.9, 1.9, 5.1)): add(*lamp(x, ZB + .16, 2.9 if abs(x) > 3 else 2.5, f'lamp{i}'))
# Dressing on the terrace's back strip: crates, a barrel, a coil of rope, mooring bollards
add(slab(-4.5, -3.8, 0, .6, ZB + .4, ZB + 1.05, .025, 'wood', 'crate1'), slab(-4.35, -3.95, .6, .98, ZB + .5, ZB + .9, .02, 'wood', 'crate2'), slab(3.3, 4.0, 0, .55, ZB + .45, ZB + 1.1, .025, 'wood', 'crate3'))
add(lathe([(.2, 0), (.26, .12), (.28, .38), (.26, .64), (.2, .76)], seg=14, name='barrel', slot='wood', at=(4.45, 0, ZB + .75)), torus(.275, .014, seg=16, rseg=6, flat=2.4, name='hoop1', slot='iron', at=(4.45, .22, ZB + .75)), torus(.275, .014, seg=16, rseg=6, flat=2.4, name='hoop2', slot='iron', at=(4.45, .56, ZB + .75)))
for i, x in enumerate((-5.3, 5.3)): add(lathe([(.1, 0), (.12, .04), (.07, .1), (.07, .3), (.12, .36), (.1, .44), (.04, .46)], seg=10, name=f'bollard{i}', slot='iron', at=(x, 0, ZF - .32)))

# ── Three floating slabs: paved top (exact), brass rim, a keel of rock and a lantern on a chain ──
for pl in PLATS:
    x0, x1, y = pl['left'], pl['right'], pl['y']; cx = (x0 + x1) / 2; w = x1 - x0
    add(slab(x0, x1, y - .12, y, -.85, .85, .03, 'paving', pl['id'] + 'top'), slab(x0 + .03, x1 - .03, y - .2, y - .12, -.82, .82, .02, 'brass', pl['id'] + 'rim'), density=2.2)
    keel = loft([dict(p=(cx, y - .2, 0), r=(w * .47, .78), sq=3.2), dict(p=(cx, y - .5, 0), r=(w * .36, .56), sq=2.6), dict(p=(cx + .05, y - .95, 0), r=(w * .18, .28), sq=2.2), dict(p=(cx, y - 1.35, 0), r=(.05, .05))], n=10, seg=20, caps=('flat', 'round'), fwd=(0, 0, 1), name=pl['id'] + 'keel', slot='rock')
    add(rough(keel, .09, 2.4, y * 3, lambda p, y=y: float(smooth(y - .22, y - .4, p[1]))), density=1.3)
    for s in (-1, 1):
        lx = cx + s * w * .34; add(loft([dict(p=(lx, y - .2, .7), r=.012), dict(p=(lx, y - .62, .7), r=.012)], seg=6, caps=('flat', 'flat'), fwd=(1, 0, 0), name=pl['id'] + 'chain', slot='iron'),
                                   lathe([(.03, 0), (.07, .03), (.075, .16), (.05, .2), (.02, .22)], seg=8, name=pl['id'] + 'lantern', slot='ember', at=(lx, y - .84, .7)), lathe([(.02, 0), (.085, .03), (.03, .07)], seg=8, name=pl['id'] + 'lcap', slot='brass', at=(lx, y - .64, .7)))

# ── The beacon tower behind the terrace, and its keeper's stair ──
TX, TZ = 3.4, -8.5
tower = lathe([(1.9, -1.4), (1.75, 0), (1.55, 3.0), (1.38, 7.5), (1.3, 10.6), (1.55, 10.9), (1.55, 11.1), (1.2, 11.2)], seg=28, name='tower', slot='plaster', at=(TX, 0, TZ))
tower.face_slots(lambda c, i: 'stone' if c[1] < 1.2 else None); add(tower, density=.9)
for i, y in enumerate((3.6, 6.4, 9.2)): add(torus(1.56 - y * .022, .05, seg=28, rseg=6, flat=3.0, name=f'towerband{i}', slot='roof', at=(TX, y, TZ)), density=.6)
add(torus(1.72, .09, seg=28, rseg=8, flat=1.6, name='gallery', slot='iron', at=(TX, 11.2, TZ)), lathe([(.9, 0), (.95, .1), (.95, 1.5), (.9, 1.6)], seg=16, name='lanternroom', slot='ember', at=(TX, 11.25, TZ)),
    lathe([(1.15, 0), (1.2, .08), (.7, .7), (.12, 1.25), (.05, 1.7)], seg=16, name='dome', slot='roof', at=(TX, 12.85, TZ)), density=.7)
for k in range(8):
    a = math.radians(k * 45); add(loft([dict(p=(TX + math.cos(a) * .95, 11.25, TZ + math.sin(a) * .95), r=.035), dict(p=(TX + math.cos(a) * .95, 12.85, TZ + math.sin(a) * .95), r=.035)], seg=6, caps=('flat', 'flat'), fwd=(1, 0, 0), name=f'mullion{k}', slot='iron'), density=.5)
for i, (y, a) in enumerate([(2.2, 200), (5.0, 230), (8.2, 205)]):   # lit windows
    q = math.radians(a); r = 1.52 - y * .022; add(slab(-.16, .16, y, y + .5, 0, .08, .02, 'ember', f'window{i}').turn((0, 1, 0), 90 - a).move((TX + math.cos(q) * r, 0, TZ - math.sin(q) * r)), density=.6)
add(rough(loft([dict(p=(TX - 1.2, -1.4, TZ + .5), r=(3.4, 2.6), sq=3), dict(p=(TX - .8, -3.0, TZ + .3), r=(2.9, 2.2)), dict(p=(TX - .5, -6.0, TZ), r=(1.6, 1.3)), dict(p=(TX - .3, -9.5, TZ), r=(.2, .2))], n=14, seg=26, caps=('flat', 'round'), fwd=(0, 0, 1), name='towerrock', slot='rock'), .4, .7, 20), density=.6)
# A rope bridge links the tower rock to the terrace
bridge = [A(lerp(TX - 1.6, 4.6, t), -1.3 - 1.1 * math.sin(math.pi * t) * .5 + lerp(0, 1.2, t), lerp(TZ + 2.6, ZB - .1, t)) for t in np.linspace(0, 1, 9)]
add(loft([dict(p=p, r=(.5, .035), sq=4) for p in bridge], n=18, seg=8, caps=('flat', 'flat'), fwd=(0, 1, 0), name='bridge', slot='wood'), density=.7)

# ── Far islands for depth (the renderer fades them into haze) ──
for i, (x, y, z, s) in enumerate([(-17, 1.5, -34, 5.5), (15, -3, -46, 7), (-6, 6.5, -70, 9), (26, 4, -80, 8), (-30, -4, -60, 7)]):
    isle = loft([dict(p=(x, y + s * .12, z), r=(s * .5, s * .3)), dict(p=(x, y, z), r=(s, s * .6), sq=3), dict(p=(x + s * .1, y - s * .5, z), r=(s * .75, s * .45)), dict(p=(x, y - s * 1.3, z), r=(s * .3, s * .2)), dict(p=(x - s * .1, y - s * 1.9, z), r=(.1, .1))], n=12, seg=18, name=f'isle{i}', slot='far')
    add(rough(isle, s * .12, 1.2 / s * 3, i * 7.0), density=.25)
    add(lathe([(s * .05, 0), (s * .04, s * .3), (s * .06, s * .32), (.02, s * .42)], seg=8, name=f'isletower{i}', slot='far', at=(x + s * .2, y + s * .1, z)), lathe([(s * .035, 0), (s * .035, s * .05)], seg=6, name=f'islelight{i}', slot='ember', at=(x + s * .2, y + s * .36, z)), density=.25)

b.anchors = {'beam': {'bone': 'root', 'at': [TX, 12.0, TZ]}}
b.extras = {'collision': {'blocks': [dict(id='main', **MAIN), dict(id='under', **UNDER)], 'platforms': PLATS}, 'lights': [[x, 2.4 if abs(x) > 3 else 2.0, ZB + .16] for x in (-5.1, -1.9, 1.9, 5.1)]}
stage = flag('stage', 'color'); b.mesh(); b.rig()
SHOTS = [(0, (0, 1.2, 0), 26, 50), (35, (0, 1.2, 0), 26, 50), (0, (0, .6, 0), 9, 50)]
if stage == 'meta': b.write_meta(os.path.getsize(os.path.join(GAME, 'assets', 'stages', 'beacon-rock.glb')))   # palette and anchors only; the bake is unchanged
elif stage == 'color': b.materials(baked=False); b.render(SHOTS, os.path.join(OUT, 'beacon-rock-color'), size=(900, 600), samples=16)
else: b.bake(); b.materials(); b.export('stages')
