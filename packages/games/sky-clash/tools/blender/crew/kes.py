"""Kes, the kite-runner: lean and light, a diamond kite on the back with two long ribbon tails, hair tied high. Fights with feet and open hands.
blender -b --factory-startup --python-exit-code 1 --python tools/blender/crew/kes.py -- [--stage clay|color|full|rig] [--view body|face]"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from kit import *
from body import *
from head import *

H = 1.60
ARM = unit((math.cos(math.radians(40)), -math.sin(math.radians(40)), 0))
SH = A(.152, 1.288, -.007); EL = SH + ARM * .245; WR = EL + ARM * .218
HIP, KNEE, ANKLE = A(.078, .86, 0), A(.09, .47, .005), A(.094, .088, -.011)
HEAD_C, HEAD_H = A(0, 1.478, .012), .25
ALONG, THUMB, PALM = hand_axes(ARM); mirror = lambda p: A(-p[0], p[1], p[2])
J = humanoid(hips=(0, .888, 0), spine=(0, .99, -.004), chest=(0, 1.12, -.008), neck=(0, 1.313, -.012), head=(0, 1.375, -.004), clav=(.042, 1.28, -.004), shoulder=SH, elbow=EL, wrist=WR,
             hip=HIP, knee=KNEE, ankle=ANKLE, prop=mirror(WR + ALONG * .075 + PALM * .02))
J.update(face_joints(HEAD_C, HEAD_H, eye=(.152, -.005, .228), brow=(.158, .13, .355), jaw=(0, -.14, -.02)))
J.update(hand_joints(WR, ARM, .95))

SLOTS = {
    'jacket':  dict(surface='cloth', color='#d28a1e', pattern='#f3d9a0'),
    'wrap':    dict(surface='cloth', color='#e2d7bd', pattern='#b9a888'),
    'trouser': dict(surface='cloth', color='#2a3160', pattern='#3d4680'),
    'sash':    dict(surface='wool', color='#2f8a80', pattern='#f0e2b8'),
    'leather': dict(surface='leather', color='#5a3a28', pattern='#3a2418'),
    'skin':    dict(surface='skin', color='#c48a62', pattern='#a8503f'),
    'hair':    dict(surface='hair', color='#23202e', pattern='#4b4460'),
    'kite':    dict(surface='cloth', color='#efe6cf', pattern='#d28a1e'),
    'wood':    dict(surface='wood', color='#6a4a34', pattern='#3e2a1e'),
    'brass':   dict(surface='metal', color='#c9963f', pattern='#8a5a22'),
    'dark':    dict(surface='flat', color='#16131a', pattern='#16131a'),
    'white':   dict(surface='eye', color='#f3efe6', pattern='#f3efe6'),
    'iris':    dict(surface='eye', color='#3fae96', pattern='#145046'),
    'gale':    dict(surface='glow', color='#8ff0d0', pattern='#3fd0a8', glow=1.8),
}
def costume(name, **over):
    c = {k: v['color'] for k, v in SLOTS.items()}; p = {k: v['pattern'] for k, v in SLOTS.items()}
    for k, v in over.items(): (c if not k.endswith('_p') else p)[k.removesuffix('_p')] = v
    return {'name': name, 'colors': c, 'patterns': p}
COSTUMES = [costume('Saffron Run'), costume('Storm Indigo', jacket='#34407e', jacket_p='#b9c4f0', trouser='#4a4f5c', sash='#c9a54a', kite='#dfe4f2', kite_p='#34407e', gale='#9fd8ff', gale_p='#4aa0ff', iris='#5f8fd8'),
            costume('Rosewind', jacket='#b9485c', jacket_p='#f5c9cf', trouser='#3a2a3f', sash='#e3c98a', kite='#f6e3e0', kite_p='#b9485c', hair='#6b3a2a', gale='#ffd0e0', gale_p='#ff8ab0'),
            costume('Evergreen', jacket='#4d7a40', jacket_p='#dfe8b8', trouser='#3a2f26', sash='#c0562e', kite='#e9edd2', kite_p='#4d7a40', hair='#d8d2c2', gale='#e8ff9a', gale_p='#a8e04a', iris='#7a9a3a')]
b = Build('kes', 'Kes', J, SLOTS, COSTUMES, height=H, swatch=('jacket', 'trouser', 'gale'))
hu = lambda p, s=1: HEAD_C + A(p[0] * s, p[1], p[2]) * HEAD_H
SLOTS['skin']['mask'] = mask_ellipsoids([(hu((0, -.30 + .015, .33)), A(.098, .019, .06) * HEAD_H, .7, .25), (hu((0, -.30 - .019, .325)), A(.084, .023, .06) * HEAD_H, .7, .25),
                                         (hu((.2, -.13, .27)), A(.11, .075, .09) * HEAD_H, .35, .8), (hu((-.2, -.13, .27)), A(.11, .075, .09) * HEAD_H, .35, .8), (hu((0, -.13, .41)), A(.05, .04, .05) * HEAD_H, .2, .8)])
SLOTS['kite']['mask'] = lambda N, L: kite_mask(N, L)

# ── Torso: a wrap shirt, a cropped open jacket over it, a broad sash with a tail ──
TORSO = [dict(y=.83, r=(.150, .115), z=-.006), dict(y=.905, r=(.140, .108), z=-.003), dict(y=.97, r=(.112, .088), z=.002), dict(y=1.03, r=(.116, .092), z=.005), dict(y=1.115, r=(.136, .102), z=.008, bumps=[(90, .05, 60), (270, .04, 60)]),
         dict(y=1.20, r=(.150, .100), z=.003, bumps=[(270, .04, 50)]), dict(y=1.265, r=(.140, .090), z=-.004), dict(y=1.305, r=(.084, .076), z=-.01)]
tp = lambda y, ang, lift=0.0: torso_point(TORSO, y, ang, lift)
body_w = by_height([(J['hips'][0][1] - .02, 'hips'), (J['hips'][0][1] + .02, 'hips'), (J['spine'][0][1] + .02, 'spine'), (J['chest'][0][1] + .03, 'chest'), (2, 'chest')])
b.add(torso(TORSO, J, slot='wrap', name='shirt').face_slots(lambda c, i: 'trouser' if c[1] < .9 else None))
b.add(shell(lambda u, v: tp(lerp(1.0, 1.285, v), lerp(112, 428, u), .007 + .01 * (1 - v)), nu=26, nv=8, thick=.009, name='jacket', slot='jacket').paint(body_w))
b.add(strip([tp(1.0, a, .017) for a in range(112, 429, 19)], .011, .004, 'jackethem', 'wrap', n=34).paint(body_w))
for s in (1, -1): b.add(strip([tp(y, 90 + 22.5 * s, .009 + .01 * (1.285 - y) / .285) for y in (1.0, 1.08, 1.16, 1.24, 1.285)], .008, .004, f'lapel{s}', 'wrap', fwd=(1, 0, 0), n=10).paint(body_w))
b.add(torus(.08, .009, seg=24, rseg=8, rz=.9, flat=2.2, name='collar', slot='jacket', at=(0, 1.3, -.008)).turn((1, 0, 0), -10, (0, 1.305, 0)).paint(by_height([(1.29, 'chest'), (1.33, 'neck')])))
b.add(torus(.128, .017, seg=30, rseg=8, rz=.80, flat=3.2, sq=3.0, name='sash', slot='sash', at=(0, .955, 0)).paint(body_w))
b.add(loft([dict(p=tp(.965, 168, .02), r=.02), dict(p=tp(.955, 172, .04), r=.034), dict(p=tp(.93, 176, .035), r=.024)], n=6, seg=10, name='sashknot', slot='sash').paint(body_w))
SA = [tp(.94, 176, .03), tp(.94, 176, .03) + A(-.02, -.14, -.01), tp(.94, 176, .03) + A(-.035, -.3, -.02), tp(.94, 176, .03) + A(-.045, -.46, -.03)]
J['extra_sash_0'] = (tuple(SA[0]), 'hips'); J['extra_sash_1'] = (tuple(SA[1]), 'extra_sash_0'); J['extra_sash_2'] = (tuple(SA[2]), 'extra_sash_1')
b.add(strip(SA, .034, .006, 'sashtail', 'sash', fwd=(1, 0, 0), n=12).paint(chain(['hips', 'extra_sash_0', 'extra_sash_1', 'extra_sash_2'], [SA[0] + A(0, .08, 0), SA[0], SA[1], SA[2], SA[3]], .04)))

# ── Legs: loose trousers gathered below the knee, wrapped shins, soft shoes ──
leg_w = chain(['hips', 'thigh_L', 'shin_L'], [HIP + A(0, .12, 0), HIP, KNEE, ANKLE], .07)
b.both(loft([dict(p=HIP + A(-.012, .05, -.006), r=(.082, .098)), dict(p=HIP + A(0, -.08, 0), r=(.088, .1), bumps=[(90, .05, 50)]), dict(p=lerp(HIP, KNEE, .55), r=(.086, .094), bumps=[(0, .08, 60)]), dict(p=lerp(HIP, KNEE, .9), r=(.082, .088)),
             dict(p=lerp(KNEE, ANKLE, .1), r=(.08, .086), bumps=[(270, .1, 50)]), dict(p=lerp(KNEE, ANKLE, .3), r=(.07, .076)), dict(p=lerp(KNEE, ANKLE, .4), r=(.05, .056))], n=16, seg=16, caps=('round', 'round'), name='trouser_L', slot='trouser').paint(leg_w))
b.both(loft([dict(p=lerp(KNEE, ANKLE, .36), r=(.05, .056)), dict(p=lerp(KNEE, ANKLE, .55), r=(.048, .058), bumps=[(270, .1, 50)]), dict(p=lerp(KNEE, ANKLE, .85), r=(.04, .046)), dict(p=ANKLE + A(0, .01, 0), r=(.04, .048))], n=8, seg=14, caps=('open', 'open'), name='shinwrap_L', slot='wrap').bone('shin_L'))
for i, t in enumerate((.42, .56, .7, .84)): b.both(torus(.049 - i * .003, .006, seg=14, rseg=6, rz=1.14, flat=2.4, name=f'wrapband{i}_L', slot='sash' if i == 0 else 'wrap', axis=unit(KNEE - ANKLE) + A(.12 * (i % 2 * 2 - 1), 0, 0), at=lerp(KNEE, ANKLE, t)).bone('shin_L'))
b.both(boot(KNEE, ANKLE, 'L', top=.07, cuff=.02, sole=.018, length=.2, width=.078, slot='leather', sole_slot='dark', calf=.02, heel=.06))

# ── Arms: short jacket sleeves, bare arms, wrapped wrists, open hands ──
up = unit(np.cross(ARM, (0, 0, 1))); arm_w = chain(['chest', 'upperarm_L', 'forearm_L'], [SH - ARM * .12, SH, EL, WR], .06)
b.both(loft([dict(p=SH - ARM * .035 + up * .004, r=(.058, .056)), dict(p=SH + ARM * .04, r=(.05, .05), bumps=[(0, .12, 60)]), dict(p=lerp(SH, EL, .5), r=(.042, .043)), dict(p=EL, r=(.038, .04), bumps=[(270, .06, 50)]), dict(p=lerp(EL, WR, .3), r=(.04, .042), bumps=[(90, .08, 60)]),
             dict(p=lerp(EL, WR, .75), r=(.032, .034)), dict(p=WR, r=(.027, .031))], n=16, seg=14, caps=('round', 'open'), name='arm_L', slot='skin', fwd=(0, 0, 1)).paint(arm_w))
b.both(loft([dict(p=SH - ARM * .05 + up * .006, r=(.06, .058)), dict(p=SH + ARM * .03 + up * .004, r=(.06, .059)), dict(p=SH + ARM * .1, r=(.056, .055)), dict(p=SH + ARM * .135, r=(.055, .054))], n=8, seg=14, caps=('round', 'open'), lip=(.008, .03), name='sleeve_L', slot='jacket').paint(arm_w))
b.both(torus(.055, .005, seg=16, rseg=6, name='sleevetrim_L', slot='wrap', axis=ARM, at=SH + ARM * .135).paint(arm_w))
b.both(loft([dict(p=lerp(EL, WR, .52), r=(.037, .039)), dict(p=lerp(EL, WR, .7), r=(.036, .038)), dict(p=WR + ARM * .012, r=(.031, .036))], seg=14, caps=('open', 'open'), lip=(.005, .01), name='wristwrap_L', slot='wrap').bone('forearm_L'))
b.both(torus(.036, .006, seg=14, rseg=6, flat=2.0, name='wristband_L', slot='sash', axis=ARM, at=lerp(EL, WR, .56)).bone('forearm_L'))
for p in hand(WR, ARM, 'L', slot='skin', k=.95, thick=1.0, curl=12): b.add(p); b.add(p.mirror())
b.both(loft([dict(p=WR + ALONG * .02, r=(.022, .042), sq=2.8), dict(p=WR + ALONG * .06, r=(.021, .046), sq=3.0)], seg=14, caps=('open', 'open'), fwd=THUMB, name='palmwrap_L', slot='leather').bone('hand_L'))

# ── Head: a younger, rounder face with large eyes; hair swept back into a high tail; a headband ──
hd = Head(HEAD_C, HEAD_H, dict(skull=((0, .115, -.03), (.365, .375, .43)), jaw=((0, -.13, .06), (.28, .345, .30)), chin=((0, -.398, .232), .068), jaw_corner=((.185, -.25, -.01), .07), cheek=((.2, -.1, .2), .116),
                               nose_tip=(0, -.128, .402), nose_ball=.03, nose_r=(.022, .03), nostril=((.036, -.152, .362), .027), muzzle=((0, -.25, .242), (.122, .088, .098)),
                               eye=((.152, -.005, .228), .106), dish=((.152, -.005, .395), .112, .05), eye_open=50, lid_up=19, lid_low=12, lid_tilt=7, iris=31, pupil=13,
                               mouth_y=-.30, mouth_z=.332, mouth_half=.112, lip_up=(.098, .016, .020), lip_low=(.084, .020, .021), brow_in=(.05, .098, .376), brow_mid=(.16, .13, .36), brow_out=(.262, .106, .276), brow_w=.023))
b.add(hd.skin(), *hd.eyes(), *hd.brows(), *hd.mouth(), *hd.ears())
b.add(loft([dict(p=(0, 1.288, -.014), r=(.05, .048)), dict(p=(0, 1.34, -.008), r=(.042, .043)), dict(p=(0, 1.395, .002), r=(.042, .045))], seg=14, caps=('open', 'open'), name='neck', slot='skin').paint(by_height([(1.30, 'chest'), (1.325, 'neck'), (1.36, 'neck'), (1.39, 'head')])))
def hairline(lon):
    a = abs(lon); pts = [(0, 46), (40, 42), (70, 20), (95, -2), (135, -24), (180, -30)]
    for (a0, v0), (a1, v1) in zip(pts, pts[1:]):
        if a <= a1: return lerp(v0, v1, (a - a0) / (a1 - a0))
    return -30
b.add(hd.cap(hairline, lift=.03, volume=lambda lon, v: .035 + .03 * float(smooth(90, 170, abs(lon))), grooves=(17, .2)))
LOCKS = [(28, 50, 150, .30, .2, .05, .04, .1, .5), (-24, 50, 205, .30, .2, .05, .04, .1, .5), (0, 52, 178, .34, .22, .05, .045, .05, .55), (58, 36, 120, .28, .18, .05, .035, .2, .4), (-58, 36, 240, .28, .18, .05, .035, .2, .4),
         (84, 12, 110, .22, .16, .045, .03, .5, .3), (-84, 12, 250, .22, .16, .045, .03, .5, .3), (38, 44, 250, .2, .14, .04, .03, .6, .2), (-40, 42, 122, .16, .12, .04, .03, .7, .2)]
for i, (lon, lat, hdg, ln, wd, th, lift, droop, flick) in enumerate(LOCKS): b.add(hd.clump(lon, lat, hdg, ln, wd, th, lift, droop, flick, name=f'lock{i}', steps=6))
T0 = hd.at(hd.surface(180, 58, .05)); TP = [T0, T0 + A(0, .05, -.1), T0 + A(0, -.02, -.2), T0 + A(0, -.14, -.25), T0 + A(0, -.27, -.24)]
J['extra_tail_0'] = (tuple(TP[0]), 'head'); J['extra_tail_1'] = (tuple(TP[1]), 'extra_tail_0'); J['extra_tail_2'] = (tuple(TP[2]), 'extra_tail_1'); J['extra_tail_3'] = (tuple(TP[3]), 'extra_tail_2')
b.add(loft([dict(p=TP[0], r=.03), dict(p=lerp(TP[0], TP[1], .6), r=.04), dict(p=TP[1], r=(.042, .038)), dict(p=TP[2], r=(.044, .034)), dict(p=TP[3], r=(.034, .026)), dict(p=TP[4], r=(.008, .006), cap=2)], n=18, seg=10, fwd=(1, 0, 0), name='ponytail', slot='hair', density=1.2)
      .paint(chain(['head', 'extra_tail_0', 'extra_tail_1', 'extra_tail_2', 'extra_tail_3'], [TP[0] + A(0, 0, .08), TP[0], TP[1], TP[2], TP[3], TP[4]], .03)))
b.add(torus(.034, .01, seg=16, rseg=6, flat=1.6, name='tailring', slot='brass', axis=unit(TP[1] - TP[0]), at=lerp(TP[0], TP[1], .35)).bone('extra_tail_0'))
band = [hd.at(hd.surface(lon, 34 + 9 * math.cos(math.radians(lon)), .05 if abs(lon) > 40 else .042)) for lon in range(-180, 181, 15)]
b.add(strip(band, .014, .005, 'headband', 'sash', n=50).bone('head'))
for s in (1, -1):
    k0 = hd.at(hd.surface(168 * s, 26, .05)); b.add(strip([k0, k0 + A(.02 * s, -.06, -.03), k0 + A(.035 * s, -.13, -.035)], .012, .004, f'bandend{s}', 'sash', fwd=(1, 0, 0), n=6).bone('head'))

# ── The kite: a diamond of cloth on two spars, carried on the back; a wind-bead where they cross; two long ribbon tails ──
KT, KB, KL = A(0, 1.66, -.3), A(0, .9, -.19), A(.29, 1.33, -.255); KR = mirror(KL); KC = lerp(KL, KR, .5)
def kite_point(u, v): p = KT * (1 - u) * (1 - v) + KL * u * (1 - v) + KR * (1 - u) * v + KB * u * v; return p + A(0, 0, -.035 * math.sin(math.pi * u) * math.sin(math.pi * v))
def kite_mask(N, L):
    """A broad chevron band and a rim in the pattern colour."""
    geo = N.new('ShaderNodeNewGeometry'); sep = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Position'], sep.inputs[0])
    ax = N.new('ShaderNodeMath'); ax.operation = 'ABSOLUTE'; L.new(sep.outputs['X'], ax.inputs[0])
    m = N.new('ShaderNodeMath'); m.operation = 'MULTIPLY_ADD'; L.new(ax.outputs[0], m.inputs[0]); m.inputs[1].default_value = .9; L.new(sep.outputs['Z'], m.inputs[2])
    w = N.new('ShaderNodeMath'); w.operation = 'WRAP'; L.new(m.outputs[0], w.inputs[0]); w.inputs[1].default_value = .26; w.inputs[2].default_value = 0
    r = N.new('ShaderNodeMapRange'); r.interpolation_type = 'STEPPED'; r.inputs['Steps'].default_value = 1; r.inputs['From Min'].default_value = 0; r.inputs['From Max'].default_value = .2; L.new(w.outputs[0], r.inputs['Value']); return r.outputs[0]
kite_w = lambda p: {'chest': 1.0}
b.add(shell(kite_point, nu=10, nv=10, thick=.006, name='kite', slot='kite', density=1.2).paint(kite_w))
b.add(loft([dict(p=KT + A(0, .03, .012), r=.008), dict(p=KB + A(0, -.03, .012), r=.008)], seg=6, caps=('round', 'round'), fwd=(1, 0, 0), name='spar1', slot='wood').paint(kite_w), loft([dict(p=KL + A(.02, 0, .012), r=.007), dict(p=KC + A(0, 0, -.02), r=.007), dict(p=KR + A(-.02, 0, .012), r=.007)], n=7, seg=6, caps=('round', 'round'), fwd=(0, 1, 0), name='spar2', slot='wood').paint(kite_w))
b.add(loft([dict(p=KC + A(0, 0, -.045), r=.004), dict(p=KC + A(0, 0, -.03), r=.026), dict(p=KC + A(0, 0, -.004), r=.03), dict(p=KC + A(0, 0, .016), r=.012)], n=7, seg=12, fwd=(0, 1, 0), name='windbead', slot='gale').paint(kite_w), torus(.032, .006, seg=14, rseg=6, name='beadring', slot='brass', axis=(0, 0, 1), at=KC + A(0, 0, -.006)).paint(kite_w))
for i, p in enumerate((KT, KL, KR, KB)): b.add(lathe([(.012, -.012), (.016, 0), (.012, .012)], seg=8, name=f'kitecap{i}', slot='brass', axis=(0, 0, 1), at=p + A(0, 0, .012)).paint(kite_w))
for s in (1, -1): b.add(strip([tp(y, a, .03) for y, a in ((1.275, 90 - 52 * s), (1.2, 90 - 66 * s), (1.1, 90 - 80 * s), (1.02, 90 - 100 * s), (1.0, 90 - 128 * s))], .014, .005, f'kitestrap{s}', 'leather', n=12).paint(body_w))
for s, n, slot in ((1, 'L', 'jacket'), (-1, 'R', 'sash')):
    R0 = KB + A(.03 * s, -.02, 0); RP = [R0, R0 + A(.03 * s, -.2, -.03), R0 + A(.05 * s, -.4, -.04), R0 + A(.06 * s, -.6, -.03)]
    for i in range(3): J[f'extra_ribbon{n}_{i}'] = (tuple(RP[i]), 'chest' if i == 0 else f'extra_ribbon{n}_{i - 1}')
    b.add(strip(RP, .026, .0035, f'ribbon{n}', slot, fwd=(1, 0, 0), n=14).paint(chain([f'extra_ribbon{n}_0', f'extra_ribbon{n}_1', f'extra_ribbon{n}_2'], RP, .03)))

b.J = J; b.extras = {'hand': {'along': [round(float(x), 4) for x in ALONG], 'thumb': [0, 0, 1], 'palm': [round(float(x), 4) for x in PALM]}, 'fist': False}
palm = [round(float(x), 4) for x in ALONG * .08]
b.anchors = {'handL': {'bone': 'hand_L', 'at': palm}, 'handR': {'bone': 'hand_R', 'at': [-palm[0], palm[1], palm[2]]}, 'footL': {'bone': 'foot_L', 'at': [0, -.04, .08]}, 'footR': {'bone': 'foot_R', 'at': [0, -.04, .08]},
             'kneeL': {'bone': 'shin_L', 'at': [0, 0, .03]}, 'kneeR': {'bone': 'shin_R', 'at': [0, 0, .03]}, 'elbowL': {'bone': 'forearm_L', 'at': [0, 0, 0]}, 'elbowR': {'bone': 'forearm_R', 'at': [0, 0, 0]},
             'crown': {'bone': 'head', 'at': [0, .2, .02]}, 'bead': {'bone': 'chest', 'at': [round(float(x), 4) for x in KC - A(J['chest'][0])]}, 'kiteTop': {'bone': 'chest', 'at': [round(float(x), 4) for x in KT - A(J['chest'][0])]}}

stage = flag('stage', 'clay'); view = flag('view', 'body')
BODY = [(22, (0, .88, 0), 5.0, 85), (90, (0, .88, 0), 5.0, 85), (180, (0, .88, 0), 5.0, 85), (-52, (0, .88, 0), 5.0, 85)]; FACE_SHOTS = [(0, HEAD_C, 1.1, 110), (38, HEAD_C, 1.1, 110), (90, HEAD_C, 1.1, 110)]
b.mesh(); b.rig()
if stage == 'rig': b.write_meta(os.path.getsize(os.path.join(GAME, 'assets', 'fighters', 'kes.glb')))
elif stage in ('clay', 'color'):
    b.materials(baked=False); b.render(FACE_SHOTS if view == 'face' else BODY, os.path.join(OUT, f'kes-{stage}-{view}'), size=(560, 640) if view == 'face' else (520, 860), clay=stage == 'clay')
else: b.bake(); b.materials(); b.export()
