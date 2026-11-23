"""Toll, the Bellyard's old casting automaton: a walking bell. Every limb is a bell shape; the face is a visor with shuttered lamp eyes.
blender -b --factory-startup --python-exit-code 1 --python tools/blender/crew/toll.py -- [--stage clay|color|full|rig] [--view body|face]"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from kit import *
from body import *

H = 2.0
ARM = unit((math.cos(math.radians(40)), -math.sin(math.radians(40)), 0))
SH = A(.50, 1.56, 0); EL = SH + ARM * .36; WR = EL + ARM * .42
HIP, KNEE, ANKLE = A(.19, .78, 0), A(.22, .45, .02), A(.23, .13, -.01)
ALONG, THUMB, PALM = hand_axes(ARM); mirror = lambda p: A(-p[0], p[1], p[2]); HK = 1.8   # hand scale
J = humanoid(hips=(0, .80, 0), spine=(0, .98, 0), chest=(0, 1.22, 0), neck=(0, 1.62, 0), head=(0, 1.70, .02), clav=(.22, 1.56, 0), shoulder=SH, elbow=EL, wrist=WR, hip=HIP, knee=KNEE, ankle=ANKLE,
             prop=mirror(WR + ALONG * .15))
EYE = A(.068, 1.80, .2); HS, HP = 1.16, A(0, 1.68, .02); hs = lambda p: tuple(HP + (A(p) - HP) * HS)   # the head is modelled at unit scale, then enlarged about its base
J['jaw'] = (hs((0, 1.755, .1)), 'head')
for s, n in ((1, 'L'), (-1, 'R')): J[f'lid_{n}'] = (hs((EYE[0] * s, EYE[1], EYE[2])), 'head'); J[f'brow_{n}'] = (hs((EYE[0] * s, 1.848, .225)), 'head')
J.update(hand_joints(WR, ARM, HK))

SLOTS = {
    'bronze': dict(surface='bronze', color='#4f8f80', pattern='#a8884a'),
    'iron':   dict(surface='iron', color='#34363f', pattern='#23242b'),
    'brass':  dict(surface='metal', color='#c9963f', pattern='#8a5a22'),
    'copper': dict(surface='metal', color='#b5673a', pattern='#6f3a22'),
    'enamel': dict(surface='leather', color='#7c2f2a', pattern='#4a1c1a'),
    'dark':   dict(surface='flat', color='#141218', pattern='#141218'),
    'ember':  dict(surface='glow', color='#ffb347', pattern='#ff6a1c', glow=1.8),
}
SLOTS['bronze']['mask'] = mask_noise(3.2, .56, .7)   # bare metal shows through the patina in worn patches
def costume(name, **over):
    c = {k: v['color'] for k, v in SLOTS.items()}; p = {k: v['pattern'] for k, v in SLOTS.items()}
    for k, v in over.items(): (c if not k.endswith('_p') else p)[k.removesuffix('_p')] = v
    return {'name': name, 'colors': c, 'patterns': p}
COSTUMES = [costume('Verdigris'), costume('Foundry Brass', bronze='#b88d3e', bronze_p='#e0c078', brass='#d8d2c4', enamel='#27445c', ember='#ffd27a'),
            costume('Soot and Frost', bronze='#3d4350', bronze_p='#7d8799', iron='#22232a', brass='#9aa4b5', enamel='#2f5a6a', ember='#8fe3ff', ember_p='#3aa8ff'),
            costume('Rose Copper', bronze='#a85f4a', bronze_p='#e3a07f', brass='#e0b060', copper='#7a4a3a', enamel='#3a2f52', ember='#ffe07a')]
b = Build('toll', 'Toll', J, SLOTS, COSTUMES, height=H, swatch=('bronze', 'brass', 'ember'))
CH = lambda p: {'chest': 1.0}

# ── The bell: Toll's body. Mouth open at the hips, crown under the head; rigid, it rides the chest and tilts over the pelvis ──
BELL = [(.60, .47, .42), (.655, .44, .39), (.80, .39, .35), (1.00, .40, .36), (1.20, .47, .41), (1.40, .52, .43), (1.54, .50, .40), (1.64, .40, .33), (1.70, .27, .24)]
def bell_at(y, ang, lift=0.0):
    """A point on the bell at height y and angle (0 = Toll's left, 90 = front), pushed out by `lift`."""
    i = max(0, min(len(BELL) - 2, next((k for k in range(len(BELL) - 1) if BELL[k + 1][0] >= y), len(BELL) - 2))); a, c = BELL[i], BELL[i + 1]; t = float(np.clip((y - a[0]) / (c[0] - a[0]), 0, 1))
    rx, rz = lerp(a[1], c[1], t), lerp(a[2], c[2], t); q = math.radians(ang); e = 2 / 2.2; x, z = math.copysign(abs(math.cos(q)) ** e, math.cos(q)), math.copysign(abs(math.sin(q)) ** e, math.sin(q)); n = unit((x / rx, 0, z / rz))
    return A(rx * x, y, rz * z) + n * lift
def band(y, r, flat, slot, name):
    rx, rz = bell_at(y, 0)[0], bell_at(y, 90)[2]; return torus(rx + r * .3, r, seg=40, rseg=8, rz=rz / rx, flat=flat, sq=2.6, name=name, slot=slot, at=(0, y, 0)).paint(CH)
b.add(loft([dict(p=(0, y, 0), r=(rx, rz), sq=2.2) for y, rx, rz in BELL], n=26, seg=32, caps=('open', 'round'), lip=(.035, .1), name='bell', slot='bronze', density=1.15).paint(CH))
b.add(band(.61, .028, 1.3, 'brass', 'lip'), band(.82, .016, 2.6, 'iron', 'band1'), band(1.44, .018, 2.6, 'iron', 'band2'), band(1.635, .02, 1.6, 'brass', 'collar'))
for y, n, off in ((.82, 14, 0), (1.44, 16, 11)):
    for i in range(n):
        a = off + 360 * i / n; p = bell_at(y, a, .014); b.add(disc(.017, .016, seg=8, name='rivet', slot='brass', axis=unit((p[0], 0, p[2])), at=p, density=.6).paint(CH))
for i, a in enumerate((35, 145, 215, 325)):   # four enamelled straps running up the bell
    b.add(loft([dict(p=bell_at(y, a, .006), r=(.006, .05), sq=3.5) for y in (.84, .98, 1.12, 1.28, 1.42)], n=10, seg=8, caps=('flat', 'flat'), fwd=(0, 1, 0), name=f'strap{i}', slot='enamel').paint(CH))
# Furnace door in the chest: a brass ring, glowing coals behind iron bars
FY = 1.19; FZ = bell_at(FY, 90)[2]
b.add(torus(.145, .026, seg=24, rseg=8, name='doorring', slot='brass', axis=(0, -.12, 1), at=(0, FY, FZ + .012)).paint(CH), disc(.132, .03, seg=20, name='coals', slot='ember', axis=(0, -.12, 1), at=(0, FY, FZ - .004)).paint(CH))
for i in range(4): b.add(box((.02, .27 - abs(i - 1.5) * .05, .022), .005, name=f'bar{i}', slot='iron', at=(-.081 + i * .054, FY, FZ + .022)).paint(CH))
b.add(box((.06, .05, .03), .008, name='latch', slot='iron', at=(.165, FY, FZ + .01)).paint(CH))
# Boiler and two stacks on the back
b.add(lathe([(.15, 0), (.19, .04), (.19, .40), (.15, .44)], seg=18, name='boiler', slot='copper', at=(0, 1.04, -.44)).paint(CH))
for y in (1.12, 1.4): b.add(torus(.193, .012, seg=18, rseg=6, flat=2.0, name='hoop', slot='iron', at=(0, y, -.44)).paint(CH))
for s in (1, -1):
    b.add(lathe([(.05, 0), (.05, .42), (.066, .44), (.066, .52), (.05, .53)], seg=12, name=f'stack{s}', slot='iron', at=(.11 * s, 1.44, -.5)).paint(CH), disc(.046, .012, seg=12, name=f'stackglow{s}', slot='ember', axis=(0, 1, 0), at=(.11 * s, 1.972, -.5)).paint(CH))
# Two small bells hang from the chest, and the clapper swings under the mouth of the bell
for s, n in ((1, 'L'), (-1, 'R')):
    top = bell_at(1.36, 90 - 34 * s, .03); J[f'extra_charm{n}_0'] = (tuple(top), 'chest')
    b.add(loft([dict(p=top, r=.007), dict(p=top - A(0, .07, 0), r=.007)], seg=6, caps=('flat', 'flat'), fwd=(1, 0, 0), name=f'charmchain{n}', slot='iron').bone(f'extra_charm{n}_0'),
          lathe([(.012, 0), (.03, -.012), (.042, -.06), (.055, -.085), (.05, -.09)], seg=12, name=f'charm{n}', slot='brass', at=top - A(0, .07, 0)).bone(f'extra_charm{n}_0'))
J['extra_clapper_0'] = ((0, .86, -.02), 'chest')
b.add(loft([dict(p=(0, .86, -.02), r=.016), dict(p=(0, .56, -.02), r=.016)], seg=8, caps=('flat', 'flat'), fwd=(1, 0, 0), name='clapperrod', slot='iron').bone('extra_clapper_0'),
      loft([dict(p=(0, .56, -.02), r=.03), dict(p=(0, .50, -.02), r=.072), dict(p=(0, .45, -.02), r=.06)], n=7, seg=12, name='clapper', slot='iron').bone('extra_clapper_0'))

# ── Pelvis and legs: iron joints, bell greaves, slab feet ──
b.add(loft([dict(p=(0, .88, 0), r=(.24, .2)), dict(p=(0, .78, 0), r=(.3, .24), sq=2.4), dict(p=(0, .68, 0), r=(.26, .21))], n=8, seg=20, name='pelvis', slot='iron').bone('hips'))
leg_w = chain(['hips', 'thigh_L', 'shin_L'], [HIP + A(0, .14, 0), HIP, KNEE, ANKLE], .05)
b.both(loft([dict(p=HIP + A(-.02, .04, 0), r=.115), dict(p=lerp(HIP, KNEE, .3), r=.098), dict(p=lerp(HIP, KNEE, .5), r=.108), dict(p=lerp(HIP, KNEE, .7), r=.098), dict(p=KNEE, r=.1)], n=10, seg=14, name='thigh_L', slot='iron').paint(leg_w))
b.both(loft([dict(p=KNEE + A(0, 0, .03), r=.02), dict(p=KNEE + A(0, 0, .03), r=.118), dict(p=KNEE + A(0, 0, .03), r=.02)], seg=12, name='knee_L', slot='brass').warp(lambda p: p).bone('shin_L'))
b.both(loft([dict(p=KNEE + A(0, -.02, 0), r=.105), dict(p=lerp(KNEE, ANKLE, .35), r=.115), dict(p=lerp(KNEE, ANKLE, .75), r=.15), dict(p=ANKLE + A(0, -.03, .005), r=(.18, .2))], n=12, seg=18, caps=('round', 'open'), lip=(.02, .06), name='greave_L', slot='bronze').bone('shin_L'))
b.both(torus(.166, .018, seg=20, rseg=6, rz=1.1, flat=1.4, name='greaveband_L', slot='brass', at=ANKLE + A(0, .0, .005)).bone('shin_L'))
FX, FZ0 = ANKLE[0] + .01, ANKLE[2] - .14
b.both(join([box((.25, .115, .44), .028, name='foot_L', slot='iron', at=(FX, .0585, FZ0 + .22)), box((.262, .075, .13), .02, name='toecap_L', slot='brass', at=(FX, .05, FZ0 + .40)), box((.2, .05, .2), .015, name='instep_L', slot='iron', at=(FX, .13, FZ0 + .17))], name='foot_L', slot='iron').bone('foot_L'))

# ── Arms: bell pauldrons, piston upper arms, bell gauntlets and three-jointed iron hands ──
arm_w = chain(['chest', 'upperarm_L', 'forearm_L'], [SH - ARM * .2, SH, EL, WR], .06)
PC = SH + A(.0, .035, 0)
b.both(loft([dict(p=PC - ARM * .2, r=.06), dict(p=PC - ARM * .12, r=.19), dict(p=PC, r=.235), dict(p=PC + ARM * .12, r=.225), dict(p=PC + ARM * .2, r=.215)], n=12, seg=22, caps=('round', 'open'), lip=(.03, .06), name='pauldron_L', slot='bronze').paint(mix(lambda p: {'chest': 1.0}, lambda p: {'upperarm_L': 1.0}, lambda p: smooth(-.2, .05, np.dot(p - SH, ARM)) * .8)))
b.both(torus(.214, .018, seg=24, rseg=6, flat=1.5, name='pauldronband_L', slot='brass', axis=ARM, at=PC + ARM * .19).bone('upperarm_L'))
b.both(loft([dict(p=SH, r=.1), dict(p=lerp(SH, EL, .4), r=.082), dict(p=lerp(SH, EL, .55), r=.094), dict(p=lerp(SH, EL, .7), r=.082), dict(p=EL, r=.088)], n=10, seg=14, name='upperarm_L', slot='iron').paint(arm_w))
b.both(loft([dict(p=EL - ARM * .11, r=.02), dict(p=EL, r=.118), dict(p=EL + ARM * .11, r=.02)], n=7, seg=12, name='elbow_L', slot='brass').bone('forearm_L'))
b.both(loft([dict(p=EL + ARM * .02, r=.098), dict(p=lerp(EL, WR, .35), r=.118), dict(p=lerp(EL, WR, .72), r=.165), dict(p=WR + ARM * .01, r=(.2, .215))], n=12, seg=20, caps=('round', 'open'), lip=(.022, .07), name='gauntlet_L', slot='bronze').bone('forearm_L'))
b.both(torus(.192, .02, seg=22, rseg=6, rz=1.07, flat=1.4, name='gauntletband_L', slot='brass', axis=ARM, at=WR - ARM * .012).bone('forearm_L'))
for i in range(6):
    a = math.radians(i * 60 + 30); n = unit(np.cross(ARM, (0, 0, 1))) * math.cos(a) + A(0, 0, 1) * math.sin(a)
    b.both(disc(.016, .014, seg=8, name='gauntletrivet', slot='brass', axis=n, at=lerp(EL, WR, .52) + n * .142, density=.6).bone('forearm_L'))
for p in hand(WR, ARM, 'L', slot='iron', k=HK, thick=1.3, curl=18): b.add(p); b.add(p.mirror())
b.both(box((.11, .05, .13), .012, name='knuckle_L', slot='brass', at=WR + ALONG * .15 - PALM * .045).turn((0, 0, 1), -40, WR + ALONG * .15 - PALM * .045).bone('hand_L'))

# ── Head: a helmet dome with a visor; lamp eyes behind shutter lids, brow bars, a grille jaw, a hanging ring on the crown ──
HY = 1.68
def hadd(*parts):
    for p in parts: b.add(p.scale(HS, HP))
hadd(lathe([(.205, 0), (.222, .05), (.218, .15), (.18, .245), (.10, .30), (.035, .318)], seg=24, name='helm', slot='bronze', at=(0, HY, .02), rz=1.06).bone('head'))
hadd(torus(.224, .016, seg=24, rseg=6, rz=1.06, flat=1.8, name='helmband', slot='brass', at=(0, HY + .05, .02)).bone('head'))
hadd(box((.3, .1, .09), .02, name='visor', slot='dark', at=(0, 1.80, .2)).bone('head'), box((.33, .028, .1), .008, name='visortop', slot='brass', at=(0, 1.862, .205)).bone('head'))
for s, n in ((1, 'L'), (-1, 'R')):
    c = A(EYE[0] * s, EYE[1], EYE[2]); R = .046
    hadd(disc(.036, .03, seg=16, name=f'eye_{n}', slot='ember', axis=(0, 0, 1), at=c + A(0, 0, .035)).bone('head'), torus(.039, .007, seg=16, rseg=6, name=f'eyering_{n}', slot='brass', axis=(0, 0, 1), at=c + A(0, 0, .05)).bone('head'))
    on = lambda a, e, c=c: c + A(math.sin(math.radians(a)) * math.cos(math.radians(e)), math.sin(math.radians(e)), math.cos(math.radians(a)) * math.cos(math.radians(e)) * 1.25) * R
    hadd(shell(lambda u, v: on(lerp(-80, 80, u), lerp(38, 112, v)), nu=10, nv=5, thick=.006, name=f'lid_{n}', slot='iron').bone(f'lid_{n}'))
    hadd(box((.092, .022, .034), .006, name=f'brow_{n}', slot='iron', at=(EYE[0] * s, 1.848, .246)).bone(f'brow_{n}'))
hadd(join([box((.24, .075, .07), .016, name='jaw', slot='iron', at=(0, 1.712, .2))] + [box((.026, .05, .012), .004, name='jawslit', slot='dark', at=(-.075 + i * .05, 1.712, .238)) for i in range(4)], name='jaw', slot='iron').bone('jaw'))
hadd(lathe([(.03, 0), (.022, .03), (.022, .05)], seg=10, name='crownstem', slot='brass', at=(0, HY + .31, .02)).bone('head'), torus(.052, .016, seg=18, rseg=8, name='crownring', slot='brass', axis=(0, 0, 1), at=(0, HY + .405, .02)).bone('head'))
for s in (1, -1): hadd(lathe([(.03, 0), (.045, .02), (.045, .05), (.03, .07)], seg=10, name=f'ear{s}', slot='copper', axis=(s, 0, 0), at=(.2 * s, 1.80, .02)).bone('head'))

b.J = J; b.extras = {'hand': {'along': [round(float(x), 4) for x in ALONG], 'thumb': [0, 0, 1], 'palm': [round(float(x), 4) for x in PALM]}, 'fist': False}
fist = [round(float(x), 4) for x in ALONG * .15]; r4 = lambda p: [round(float(x), 4) for x in p]
b.anchors = {'fistL': {'bone': 'hand_L', 'at': fist}, 'fistR': {'bone': 'hand_R', 'at': [-fist[0], fist[1], fist[2]]}, 'elbowL': {'bone': 'forearm_L', 'at': [0, 0, 0]}, 'elbowR': {'bone': 'forearm_R', 'at': [0, 0, 0]},
             'shoulderL': {'bone': 'upperarm_L', 'at': [0, .04, 0]}, 'shoulderR': {'bone': 'upperarm_R', 'at': [0, .04, 0]}, 'crown': {'bone': 'head', 'at': [0, .3, .05]}, 'belly': {'bone': 'chest', 'at': [0, -.1, .36]},
             'footL': {'bone': 'foot_L', 'at': [0, -.06, .12]}, 'footR': {'bone': 'foot_R', 'at': [0, -.06, .12]}, 'furnace': {'bone': 'chest', 'at': r4((0, FY - 1.22, FZ + .05))}, 'clapper': {'bone': 'extra_clapper_0', 'at': [0, -.36, 0]},
             'charmL': {'bone': 'extra_charmL_0', 'at': [0, -.15, 0]}, 'charmR': {'bone': 'extra_charmR_0', 'at': [0, -.15, 0]}}

stage = flag('stage', 'clay'); view = flag('view', 'body')
BODY = [(22, (0, 1.0, 0), 6.4, 85), (90, (0, 1.0, 0), 6.4, 85), (180, (0, 1.0, 0), 6.4, 85), (-52, (0, 1.0, 0), 6.4, 85)]; FACE_SHOTS = [(0, (0, 1.82, 0), 1.6, 110), (38, (0, 1.82, 0), 1.6, 110)]
b.mesh(); b.rig()
if stage == 'rig': b.write_meta(os.path.getsize(os.path.join(GAME, 'assets', 'fighters', 'toll.glb')))
elif stage in ('clay', 'color'):
    b.materials(baked=False); b.render(FACE_SHOTS if view == 'face' else BODY, os.path.join(OUT, f'toll-{stage}-{view}'), size=(560, 640) if view == 'face' else (560, 860), clay=stage == 'clay')
else: b.bake(); b.materials(); b.export()
