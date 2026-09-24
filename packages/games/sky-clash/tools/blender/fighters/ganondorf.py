"""Ganondorf (Melee, the Ocarina of Time King of Evil): a towering brute with dark olive skin, swept-back flaming red
hair and sideburns, heavy red brows over narrow gold eyes, a hooked nose and a hard scowl; a gold circlet with a pale
jewel. Black plate armor with gold trim and big rounded pauldrons, a long dark cape, a wide leather belt with a gold
jewelled buckle, a waist cloth, heavy gauntlets and boots. Fists only: no prop."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._captain_falcon_helpers import *
from fighters.marth import scalp

COLORS = {'primary': '#2a2630', 'secondary': '#3b2a2c', 'accent': '#cf9d3e', 'trim': '#4a3226', 'hair': '#cf3f26', 'skin': '#7a6b4c', 'light': '#bfe6f2',
          'dark': '#1a1418', 'eye': '#f0b21e', 'eye-white': '#fff4d8'}
COSTUMES = [('Red', {'primary': '#6a1c20', 'secondary': '#2a1a1c'}), ('Blue', {'primary': '#23305e', 'secondary': '#1a2040', 'accent': '#d8d0b8'}),
            ('Purple', {'primary': '#4a2a60', 'secondary': '#26183a'})]
J = humanoid(hip=1.1, spine=1.24, chest=1.45, neck=1.7, head=1.78, arm_y=1.61, shoulder=.09, arm=.31, elbow=.6, wrist=.86,
             leg=.135, leg_y=1.05, knee=.58, ankle=.1, clav_y=1.58)
HC = Vector((0, 1.94, .03))

HERO = {'root_loc': (0, -.12, 0), 'hips': (0, 14, 0), 'spine': (10, 10, 0), 'chest': (8, 14, 0), 'head': (-6, -22, 0),
        'upperarm_R': (0, -55, 50), 'forearm_R': (0, 110, 0), 'hand_R': (0, 0, 0),
        'upperarm_L': (0, -75, -15), 'forearm_L': (0, -25, 0), 'hand_L': (0, 0, 10),
        'thigh_L': (-55, 0, 12), 'shin_L': (55, 0, 0), 'foot_L': (0, 0, 0), 'thigh_R': (30, 0, -12), 'shin_R': (20, 0, 0), 'foot_R': (18, 0, 0),
        'extra_cape_0': (12, 0, 5), 'extra_cape_1': (8, 0, 3), 'extra_cape_2': (8, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'sym': {'upperarm': (0, 0, -80), 'forearm': (0, -10, 0)}, 'head': (-4, -14, 0)}, 'shoulders': .32}
IDLE = {**IDLE, 'sym': {**IDLE['sym'], 'upperarm': (0, -10, -64)}}

def head(m):
    c = HC; o = lambda x, y, z: c + Vector((x, y, z))
    skull, face = human_head(m, c, (.13, .15, .14), jaw=1.12, chin=1.2, nose=(.03, .058), nose_y=-.04, ears='elf', ear_len=.075, tris=1380, cheeks=1.05,
                             mouth=[(-.042, -.108), (-.015, -.1), (.015, -.1), (.042, -.108)],
                             eyes=dict(x=.052, y=.0, w=.032, h=.026, tilt=12, iris=.72, pupil=.4, look=(0, .1), lid=(.32, 20), lash=.22, lid_mat='skin',
                                       brow=dict(lift=.28, slant=26, thick=.46, width=1.15, arch=0, mat='hair', gap=.008)))
    keep = scalp(m, skull, c, .085, -.12, .026, tris=420); trim(skull, keep, .05); m.add(skull, 'skin', 'head', tag='face')
    m.add(blob([('cap', o(0, .01, .13), o(0, .02, .145), .02)], tris=120, relax=1), 'skin', 'head', tag='brow')  # heavy brow ridge
    for s in (1, -1):  # sideburns down to the jaw
        m.add(stamp(face, o(s * .12, -.04, .02), [[(-.03, .07), (.03, .07), (.022, -.04), (0, -.09), (-.025, -.03)]], .012, d=(-s, 0, -.2)), 'hair', 'head', tag='hair')
    # Swept-back flaming hair: thick spikes rising from the hairline and curling back over the crown.
    for x, h, r in ((0, .12, .055), (.055, .1, .05), (-.055, .1, .05), (.1, .06, .045), (-.1, .06, .045), (0, .02, .05), (.06, -.02, .045), (-.06, -.02, .045)):
        base = o(x * .8, .09 + h * .2, .06 - (.12 - h) * .6); m.add(spike(base, o(x * 1.1, .14 + h * .5, -.02 - (.12 - h) * .5), o(x * 1.15, .1 + h * .6, -.2 - (.12 - h) * .4), r, sq=(1, .7), n=6, seg=7), 'hair', 'head', tag='hair')
    # Gold circlet with a pale jewel in the middle of the brow.
    m.add(torus(o(0, .065, -.01), (.143, .15), .011, 24, 5, rot=(-14, 0, 0), sq=(.7, 1.5)), 'accent', 'head', tag='circlet')
    p, n = Surf(skull).hit(o(0, .085, 0)); p = p + n * .03
    m.add(slab([[(0, .036), (.03, .008), (.024, -.02), (0, -.03), (-.024, -.02), (-.03, .008)]], .012, Matrix.Translation(p) @ aim(n).to_4x4()), 'accent', 'head', tag='circlet')
    m.add(sphere(p + n * .008, (.014, .016, .008), 10, 6), 'light', 'head', tag='circlet')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, 1.1, 0), (.2, .12, .15)), ('ell', (0, 1.26, .02), (.21, .13, .16)), ('box', (0, 1.47, 0), (.29, .15, .17), .11), ('ell', (.13, 1.5, .08), (.14, .1, .09)), ('ell', (-.13, 1.5, .08), (.14, .1, .09)),
                 ('cap', (-.3, 1.59, -.01), (.3, 1.59, -.01), .12), ('ell', (0, 1.67, -.03), (.2, .08, .12))], tris=1250, relax=2)
    lo = 1.34
    def plate(p): return min(p.y - lo, p.z + .04)
    bp = layer(body, plate, .014, .02, relax=1, tris=380); split_by(bp, lambda p: p.y - lo - .03)
    m.add(bp, lambda c, n: 'accent' if c.y < lo + .03 else 'primary', w, tag='armor')
    trim(body, lambda p: plate(p) - .01, .01); m.add(body, 'primary', w, tag='body')
    surf = Surf(bp)
    m.add(stamp(surf, (0, 1.47, 0), [ellipse(.075, .07, 28), ellipse(.045, .042, 20)], .008), 'accent', w, rigid=True, tag='emblem')  # gold medallion
    m.add(stamp(surf, (0, 1.47, 0), [[(0, .04), (.028, 0), (0, -.04), (-.028, 0)]], .012), 'light', w, rigid=True, tag='emblem')
    m.add(capsule((0, 1.6, -.01), (0, 1.84, 0), .082, .078, 14), 'skin', 'neck', tag='neck')
    m.add(lathe((0, 1.6, -.02), (0, 1.74, -.01), [(0, 0), (0, .135), (.02, .14), (.1, .1), (.14, .092), (.141, 0)], 20, sq=(1, .88)), 'primary', m.spine(('chest', 'neck')), tag='collar')
    for s, S in ((1, 'L'), (-1, 'R')):  # big rounded pauldrons with a gold rim
        c = Vector((s * .34, 1.665, 0)); R = (.17, .105, .175); g = sphere(c, R, 16, 9, rot=(0, 0, s * -20)); cut(g, c - Vector((0, R[1] * .25, 0)), (s * .36, 1, 0), keep='above')
        bmesh.ops.solidify(g, geom=list(g.faces), thickness=.014); m.add(g, 'primary', f'shoulder_{S}', tag='pauldrons')
        m.add(torus(c - Vector((0, R[1] * .22, 0)), (R[0] * .95, R[2] * .95), .014, 20, 5, rot=(0, 0, s * -20)), 'accent', f'shoulder_{S}', tag='pauldrons')
    # Wide belt, jewelled buckle and a split waist cloth.
    m.add(torus((0, 1.12, .005), (.205, .158), .04, 24, 5, sq=(.5, 1.3)), 'trim', w, tag='belt')
    m.add(rbox((0, 1.12, .16), (.13, .1, .03), .02), 'accent', 'hips', tag='buckle')
    m.add(sphere((0, 1.12, .178), (.028, .03, .014), 12, 8), 'light', 'hips', tag='buckle')
    def cloth_w(p):
        t = smooth01((1.1 - p.y) / .35) * .55; side = smooth01((p.x + .18) / .36); return {'hips': 1 - t, 'thigh_L': t * side, 'thigh_R': t * (1 - side)}
    sk = lathe((0, 1.1, 0), (0, .66, 0), [(0, .2), (.12, .215), (.3, .25), (.44, .27)], 30, sq=(1, .8))
    bmesh.ops.delete(sk, geom=[f for f in sk.faces if abs(f.normal.y) > .95 or (abs(f.calc_center_median().z) < .07 and f.calc_center_median().y < .98)], context='FACES')
    split_by(sk, lambda p: p.y - .71); bmesh.ops.solidify(sk, geom=list(sk.faces), thickness=.014)
    m.add(sk, lambda c, n: 'accent' if c.y < .71 else 'secondary', cloth_w, tag='cloth')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(blob([('cap', sh, el, .11), ('ell', lerp(sh, el, .45) + Vector((0, 0, .02)), (.14, .1, .1))], tris=380, relax=2), 'primary', f'upperarm_{S}', tag='arms')
    m.add(capsule(el, wr, .092, .076, 14), 'primary', f'forearm_{S}', tag='arms')
    m.add(lathe(lerp(el, wr, .25), wr + Vector((s * .005, 0, 0)), [(0, 0), (0, .09), (.02, .096), (.14, .092), (.19, .1), (.2, .085), (.201, 0)], 16), 'trim', f'forearm_{S}', tag='gauntlets')
    m.add(torus(lerp(el, wr, .25) + Vector((s * .012, 0, 0)), .094, .012, 18, 4, rot=(0, 0, 90)), 'accent', f'forearm_{S}', tag='gauntlets')
    hand(m, s, S, wr + Vector((s * .01, 0, 0)), .092, 'trim', fist=True, tris=460)
    hp, kn = P(J, f'thigh_{S}'), P(J, f'shin_{S}')
    m.add(capsule(lerp(hp, kn, .15), kn, .125, .095, 12), 'primary', f'thigh_{S}', tag='legs')
    m.add(capsule(kn, kn + Vector((0, -.12, 0)), .094, .088, 12), 'primary', f'shin_{S}', tag='legs')
    boot(m, s, S, J, .5, .105, .08, 'trim', 'dark', L=.34, wd=.19, ht=.16, cuff=.02, cuff_mat='accent', tris=380)

def build():
    m = Model('ganondorf', J, COLORS, COSTUMES, prop='none')
    with m.transform((0, 1.72, 0), 1.06): head(m)
    torso(m); m.both(lambda s, S: limbs(m, s, S))
    cape(m, 'cape', 'chest', 1.65, -.17, .62, 1.42, ('secondary', 'secondary'), n=3, flare=1.5, back=-.16, curve=.12)
    return m

main(globals())
