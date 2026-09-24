"""Mr. Game & Watch (Melee): the solid black LCD man. The renderer squashes him to 16% along X and shows him side-on,
so the profile carries him: a big round head with a bulb nose, a small chin, a pointed tuft at the back of the head,
a thin neck, a round pot belly, stick limbs with round mitten hands and oval shoes. The Chef's frying pan rides the
prop bone (move-only); like every LCD prop it is the same black as the body."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'dark': '#17151b'}
COSTUMES = [('Red', {'dark': '#5e1a20'}), ('Blue', {'dark': '#1b2a68'}), ('Green', {'dark': '#194b2b'})]
J = humanoid(hip=.62, spine=.74, chest=.9, neck=1.07, head=1.17, arm_y=1.0, shoulder=.06, arm=.15, elbow=.37, wrist=.58,
             leg=.085, leg_y=.6, knee=.33, ankle=.09, clav_y=.99)
IDLE = {'sym': {'upperarm': (0, -20, -55), 'forearm': (0, -50, 0), 'thigh': (0, 0, 2)}, 'head': (-4, 0, 0)}
HERO = {'root_loc': (0, .1, 0), 'hips': (4, 0, 0), 'chest': (-6, 0, 0), 'head': (-8, 0, 0),
        'upperarm_R': (0, 50, 60), 'forearm_R': (0, 90, 0), 'upperarm_L': (0, 40, -60), 'forearm_L': (0, -90, 0),
        'thigh_L': (-60, 0, 0), 'shin_L': (70, 0, 0), 'foot_L': (-10, 0, 0), 'thigh_R': (30, 0, 0), 'shin_R': (50, 0, 0), 'foot_R': (20, 0, 0)}
HERO_PROP = False
PORTRAIT = {'pose': {**IDLE, 'head': (-6, 0, 0)}, 'shoulders': .5}

def head(m):
    skull = blob([('ell', (0, 1.44, -.02), (.2, .26, .25)), ('ell', (0, 1.3, .12), (.14, .1, .14)), ('ell', (0, 1.25, .17), (.08, .06, .07))], tris=1800, relax=3)
    m.add(skull, 'dark', 'head', tag='head')
    m.add(sphere((0, 1.42, .275), (.07, .085, .09), 20, 14), 'dark', 'head', tag='nose')  # the bulb nose, clear in profile
    pts = [(0, 1.6, -.1), (0, 1.67, -.2), (0, 1.69, -.28), (0, 1.645, -.31)]  # pointed tuft sweeping back and curling down
    m.add(strand(pts, .06, .012, sq=(.7, 1), n=12, seg=12), 'dark', 'head', over=True, tag='tuft')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, .94, -.01), (.13, .12, .11)), ('ell', (0, .79, .04), (.155, .16, .175)), ('ell', (0, .66, .0), (.12, .08, .12))], tris=1500, relax=2)
    m.add(body, 'dark', w, tag='body')
    m.add(capsule((0, .98, -.01), (0, 1.2, .0), .05, .045, 12), 'dark', m.spine(('chest', 'neck')), tag='neck')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(capsule(sh - Vector((s * .05, 0, 0)), el, .038, .033, 12), 'dark', f'upperarm_{S}', tag='arms')
    m.add(capsule(el, wr, .033, .03, 12), 'dark', f'forearm_{S}', tag='arms')
    m.add(blob([('ell', wr + Vector((s * .06, 0, 0)), (.065, .055, .06)), ('ell', wr + Vector((s * .06, .01, .05)), (.028, .026, .03))], tris=500, relax=2), 'dark', f'hand_{S}', tag='hands')
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(capsule(hp, kn, .045, .038, 12), 'dark', f'thigh_{S}', tag='legs')
    m.add(capsule(kn, an, .038, .035, 12), 'dark', f'shin_{S}', tag='legs')
    foot = blob([('ell', (an.x, .06, an.z + .06), (.06, .06, .12)), ('ell', (an.x, .07, an.z - .02), (.05, .05, .06))], tris=500, relax=2)
    cut(foot, (0, 0, 0), (0, 1, 0), keep='above'); m.add(foot, 'dark', f'foot_{S}', tag='feet')

def pan(m):
    """Chef's frying pan: handle out of the thumb side of the fist (+Z), the flat pan at the far end facing sideways (X)
    so it reads in profile."""
    g = P(J, 'prop')
    m.add(capsule(g - Vector((0, 0, .06)), g + Vector((0, 0, .2)), .02, .018, 10), 'dark', 'prop', tag='pan')
    c = g + Vector((0, .01, .36)); M = Matrix.Translation(c) @ rot4((0, 90, 0))
    m.add(slab([ellipse(.16, .15, 32)], .03, M, bevel=.008), 'dark', 'prop', tag='pan')
    m.add(torus(c, .155, .015, 32, 6, rot=(0, 0, 90)), 'dark', 'prop', tag='pan')

def build():
    m = Model('game-watch', J, COLORS, COSTUMES, prop='move')
    head(m); torso(m); m.both(lambda s, S: limbs(m, s, S)); pan(m); return m

main(globals())
