"""Donkey Kong (Melee): a huge gorilla with a barrel chest and gut, enormous long arms ending in giant tan fists, and
short bowed legs with big tan feet. Big head thrust forward: a heavy fur brow, a heart-shaped tan face mask around
small brown eyes, a wide muzzle with nostrils and a toothy grin, round ears and a spiky tuft on top. Red tie with
yellow "DK" letters on a spring chain. No prop."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._captain_falcon_helpers import *

COLORS = {'hair': '#6e3d1d', 'skin': '#eab47c', 'primary': '#d8281f', 'accent': '#ffd23a', 'dark': '#231616', 'eye': '#6a3a1c', 'eye-white': '#ffffff', 'light': '#fbf6ea'}
COSTUMES = [('Black', {'hair': '#3a3232', 'primary': '#8e3ad6'}), ('Red', {'hair': '#8e3a26', 'primary': '#2a5ad8'}),
            ('Blue', {'hair': '#4c5078', 'primary': '#2fa84a'})]
J = humanoid(hip=.74, spine=.92, chest=1.15, neck=1.42, head=1.5, arm_y=1.34, shoulder=.14, arm=.38, elbow=.78, wrist=1.14,
             leg=.2, leg_y=.66, knee=.37, ankle=.11, clav_y=1.3)
HC = Vector((0, 1.7, .12))

IDLE = {'sym': {'upperarm': (0, -12, -72), 'forearm': (0, -20, 0), 'hand': (0, 0, -10), 'thigh': (0, 0, 8), 'shin': (0, 0, -6), 'foot': (0, 0, -3)}, 'spine': (6, 0, 0), 'chest': (6, 0, 0), 'head': (-12, 0, 0)}
HERO = {'root_loc': (0, -.08, 0), 'hips': (0, -22, 0), 'spine': (12, -8, 0), 'chest': (10, -10, 0), 'head': (4, 18, 0),
        'upperarm_L': (0, -30, 40), 'forearm_L': (0, -85, 0), 'hand_L': (0, 0, 0), 'upperarm_R': (0, 35, 62), 'forearm_R': (0, 35, 0),
        'thigh_L': (-40, 0, 18), 'shin_L': (40, 0, -8), 'foot_L': (-5, 0, 0), 'thigh_R': (20, 0, -18), 'shin_R': (20, 0, 6), 'foot_R': (10, 0, 0),
        'extra_tie_0': (-20, 10, 0), 'extra_tie_1': (-10, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'head': (-14, -12, 0)}, 'shoulders': .3}

def head(m):
    c = HC; o = lambda x, y, z: c + Vector((x, y, z))
    skull = blob([('ell', c, (.22, .23, .21)), ('cap', o(-.13, .05, .15), o(.13, .05, .15), .06), ('ell', o(0, -.11, .19), (.19, .13, .15)), ('ell', o(0, -.06, .21), (.12, .06, .08)),
                  ('ell', o(0, -.17, .1), (.16, .08, .12)), ('ell', o(0, .02, -.04), (.2, .2, .18))], tris=2400, relax=3)
    def mask(p):
        q = p - c; lobe = lambda sx: 1 - ((q.x - sx) / .095) ** 2 - ((q.y + .005) / .085) ** 2
        return min(q.z - .07, max(1 - (q.x / .2) ** 2 - ((q.y + .12) / .13) ** 2, lobe(.075), lobe(-.075), (.06 - abs(q.x)) * 20 if q.y < .02 else -1))
    split_by(skull, mask); face = Surf(skull)
    m.add(skull, lambda cc, n: 'skin' if mask(cc) > 0 else 'hair', 'head', tag='head')
    for s in (1, -1):
        eye(m, face, o(s * .072, .0, 0), .038, .044, s, tilt=-4, iris=.62, pupil=.5, look=(-s * .1, .05), lid=(.24, -6), lash=0,
            brow=dict(lift=.25, slant=10, thick=.7, width=1.25, arch=.2, mat='hair', gap=.004))
        m.add(stamp(face, o(s * .042, -.055, 0), [ellipse(.026, .016, 14, rot=s * 25)], .005, d=(0, -.6, -1)), 'dark', 'head', tag='nostrils')
        ear = blob([('ell', o(s * .215, -.01, -.02), (.05, .075, .06), (0, s * -20, 0))], tris=260, relax=2)
        m.add(stamp(Surf(ear), o(s * .215, -.01, .04), [ellipse(.028, .045, 16)], .004, d=(-s * .4, 0, -1)), 'skin', 'head', tag='ears'); m.add(ear, 'hair', 'head', tag='ears')
    # Wide grin with a row of teeth, and a spiky tuft on top.
    # Wide open grin: a dark crescent with the upper teeth showing along its top edge.
    top = lambda x: .012 * (x / .13) ** 2; bot = lambda x: -.075 * (1 - (x / .14) ** 2)
    xs = np.linspace(-.14, .14, 15); mouth = [(x, top(x)) for x in xs] + [(x, bot(x)) for x in xs[::-1][1:-1]]
    m.add(stamp(face, o(0, -.145, 0), [mouth], .004, d=(0, -.25, -1)), 'dark', 'head', tag='mouth')
    teeth = [(x, top(x) + .002) for x in xs[2:-2]] + [(x, top(x) - .026 + .012 * (x / .1) ** 2) for x in xs[2:-2][::-1]]
    m.add(stamp(face, o(0, -.145, 0), [teeth], .004, d=(0, -.25, -1), lift=.004), 'light', 'head', tag='teeth')
    for x, h, z in ((0, .14, .04), (.05, .1, .0), (-.05, .1, .0)):
        b = o(x, .19, z); m.add(spike(b, b + Vector((x * .3, .06, .04)), b + Vector((x * 1.2, h, .1)), .05, sq=(1, .6), n=7, seg=8), 'hair', 'head', over=True, tag='tuft')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, .75, 0), (.26, .15, .21)), ('ell', (0, .93, .05), (.31, .2, .27)), ('ell', (0, 1.14, .03), (.38, .2, .27)),
                 ('cap', (-.36, 1.32, -.02), (.36, 1.32, -.02), .17), ('ell', (0, 1.42, -.04), (.26, .12, .18)), ('ell', (0, 1.5, .02), (.14, .1, .12))], tris=2200, relax=2)
    m.add(body, 'hair', w, tag='body'); surf = Surf(body)
    # Necktie: knot at the throat, blade down the chest on a two-bone spring, DK letters in gold.
    kp, kn = surf.hit((0, 1.36, 0)); m.add(blob([('ell', kp + kn * .03, (.065, .05, .045))], tris=260, relax=1), 'primary', 'chest', tag='tie')
    pts = [kp + kn * .03 + Vector((0, -.03, 0)), Vector((0, 1.12, .33)), Vector((0, .9, .34))]; wt = m.chain('tie', 'chest', pts)
    def blade(u, v):
        wv = .06 + .08 * v; y = 1.33 - .43 * v; p, n = surf.hit((0, y, 0)); return p + n * (.022 + .01 * v) + Vector((u - .5, 0, 0)) * 2 * wv
    def tip(u, v):
        return blade(u, v) + Vector((0, abs(u - .5) * .2, 0)) * smooth01((v - .78) / .22)
    tie = sheet(tip, 8, 12, .012); m.add(tie, 'primary', blend((wt, lambda p: smooth01((1.3 - p.y) / .12)), ('chest', lambda p: 1 - smooth01((1.3 - p.y) / .12))), tag='tie')
    ts = Surf(tie); D = [(-.03, .04), (.005, .04), (.03, .02), (.03, -.02), (.005, -.04), (-.03, -.04)]; Dh = [(-.012, .022), (.0, .022), (.012, .01), (.012, -.01), (0, -.022), (-.012, -.022)]
    K = [(-.03, .04), (-.012, .04), (-.012, .01), (.012, .04), (.032, .04), (.004, 0), (.032, -.04), (.012, -.04), (-.012, -.01), (-.012, -.04), (-.03, -.04)]
    for loops, x in (([D, Dh], -.032), ([K], .035)):
        m.add(stamp(ts, (x, 1.03, 0), loops, .005, spacing=.008), 'accent', blend((wt, 1.0)), rigid=True, tag='letters')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(blob([('cap', sh, el, .13), ('ell', lerp(sh, el, .35) + Vector((0, .02, .02)), (.18, .15, .15))], tris=700, relax=2), 'hair', f'upperarm_{S}', tag='arms')
    m.add(blob([('cap', el, wr, .12), ('ell', lerp(el, wr, .55) + Vector((0, .01, 0)), (.19, .15, .15))], tris=700, relax=2), 'hair', f'forearm_{S}', tag='arms')
    hand(m, s, S, wr + Vector((s * .02, 0, 0)), .13, 'skin', fist=True, tris=700)
    hp, kn = P(J, f'thigh_{S}'), P(J, f'shin_{S}')
    m.add(blob([('cap', hp, kn, .13), ('ell', lerp(hp, kn, .4) + Vector((s * .02, 0, 0)), (.16, .13, .15))], tris=500, relax=2), 'hair', f'thigh_{S}', tag='legs')
    m.add(capsule(kn, P(J, f'foot_{S}') + Vector((0, .03, 0)), .12, .1, 16), 'hair', f'shin_{S}', tag='legs')
    an = P(J, f'foot_{S}'); shoe(m, s, S, an + Vector((s * .02, 0, .05)), .42, .24, .15, 'skin', 'skin', sole=.02, toe=1.15, heel=.9, up=.02, tris=600)
    for k in range(3): m.add(sphere(an + Vector((s * .02 + (k - 1) * .065, .04, .27)), (.036, .034, .042), 12, 8), 'skin', f'foot_{S}', tag='toes')

def build():
    m = Model('donkey-kong', J, COLORS, COSTUMES, prop='none')
    with m.transform((0, 1.45, .05), 1.22): head(m)
    torso(m); m.both(lambda s, S: limbs(m, s, S)); return m

main(globals())
