"""Yoshi (Melee): green dinosaur with a huge round snout, tall white eyes on top of the head, puffy cheeks, a white jaw
and belly, red spines down the back of the head, a red saddle shell with a white rim, a thick tail and big orange
boots. Hunched in game (dinosaur style); built upright in the T-pose."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#5cc64a', 'light': '#fbf8ef', 'secondary': '#e23a2c', 'accent': '#f27a1c', 'trim': '#c85a14', 'dark': '#1b1a1e',
          'eye-white': '#ffffff', 'hair': '#e23a2c'}
COSTUMES = [('Red', {'primary': '#f0584a', 'secondary': '#b8232a', 'hair': '#b8232a', 'accent': '#f5a623', 'trim': '#c77a12'}),
            ('Blue', {'primary': '#4f8fec', 'accent': '#f2c230', 'trim': '#c49414'}),
            ('Yellow', {'primary': '#f5d43c', 'accent': '#e2562c', 'trim': '#a8381a'})]
J = humanoid(hip=.56, spine=.7, chest=.88, neck=1.04, head=1.16, arm_y=.94, shoulder=.1, arm=.24, elbow=.39, wrist=.53,
             leg=.15, leg_y=.52, knee=.3, ankle=.12, clav_y=.93)
HERO = {'root_loc': (0, .08, 0), 'hips': (14, -8, 0), 'spine': (6, 0, 0), 'chest': (4, -6, 0), 'neck': (-10, 4, 0), 'head': (-12, 0, 4),
        'upperarm_L': (0, -40, 20), 'forearm_L': (0, -50, 0), 'upperarm_R': (0, 30, -30), 'forearm_R': (0, 50, 0),
        'thigh_L': (-70, 0, 4), 'shin_L': (80, 0, 0), 'foot_L': (-10, 0, 0), 'thigh_R': (25, 0, -4), 'shin_R': (35, 0, 0), 'foot_R': (10, 0, 0),
        'extra_tail_0': (15, 0, 0), 'extra_tail_1': (-15, 0, 0)}
HERO_VIEW = (-1, .04, .55)
PORTRAIT = {'pose': {**IDLE, 'head': (-6, -6, 0), 'neck': (-4, 0, 0)}, 'shoulders': .3, 'view': (-1, .08, .75)}

def head(m):
    skull = blob([('ell', (0, 1.36, -.03), (.2, .205, .2)), ('ell', (0, 1.36, .12), (.17, .15, .17)), ('ell', (0, 1.33, .29), (.2, .165, .2)),
                  ('ell', (.12, 1.3, .07), (.1, .09, .11)), ('ell', (-.12, 1.3, .07), (.1, .09, .11))], tris=2400, relax=3)
    face = Surf(skull); m.add(skull, 'primary', 'head', tag='head')
    jaw = blob([('ell', (0, 1.19, .12), (.175, .1, .21)), ('ell', (0, 1.2, .27), (.135, .07, .13)), ('ell', (.135, 1.225, .04), (.09, .085, .09)),
                ('ell', (-.135, 1.225, .04), (.09, .085, .09))], tris=1300, relax=2)
    m.add(jaw, 'light', 'head', tag='jaw')
    for s in (1, -1):  # mouth line tucked between snout and jaw, curling up into the cheek
        smile(m, face, [(s * .02, 1.215, .42), (s * .09, 1.22, .36), (s * .15, 1.24, .24), (s * .18, 1.28, .12), (s * .17, 1.31, .07)], .009, d=(0, .3, -1))
        m.add(sphere(face.hit((s * .055, 1.44, .3), (0, -.6, -1))[0], (.018, .014, .014), 10, 6), 'dark', 'head', tag='nostrils')
    for s in (1, -1):  # tall eyes sitting on top of the head, pupils looking ahead
        c = Vector((s * .078, 1.555, .1)); ball = sphere(c, (.078, .135, .07), 20, 14, rot=(-12, 0, s * -6)); es = Surf(ball)
        m.add(ball, 'eye-white', 'head', tag='eyes')
        m.add(stamp(es, (s * .07, 1.545, .2), [ellipse(.034, .07, 24)], .006, spin=s * 4), 'dark', 'head', tag='eyes')
        m.add(stamp(es, (s * .062, 1.575, .2), [ellipse(.012, .02, 12)], .003, lift=.006), 'eye-white', 'head', tag='eyes')
        m.add(blob([('ell', c + Vector((0, -.07, -.01)), (.082, .06, .075))], tris=300, relax=1), 'primary', 'head', tag='eyes')  # socket blend
    for i, (y, z, L) in enumerate(((1.49, -.15, .1), (1.38, -.215, .11), (1.26, -.21, .1))):  # red spines down the back of the head
        b = Vector((0, y, z)); d = Vector((0, .35 - i * .25, -1)).normalized()
        m.add(spike(b - d * .02, b + d * L * .5 + Vector((0, .02, 0)), b + d * L, .045, sq=(.55, 1), up=(1, 0, 0), n=7), 'hair', 'head', tag='spines')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest', 'neck'))
    body = blob([('ell', (0, .65, .02), (.285, .23, .26)), ('ell', (0, .8, .03), (.26, .2, .235)), ('ell', (0, .95, .0), (.2, .12, .17)),
                 ('cap', (0, .98, .01), (0, 1.2, .07), .13), ('ell', (0, .6, .07), (.24, .15, .21))], tris=2200, relax=2)
    def belly(p): return 1 - (p.x / .2) ** 2 - ((p.y - .74) / .33) ** 2 - max(0, (.02 - p.z) * 30)
    split_by(body, belly); m.add(body, lambda c, n: 'light' if belly(c) > 0 else 'primary', w, tag='body')
    # Saddle: a domed red shell with a thick white rim, hugging the upper back.
    sw = w(Vector((0, .86, -.2))); tilt = (-14, 0, 0)
    rim = blob([('ell', (0, .86, -.16), (.216, .18, .105), tilt)], tris=900, relax=2); cut(rim, (0, .86, -.12), (0, -.2, -1), keep='above')
    m.add(rim, 'light', sw, rigid=True, tag='saddle')
    dome = blob([('ell', (0, .865, -.19), (.2, .165, .122), tilt)], tris=1000, relax=2); cut(dome, (0, .87, -.15), (0, -.2, -1), keep='above')
    m.add(dome, 'secondary', sw, rigid=True, tag='saddle')
    pts = [(0, .64, -.2), (0, .52, -.42), (0, .42, -.62), (0, .38, -.78), (0, .42, -.9)]; wt = m.chain('tail', 'hips', pts)
    m.add(tube(spline(pts, 14), [.17, .16, .145, .13, .115, .1, .088, .076, .064, .052, .042, .033, .024, .012], 14, up=(1, 0, 0)), 'primary', wt, tag='tail')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(capsule(sh + Vector((-s * .04, 0, 0)), el, .075, .062, 14), 'primary', f'upperarm_{S}', tag='arms')
    m.add(capsule(el, wr, .062, .056, 14), 'primary', f'forearm_{S}', tag='arms')
    hand(m, s, S, wr + Vector((s * .01, 0, 0)), .075, 'primary', curl=.35, fingers=3, thumb=.9)
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(capsule(hp, kn, .15, .11, 16), 'primary', f'thigh_{S}', tag='legs')
    m.add(capsule(kn, an + Vector((0, .06, 0)), .11, .09, 16), 'primary', f'shin_{S}', tag='legs')
    shoe(m, s, S, an + Vector((0, 0, .03)), .38, .22, .21, 'accent', 'trim', sole=.04, toe=1.15, heel=.9, up=.02, tris=900)
    m.add(torus((an.x, .19, .01), (.1, .1), .025, 20, 6), 'accent', f'foot_{S}', tag='shoes')

def build():
    m = Model('yoshi', J, COLORS, COSTUMES, prop='none')
    head(m); torso(m); m.both(lambda s, S: limbs(m, s, S)); return m

main(globals())
