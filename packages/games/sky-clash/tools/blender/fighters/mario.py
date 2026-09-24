"""Mario (Melee): big-capped plumber, round nose and lobed moustache, red shirt under blue overalls with gold buttons,
white gloves, big brown shoes. Stocky: a large head, a round belly and short legs. The Cape rides the prop bone."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#e0282e', 'secondary': '#2f5fd0', 'accent': '#ffd23a', 'light': '#f7f5f0', 'skin': '#f6c49a', 'hair': '#4a2a18',
          'trim': '#7a4a26', 'dark': '#231a1c', 'eye': '#2f6fd8', 'eye-white': '#ffffff'}
COSTUMES = [('Wario Yellow', {'primary': '#f2c81c', 'secondary': '#7b3fb0', 'accent': '#39c26b'}),
            ('Black', {'primary': '#2c2a33', 'secondary': '#c7342f', 'accent': '#e6e6e6'}),
            ('Blue', {'primary': '#3aa0ff', 'secondary': '#e8e1d0', 'accent': '#ffd23a', 'trim': '#5b3b22'})]
J = humanoid(hip=.5, spine=.6, chest=.74, neck=.93, head=1.0, arm_y=.875, shoulder=.08, arm=.235, elbow=.44, wrist=.62,
             leg=.12, leg_y=.47, knee=.28, ankle=.11, clav_y=.86)

HERO = {'root_loc': (0, .05, 0), 'hips': (0, -14, 0), 'spine': (4, -6, 0), 'chest': (0, -8, 4), 'head': (-8, -12, -4),
        'shoulder_L': (0, 0, 8), 'upperarm_L': (0, -22, 42), 'forearm_L': (0, -30, 40), 'hand_L': (0, 0, 10),
        'upperarm_R': (0, 38, 52), 'forearm_R': (0, 75, 0), 'hand_R': (0, 0, 15),
        'thigh_L': (-58, 0, 6), 'shin_L': (78, 0, 0), 'foot_L': (-10, 0, 0), 'thigh_R': (8, 0, -6), 'shin_R': (22, 0, 0), 'foot_R': (10, 0, 0)}
HERO_PROP = False
PORTRAIT = {'pose': {**IDLE, 'head': (-4, -8, 0), 'chest': (0, -6, 0)}}

def head(m):
    skull = blob([('ell', (0, 1.245, .0), (.235, .235, .228)), ('ell', (0, 1.12, .06), (.185, .115, .165)), ('ell', (0, 1.19, .12), (.17, .1, .12)),
], tris=2100, relax=3)
    face = Surf(skull)
    m.add(sphere((0, 1.19, .262), (.1, .086, .09), 18, 12, rot=(-8, 0, 0)), 'skin', 'head', tag='nose')
    # Lobed moustache that hugs the upper lip, wider than the nose.
    lobes = [(0, 1.118, .262, .058), (.066, 1.112, .25, .057), (.126, 1.098, .222, .05), (.172, 1.084, .18, .04)]
    m.add(blob([('ell', mx(p[:3], s), (r * 1.15, r * .8, r * .8), (0, 0, s * -12 * i)) for i, p in enumerate(lobes) for s in ((1, -1) if p[0] else (1,)) for r in (p[3],)],
               tris=720, relax=1), 'hair', 'head', tag='moustache')
    smile(m, face, [(-.07, 1.05, .2), (-.03, 1.037, .2), (.03, 1.037, .2), (.07, 1.05, .2)], .0075)
    # Hair: back and sideburns under the cap.
    m.add(trim(blob([('ell', (0, 1.26, -.1), (.228, .13, .15)), ('ell', (0, 1.18, -.13), (.18, .08, .1))], tris=700, relax=1), under_cap, .03), 'hair', 'head', tag='hair')
    for s in (1, -1):  # sideburns: flush inlays in front of the ears, and a soft inner-ear fold
        m.add(stamp(face, (s * .2, 1.31, .085), [[(-.042, .085), (.032, .085), (.03, -.02), (.002, -.072), (-.038, -.035)]], .01, d=(-s, 0, -.25), spin=0), 'hair', 'head', tag='hair')
        ear = blob([('ell', (s * .232, 1.225, -.008), (.035, .078, .056), (0, s * -18, 0)), ('ell', (s * .24, 1.2, .01), (.03, .04, .04))], tris=320, relax=2)
        m.add(ear, 'skin', 'head', tag='ears'); m.add(sphere((s * .262, 1.23, 0), (.01, .045, .028), 8, 6, rot=(0, s * -18, 0)), 'skin', 'head', tag='ears')
    for s in (1, -1):
        eye(m, face, (s * .072, 1.28, 0), .047, .066, s, tilt=-4, iris=.66, pupil=.52, look=(-s * .15, .1), lid=(.1, -4), lash=.14,
            brow=dict(lift=.2, slant=-2, thick=.36, width=1.1, arch=.25, mat='hair', gap=.006))
    with m.transform(loc=(0, LIFT, 0)): cap(m)
    m.add(trim(skull, under_cap, .04), 'skin', 'head', tag='skull')

LIFT = .012  # the cap sits a touch high so the brows show under the brim
CAP = (Vector((0, 1.37 + LIFT, 0)), Vector((0, 1, -.22)).normalized())
def under_cap(p): return (v3(p) - CAP[0]).dot(CAP[1])

def cap(m):
    dome = blob([('ell', (0, 1.435, -.012), (.262, .215, .262)), ('ell', (0, 1.49, .06), (.21, .16, .2))], tris=1300, relax=1)
    cut(dome, CAP[0] - Vector((0, LIFT, 0)), CAP[1], keep='above'); surf = Surf(dome)
    m.add(dome, 'primary', 'head', tag='cap')
    brim = sphere((0, 1.405, .19), (.215, .03, .17), 24, 10, rot=(-10, 0, 0)); cut(brim, (0, 0, .03), (0, 0, 1), keep='above')
    m.add(brim, 'primary', 'head', tag='cap')
    m.add(stamp(surf, (0, 1.535, 0), [ellipse(.09, .082, 32)], .007, d=(0, -.3, -1)), 'light', 'head', tag='emblem')
    M = [(-.05, -.042), (-.05, .042), (-.026, .042), (0, .006), (.026, .042), (.05, .042), (.05, -.042), (.029, -.042), (.029, .005), (0, -.028), (-.029, .005), (-.029, -.042)]
    m.add(stamp(surf, (0, 1.535, 0), [M], .006, d=(0, -.3, -1), lift=.007), 'primary', 'head', tag='emblem')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, .52, 0), (.215, .13, .19)), ('ell', (0, .645, .03), (.24, .17, .215)), ('ell', (0, .79, 0), (.215, .13, .18)),
                 ('cap', (-.18, .865, -.01), (.18, .865, -.01), .095), ('ell', (0, .88, 0), (.16, .07, .13))], tris=1500, relax=1)
    def overalls(p):
        ax = abs(p.x); bib = min(.137 - ax, .83 - p.y, p.z - .02); strap = min(.032 - abs(ax - .105), p.y - .6)
        return max(.66 - p.y, bib, strap)
    shell = layer(body, overalls, .012, .013, relax=1, tris=1200); trim(body, lambda p: min(overalls(p), .63 - p.y)); m.add(body, 'primary', w, tag='shirt'); m.add(shell, 'secondary', w, tag='overalls')
    surf = Surf(shell)
    for s in (1, -1):
        p, n = surf.hit((s * .105, .795, 0))
        m.add(sphere(p + n * .004, (.032, .032, .014), 14, 8, rot=[math.degrees(a) for a in aim(n).to_euler()]), 'accent', w, rigid=True, tag='buttons')
    m.add(capsule((0, .9, -.01), (0, 1.07, 0), .095, .09, 16), 'skin', 'neck', tag='neck')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(capsule(sh, el, .088, .076, 16), 'primary', f'upperarm_{S}', tag='arms')
    m.add(capsule(el, wr, .076, .066, 16), 'primary', f'forearm_{S}', tag='arms')
    hand(m, s, S, wr + Vector((s * .02, 0, 0)), .075, 'light', curl=.4, cuff=(.07, .082))
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(capsule(hp, kn, .118, .1, 16), 'secondary', f'thigh_{S}', tag='legs')
    m.add(lathe(kn, (an.x, .1, 0), [(-.1, 0), (-.095, .04), (-.07, .085), (-.03, .1), (.06, .1), (.13, .108), (.16, .112), (.172, .1), (.175, 0)], 16), 'secondary', f'shin_{S}', tag='legs')
    shoe(m, s, S, an + Vector((0, 0, .02)), .31, .19, .15, 'trim', 'dark', sole=.03, toe=1.1, heel=.85, up=.01, tris=660)

def cape(m):
    """Cape (Side Special) gathered in the right fist and falling open below it; shown only by the move."""
    g = P(J, 'prop')
    def surf(u, v):
        a = (u - .5) * 2; k = v ** .8  # gathered at the fist, folds and a billow toward the curved hem
        return (g.x + a * (.035 + .24 * k), g.y - .03 - v * .52 * (1 - .14 * a * a), g.z + .03 - .14 * (1 - a * a) * k + .035 * math.sin(3.2 * math.pi * a) * k)
    m.add(sheet(surf, 16, 8, .012), 'accent', 'prop', tag='cape')

def build():
    m = Model('mario', J, COLORS, COSTUMES, prop='move')
    head(m); torso(m); m.both(lambda s, S: limbs(m, s, S)); cape(m); return m

main(globals())
