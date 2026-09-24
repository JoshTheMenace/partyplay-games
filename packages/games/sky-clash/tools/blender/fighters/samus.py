"""Samus Aran (Melee, Varia Suit): red-orange helmet with a glowing green visor set in a raised rim, cheek guards and a
brow ridge; huge layered spherical pauldrons in orange-yellow with red bands; red chest armor over a dark segmented
undersuit; armored thighs, round knee caps, bulky red shins and boots. The arm cannon is her whole right forearm and
hand (weighted to forearm_R/hand_R); only its short muzzle rides the prop bone, so the muzzle is the business end."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._captain_falcon_helpers import *

COLORS = {'primary': '#d8431f', 'secondary': '#f2a51e', 'metal': '#5b606e', 'emissive': '#48dc8a', 'accent': '#ffd84a', 'dark': '#1c1a22', 'light': '#f4f0e0'}
COSTUMES = [('Pink', {'primary': '#e0558f', 'secondary': '#f7bfd8', 'accent': '#ffffff'}), ('Dark', {'primary': '#2c2a36', 'secondary': '#6c3aa0', 'emissive': '#ff5a5a', 'accent': '#b88aff'}),
            ('Green', {'primary': '#2f8a44', 'secondary': '#b8e05a', 'metal': '#4a5048'})]
J = humanoid(hip=1.06, spine=1.18, chest=1.36, neck=1.6, head=1.68, arm_y=1.52, shoulder=.08, arm=.25, elbow=.52, wrist=.76,
             leg=.12, leg_y=1.0, knee=.56, ankle=.1, clav_y=1.5, grip=(-.99, 1.52, 0))
HC = Vector((0, 1.79, .025))

HERO = {'root_loc': (0, -.1, 0), 'hips': (0, -30, 0), 'spine': (6, -12, 0), 'chest': (4, -14, 0), 'head': (-6, 26, 0),
        'upperarm_R': (0, 80, 8), 'forearm_R': (0, 5, 0), 'hand_R': (0, 0, 0),
        'upperarm_L': (0, -20, -65), 'forearm_L': (0, -60, 0), 'hand_L': (0, 0, 0),
        'thigh_L': (-50, 0, 12), 'shin_L': (55, 0, 0), 'foot_L': (-5, 0, 0), 'thigh_R': (25, 0, -14), 'shin_R': (25, 0, 0), 'foot_R': (15, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'sym': {'upperarm': (0, 0, -82), 'forearm': (0, -10, 0)}, 'head': (-4, -14, 0)}, 'shoulders': .34}

def helmet(m):
    c = HC; o = lambda x, y, z: c + Vector((x, y, z))
    def shape(p):  # a smooth dome that narrows into a jaw guard below the visor
        q = p - c; k = smooth01((-q.y - .02) / .13); return c + Vector((q.x * (1 - .28 * k), q.y, q.z * (1 - .1 * k) + .03 * k * max(0, q.z) / .16))
    hel = bend(sphere(c, (.142, .152, .158), 36, 24), shape)
    def visor(p): q = p - c; return min(q.z - .05, .05 - q.y - .8 * q.x * q.x, q.y + .055 - .5 * abs(q.x), .105 - abs(q.x))
    m.add(layer(hel, lambda p: -visor(p), 0, .016, relax=1), 'primary', 'head', tag='helmet')
    m.add(layer(hel, visor, -.012, .01, relax=1), 'emissive', 'head', tag='visor')
    hs = Surf(hel)
    for s in (1, -1):  # side pods and cheek vents
        m.add(cyl(o(s * .125, -.01, -.02), o(s * .158, -.01, -.02), .052, .044, seg=20, bevel=.012, up=(0, 1, 0)), 'primary', 'head', tag='helmet')
        m.add(sphere(o(s * .16, -.01, -.02), (.01, .032, .032), 12, 8), 'secondary', 'head', tag='helmet')
        for k in range(3): m.add(stamp(hs, o(s * .1, -.085 - k * .022, .1), [[(-.018, .006), (.018, .006), (.018, -.006), (-.018, -.006)]], .006, d=(-s * .4, 0, -1)), 'metal', 'head', tag='helmet')
    m.add(lathe((0, 1.58, -.01), (0, 1.68, 0), [(0, 0), (0, .115), (.03, .12), (.07, .1), (.1, .09), (.101, 0)], 20), 'metal', m.spine(('chest', 'neck')), tag='neck')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, 1.05, 0), (.17, .1, .13)), ('ell', (0, 1.19, 0), (.135, .1, .105)), ('box', (0, 1.39, .01), (.21, .13, .145), .09),
                 ('cap', (-.22, 1.5, -.01), (.22, 1.5, -.01), .09), ('ell', (0, 1.54, -.03), (.15, .06, .1))], tris=1500, relax=2)
    def chest(p): return p.y - 1.28
    def hips(p): return 1.1 - p.y
    for k, (fn, mat) in enumerate(((chest, 'primary'), (hips, 'primary'))):
        g = layer(body, fn, .014, .018, relax=1, tris=500); split_by(g, (lambda p: p.y - 1.3) if k == 0 else (lambda p: p.y - .98))
        m.add(g, (lambda c, n: 'accent' if c.y < 1.3 else 'primary') if k == 0 else (lambda c, n: 'secondary' if c.y < .98 else 'primary'), w, tag='armor')
    trim(body, lambda p: max(chest(p), hips(p)), .02); m.add(body, 'metal', w, tag='undersuit')
    for y in (1.16, 1.21): m.add(torus((0, y, .0), (.14, .11), .012, 22, 5, sq=(.6, 1)), 'metal', w, tag='undersuit')
    for s, S in ((1, 'L'), (-1, 'R')):  # big layered pauldrons
        for k, (c, R) in enumerate((((s * .29, 1.56, -.01), (.15, .14, .155)), ((s * .33, 1.47, -.005), (.115, .09, .12)))):
            g = sphere(c, R, 20, 12, rot=(0, 0, s * -15)); cut(g, v3(c) - Vector((0, R[1] * (.2 if k == 0 else .4), 0)), (s * .25, 1, 0), keep='above')
            if k == 0: m.add(g, 'secondary', f'shoulder_{S}', tag='pauldrons')
            else: bmesh.ops.solidify(g, geom=list(g.faces), thickness=.01); m.add(g, 'secondary', f'upperarm_{S}', tag='pauldrons')
        m.add(torus((s * .29, 1.56 - .14 * .1, -.01), (.152, .157), .014, 24, 5, rot=(0, 0, s * -15), sq=(.8, 1.4)), 'primary', f'shoulder_{S}', tag='pauldrons')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(capsule(sh, el, .075, .068, 14), 'metal', f'upperarm_{S}', tag='arms')
    m.add(lathe(lerp(sh, el, .3), lerp(sh, el, .92), [(0, 0), (0, .07), (.02, .085), (.13, .088), (.17, .08), (.171, 0)], 16), 'secondary', f'upperarm_{S}', tag='arms')
    m.add(sphere(el, .07, 14, 9), 'metal', f'forearm_{S}', tag='arms')
    if s > 0:  # left: armored gauntlet and fist
        m.add(lathe(el + Vector((.02, 0, 0)), wr, [(0, 0), (0, .075), (.03, .09), (.12, .092), (.2, .082), (.23, .07), (.231, 0)], 18), 'primary', 'forearm_L', tag='arms')
        m.add(torus(lerp(el, wr, .25), .092, .011, 18, 4, rot=(0, 0, 90)), 'secondary', 'forearm_L', tag='arms')
        hand(m, s, S, wr, .07, 'primary', fist=True, tris=460)
    else:  # right: the arm cannon (forearm + hand), muzzle on the prop bone
        a, g = el - Vector((.02, 0, 0)), P(J, 'prop'); L = (a - g).length
        L1 = a.x - wr.x  # the body (forearm_R) ends in a collar at the wrist; the barrel (hand_R) pivots inside it
        m.add(lathe(a, wr - Vector((.02, 0, 0)), [(0, 0), (0, .095), (.03, .115), (.12, .125), (.2, .12), (L1 - .02, .114), (L1 + .02, .114), (L1 + .021, 0)], 22), 'primary', 'forearm_R', tag='cannon')
        m.add(lathe(wr + Vector((.04, 0, 0)), g, [(0, 0), (0, .1), (.06, .104), (.12, .1), (L - L1 - .06, .096), (L - L1 - .05, 0)], 22), 'primary', 'hand_R', tag='cannon')
        for x, r in ((a.x - .1, .128), (wr.x + .01, .12), (g.x + .1, .1)): m.add(torus((x, wr.y, 0), r, .012, 22, 5, rot=(0, 0, 90)), 'secondary', 'forearm_R' if x > wr.x else 'hand_R', tag='cannon')
        m.add(lathe(g - Vector((-.02, 0, 0)), g - Vector((.04, 0, 0)), [(0, .098), (.01, .1), (.05, .098), (.06, .075), (.061, 0)], 22), 'metal', 'prop', tag='cannon')
        m.add(cyl(g - Vector((.035, 0, 0)), g - Vector((.045, 0, 0)), .06, seg=18), 'dark', 'prop', tag='cannon')
    hp, kn = P(J, f'thigh_{S}'), P(J, f'shin_{S}')
    m.add(blob([('cap', lerp(hp, kn, .1), kn, .105), ('ell', lerp(hp, kn, .4) + Vector((0, 0, .01)), (.125, .17, .125))], tris=520, relax=2), 'secondary', f'thigh_{S}', tag='legs')
    m.add(sphere(kn + Vector((0, 0, .072)), (.074, .08, .05), 14, 9), 'primary', f'shin_{S}', tag='knees')
    m.add(lathe(kn + Vector((0, .05, 0)), (kn.x, .12, 0), [(0, 0), (0, .09), (.015, .11), (.07, .114), (.17, .1), (.3, .098), (.38, .09), (.45, .095), (.48, .09), (.49, 0)], 18, sq=(1, 1.1)), 'primary', f'shin_{S}', tag='shins')
    m.add(torus((kn.x, .44, 0), (.1, .108), .012, 18, 4), 'secondary', f'shin_{S}', tag='shins')
    shoe(m, s, S, P(J, f'foot_{S}') + Vector((0, 0, .02)), .32, .19, .16, 'primary', 'metal', sole=.035, toe=1.0, heel=1.0, up=.01, tris=520)

def build():
    m = Model('samus', J, COLORS, COSTUMES, prop='always')
    helmet(m); torso(m); m.both(lambda s, S: limbs(m, s, S)); return m

main(globals())
