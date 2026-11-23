"""Sola, the Lamplighter (hero of the Reaches).
blender -b --factory-startup --python-exit-code 1 --python tools/blender/crew/sola.py -- [--stage clay|color|full] [--view body|face] [--tex 1024]"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from kit import *
from body import *
from head import *

H = 1.72
ARM = unit((math.cos(math.radians(40)), -math.sin(math.radians(40)), 0))   # A-pose: arms 40 degrees below horizontal
SH = A(.168, 1.385, -.008); EL = SH + ARM * .265; WR = EL + ARM * .235
HIP, KNEE, ANKLE = A(.084, .925, 0), A(.098, .505, .005), A(.102, .095, -.012)
HEAD_C, HEAD_H = A(0, 1.592, .012), .262
ALONG, THUMB, PALM = hand_axes(ARM); mirror = lambda p: A(-p[0], p[1], p[2])
GRIP = mirror(WR + ALONG * .084 + PALM * .022)                                # the pike runs along +Z through the right fist
J = humanoid(hips=(0, .955, 0), spine=(0, 1.065, -.004), chest=(0, 1.205, -.008), neck=(0, 1.412, -.012), head=(0, 1.478, -.004), clav=(.045, 1.378, -.004), shoulder=SH, elbow=EL, wrist=WR,
             hip=HIP, knee=KNEE, ankle=ANKLE, prop=GRIP)
J.update(face_joints(HEAD_C, HEAD_H, eye=(.148, .0, .226), brow=(.155, .125, .36), jaw=(0, -.14, -.02)))
J.update(hand_joints(WR, ARM))

SLOTS = {
    'coat':    dict(surface='cloth', color='#1d5a62', pattern='#d9c9a3'),
    'lining':  dict(surface='cloth', color='#c4b99c', pattern='#b5532a'),
    'trouser': dict(surface='cloth', color='#2a2d38', pattern='#3a4050'),
    'leather': dict(surface='leather', color='#5c3521', pattern='#3d2416'),
    'scarf':   dict(surface='wool', color='#cfc5a9', pattern='#d9742b'),
    'skin':    dict(surface='skin', color='#e3a882', pattern='#c0604f'),
    'hair':    dict(surface='hair', color='#402b2c', pattern='#7a5148'),
    'brass':   dict(surface='metal', color='#c9963f', pattern='#8a5a22'),
    'steel':   dict(surface='metal', color='#b4bdc8', pattern='#5d6672'),
    'wood':    dict(surface='wood', color='#4a3226', pattern='#2e1e17'),
    'dark':    dict(surface='flat', color='#16131a', pattern='#16131a'),
    'white':   dict(surface='eye', color='#f3efe6', pattern='#f3efe6'),
    'iris':    dict(surface='eye', color='#c8792c', pattern='#5a2c10'),
    'lens':    dict(surface='glass', color='#1c2630', pattern='#1c2630'),
    'ember':   dict(surface='glow', color='#ffb347', pattern='#ff6a1c', glow=1.9),
}
def costume(name, **over):
    c = {k: v['color'] for k, v in SLOTS.items()}; p = {k: v['pattern'] for k, v in SLOTS.items()}
    for k, v in over.items(): (c if not k.endswith('_p') else p)[k.removesuffix('_p')] = v
    return {'name': name, 'colors': c, 'patterns': p}
COSTUMES = [costume('Beacon Teal'), costume('Harbour Red', coat='#8f2f2c', scarf='#e3d9c0', scarf_p='#2f6f78', lining='#e0d4b8', hair='#2a2326', ember='#ffc65c'),
            costume('Night Watch', coat='#2b3350', scarf='#c9a54a', scarf_p='#f0e4c2', trouser='#1d1f29', leather='#3b2d2a', hair='#c9c2b8', ember='#8fe3ff', ember_p='#3aa8ff', iris='#5fa8d8'),
            costume('Moss and Rust', coat='#566b3a', scarf='#c9683a', scarf_p='#f1dfbd', leather='#4b3423', hair='#7b3b24', iris='#6f8f3a', ember='#ffd866')]

b = Build('sola', 'Sola', J, SLOTS, COSTUMES, height=H, swatch=('coat', 'scarf', 'ember'))
hu = lambda p, s=1: HEAD_C + A(p[0] * s, p[1], p[2]) * HEAD_H
SLOTS['skin']['mask'] = mask_ellipsoids([(hu((0, -.305 + .016, .336)), A(.106, .020, .06) * HEAD_H, .8, .25), (hu((0, -.305 - .020, .330)), A(.090, .024, .06) * HEAD_H, .8, .25),
                                         (hu((.2, -.13, .27)), A(.10, .07, .09) * HEAD_H, .3, .8), (hu((-.2, -.13, .27)), A(.10, .07, .09) * HEAD_H, .3, .8), (hu((0, -.14, .42)), A(.05, .04, .05) * HEAD_H, .22, .8)])

# ── Torso: the fitted coat body. Rings: half width, half depth; angle 90 is the chest ──
TORSO = [dict(y=.895, r=(.170, .128), z=-.006), dict(y=.975, r=(.158, .118), z=-.003), dict(y=1.045, r=(.126, .096), z=.002), dict(y=1.11, r=(.132, .103), z=.006, bumps=[(90, .04, 60)]),
         dict(y=1.20, r=(.154, .114), z=.010, bumps=[(60, .08, 28), (120, .08, 28), (270, .05, 60)]), dict(y=1.29, r=(.168, .112), z=.004, bumps=[(60, .06, 30), (120, .06, 30), (270, .04, 50)]),
         dict(y=1.36, r=(.156, .100), z=-.004), dict(y=1.405, r=(.092, .082), z=-.010)]
def tsurf(y, ang, lift=0.0):
    """A point on the coat body at height y and angle (0 = her left side, 90 = front), pushed out by `lift`."""
    i = max(0, min(len(TORSO) - 2, next((k for k in range(len(TORSO) - 1) if TORSO[k + 1]['y'] >= y), len(TORSO) - 2))); a, c = TORSO[i], TORSO[i + 1]; t = float(np.clip((y - a['y']) / (c['y'] - a['y']), 0, 1))
    rx, rz, z0 = lerp(a['r'][0], c['r'][0], t), lerp(a['r'][1], c['r'][1], t), lerp(a.get('z', 0), c.get('z', 0), t); q = math.radians(ang); e = 2 / 2.3
    x, z = math.copysign(abs(math.cos(q)) ** e, math.cos(q)), math.copysign(abs(math.sin(q)) ** e, math.sin(q)); n = unit((x / rx, 0, z / rz)); return A(rx * x, y, z0 + rz * z) + n * lift
body_w = by_height([(J['hips'][0][1] - .02, 'hips'), (J['hips'][0][1] + .02, 'hips'), (J['spine'][0][1] + .02, 'spine'), (J['chest'][0][1] + .03, 'chest'), (2, 'chest')])
b.add(torso(TORSO, J, slot='coat', name='coat').face_slots(lambda c, i: 'trouser' if c[1] < .965 else None))

# ── Legs: dark trousers into tall cuffed boots ──
thigh = loft([dict(p=HIP + A(-.012, .05, -.006), r=(.088, .104)), dict(p=HIP + A(.0, -.07, 0), r=(.090, .104), bumps=[(90, .05, 50)]), dict(p=lerp(HIP, KNEE, .5), r=(.080, .090), bumps=[(90, .06, 55)]),
              dict(p=lerp(HIP, KNEE, .86), r=(.064, .070)), dict(p=KNEE + A(0, 0, .006), r=(.060, .066), bumps=[(90, .08, 40)]), dict(p=lerp(KNEE, ANKLE, .22), r=(.056, .064), bumps=[(270, .12, 50)])],
             n=14, seg=16, caps=('round', 'open'), name='thigh_L', slot='trouser').paint(chain(['hips', 'thigh_L', 'shin_L'], [HIP + A(0, .12, 0), HIP, KNEE, ANKLE], .07))
b.both(thigh)
b.both(boot(KNEE, ANKLE, 'L', top=.78, cuff=.07, sole=.024, length=.205, width=.084, slot='leather', sole_slot='dark'))

# ── Coat skirt: two long back tails (spring chains) and two swept-back side panels that ride the thighs ──
WAIST = 1.005
def skirt(a0, a1, hem, flare, folds, name, slot='coat', v0=0.0, v1=1.0, lift=.006, nv=12):
    def fn(u, v):
        v = lerp(v0, v1, v); ang = lerp(a0, a1, u); top = tsurf(WAIST, ang, lift); y = lerp(WAIST, hem(ang), v); q = math.radians(ang)
        k = 1 + .26 * float(smooth(0, .22, v)) + flare * v + folds * v * math.sin(q * 7 + 1.3)       # clear the hips first, then flare and fold
        return A(top[0] * k, y, top[2] * k - .03 * v * (1 if math.sin(q) < 0 else 0))
    return shell(fn, nu=12, nv=nv, thick=.011, name=name, slot=slot)
hem_back = lambda ang: .44 + .02 * math.cos(math.radians(ang) * 3); hem_side = lambda ang: lerp(.48, .72, float(smooth(8, 64, ang)))
T0, T1 = tsurf(WAIST, -45, .006) * A(1.25, 0, 1.25) + A(0, WAIST - .08, 0), tsurf(WAIST, -45, .03) * A(1.45, 0, 1.5) + A(0, .72, -.01)
J['extra_tailL_0'] = (tuple(T0), 'hips'); J['extra_tailL_1'] = (tuple(T1), 'extra_tailL_0'); J['extra_tailR_0'] = (tuple(mirror(T0)), 'hips'); J['extra_tailR_1'] = (tuple(mirror(T1)), 'extra_tailR_0')
tail_w = by_height([(.50, 'extra_tailL_1'), (.74, 'extra_tailL_1'), (.88, 'extra_tailL_0'), (.955, 'extra_tailL_0'), (.99, 'hips')]); flap_w = mix(body_w, lambda p: {'thigh_L': 1.0}, lambda p: smooth(.97, .76, p[1]) * .85)
b.both(skirt(8, -88.5, hem_back, .16, .03, 'tail_L').paint(tail_w)); b.both(skirt(8, -88.5, hem_back, .16, .03, 'tailtrim_L', 'lining', .925, 1.004, .0085, 2).paint(tail_w))
b.both(skirt(8, 64, hem_side, .10, .018, 'flap_L').paint(flap_w)); b.both(skirt(8, 64, hem_side, .10, .018, 'flaptrim_L', 'lining', .90, 1.004, .0085, 2).paint(flap_w))

# ── Arms: sleeves with turned cuffs under leather gauntlets; a leather shoulder roll hides the seam ──
up = unit(np.cross(ARM, (0, 0, 1)))
sleeve = loft([dict(p=SH - ARM * .04 + up * .006, r=(.074, .072)), dict(p=SH + ARM * .05, r=(.066, .065), bumps=[(0, .10, 60)]), dict(p=lerp(SH, EL, .55), r=(.055, .055)), dict(p=EL - ARM * .01, r=(.050, .051), bumps=[(270, .06, 50)]),
               dict(p=lerp(EL, WR, .3), r=(.051, .053), bumps=[(90, .06, 60)]), dict(p=lerp(EL, WR, .62), r=(.048, .050))],
              n=14, seg=14, caps=('round', 'open'), lip=(.008, .03), name='sleeve_L', slot='coat', fwd=(0, 0, 1)).paint(chain(['chest', 'upperarm_L', 'forearm_L'], [SH - ARM * .12, SH, EL, WR], .06))
b.both(sleeve)
sleeve_w = chain(['chest', 'upperarm_L', 'forearm_L'], [SH - ARM * .12, SH, EL, WR], .06)
b.both(loft([dict(p=SH - ARM * .06 + up * .010, r=(.074, .078)), dict(p=SH - ARM * .01 + up * .010, r=(.084, .082)), dict(p=SH + ARM * .05 + up * .006, r=(.079, .078)), dict(p=SH + ARM * .09, r=(.070, .071))], n=9, seg=14, caps=('round', 'open'), lip=(.009, .02),
            name='roll_L', slot='leather').paint(sleeve_w))
b.both(torus(.071, .006, seg=18, rseg=6, name='rolltrim_L', slot='brass', axis=ARM, at=SH + ARM * .092).paint(sleeve_w))
b.both(loft([dict(p=lerp(EL, WR, .50), r=(.055, .057)), dict(p=lerp(EL, WR, .56), r=(.060, .062)), dict(p=lerp(EL, WR, .70), r=(.058, .060))], seg=14, caps=('open', 'open'), lip=(.007, .02), name='cuff_L', slot='lining').bone('forearm_L'))
for p in hand(WR, ARM, 'L', slot='leather', thick=1.12, gauntlet=(lerp(EL, WR, .56), .052), curl=8): b.add(p)
for p in hand(WR, ARM, 'L', slot='leather', thick=1.12, gauntlet=(lerp(EL, WR, .56), .052), fist=True): b.add(p.mirror())
b.both(disc(.02, .008, name='stud_L', slot='brass', axis=-PALM, at=WR + ALONG * .05 - PALM * .024).bone('hand_L'))

# ── Head: sculpted face, eyes, brows, jaw ──
hd = Head(HEAD_C, HEAD_H, dict(lip_up=(.104, .017, .021), lip_low=(.088, .021, .022), mouth_half=.118, chin=((0, -.412, .238), .074), jaw=((0, -.13, .06), (.29, .36, .305)), jaw_corner=((.19, -.26, -.01), .075), muzzle=((0, -.255, .245), (.125, .09, .10)), nose_tip=(0, -.145, .412), nose_ball=.033,
                               skull=((0, .11, -.03), (.36, .365, .43)), lid_up=21, lid_low=12, brow_w=.027, mouth_z=.336, brow_in=(.046, .100, .378), brow_mid=(.155, .132, .362), brow_out=(.258, .112, .278),
                               eye=((.148, .0, .226), .098), dish=((.148, .0, .388), .106, .05), iris=30, pupil=13))
b.add(hd.skin(), *hd.eyes(), *hd.brows(), *hd.mouth(), *hd.ears())
b.add(loft([dict(p=(0, 1.385, -.014), r=(.056, .054)), dict(p=(0, 1.44, -.008), r=(.047, .048)), dict(p=(0, 1.50, .002), r=(.047, .05))], seg=14, caps=('open', 'open'), name='neck', slot='skin').paint(by_height([(1.40, 'chest'), (1.425, 'neck'), (1.46, 'neck'), (1.49, 'head')])))

# ── Hair: a cap on the skull, a side-swept fringe, locks by the ears, flicked ends at the nape ──
def hairline(lon):
    a = abs(lon); pts = [(0, 43), (45, 37), (72, 14), (95, -6), (135, -28), (180, -36)]
    for (a0, v0), (a1, v1) in zip(pts, pts[1:]):
        if a <= a1: return lerp(v0, v1, (a - a0) / (a1 - a0))
    return -36
b.add(hd.cap(hairline, lift=.034, volume=lambda lon, v: .05 + .035 * float(smooth(60, 150, abs(lon)))))
LOCKS = [  # lon, lat, heading, length, width, thick, lift, droop, flick
    (44, 50, 236, .34, .26, .06, .034, .30, .22), (18, 53, 230, .38, .28, .06, .038, .25, .2), (-8, 53, 222, .34, .27, .06, .038, .3, .22), (-32, 49, 204, .28, .24, .055, .034, .4, .2),
    (66, 30, 186, .40, .20, .055, .03, .8, .15), (-66, 30, 174, .40, .20, .055, .03, .8, .15), (88, 14, 180, .36, .20, .055, .03, .8, .2), (-88, 14, 180, .36, .20, .055, .03, .8, .2),
    (122, -8, 178, .24, .26, .06, .034, .5, .55), (-122, -8, 182, .24, .26, .06, .034, .5, .55), (152, -18, 178, .22, .26, .06, .034, .45, .6), (-152, -18, 182, .22, .26, .06, .034, .45, .6), (180, -22, 180, .22, .27, .06, .034, .45, .6),
    (70, 74, 96, .30, .24, .06, .07, .5, .3), (-74, 72, 262, .30, .24, .06, .07, .5, .3), (172, 70, 184, .32, .26, .06, .07, .5, .35),
]
for i, (lon, lat, hdg, ln, wd, th, lift, droop, flick) in enumerate(LOCKS): b.add(hd.clump(lon, lat, hdg, ln, wd, th, lift, droop, flick, name=f'lock{i}', steps=6))

# ── Soot goggles pushed up into the hair ──
for s in (1, -1):
    c = hd.surface(20 * s, 52, .085); n = unit(c); at = hd.at(c)
    b.add(torus(.027, .0075, seg=20, rseg=8, name=f'gogglerim{s}', slot='brass', axis=n, at=at).bone('head'), disc(.0255, .006, seg=18, name=f'gogglelens{s}', slot='lens', axis=n, at=at + n * .003).bone('head'))
b.add(box((.028, .012, .012), .003, name='gogglebridge', slot='brass', at=hd.at(hd.surface(0, 53, .08))).bone('head'))
strap = loft([dict(p=hd.at(hd.surface(lon, 40 + 12 * math.cos(math.radians(lon)), .058 if abs(lon) > 45 else .07)), r=(.004, .013), sq=3.5) for lon in list(range(34, 181, 14)) + list(range(-174, -33, 14))], seg=8, caps=('flat', 'flat'), fwd=(0, 1, 0), name='gogglestrap', slot='leather').bone('head')
b.add(strap)

# ── Scarf: a thick wrap, a knot at the left collarbone and a long tail down the back (spring chain) ──
b.add(torus(.078, .034, seg=28, rseg=10, rz=.92, flat=1.15, name='scarf', slot='scarf', at=(0, 1.425, -.006)).turn((1, 0, 0), -8, (0, 1.425, 0)).paint(by_height([(1.40, 'chest'), (1.45, 'neck')])))
b.add(loft([dict(p=(.055, 1.44, .07), r=.02), dict(p=(.075, 1.415, .082), r=.034), dict(p=(.085, 1.375, .088), r=.028), dict(p=(.09, 1.33, .09), r=(.03, .012))], n=7, seg=10, name='knot', slot='scarf').bone('chest'))
SC = [A(.05, 1.44, -.085), A(.075, 1.37, -.13), A(.088, 1.26, -.15), A(.096, 1.14, -.158), A(.10, 1.02, -.164)]
J['extra_scarf_0'] = (tuple(SC[0]), 'chest'); J['extra_scarf_1'] = (tuple(SC[2]), 'extra_scarf_0'); J['extra_scarf_2'] = (tuple(SC[3]), 'extra_scarf_1')
b.add(loft([dict(p=SC[0], r=(.03, .016), sq=3), dict(p=SC[1], r=(.036, .011), sq=3.2), dict(p=SC[2], r=(.038, .010), sq=3.2), dict(p=SC[3], r=(.040, .010), sq=3.2), dict(p=SC[4], r=(.044, .009), sq=3.4)], n=16, seg=10, caps=('round', 'flat'), fwd=(0, 0, -1),
            name='scarftail', slot='scarf').paint(chain(['chest', 'extra_scarf_0', 'extra_scarf_1', 'extra_scarf_2'], [SC[0] + A(0, .08, .03), SC[0], SC[2], SC[3], SC[4]], .05)))

# ── Belt, buckle, pouch, wick coil, bandolier, buttons ──
b.add(torus(.150, .011, seg=32, rseg=8, rz=.775, flat=2.6, sq=3.2, name='belt', slot='leather', at=(0, 1.012, -.001)).paint(body_w))
b.add(box((.058, .046, .014), .005, name='buckle', slot='brass', at=tsurf(1.012, 90, .012)).paint(body_w), box((.03, .022, .016), .003, name='buckletongue', slot='steel', at=tsurf(1.012, 90, .02)).paint(body_w))
b.add(box((.05, .085, .075), .012, name='pouch', slot='leather', at=tsurf(.955, 182, .03)).paint(body_w), disc(.011, .008, name='pouchstud', slot='brass', axis=(-1, 0, 0), at=tsurf(.965, 182, .058)).paint(body_w))
for i in range(3): b.add(torus(.036 - i * .002, .0085, seg=18, rseg=6, name=f'wick{i}', slot='lining', axis=(1, 0, .15), at=tsurf(.94, 10, .022 + i * .014)).paint(body_w))
band = [tsurf(y, a, .012) for y, a in ((1.37, 52), (1.31, 62), (1.23, 76), (1.15, 96), (1.07, 118), (1.02, 140))]
b.add(loft([dict(p=p, r=(.004, .024), sq=3.5) for p in band], n=14, seg=8, caps=('flat', 'flat'), fwd=(0, 1, 0), name='bandolier', slot='leather').paint(body_w))
b.add(loft([dict(p=tsurf(y, 90, .003), r=(.026, .006), sq=3.5) for y in (1.03, 1.10, 1.18, 1.26, 1.33, 1.375)], n=12, seg=8, caps=('flat', 'flat'), fwd=(1, 0, 0), name='placket', slot='coat').paint(body_w))
for y in (1.085, 1.155, 1.225):
    for a in (66, 114): p = tsurf(y, a, .004); b.add(disc(.017, .009, seg=12, name='button', slot='brass', axis=unit((p[0] * .6, 0, 1)), at=p).paint(body_w))

# ── The lantern-pike: pole along +Z through the right fist, spear blade, hook arm and a hanging lantern (spring bone) ──
G = GRIP; z0, z1 = G[2] - .70, G[2] + 1.02
b.add(loft([dict(p=(G[0], G[1], z0), r=.017), dict(p=(G[0], G[1], z0 + .05), r=.0155), dict(p=(G[0], G[1], G[2]), r=.0150), dict(p=(G[0], G[1], z1), r=.0145)], n=12, seg=10, caps=('round', 'flat'), fwd=(0, 1, 0), name='pole', slot='wood', density=.8).bone('prop'))
for z, r, ln in ((z0 + .02, .021, .05), (G[2] - .16, .019, .02), (G[2] + .16, .019, .02), (z1 - .16, .02, .03), (z1 - .01, .024, .06)):
    b.add(lathe([(r * .82, -ln / 2), (r, -ln / 2 + .006), (r, ln / 2 - .006), (r * .82, ln / 2)], seg=12, name='ferrule', slot='brass', axis=(0, 0, 1), at=(G[0], G[1], z)).bone('prop'))
b.add(loft([dict(p=(G[0], G[1], z1 + .02), r=(.012, .012), sq=1.5), dict(p=(G[0], G[1], z1 + .075), r=(.036, .008), sq=1.4), dict(p=(G[0], G[1], z1 + .17), r=(.022, .006), sq=1.4), dict(p=(G[0], G[1], z1 + .265), r=(.002, .002), sq=1.4)],
            n=9, seg=8, caps=('flat', 'flat'), fwd=(0, 1, 0), name='blade', slot='steel').bone('prop'))
hook = [A(G[0], G[1], z1 - .10), A(G[0], G[1] + .05, z1 - .06), A(G[0], G[1] + .11, z1 - .07), A(G[0], G[1] + .135, z1 - .12)]
b.add(loft([dict(p=p, r=.0075) for p in hook], n=10, seg=8, fwd=(1, 0, 0), name='hook', slot='brass').bone('prop'))
LP = hook[-1] + A(0, 0, -.012); J['extra_lantern_0'] = (tuple(LP), 'prop'); lz = lambda d: (LP[0], LP[1], LP[2] - d)
lantern = [torus(.014, .004, seg=12, rseg=6, name='lanternring', slot='brass', axis=(1, 0, 0), at=lz(.012)),
           lathe([(.012, 0), (.03, .012), (.05, .03), (.052, .04), (.03, .045)], seg=10, name='lanterncap', slot='brass', axis=(0, 0, -1), at=lz(.07)),
           lathe([(.036, 0), (.044, .02), (.046, .07), (.040, .105)], seg=10, name='lanternglass', slot='ember', axis=(0, 0, -1), at=lz(.066)),
           lathe([(.044, 0), (.05, .008), (.05, .02), (.03, .032), (.012, .036)], seg=10, name='lanternbase', slot='brass', axis=(0, 0, -1), at=lz(.166))]
for k in range(4):
    a = math.radians(45 + 90 * k); lantern.append(loft([dict(p=(LP[0] + math.cos(a) * .047, LP[1] + math.sin(a) * .047, LP[2] - .066), r=.0038), dict(p=(LP[0] + math.cos(a) * .047, LP[1] + math.sin(a) * .047, LP[2] - .17), r=.0038)], seg=6, caps=('flat', 'flat'), fwd=(1, 0, 0), name=f'lanternbar{k}', slot='brass'))
for p in lantern: b.add(p.bone('extra_lantern_0'))

b.J = J; b.extras = {'hand': {'along': [round(float(x), 4) for x in ALONG], 'thumb': [0, 0, 1], 'palm': [round(float(x), 4) for x in PALM]}, 'fist': True}
b.anchors = {'pikeTip': {'bone': 'prop', 'at': [0, 0, round(z1 + .2 - G[2], 4)]}, 'pikeHead': {'bone': 'prop', 'at': [0, 0, round(z1 - G[2], 4)]}, 'pikeButt': {'bone': 'prop', 'at': [0, 0, round(z0 - G[2], 4)]}, 'pikeMid': {'bone': 'prop', 'at': [0, 0, .55]},
             'lantern': {'bone': 'extra_lantern_0', 'at': [0, 0, -.115]}, 'grip': {'bone': 'prop', 'at': [0, 0, 0]}}

stage = flag('stage', 'clay'); view = flag('view', 'body')
BODY = [(22, (0, .9, 0), 5.2, 85), (90, (0, .9, 0), 5.2, 85), (180, (0, .9, 0), 5.2, 85), (-52, (0, .9, 0), 5.2, 85)]
FACE_SHOTS = [(0, HEAD_C, 1.15, 110), (38, HEAD_C, 1.15, 110), (90, HEAD_C, 1.15, 110)]
REVIEW = {'hand_R': (-80, 0, 0), 'upperarm_R': (0, 0, 14), 'forearm_R': (0, 30, 0), 'upperarm_L': (0, 0, -22), 'forearm_L': (0, -22, 0)}
b.mesh(); b.rig()
if stage == 'rig': b.write_meta(os.path.getsize(os.path.join(GAME, 'assets', 'fighters', 'sola.glb')))
elif stage in ('clay', 'color'):
    b.materials(baked=False); b.pose(REVIEW)
    b.render(FACE_SHOTS if view == 'face' else BODY, os.path.join(OUT, f'sola-{stage}-{view}'), size=(560, 640) if view == 'face' else (520, 860), clay=stage == 'clay')
else:
    b.bake(); b.materials(); b.export()   # turnarounds and portraits come from the game renderer (tools/pose-lab/crew.html)
