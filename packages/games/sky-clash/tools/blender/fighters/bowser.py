"""Bowser (Melee): a hulking Koopa. Big horned head with a broad tan snout and underjaw, fangs, angry red eyes under
thick red brows and a wild red mane; green scaly skin; a banded yellow belly plate; a domed green shell with a cream rim
and cream spikes; black spiked collar and cuffs; thick arms with cream claws, stumpy legs with clawed feet and a short
spiked tail. No prop. The builder is parameterized so Giga Bowser reuses it."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._captain_falcon_helpers import *

COLORS = {'primary': '#98b83a', 'secondary': '#2f8a3a', 'accent': '#f2cc5c', 'light': '#f6eed2', 'hair': '#e2482a', 'dark': '#231a1c', 'metal': '#c4cad4',
          'eye': '#d83020', 'eye-white': '#fff6dc', 'trim': '#c8963a'}
COSTUMES = [('Red', {'secondary': '#b52a2a', 'hair': '#ff9a3a'}), ('Blue', {'secondary': '#2a4fb8', 'primary': '#8fb0a0', 'hair': '#f0e6d0'}),
            ('Black', {'secondary': '#2c2a2e', 'primary': '#6f8a3a', 'hair': '#f4f4f4', 'accent': '#d8c07a'})]
J = humanoid(hip=.8, spine=1.0, chest=1.2, neck=1.46, head=1.54, arm_y=1.36, shoulder=.14, arm=.4, elbow=.7, wrist=.96,
             leg=.24, leg_y=.7, knee=.4, ankle=.13, clav_y=1.32)
B = dict(HC=(0, 1.74, .13), horn=1.0, spikes=1.0, claws=1.0, brow=26, hair=1.0, iris='eye', elbow_spikes=False, tail=1.0)

IDLE = {'sym': {'upperarm': (0, -14, -60), 'forearm': (0, -30, 0), 'hand': (0, 0, -10), 'thigh': (0, 0, 8), 'shin': (0, 0, -6), 'foot': (0, 0, -4)}, 'spine': (8, 0, 0), 'chest': (6, 0, 0), 'head': (-10, 0, 0)}
HERO = {'root_loc': (0, -.08, 0), 'hips': (0, -24, 0), 'spine': (12, -8, 0), 'chest': (10, -10, 0), 'head': (-6, 20, 0),
        'upperarm_L': (0, -40, 10), 'forearm_L': (0, -50, 0), 'hand_L': (0, 0, 20), 'upperarm_R': (0, -20, 20), 'forearm_R': (0, 60, 0), 'hand_R': (0, 0, 20),
        'thigh_L': (-40, 0, 18), 'shin_L': (40, 0, -8), 'foot_L': (-5, 0, 0), 'thigh_R': (20, 0, -18), 'shin_R': (20, 0, 6), 'foot_R': (10, 0, 0),
        'extra_tail_0': (-10, 30, 0), 'extra_tail_1': (0, 20, 0)}
PORTRAIT = {'pose': {**IDLE, 'head': (-12, -14, 0)}, 'shoulders': .32}

def head(m, b):
    c = v3(b['HC']); o = lambda x, y, z: c + Vector((x, y, z))
    skull = blob([('ell', c, (.2, .2, .19)), ('cap', o(-.12, .1, .12), o(.12, .1, .12), .065), ('ell', o(0, -.07, .23), (.2, .105, .2)),
                  ('ell', o(0, -.15, .2), (.18, .08, .18)), ('ell', o(.13, -.06, .06), (.08, .1, .1)), ('ell', o(-.13, -.06, .06), (.08, .1, .1))], tris=2000, relax=3)
    def snout(p): q = p - c; return max(q.z - .17 - 1.5 * max(0, q.y + .0), min(q.z + .05, -.11 - q.y))
    split_by(skull, snout); face = Surf(skull)
    m.add(skull, lambda cc, n: 'accent' if snout(cc) > 0 else 'primary', 'head', tag='head')
    for s in (1, -1):
        eye(m, face, o(s * .09, .055, 0), .056, .062, s, tilt=10, iris=.56, pupil=.42, look=(0, .0), lid=(.2, 16), lash=0, lid_mat='primary', iris_mat=b['iris'],
            brow=dict(lift=.22, slant=b['brow'], thick=.52, width=1.2, arch=0, mat='hair', gap=.004))
        m.add(stamp(face, o(s * .055, -.01, 0), [ellipse(.026, .018, 14, rot=s * 20)], .008, d=(0, -.35, -1)), 'dark', 'head', tag='nostrils')
        # Horns sweep out and up from above the brow; fangs hang over the lip.
        hb = o(s * .13, .13, .02); k = b['horn']
        m.add(spike(hb, hb + Vector((s * .1, .06, -.02)) * k, hb + Vector((s * .14, .2, -.04)) * k, .055 * k ** .5, sq=(1, .9), n=8, seg=10, power=.9), 'light', 'head', over=True, tag='horns')
        fp, fn = face.hit(o(s * .1, -.13, 0)); m.add(spike(fp - fn * .012, fp + Vector((0, .03, .01)), fp + Vector((s * .006, .07, .012)), .024, sq=(1, .7), n=6, seg=8), 'light', 'head', tag='fangs')
    xs = np.linspace(-.15, .15, 13); mouth = [(x, .01 * (x / .15) ** 2) for x in xs] + [(x, -.03 * (1 - (x / .15) ** 2) - .004) for x in xs[::-1][1:-1]]
    m.add(stamp(face, o(0, -.115, 0), [mouth], .004, d=(0, -.1, -1)), 'dark', 'head', tag='mouth')
    # Mane: flaming red locks from the crown streaming back, plus a forelock between the horns.
    r = .06 * b['hair']
    for x, y, z, L in ((0, .2, -.02, 1), (.07, .18, -.05, .9), (-.07, .18, -.05, .9), (.11, .1, -.1, .8), (-.11, .1, -.1, .8), (0, .12, -.14, 1), (.05, .02, -.17, .8), (-.05, .02, -.17, .8)):
        base = o(x, y - .02, z * .8); m.add(spike(base, base + Vector((x * .4, .08, -.1)) * L, base + Vector((x * .8, .1 - .05 * (z < -.1), -.24)) * L * b['hair'], r, sq=(1, .6), n=7, seg=8), 'hair', 'head', over=True, tag='hair')
    fb = o(0, .17, .1); m.add(spike(fb, fb + Vector((0, .07, .05)), fb + Vector((0, .1, -.03)), .045, sq=(1, .6), n=6, seg=8), 'hair', 'head', over=True, tag='hair')

def torso(m, b):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, .8, .02), (.3, .16, .25)), ('ell', (0, 1.0, .06), (.33, .22, .28)), ('ell', (0, 1.2, .03), (.34, .18, .25)),
                 ('cap', (-.34, 1.33, -.02), (.34, 1.33, -.02), .14), ('ell', (0, 1.42, .0), (.22, .12, .17))], tris=1400, relax=2)
    def belly(p): return min(p.z - .06, 1.36 - p.y)
    bp = layer(body, belly, .016, .02, relax=1, tris=500); m.add(bp, 'accent', w, tag='belly'); bs = Surf(bp)
    for y in (.86, 1.0, 1.14, 1.27): m.add(stamp(bs, (0, y, 0), [[(-.22, .012), (.22, .012), (.22, -.012), (-.22, -.012)]], .006, spacing=.05), 'trim', w, tag='belly')
    trim(body, lambda p: belly(p) - .02, .0); m.add(body, 'primary', w, tag='body')
    # Shell: a domed back plate with a cream rim and a crown of spikes.
    sh = blob([('ell', (0, 1.05, -.1), (.45, .47, .32)), ('ell', (0, 1.2, -.18), (.38, .3, .24))], tris=1200, relax=2); cut(sh, (0, 0, -.04), (0, 0, -1), keep='above'); sh.normal_update()
    bmesh.ops.delete(sh, geom=[f for f in sh.faces if f.normal.z > .99 and f.calc_center_median().z > -.045], context='FACES')  # open front: no long cap edges
    m.add(sh, 'secondary', w, tag='shell'); ss = Surf(sh)
    m.add(torus((0, 1.05, -.055), (.455, .475), .038, 32, 6, rot=(90, 0, 0), sq=(1, .7)), 'light', w, tag='shell')
    for x, y in ((0, 1.3), (.2, 1.18), (-.2, 1.18), (0, 1.04), (.24, .92), (-.24, .92), (.1, .86), (-.1, .86), (0, .74)):
        p, n = ss.hit((x, y, -.8), (0, 0, 1)); L = .12 * b['spikes']
        m.add(lathe(p - n * .01, p + n * L, [(0, 0), (0, .05 * b['spikes'] ** .5), (.02, .048 * b['spikes'] ** .5), (L * .6, .022), (L + .01, 0)], 12, up=(0, 1, 0)), 'light', w, rigid=True, tag='spikes')
    # Spiked collar.
    m.add(torus((0, 1.44, .0), (.22, .18), .04, 20, 5, sq=(.8, 1.2)), 'dark', m.spine(('chest', 'neck')), tag='collar')
    for k in range(9):
        a = 2 * math.pi * k / 9; d = Vector((math.sin(a) * .22, 0, math.cos(a) * .18)); p = Vector((0, 1.44, 0)) + d * 1.12
        m.add(spike(p - d.normalized() * .02, p + d.normalized() * .03, p + d.normalized() * .07, .025, sq=(1, 1), n=4, seg=6), 'metal', m.spine(('chest', 'neck')), rigid=True, tag='collar')
    # Short thick tail with a spike, on a spring chain.
    pts = [(0, .76, -.22), (0, .6, -.38), (0, .42, -.46)]; wt = m.chain('tail', 'hips', pts)
    m.add(tube(spline(pts, 10), [.13, .12, .11, .1, .085, .07, .055, .04, .025, .01], 14, up=(1, 0, 0)), 'primary', wt, tag='tail')
    p = v3(pts[1]) + Vector((0, .1, -.06)); m.add(spike(p, p + Vector((0, .04, -.03)), p + Vector((0, .08 * b['tail'], -.08 * b['tail'])), .04, n=5, seg=8), 'light', wt, rigid=True, tag='tail')

def limbs(m, s, S, b):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(blob([('cap', sh, el, .13), ('ell', lerp(sh, el, .4), (.16, .14, .14))], tris=420, relax=2), 'primary', f'upperarm_{S}', tag='arms')
    m.add(blob([('cap', el, wr, .115), ('ell', lerp(el, wr, .4), (.15, .13, .13))], tris=420, relax=2), 'primary', f'forearm_{S}', tag='arms')
    cc = lerp(el, wr, .62); m.add(lathe(cc - Vector((s * .07, 0, 0)), cc + Vector((s * .07, 0, 0)), [(0, 0), (0, .14), (.02, .15), (.12, .15), (.14, .14), (.141, 0)], 16, up=(0, 1, 0)), 'dark', f'forearm_{S}', tag='cuffs')
    for k in range(6):
        a = 2 * math.pi * k / 6; d = Vector((0, math.cos(a), math.sin(a))); p = cc + d * .15
        m.add(spike(p, p + d * .03, p + d * .07, .026, sq=(1, 1), n=4, seg=6), 'metal', f'forearm_{S}', tag='cuffs')
    if b['elbow_spikes']: m.add(spike(el - Vector((0, 0, .08)), el + Vector((s * .04, 0, -.14)), el + Vector((s * .08, .02, -.24)), .05, n=5, seg=7), 'light', f'forearm_{S}', tag='arms')
    u = .12; hand(m, s, S, wr + Vector((s * .02, 0, 0)), u, 'primary', curl=.55, fingers=3, tris=460)
    for i in range(3):  # claws at the fingertips
        z = (1 - i) * u * .56; base = wr + Vector((s * (.02 + u * 2.25), -u * .35, z)); k = b['claws']
        m.add(spike(base, base + Vector((s * .035, -.035, 0)) * k, base + Vector((s * .05, -.1, 0)) * k, .03, sq=(1, .8), n=5, seg=6), 'light', f'hand_{S}', tag='claws')
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(blob([('cap', hp, kn, .15), ('ell', lerp(hp, kn, .35), (.18, .16, .17))], tris=420, relax=2), 'primary', f'thigh_{S}', tag='legs')
    m.add(capsule(kn, an + Vector((0, .03, 0)), .14, .12, 14), 'primary', f'shin_{S}', tag='legs')
    shoe(m, s, S, an + Vector((0, 0, .05)), .42, .26, .17, 'primary', 'primary', sole=.02, toe=1.1, heel=1.0, up=.02, tris=440, flare=.005)
    for i in range(3):
        base = an + Vector(((i - 1) * .075, .05, .33)); k = b['claws']
        m.add(spike(base, base + Vector((0, 0, .03)) * k, base + Vector(((i - 1) * .01 * k, -.035, .07 * k)), .03, sq=(1, .8), n=5, seg=6), 'light', f'foot_{S}', tag='claws')

def build_bowser(kind, colors, costumes, b):
    m = Model(kind, J, colors, costumes, prop='none')
    with m.transform((0, 1.5, .05), 1.2): head(m, b)
    torso(m, b); m.both(lambda s, S: limbs(m, s, S, b)); return m

def build(): return build_bowser('bowser', COLORS, COSTUMES, B)

main(globals())
