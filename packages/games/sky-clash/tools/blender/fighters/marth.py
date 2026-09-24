"""Marth (Melee): slender prince with blue hair to the collar, a gold tiara with a pointed brow piece and calm blue eyes;
navy tunic with side-slit skirt, silver breastplate with gold hem and round pauldrons, long blue cape with a red lining,
pale tights and gloves, navy knee boots. The Falchion (slim silver blade, gold hand guard) rides the prop bone in his
right hand. The lord builders here are shared with Roy."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._captain_falcon_helpers import *

COLORS = {'primary': '#26357a', 'secondary': '#c7303a', 'light': '#e9e8f0', 'metal': '#c9cfdc', 'accent': '#f0c040', 'hair': '#2f4fae', 'trim': '#1d2350',
          'skin': '#f7d2b0', 'dark': '#221a22', 'eye': '#2f5fc8', 'eye-white': '#ffffff'}
COSTUMES = [('Red', {'primary': '#962a30', 'secondary': '#2d3b8a', 'trim': '#4a1418'}), ('Green', {'primary': '#2c6a42', 'secondary': '#e2c060', 'trim': '#173a24'}),
            ('Black', {'primary': '#26242e', 'secondary': '#7a2fa0', 'trim': '#141318', 'light': '#b8b6c4'})]
J = humanoid(hip=1.06, spine=1.19, chest=1.38, neck=1.6, head=1.68, arm_y=1.54, shoulder=.07, arm=.205, elbow=.48, wrist=.72,
             leg=.1, leg_y=1.02, knee=.56, ankle=.09, clav_y=1.52, grip=(-.72 - .066 * 1.25, 1.54 - .066 * .45, 0))
HC = Vector((0, 1.805, .015)); HU = .066

HERO = {'root_loc': (0, -.1, 0), 'hips': (0, -20, 0), 'spine': (6, -10, 0), 'chest': (4, -10, 0), 'head': (-4, 16, 0),
        'upperarm_R': (0, 30, 20), 'forearm_R': (0, 20, 0), 'hand_R': (0, -40, -20),
        'upperarm_L': (0, 30, -70), 'forearm_L': (0, -30, 0), 'hand_L': (0, 0, 10),
        'thigh_L': (-48, 0, 12), 'shin_L': (50, 0, 0), 'foot_L': (-5, 0, 0), 'thigh_R': (26, 0, -14), 'shin_R': (22, 0, 0), 'foot_R': (15, 0, 0),
        'extra_cape_0': (22, 0, 8), 'extra_cape_1': (10, 0, 4), 'extra_cape_2': (8, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'sym': {'upperarm': (0, 0, -82), 'forearm': (0, -10, 0)}, 'head': (-4, -14, 0)}, 'shoulders': .34}

def scalp(m, skull, c, front=.075, back=-.13, inflate=.022, mat='hair', tris=440):
    """Hair shell over the cranium: the hairline runs from `front` (above the brow) down to `back` (the nape)."""
    rz = 1 / .13
    def keep(p): q = p - c; return q.y - (back + (front - back) * smooth01((q.z * rz + 1) / 2))
    m.add(layer(skull, keep, inflate, .012, relax=2, tris=tris), mat, 'head', tag='hair'); return keep

def lord_torso(m, T):
    """Tunic, breastplate with a gold hem, belt and side-slit skirt. T: dict of heights and radii."""
    w = m.spine(('hips', 'spine', 'chest')); y0, y1 = T['hip'], T['chest']
    body = blob([('ell', (0, y0, 0), (T['w'] * .9, .09, T['d'] * .9)), ('ell', (0, (y0 + y1) / 2, 0), (T['w'] * .82, .1, T['d'] * .85)),
                 ('box', (0, y1 + .01, 0), (T['w'] * 1.08, .12, T['d'] * .92), .075), ('cap', (-T['sh'], T['arm_y'] - .03, -.01), (T['sh'], T['arm_y'] - .03, -.01), .072),
                 ('ell', (0, T['arm_y'], -.03), (T['w'] * .8, .06, T['d'] * .7))], tris=1150, relax=2)
    lo = T['plate']
    def plate(p): return min(p.y - lo, T['arm_y'] + .02 - p.y + .2 * max(0, abs(p.x) - .08), p.z + .03)
    bp = layer(body, plate, .012, .016, relax=1, tris=420); split_by(bp, lambda p: p.y - lo - .025)
    m.add(bp, lambda c, n: 'accent' if c.y < lo + .025 else 'metal', w, tag='breastplate')
    trim(body, lambda p: min(plate(p), p.y - lo - .01), .01); m.add(body, 'primary', w, tag='tunic')
    m.add(capsule((0, T['arm_y'] - .1, -.01), (0, T['arm_y'] + .14, 0), .055, .052, 14), 'skin', 'neck', tag='neck')
    m.add(lathe((0, T['arm_y'] - .06, -.01), (0, T['arm_y'] + .06, -.005), [(0, 0), (0, .095), (.02, .1), (.08, .07), (.14, .064), (.145, .058), (.146, 0)], 18, sq=(1, .9)), T.get('collar', 'primary'), m.spine(('chest', 'neck')), tag='collar')
    def skirt_w(p):
        t = smooth01((y0 - p.y) / .3) * .55; side = smooth01((p.x + .16) / .32); return {'hips': 1 - t, 'thigh_L': t * side, 'thigh_R': t * (1 - side)}
    sk = lathe((0, y0 + .02, 0), (0, T['hem'], 0), [(0, T['w'] * .95), (.1, T['w'] * 1.04), (.22, T['w'] * 1.26), (y0 + .02 - T['hem'], T['w'] * 1.4)], 28, sq=(1, .8))
    bmesh.ops.delete(sk, geom=[f for f in sk.faces if abs(f.normal.y) > .95 or (abs(f.calc_center_median().z) < .045 and f.calc_center_median().y < y0 - .12)], context='FACES')
    bmesh.ops.solidify(sk, geom=list(sk.faces), thickness=.012); m.add(sk, 'primary', skirt_w, tag='skirt')
    m.add(torus((0, y0 + .005, 0), (T['w'] * .93, T['d'] * .92), .022, 22, 5, sq=(.5, 1.3)), T.get('belt', 'light'), w, tag='belt')
    m.add(rbox((0, y0 + .005, T['d'] * .92), (.06, .05, .02), .012), 'accent', 'hips', tag='belt')
    return body

def pauldrons(m, T, R=(.085, .05, .095)):
    for s, S in ((1, 'L'), (-1, 'R')):
        c = Vector((s * (T['sh'] + .015), T['arm_y'] + .01, 0)); g = sphere(c, R, 16, 9, rot=(0, 0, s * -18)); cut(g, c - Vector((0, R[1] * .15, 0)), (s * .3, 1, 0), keep='above')
        bmesh.ops.solidify(g, geom=list(g.faces), thickness=.012); m.add(g, 'metal', f'shoulder_{S}', tag='pauldrons')
        m.add(torus(c - Vector((0, R[1] * .13, 0)), (R[0] * .97, R[2] * .97), .01, 18, 4, rot=(0, 0, s * -17)), 'accent', f'shoulder_{S}', tag='pauldrons')

def lord_limbs(m, J, s, S, T):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(capsule(sh, el, .062, .052, 12), T.get('sleeve', 'primary'), f'upperarm_{S}', tag='arms')
    m.add(capsule(el, wr, .052, .045, 12), T.get('glove', 'light'), f'forearm_{S}', tag='arms')
    m.add(lathe(lerp(el, wr, .35), wr + Vector((s * .005, 0, 0)), [(0, 0), (0, .058), (.02, .062), (.1, .06), (.14, .064), (.15, .05), (.151, 0)], 16), T.get('glove', 'light'), f'forearm_{S}', tag='gloves')
    hand(m, s, S, wr + Vector((s * .01, 0, 0)), T['hu'], T.get('glove', 'light'), fist=True, tris=460)
    hp, kn = P(J, f'thigh_{S}'), P(J, f'shin_{S}')
    m.add(capsule(lerp(hp, kn, .2), kn, .082, .066, 12), T.get('legs', 'light'), f'thigh_{S}', tag='legs')
    m.add(capsule(kn, kn + Vector((0, -.12, 0)), .064, .058, 12), T.get('legs', 'light'), f'shin_{S}', tag='legs')
    boot(m, s, S, J, T['boot'], .074, .056, T.get('boots', 'trim'), 'dark', L=.27, wd=.13, ht=.12, cuff=.014, cuff_mat='accent', tris=400)

def head(m):
    c = HC; o = lambda x, y, z: c + Vector((x, y, z))
    skull, face = human_head(m, c, (.118, .138, .128), jaw=.9, chin=.85, nose=(.017, .036), nose_y=-.05, ears='round', tris=1400,
                             mouth=[(-.026, -.1), (-.008, -.104), (.01, -.104), (.026, -.1)],
                             eyes=dict(x=.048, y=-.005, w=.031, h=.037, tilt=5, iris=.66, pupil=.48, look=(0, .05), lid=(.18, 4), lash=.2,
                                       brow=dict(lift=.36, slant=6, thick=.28, width=1.05, arch=.2, mat='hair', gap=.006)))
    keep = scalp(m, skull, c, .075, -.13); trim(skull, keep, .05); m.add(skull, 'skin', 'head', tag='face')
    # Bangs fanning over the brow, locks framing the cheeks, and collar-length hair at the back.
    for x, L, k in ((0, .1, 1), (.04, .1, .95), (.075, .085, .9), (.1, .07, .8)):
        for s in ((1, -1) if x else (1,)):
            a = o(s * x * .7, .1, .085); m.add(spike(a, o(s * (x * 1.1 + .01), .08, .135), o(s * (x * 1.25 + .012), .1 - L, .128 - x * .25), .034 * k, sq=(1, .5), up=(0, 0, 1), n=6, seg=7), 'hair', 'head', tag='hair')
    for s in (1, -1):
        m.add(strand([o(s * .1, .05, .06), o(s * .122, -.04, .06), o(s * .115, -.13, .04)], .036, .008, sq=(.4, 1), n=8, seg=7), 'hair', 'head', tag='hair')
        for z, dy in ((-.05, -.19), (-.1, -.2)):
            m.add(strand([o(s * .09, .02, z), o(s * .12, -.08, z - .01), o(s * .11, dy, z - .03)], .045, .01, sq=(.45, 1), n=8, seg=7), 'hair', 'head', tag='hair')
    m.add(blob([('ell', o(0, -.1, -.1), (.1, .1, .06)), ('ell', o(0, -.18, -.09), (.075, .05, .04))], tris=360, relax=1), 'hair', 'head', tag='hair')
    # Tiara: a thin gold circlet with a pointed brow piece and a small gem.
    m.add(torus(o(0, .06, -.005), (.132, .142), .008, 24, 4, rot=(-16, 0, 0)), 'accent', 'head', tag='tiara')
    hs = Surf(skull); p, n = hs.hit(o(0, .08, 0)); p = p + n * .026
    m.add(slab([[(0, .04), (.016, .0), (.04, -.01), (.014, -.017), (0, -.03), (-.014, -.017), (-.04, -.01), (-.016, 0)]], .01, Matrix.Translation(p) @ aim(n).to_4x4()), 'accent', 'head', tag='tiara')
    m.add(sphere(p + n * .006, (.01, .012, .007), 10, 6), 'secondary', 'head', tag='tiara')

T = dict(hip=1.06, chest=1.36, arm_y=1.54, w=.155, d=.105, sh=.19, plate=1.27, hem=.72, hu=HU, boot=.47)

def build():
    m = Model('marth', J, COLORS, COSTUMES, prop='always')
    head(m); lord_torso(m, T); pauldrons(m, T); m.both(lambda s, S: lord_limbs(m, J, s, S, T))
    cape(m, 'cape', 'chest', T['arm_y'] - .01, -.12, .4, 1.0, ('primary', 'secondary'), n=3, flare=1.6, back=-.14, curve=.1)
    for s in (1, -1): m.add(sphere((s * .15, T['arm_y'] - .02, .08), .024, 10, 6), 'accent', 'chest', tag='clasps')
    sword(m, P(J, 'prop'), .86, .046, ('metal', 'accent', 'primary', 'accent'), guard_style='hilt', grip_len=.17, guard=.16, tip=.09)  # Falchion
    return m

main(globals())
