"""Kirby (Melee): a soft pink ball with stubby arms, big red feet, tall glossy eyes, blush and a small open smile.
Every contract bone sits inside the ball: the spine chain blends the body like a soft toy, the arms are nubs, the legs
are short stubs under the feet. The Hammer (Side Special) rides the prop bone and is shown only by moves."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#ffa3c6', 'secondary': '#e2264c', 'accent': '#ff6f9c', 'dark': '#1d1630', 'eye': '#2f6ff0', 'eye-white': '#ffffff',
          'trim': '#b9824a', 'metal': '#c9ced8', 'hair': '#7c1d2c'}
COSTUMES = [('Yellow', {'primary': '#ffe066', 'secondary': '#f07a22', 'accent': '#ffb347'}),
            ('Blue', {'primary': '#8fb6ff', 'secondary': '#2a45b8', 'accent': '#c89cff'}),
            ('White', {'primary': '#f4f1ea', 'secondary': '#4a6fd8', 'accent': '#ffb6c9'})]
J = skeleton({'root': (0, 0, 0), 'hips': (0, .25, 0), 'spine': (0, .36, 0), 'chest': (0, .46, 0), 'neck': (0, .54, 0), 'head': (0, .58, 0),
              'shoulder_L': (.16, .5, 0), 'upperarm_L': (.33, .5, 0), 'forearm_L': (.43, .49, 0), 'hand_L': (.51, .48, 0),
              'shoulder_R': (-.16, .5, 0), 'upperarm_R': (-.33, .5, 0), 'forearm_R': (-.43, .49, 0), 'hand_R': (-.51, .48, 0), 'prop': (-.56, .47, 0),
              'thigh_L': (.16, .22, 0), 'shin_L': (.17, .15, .02), 'foot_L': (.17, .08, .03),
              'thigh_R': (-.16, .22, 0), 'shin_R': (-.17, .15, .02), 'foot_R': (-.17, .08, .03)})
BODY = ((0, .565, 0), (.475, .46, .455))
IDLE = {'sym': {'upperarm': (0, -10, -35), 'forearm': (0, -10, -10), 'thigh': (0, 0, 4), 'foot': (0, 0, -4)}, 'head': (-3, 0, 0)}
HERO = {'root_loc': (0, .08, 0), 'hips': (0, -18, 0), 'chest': (-6, 0, 4), 'head': (-10, -12, 6),
        'upperarm_L': (0, -10, 55), 'forearm_L': (0, 0, 20), 'upperarm_R': (0, 20, -70), 'forearm_R': (0, 0, -20), 'hand_R': (60, 0, 0),
        'thigh_L': (-50, 0, 10), 'shin_L': (30, 0, 0), 'foot_L': (-20, 0, 0), 'thigh_R': (35, 0, -15), 'shin_R': (20, 0, 0), 'foot_R': (30, 0, 0)}
HERO_PROP = False  # the hammer is a move prop: the select-screen Kirby is empty-handed, like the game's idle
PORTRAIT = {'pose': {**IDLE, 'head': (-6, -10, 0)}, 'shoulders': 1.4, 'fill': .9}  # Kirby's head is his whole body

def body(m):
    w = m.spine(('hips', 'spine', 'chest', 'neck', 'head'), spans=[(.15, .5), (.25, .65), (.35, .8), (.42, .98)])
    c, r = v3(BODY[0]), BODY[1]  # a true ellipsoid (perfectly clean toon bands), slightly fuller toward the base
    ball = bend(sphere(c, r, 48, 30), lambda p: Vector((p.x * (1 + .05 * smooth01((c.y - p.y) / r[1] + .3)), p.y, p.z * (1 + .05 * smooth01((c.y - p.y) / r[1] + .3)))))
    face = Surf(ball)
    m.add(ball, 'primary', w, tag='body')
    for s in (1, -1):
        c = (s * .105, .66, 0)  # tall glossy eye: navy base, blue lower glow, white shine
        m.add(stamp(face, c, [ellipse(.056, .112, 32)], .008, spin=s * -3), 'dark', w, tag='eyes')
        m.add(stamp(face, c, [ellipse(.04, .05, 24, (0, -.052))], .005, lift=.008, spin=s * -3), 'eye', w, tag='eyes')
        m.add(stamp(face, c, [ellipse(.03, .044, 24, (-s * .004, .048))], .005, lift=.008, spin=s * -3), 'eye-white', w, tag='eyes')
        m.add(stamp(face, (s * .235, .545, 0), [ellipse(.068, .034, 24)], .005, d=(-s * .35, 0, -1)), 'accent', w, tag='blush')
    mouth = [(-.042, .02), (-.03, -.012), (-.012, -.03), (.012, -.03), (.03, -.012), (.042, .02), (0, .012)]
    m.add(stamp(face, (0, .525, 0), [mouth], .006), 'dark', w, tag='mouth')
    m.add(stamp(face, (0, .525, 0), [ellipse(.02, .011, 16, (0, -.015))], .004, lift=.006), 'hair', w, tag='mouth')

def limbs(m, s, S):
    arm = blob([('ell', (s * .5, .49, .01), (.145, .115, .125), (0, 0, s * -16)), ('ell', (s * .38, .51, 0), (.1, .1, .11))], tris=700, relax=2)
    m.add(arm, 'primary', m.env([f'upperarm_{S}', f'forearm_{S}', f'hand_{S}'], .07), tag='arms')
    foot = blob([('ell', (s * .17, .085, .05), (.155, .1, .235), (0, s * -8, 0)), ('ell', (s * .17, .12, -.03), (.12, .08, .14))], tris=900, relax=2)
    cut(foot, (0, .0, 0), (0, 1, 0), keep='above'); m.add(foot, 'secondary', f'foot_{S}', tag='feet')

def hammer(m):
    g = P(J, 'prop')  # handle runs through the fist along +Z; the mallet head sits at the far end
    m.add(cyl(g - Vector((0, 0, .1)), g + Vector((0, 0, .52)), .028, seg=12, bevel=.01), 'trim', 'prop', tag='hammer')
    head = g + Vector((0, 0, .6))
    m.add(cyl(head - Vector((.17, 0, 0)), head + Vector((.17, 0, 0)), .12, seg=20, bevel=.03, up=(0, 1, 0)), 'trim', 'prop', tag='hammer')
    for x in (-.13, .13): m.add(torus(head + Vector((x, 0, 0)), .122, .016, 20, 6, rot=(0, 0, 90)), 'metal', 'prop', tag='hammer')

def build():
    m = Model('kirby', J, COLORS, COSTUMES, prop='move')
    body(m); m.both(lambda s, S: limbs(m, s, S)); hammer(m); return m

main(globals())
