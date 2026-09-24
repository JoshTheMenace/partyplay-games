"""Falco Lombardi (Melee): lanky blue bird pilot with a long yellow beak, red feather markings sweeping back over half-lidded
cocky eyes, a swept-back feather crest, white throat and neck ruff, a white flight jacket over a red suit, reflector
buckle, silver boots and short tail feathers. The Blaster rides the prop bone (move-only)."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#f1eee6', 'secondary': '#c23a36', 'skin': '#3f6fe0', 'light': '#fbf6ec', 'hair': '#e03a2e', 'trim': '#f4b21e',
          'metal': '#b4bcc8', 'emissive': '#6ad8ff', 'dark': '#1f1b24', 'eye': '#4a8fd8', 'eye-white': '#ffffff', 'accent': '#4a3a2c'}
COSTUMES = [('Red Team', {'primary': '#e2483c', 'secondary': '#3e3438', 'emissive': '#ffb13d'}),
            ('Blue Team', {'primary': '#3f76e0', 'secondary': '#2c3858', 'skin': '#5a86f0', 'emissive': '#8af0ff'}),
            ('Green Team', {'primary': '#57b554', 'secondary': '#2d4a2c', 'emissive': '#b8ff6a'})]
J = humanoid(hip=.84, spine=.96, chest=1.09, neck=1.3, head=1.38, arm_y=1.22, shoulder=.07, arm=.2, elbow=.46, wrist=.7,
             leg=.1, leg_y=.8, knee=.45, ankle=.1, clav_y=1.21)
HERO = {'root_loc': (0, -.02, 0), 'hips': (0, -18, 0), 'spine': (2, -4, 0), 'chest': (0, -10, 0), 'head': (-14, -18, -6),
        'upperarm_R': (0, 72, 18), 'forearm_R': (0, 8, 0), 'hand_R': (0, 0, 0),
        'upperarm_L': (0, 20, -50), 'forearm_L': (0, -110, 0), 'hand_L': (0, 0, -20),
        'thigh_L': (-26, 0, 12), 'shin_L': (44, 0, 0), 'foot_L': (-12, 0, 0), 'thigh_R': (18, 0, -10), 'shin_R': (30, 0, 0), 'foot_R': (12, 0, 0),
        'extra_tail_0': (10, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'head': (-6, -14, 0)}, 'shoulders': .35}

def head(m):
    skull = blob([('ell', (0, 1.56, -.03), (.15, .16, .155)), ('ell', (0, 1.5, .03), (.125, .11, .125)), ('ell', (0, 1.47, .08), (.1, .075, .1)),
                  ('ell', (.085, 1.5, .03), (.07, .075, .08)), ('ell', (-.085, 1.5, .03), (.07, .075, .08))], tris=1800, relax=3)
    def white(p): return min(1.475 - p.y + .08 * p.z, p.z + .06)  # white throat and chin feathers
    split_by(skull, white); face = Surf(skull)
    m.add(skull, lambda c, n: 'light' if white(c) > 0 else 'skin', 'head', tag='head')
    # Beak: long hooked upper mandible over a shorter lower one, with nostril slits.
    up = [(0, 1.505, .09), (0, 1.515, .22), (0, 1.495, .34), (0, 1.455, .415), (0, 1.42, .43)]
    m.add(tube(spline(up, 14), [.07 * (1 - k / 13) ** .8 + .004 for k in range(14)], 14, sq=(1, .6), up=(0, 1, 0)), 'trim', 'head', tag='beak')
    lo = [(0, 1.458, .08), (0, 1.445, .2), (0, 1.435, .3), (0, 1.43, .34)]
    m.add(tube(spline(lo, 10), [.052 * (1 - k / 9) ** .8 + .004 for k in range(10)], 12, sq=(1, .45), up=(0, 1, 0)), 'trim', 'head', tag='beak')
    m.add(tube(spline([(-.055, 1.472, .1), (-.03, 1.466, .24), (0, 1.462, .33), (.03, 1.466, .24), (.055, 1.472, .1)], 16), .006, 6), 'dark', 'head', tag='beak')
    for s in (1, -1):
        m.add(sphere((s * .026, 1.535, .2), (.009, .006, .02), 8, 5, rot=(-4, 0, 0)), 'dark', 'head', tag='beak')
        # Red markings: a teardrop around each eye that sweeps back to the temple.
        mark = [(.07, -.012), (.03, -.042), (-.03, -.04), (-.075, -.012), (-.15, .0), (-.2, .025), (-.13, .048), (-.05, .066), (.03, .064), (.075, .035)]
        m.add(stamp(face, (s * .07, 1.57, 0), [[(-x * s, y) for x, y in mark][::s]], .006, d=(-s * .25, 0, -1)), 'hair', 'head', tag='markings')
        eye(m, face, (s * .064, 1.575, 0), .04, .05, s, tilt=12, depth=.55, iris=.68, pupil=.45, look=(-s * .12, 0), lid=(.34, 12), lid_mat='hair', lash=.22,
            brow=dict(lift=.5, slant=18, thick=.42, width=1.15, arch=.08, mat='hair', gap=.008))
    # Swept-back crest feathers and a short forelock.
    for i, (x, y, z, L, h) in enumerate(((0, 1.7, -.02, .26, .1), (.05, 1.68, -.06, .22, .06), (-.05, 1.68, -.06, .22, .06), (0, 1.63, -.13, .2, .02))):
        b = Vector((x, y, z)); t = b + Vector((x * .6, h, -L))
        m.add(spike(b + Vector((0, -.03, .03)), lerp(b, t, .5) + Vector((0, .06, 0)), t, .055 - i * .006, sq=(.45, 1), up=(1, 0, 0), n=8), 'skin', 'head', over=True, tag='crest')
    for x in (.03, -.03):
        b = Vector((x, 1.69, .05)); m.add(spike(b, b + Vector((x, .05, .03)), b + Vector((x * 2.5, .07, .1)), .03, sq=(1, .5)), 'skin', 'head', over=True, tag='crest')
    for s in (1, -1):  # cheek feathers sweeping back
        for y, L in ((1.51, .1), (1.47, .09)):
            b = Vector((s * .11, y, .0)); m.add(spike(b, b + Vector((s * .05, -.01, -.03)), b + Vector((s * L * .8, -.03, -.08)), .035, sq=(1, .45), up=(0, 0, 1), n=6, seg=7), 'skin', 'head', tag='feathers')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, .85, 0), (.155, .1, .12)), ('ell', (0, .97, 0), (.145, .12, .11)), ('ell', (0, 1.1, .01), (.18, .13, .125)),
                 ('cap', (-.15, 1.2, -.01), (.15, 1.2, -.01), .078), ('ell', (0, 1.14, .05), (.14, .09, .1))], tris=1500, relax=2)
    def jacket(p): return min(p.y - .9, max(abs(p.x) - .025 - (p.y - .9) * .3, -p.z - .02))
    shell = layer(body, jacket, .014, .014, relax=1, tris=800); trim(body, lambda p: min(jacket(p), p.y - .94))
    m.add(body, 'secondary', w, tag='suit'); m.add(shell, 'primary', w, tag='jacket')
    m.add(lathe((0, 1.18, -.01), (0, 1.29, -.02), [(0, 0), (0, .14), (.03, .152), (.09, .13), (.11, .1), (.111, 0)], 20, sq=(1, .9)), 'primary', 'chest', tag='collar')
    m.add(capsule((0, 1.22, -.01), (0, 1.42, .0), .075, .07, 14), 'skin', 'neck', tag='neck')
    wn = m.spine(('chest', 'neck'))
    for i in range(7):  # white neck ruff
        a = math.radians(-90 + i * 30); b = Vector((math.sin(a) * .07, 1.33, math.cos(a) * .065 + .01))
        m.add(spike(b - Vector((0, .03, 0)), b + Vector((math.sin(a) * .03, -.02, math.cos(a) * .03)), b + Vector((math.sin(a) * .08, -.07, math.cos(a) * .075)), .045, sq=(1, .45), up=(0, 1, 0), n=5, seg=6), 'light', wn, tag='ruff')
    m.add(blob([('ell', (0, 1.29, .05), (.075, .06, .06))], tris=240, relax=1), 'light', wn, tag='ruff')
    m.add(torus((0, .9, .005), (.16, .124), .03, 24, 6, sq=(.5, 1.2)), 'dark', w, tag='belt')
    m.add(rbox((0, .9, .13), (.1, .075, .04), .015), 'metal', 'hips', tag='reflector')
    m.add(sphere((0, .9, .153), (.028, .024, .01), 12, 8), 'emissive', 'hips', tag='reflector')
    m.add(rbox((-.165, .7, .02), (.05, .15, .1), .02, rot=(0, 0, 4)), 'accent', 'thigh_R', tag='holster')
    # Short fanned tail feathers on a two-bone spring.
    pts = [(0, .88, -.1), (0, .8, -.22), (0, .72, -.32)]; wt = m.chain('tail', 'hips', pts)
    for a in (-24, 0, 24):
        r = math.radians(a); tip = Vector((math.sin(r) * .13, .66, -.34 - math.cos(r) * .02))
        m.add(spike(Vector((0, .88, -.08)), Vector((math.sin(r) * .05, .8, -.22)), tip, .05, sq=(1, .35), up=(0, 1, 0), n=7), 'skin', wt, tag='tail')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(capsule(sh, el, .072, .06, 14), 'primary', f'upperarm_{S}', tag='arms')
    m.add(capsule(el, wr, .06, .054, 14), 'primary', f'forearm_{S}', tag='arms')
    m.add(lathe(wr - Vector((s * .1, 0, 0)), wr, [(0, .062), (.03, .066), (.07, .068), (.1, .064), (.101, 0)], 12), 'primary', f'forearm_{S}', tag='cuffs')
    hand(m, s, S, wr + Vector((s * .01, 0, 0)), .06, 'light', curl=.45, cuff=(.045, .058), tris=520)
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(capsule(hp, kn, .08, .062, 16), 'secondary', f'thigh_{S}', tag='legs')
    m.add(lathe(kn, (an.x, .08, 0), [(-.07, 0), (-.06, .044), (-.02, .068), (.05, .07), (.2, .072), (.3, .08), (.33, .083), (.345, .068), (.35, 0)], 16), 'metal', f'shin_{S}', tag='boots')
    m.add(sphere(kn + Vector((0, 0, .045)), (.066, .072, .044), 14, 10), 'metal', f'shin_{S}', tag='kneepads')
    m.add(torus((an.x, .34, 0), .074, .012, 16, 6), 'dark', f'shin_{S}', tag='boots')
    shoe(m, s, S, an + Vector((0, 0, .02)), .26, .145, .13, 'metal', 'dark', sole=.028, toe=.95, heel=.9, up=.015, tris=560)

def blaster(m):
    g = P(J, 'prop'); x = g.x  # barrel along -X (the arm), sights toward the thumb side
    m.add(rbox((x - .02, g.y, g.z - .02), (.05, .06, .12), .014, rot=(0, 18, 0)), 'dark', 'prop', tag='blaster')
    m.add(rbox((x - .09, g.y, g.z + .05), (.2, .06, .07), .016), 'metal', 'prop', tag='blaster')
    m.add(cyl((x - .19, g.y, g.z + .05), (x - .3, g.y, g.z + .05), .022, seg=14, bevel=.004), 'dark', 'prop', tag='blaster')
    m.add(torus((x - .3, g.y, g.z + .05), .02, .007, 14, 5, rot=(0, 0, 90)), 'emissive', 'prop', tag='blaster')

def build():
    m = Model('falco', J, COLORS, COSTUMES, prop='move')
    with m.transform((0, 1.4, 0), 1.2, (0, -.045, 0)): head(m)
    torso(m); m.both(lambda s, S: limbs(m, s, S)); blaster(m); return m

main(globals())
