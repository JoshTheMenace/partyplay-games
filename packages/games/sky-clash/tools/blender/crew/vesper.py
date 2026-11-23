"""Vesper, the glasswright: tall and exact. A split robe under a leather apron, a short mantle, smoked lenses, silver hair in a long braid, and a blowpipe with a molten gather.
blender -b --factory-startup --python-exit-code 1 --python tools/blender/crew/vesper.py -- [--stage clay|color|full|rig] [--view body|face]"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from kit import *
from body import *
from head import *

H = 1.82
ARM = unit((math.cos(math.radians(40)), -math.sin(math.radians(40)), 0))
SH = A(.165, 1.468, -.008); EL = SH + ARM * .28; WR = EL + ARM * .25
HIP, KNEE, ANKLE = A(.082, .98, 0), A(.096, .535, .005), A(.1, .095, -.012)
HEAD_C, HEAD_H = A(0, 1.69, .012), .262
ALONG, THUMB, PALM = hand_axes(ARM); mirror = lambda p: A(-p[0], p[1], p[2])
GRIP = mirror(WR + ALONG * .084 + PALM * .022)
J = humanoid(hips=(0, 1.01, 0), spine=(0, 1.127, -.004), chest=(0, 1.275, -.008), neck=(0, 1.494, -.012), head=(0, 1.564, -.004), clav=(.046, 1.46, -.004), shoulder=SH, elbow=EL, wrist=WR, hip=HIP, knee=KNEE, ankle=ANKLE, prop=GRIP)
J.update(face_joints(HEAD_C, HEAD_H, eye=(.146, .005, .226), brow=(.152, .128, .358), jaw=(0, -.14, -.02)))
J.update(hand_joints(WR, ARM))

SLOTS = {
    'robe':   dict(surface='cloth', color='#4a2a58', pattern='#7c4e86'),
    'mantle': dict(surface='wool', color='#a84a66', pattern='#f0d0d4'),
    'apron':  dict(surface='leather', color='#4d3528', pattern='#2e1f18'),
    'lining': dict(surface='cloth', color='#d6cab4', pattern='#a84a66'),
    'glove':  dict(surface='leather', color='#3a2a30', pattern='#241a1e'),
    'skin':   dict(surface='skin', color='#e6c0a2', pattern='#b85a5a'),
    'hair':   dict(surface='hair', color='#cdc9d6', pattern='#8f8aa0'),
    'pewter': dict(surface='metal', color='#8f97a3', pattern='#4f5662'),
    'brass':  dict(surface='metal', color='#c9963f', pattern='#8a5a22'),
    'dark':   dict(surface='flat', color='#16131a', pattern='#16131a'),
    'white':  dict(surface='eye', color='#f3efe6', pattern='#f3efe6'),
    'iris':   dict(surface='eye', color='#7c5ca6', pattern='#2e1c48'),
    'lens':   dict(surface='glass', color='#1e1a2a', pattern='#1e1a2a'),
    'prism':  dict(surface='glow', color='#8fd8ff', pattern='#ff9ad0', glow=1.7),
}
def costume(name, **over):
    c = {k: v['color'] for k, v in SLOTS.items()}; p = {k: v['pattern'] for k, v in SLOTS.items()}
    for k, v in over.items(): (c if not k.endswith('_p') else p)[k.removesuffix('_p')] = v
    return {'name': name, 'colors': c, 'patterns': p}
COSTUMES = [costume('Plum Kiln'), costume('Sea Glass', robe='#1f5560', robe_p='#4f97a0', mantle='#7fc8b4', mantle_p='#f0fff4', prism='#c0ffe0', prism_p='#40e0b0', iris='#3f9a8a'),
            costume('Ember Kiln', robe='#5a2420', robe_p='#9a4a3a', mantle='#d98a3a', mantle_p='#ffe8c0', hair='#2e2428', prism='#ffd08a', prism_p='#ff7a2a', iris='#b8742a'),
            costume('Frost Works', robe='#c9c6d8', robe_p='#f4f2fa', mantle='#5a6cb0', mantle_p='#d8e0ff', apron='#6a5a52', hair='#2a2630', prism='#a0c8ff', prism_p='#6080ff', iris='#5a78c8')]
b = Build('vesper', 'Vesper', J, SLOTS, COSTUMES, height=H, swatch=('robe', 'mantle', 'prism'))
hu = lambda p, s=1: HEAD_C + A(p[0] * s, p[1], p[2]) * HEAD_H
SLOTS['skin']['mask'] = mask_ellipsoids([(hu((0, -.31 + .012, .33)), A(.092, .016, .06) * HEAD_H, .7, .25), (hu((0, -.31 - .016, .325)), A(.08, .019, .06) * HEAD_H, .7, .25),
                                         (hu((.2, -.1, .27)), A(.09, .06, .09) * HEAD_H, .22, .8), (hu((-.2, -.1, .27)), A(.09, .06, .09) * HEAD_H, .22, .8)])

# ── Torso and split robe: each half follows its leg like a wide trouser leg; the apron covers the front, a tail panel the back ──
TORSO = [dict(y=.95, r=(.168, .128), z=-.006), dict(y=1.03, r=(.156, .118), z=-.003), dict(y=1.10, r=(.122, .094), z=.002), dict(y=1.17, r=(.126, .10), z=.006, bumps=[(90, .04, 60)]),
         dict(y=1.27, r=(.146, .11), z=.010, bumps=[(60, .07, 28), (120, .07, 28), (270, .05, 60)]), dict(y=1.37, r=(.160, .108), z=.004, bumps=[(60, .05, 30), (120, .05, 30), (270, .04, 50)]),
         dict(y=1.44, r=(.150, .096), z=-.004), dict(y=1.485, r=(.09, .08), z=-.010)]
tp = lambda y, ang, lift=0.0: torso_point(TORSO, y, ang, lift)
body_w = by_height([(J['hips'][0][1] - .02, 'hips'), (J['hips'][0][1] + .02, 'hips'), (J['spine'][0][1] + .02, 'spine'), (J['chest'][0][1] + .03, 'chest'), (3, 'chest')])
b.add(torso(TORSO, J, slot='robe', name='robe'))
WAIST = 1.06; leg_w = chain(['hips', 'thigh_L', 'shin_L'], [HIP + A(0, .1, 0), HIP, KNEE, ANKLE], .1)
def robe_half(u, v, lift=.008, hem=.19):
    ang = lerp(93, -93, u); top = tp(WAIST, ang, lift); q = math.radians(ang); y = lerp(WAIST, hem + .03 * math.cos(q * 2), v)
    k = 1 + .22 * float(smooth(0, .2, v)) + .34 * v + .03 * v * math.sin(q * 6 + .8); return A(top[0] * k + .012 * v, y, top[2] * k)
b.both(shell(robe_half, nu=16, nv=14, thick=.011, name='robeskirt_L', slot='robe').paint(leg_w))
b.both(shell(lambda u, v: robe_half(u, lerp(.955, 1.004, v), .0105), nu=16, nv=2, thick=.011, name='robehem_L', slot='lining').paint(leg_w))
TA = [tp(WAIST, 270, .012) * A(1, 0, 1.12) + A(0, WAIST - .1, 0), tp(WAIST, 270, .012) * A(1, 0, 1.5) + A(0, .78, 0), tp(WAIST, 270, .012) * A(1, 0, 1.8) + A(0, .5, 0)]
for i in range(3): J[f'extra_tail_{i}'] = (tuple(TA[i]), 'hips' if i == 0 else f'extra_tail_{i - 1}')
def tail_panel(u, v):
    ang = lerp(250, 290, u); top = tp(WAIST, ang, .02); k = 1 + .3 * float(smooth(0, .2, v)) + .42 * v; return A(top[0] * k, lerp(WAIST, .2, v), top[2] * k)
b.add(shell(tail_panel, nu=6, nv=12, thick=.01, name='tail', slot='robe').paint(by_height([(.3, 'extra_tail_2'), (.52, 'extra_tail_2'), (.72, 'extra_tail_1'), (.84, 'extra_tail_1'), (.97, 'extra_tail_0'), (1.02, 'extra_tail_0'), (1.06, 'hips')])))
def apron(u, v):
    ang = lerp(64, 116, u); y = lerp(1.385, .56, v)
    if y >= WAIST: return tp(y, ang, .016)
    top = tp(WAIST, ang, .016); t = (WAIST - y) / (WAIST - .56); return A(top[0] * (1 + .25 * t), y, top[2] * (1 + .3 * float(smooth(0, .25, t)) + .22 * t) + .012)
def apron_w(p):
    if p[1] > 1.0: return body_w(p)
    t = float(smooth(1.0, .86, p[1])); s = float(np.clip(.5 + p[0] / .14, 0, 1)); return {'hips': 1 - t, 'thigh_L': t * s, 'thigh_R': t * (1 - s)}
b.add(shell(apron, nu=8, nv=16, thick=.009, name='apron', slot='apron').paint(apron_w))
for s in (1, -1): b.add(strip([tp(y, 90 + 24 * s, .02) for y in (1.385, 1.42, 1.46)] + [tp(1.475, 90 + 60 * s, .018), tp(1.47, 90 + 110 * s, .018), tp(1.44, 90 + 150 * s, .018)], .012, .004, f'apronstrap{s}', 'apron', n=12).paint(body_w))
b.add(torus(.152, .012, seg=32, rseg=8, rz=.78, flat=2.4, sq=3.0, name='belt', slot='apron', at=(0, WAIST, 0)).paint(body_w), box((.05, .04, .014), .005, name='buckle', slot='brass', at=tp(WAIST, 90, .034)).paint(body_w))
for i, a in enumerate((22, 8, -6)):   # glass vials on the belt
    p = tp(WAIST - .055, a, .03); b.add(lathe([(.012, .035), (.02, .02), (.022, -.03), (.012, -.045)], seg=10, name=f'vial{i}', slot='prism', at=p).paint(body_w), lathe([(.013, 0), (.013, .014)], seg=8, name=f'vialcap{i}', slot='brass', at=p + A(0, .034, 0)).paint(body_w))
# ── Legs under the robe: plain dark hose and low shoes ──
b.both(loft([dict(p=HIP + A(-.012, .05, -.006), r=(.08, .094)), dict(p=lerp(HIP, KNEE, .5), r=(.07, .08)), dict(p=KNEE, r=(.054, .06)), dict(p=lerp(KNEE, ANKLE, .3), r=(.052, .06), bumps=[(270, .1, 50)]), dict(p=lerp(KNEE, ANKLE, .8), r=(.04, .046))], n=12, seg=12, caps=('round', 'open'), name='hose_L', slot='glove', density=.6)
       .paint(chain(['hips', 'thigh_L', 'shin_L'], [HIP + A(0, .12, 0), HIP, KNEE, ANKLE], .07)))
b.both(boot(KNEE, ANKLE, 'L', top=.3, cuff=.03, sole=.022, length=.215, width=.08, slot='glove', sole_slot='dark', calf=.04))

# ── Mantle and collar ──
def mantle(u, v):
    ang = math.radians(lerp(104, 436, u)); c, s = math.cos(ang), math.sin(ang); wide = abs(c)
    r = lerp(.088, .2 + .075 * wide, float(smooth(0, 1, v)) ** .8); y = 1.5 - (.2 + .04 * wide) * v ** 1.6 - .02 * (1 - wide) * v; return A(r * c, y, r * s * .78 - .012)
b.add(shell(mantle, nu=30, nv=8, thick=.012, name='mantle', slot='mantle').paint(mix(lambda p: {'chest': 1.0}, lambda p: {'upperarm_L' if p[0] > 0 else 'upperarm_R': 1.0}, lambda p: smooth(.15, .26, abs(p[0])) * .55)))
b.add(shell(lambda u, v: mantle(u, lerp(.94, 1.0, v)) * A(1.012, 1, 1.012), nu=30, nv=2, thick=.013, name='mantletrim', slot='lining').paint(mix(lambda p: {'chest': 1.0}, lambda p: {'upperarm_L' if p[0] > 0 else 'upperarm_R': 1.0}, lambda p: smooth(.15, .26, abs(p[0])) * .55)))
b.add(loft([dict(p=(0, 1.475, -.012), r=(.07, .066)), dict(p=(0, 1.53, -.008), r=(.062, .06)), dict(p=(0, 1.565, -.004), r=(.066, .064))], seg=16, caps=('open', 'open'), lip=(.008, .02), name='collar', slot='robe').paint(by_height([(1.48, 'chest'), (1.52, 'neck')])))
b.add(disc(.022, .012, seg=12, name='clasp', slot='brass', axis=(0, -.2, 1), at=(0, 1.468, .078)).bone('chest'), lathe([(.006, 0), (.014, .012), (.006, .026)], seg=8, name='claspgem', slot='prism', axis=(0, -.2, 1), at=(0, 1.468, .084)).bone('chest'))

# ── Arms: long sleeves that widen to the cuff, heat gloves ──
up = unit(np.cross(ARM, (0, 0, 1))); sleeve_w = chain(['chest', 'upperarm_L', 'forearm_L'], [SH - ARM * .12, SH, EL, WR], .06)
b.both(loft([dict(p=SH - ARM * .04 + up * .006, r=(.066, .064)), dict(p=SH + ARM * .05, r=(.058, .057)), dict(p=lerp(SH, EL, .6), r=(.05, .05)), dict(p=EL, r=(.048, .05), bumps=[(270, .06, 50)]), dict(p=lerp(EL, WR, .4), r=(.054, .058)),
             dict(p=lerp(EL, WR, .8), r=(.066, .072)), dict(p=lerp(EL, WR, .9), r=(.07, .078))], n=16, seg=14, caps=('round', 'open'), lip=(.008, .05), name='sleeve_L', slot='robe', fwd=(0, 0, 1)).paint(sleeve_w))
b.both(torus(.072, .007, seg=18, rseg=6, rz=1.1, name='cufftrim_L', slot='lining', axis=ARM, at=lerp(EL, WR, .9)).bone('forearm_L'))
for p in hand(WR, ARM, 'L', slot='glove', thick=1.08, gauntlet=(lerp(EL, WR, .62), .044), curl=10): b.add(p)
for p in hand(WR, ARM, 'L', slot='glove', thick=1.08, gauntlet=(lerp(EL, WR, .62), .044), fist=True): b.add(p.mirror())

# ── Head: a long, composed face; smoked lenses on the nose; silver hair drawn back into a braid ──
hd = Head(HEAD_C, HEAD_H, dict(skull=((0, .12, -.03), (.352, .385, .43)), jaw=((0, -.14, .06), (.272, .37, .30)), chin=((0, -.428, .236), .066), jaw_corner=((.18, -.27, -.01), .066), cheek=((.2, -.06, .2), .1),
                               nose_bridge=(0, .04, .34), nose_tip=(0, -.158, .428), nose_ball=.03, nose_r=(.022, .03), nostril=((.036, -.18, .37), .026), muzzle=((0, -.27, .245), (.12, .088, .098)),
                               eye=((.146, .005, .226), .096), dish=((.146, .005, .386), .104, .05), eye_open=48, lid_up=15, lid_low=10, lid_tilt=3, iris=29, pupil=12,
                               mouth_y=-.315, mouth_z=.334, mouth_half=.108, lip_up=(.094, .013, .019), lip_low=(.08, .017, .02), brow_in=(.048, .112, .376), brow_mid=(.15, .15, .36), brow_out=(.256, .132, .276), brow_w=.02))
b.add(hd.skin(), *hd.eyes(), *hd.brows(), *hd.mouth(), *hd.ears())
b.add(loft([dict(p=(0, 1.47, -.014), r=(.052, .05)), dict(p=(0, 1.53, -.008), r=(.044, .045)), dict(p=(0, 1.6, .002), r=(.044, .047))], seg=14, caps=('open', 'open'), name='neck', slot='skin').paint(by_height([(1.49, 'chest'), (1.51, 'neck'), (1.55, 'neck'), (1.58, 'head')])))
for s in (1, -1):
    c = hd.at((.146 * s, .0, .345)); b.add(disc(.031, .005, seg=20, name=f'lens{s}', slot='lens', axis=(0, 0, 1), at=c).bone('head'), torus(.032, .0045, seg=20, rseg=6, name=f'lensrim{s}', slot='brass', axis=(0, 0, 1), at=c).bone('head'),
                                         strip([c + A(.03 * s, .004, 0), c + A(.07 * s, .008, -.03), hd.at((.36 * s, .02, .0))], .0035, .003, f'lensarm{s}', 'brass', n=6).bone('head'))
b.add(loft([dict(p=hd.at((-.03, .012, .352)), r=.004), dict(p=hd.at((0, .03, .362)), r=.004), dict(p=hd.at((.03, .012, .352)), r=.004)], n=6, seg=6, fwd=(0, 0, 1), name='lensbridge', slot='brass').bone('head'))
def hairline(lon):
    a = abs(lon); pts = [(0, 50), (40, 46), (70, 24), (95, 2), (135, -22), (180, -30)]
    for (a0, v0), (a1, v1) in zip(pts, pts[1:]):
        if a <= a1: return lerp(v0, v1, (a - a0) / (a1 - a0))
    return -30
b.add(hd.cap(hairline, lift=.03, volume=lambda lon, v: .03 + .03 * float(smooth(100, 170, abs(lon))), grooves=(19, .22)))
LOCKS = [(20, 54, 172, .32, .22, .05, .04, .06, .3), (-20, 54, 188, .32, .22, .05, .04, .06, .3), (52, 44, 160, .3, .2, .05, .036, .1, .25), (-52, 44, 200, .3, .2, .05, .036, .1, .25),
         (80, 16, 150, .26, .18, .045, .03, .3, .2), (-80, 16, 210, .26, .18, .045, .03, .3, .2), (64, 36, 215, .26, .1, .035, .028, .9, .15)]
for i, (lon, lat, hdg, ln, wd, th, lift, droop, flick) in enumerate(LOCKS): b.add(hd.clump(lon, lat, hdg, ln, wd, th, lift, droop, flick, name=f'lock{i}', steps=6))
B0 = hd.at(hd.surface(180, 6, .05)); BP = [B0, B0 + A(0, -.1, -.05), B0 + A(0, -.26, -.07), B0 + A(0, -.44, -.075), B0 + A(0, -.6, -.07)]
for i in range(3): J[f'extra_braid_{i}'] = (tuple(BP[i + 1] if i else BP[0]), 'head' if i == 0 else f'extra_braid_{i - 1}')
J['extra_braid_0'] = (tuple(BP[0]), 'head'); J['extra_braid_1'] = (tuple(BP[1]), 'extra_braid_0'); J['extra_braid_2'] = (tuple(BP[2]), 'extra_braid_1')
keys = []
for i in range(13):
    t = i / 12; p = cr(BP, t * 4); keys.append(dict(p=p, r=(.034 * (1 - .45 * t) * (1 + .22 * math.sin(i * math.pi)), .03 * (1 - .45 * t)), bumps=[(0, .25 * (1 if i % 2 else -1), 60), (180, .25 * (-1 if i % 2 else 1), 60)], tw=i * 28))
b.add(loft(keys, seg=10, caps=('round', 'round'), fwd=(1, 0, 0), name='braid', slot='hair', density=1.2).paint(chain(['head', 'extra_braid_0', 'extra_braid_1', 'extra_braid_2'], [BP[0] + A(0, .06, .04), BP[0], BP[1], BP[2], BP[4]], .03)))
b.add(torus(.03, .008, seg=14, rseg=6, flat=1.8, name='braidring', slot='brass', at=BP[3]).bone('extra_braid_2'), loft([dict(p=BP[4] + A(0, .01, 0), r=.022), dict(p=BP[4] + A(0, -.05, 0), r=.03), dict(p=BP[4] + A(0, -.1, 0), r=.004)], n=6, seg=8, fwd=(1, 0, 0), name='braidtip', slot='hair').bone('extra_braid_2'))

# ── The blowpipe: a pewter tube along +Z through the right fist, a brass mouthpiece, and a molten gather on the far end ──
G = GRIP; z0, z1 = G[2] - .78, G[2] + 1.08
b.add(loft([dict(p=(G[0], G[1], z0), r=.014), dict(p=(G[0], G[1], G[2]), r=.0135), dict(p=(G[0], G[1], z1), r=.013)], n=10, seg=10, caps=('flat', 'flat'), fwd=(0, 1, 0), name='pipe', slot='pewter', density=.8).bone('prop'))
for z, r, ln in ((z0 + .03, .02, .07), (G[2] - .2, .017, .02), (G[2] + .2, .017, .02), (z1 - .1, .018, .03)):
    b.add(lathe([(r * .8, -ln / 2), (r, -ln / 2 + .006), (r, ln / 2 - .006), (r * .8, ln / 2)], seg=12, name='ferrule', slot='brass', axis=(0, 0, 1), at=(G[0], G[1], z)).bone('prop'))
b.add(lathe([(.014, 0), (.03, .012), (.022, .04), (.012, .05)], seg=12, name='mouthpiece', slot='brass', axis=(0, 0, -1), at=(G[0], G[1], z0)).bone('prop'))
b.add(loft([dict(p=(G[0], G[1], z1 - .02), r=.016), dict(p=(G[0], G[1], z1 + .03), r=.05), dict(p=(G[0], G[1], z1 + .1), r=.076), dict(p=(G[0], G[1] - .006, z1 + .17), r=.062), dict(p=(G[0], G[1] - .012, z1 + .215), r=.02)], n=12, seg=14, fwd=(0, 1, 0), name='gather', slot='prism').bone('prop'))
b.add(torus(.03, .006, seg=14, rseg=6, name='gatherring', slot='brass', axis=(0, 0, 1), at=(G[0], G[1], z1 + .004)).bone('prop'))

b.J = J; b.extras = {'hand': {'along': [round(float(x), 4) for x in ALONG], 'thumb': [0, 0, 1], 'palm': [round(float(x), 4) for x in PALM]}, 'fist': True}
b.anchors = {'staffTip': {'bone': 'prop', 'at': [0, 0, round(z1 + .1 - G[2], 4)]}, 'staffMid': {'bone': 'prop', 'at': [0, 0, .6]}, 'staffButt': {'bone': 'prop', 'at': [0, 0, round(z0 - G[2], 4)]}, 'grip': {'bone': 'prop', 'at': [0, 0, 0]},
             'crown': {'bone': 'head', 'at': [0, .2, .02]}, 'clasp': {'bone': 'chest', 'at': [0, .19, .09]}}

stage = flag('stage', 'clay'); view = flag('view', 'body')
BODY = [(22, (0, .98, 0), 5.6, 85), (90, (0, .98, 0), 5.6, 85), (180, (0, .98, 0), 5.6, 85), (-52, (0, .98, 0), 5.6, 85)]; FACE_SHOTS = [(0, HEAD_C, 1.15, 110), (38, HEAD_C, 1.15, 110), (90, HEAD_C, 1.15, 110)]
REVIEW = {'hand_R': (-80, 0, 0), 'upperarm_R': (0, 0, 14), 'forearm_R': (0, 30, 0)}
b.mesh(); b.rig()
if stage == 'rig': b.write_meta(os.path.getsize(os.path.join(GAME, 'assets', 'fighters', 'vesper.glb')))
elif stage in ('clay', 'color'):
    b.materials(baked=False); b.pose(REVIEW); b.render(FACE_SHOTS if view == 'face' else BODY, os.path.join(OUT, f'vesper-{stage}-{view}'), size=(560, 640) if view == 'face' else (520, 860), clay=stage == 'clay')
else: b.bake(); b.materials(); b.export()
