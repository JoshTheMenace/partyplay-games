"""Mewtwo (Melee): tall, lean psychic cat with a small skull, two blunt horns, heavy brow over narrow purple eyes, the
tube running from the back of the skull to the upper back, broad chest and shoulders over a thin waist, a purple
belly flowing into a long heavy tail, thin arms with bulb-tipped three-finger hands and thick thighs over big feet."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#c6bad9', 'secondary': '#9b68c4', 'eye': '#8b3fd0', 'eye-white': '#ffffff', 'dark': '#1f1826', 'accent': '#b9aad0'}
COSTUMES = [('Yellow', {'secondary': '#e5bf38', 'eye': '#c28a1a', 'accent': '#d8c8a0'}),
            ('Blue', {'primary': '#d0d8ec', 'secondary': '#4c76d8', 'eye': '#2f5fc8', 'accent': '#a8b8d8'}),
            ('Green', {'primary': '#d6e2d2', 'secondary': '#56ad62', 'eye': '#2f8a4a', 'accent': '#aac8a8'})]
J = humanoid(hip=.98, spine=1.1, chest=1.3, neck=1.55, head=1.66, arm_y=1.49, shoulder=.08, arm=.25, elbow=.56, wrist=.84,
             leg=.13, leg_y=.94, knee=.52, ankle=.13, clav_y=1.47)
TAIL = [(0, .98, -.13), (0, .8, -.36), (0, .52, -.52), (0, .27, -.6), (0, .15, -.8), (0, .2, -1.0)]
IDLE = {'sym': {'upperarm': (0, -14, -62), 'forearm': (0, -35, 0), 'hand': (0, 0, -10), 'thigh': (0, 0, 3), 'foot': (0, 0, -3)}, 'spine': (4, 0, 0), 'head': (-4, 0, 0)}
HERO = {'root_loc': (0, .16, 0), 'hips': (4, 6, 0), 'spine': (2, -4, 0), 'chest': (-4, -10, 0), 'head': (-4, -10, -4),
        'upperarm_R': (0, 25, -62), 'forearm_R': (0, 40, 0), 'hand_R': (0, 0, -20),
        'upperarm_L': (0, -68, 8), 'forearm_L': (0, -12, 0), 'hand_L': (0, 0, 30),
        'thigh_L': (-22, 0, 4), 'shin_L': (45, 0, 0), 'foot_L': (35, 0, 0), 'thigh_R': (8, 0, -3), 'shin_R': (55, 0, 0), 'foot_R': (40, 0, 0),
        'extra_tail_1': (-20, 10, 0), 'extra_tail_2': (-25, 10, 0), 'extra_tail_3': (-20, 10, 0), 'extra_tail_4': (-15, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'head': (-6, -12, 0)}, 'shoulders': .4}

def head(m):
    skull = blob([('ell', (0, 1.83, -.02), (.125, .135, .14)), ('ell', (0, 1.75, .06), (.095, .08, .105)), ('ell', (0, 1.7, .1), (.07, .05, .07)),
                  ('ell', (.075, 1.76, .03), (.06, .07, .07)), ('ell', (-.075, 1.76, .03), (.06, .07, .07))], res=.008, tris=2500, relax=7)
    face = Surf(skull); m.add(skull, 'primary', 'head', tag='head')
    for s in (1, -1):
        eye(m, face, (s * .06, 1.795, 0), .044, .034, s, tilt=14, depth=.55, sink=.55, iris=.8, iris_h=.92, pupil=.4, look=(-s * .1, -.05), lid=(.24, 16), lid_mat='primary',
            lash=.1, brow=dict(lift=.3, slant=18, thick=.36, width=.95, arch=.1, mat='primary', gap=.0, taper=.5))
        b, t = Vector((s * .065, 1.92, -.04)), Vector((s * .12, 2.03, -.09))  # blunt horns
        m.add(tube(bez(b - Vector((0, .04, 0)), lerp(b, t, .5) + Vector((s * -.01, .01, 0)), t, 8), [.055, .052, .048, .043, .037, .03, .022, .01], 12, sq=(1, .8), ends=(True, True)), 'primary', 'head', tag='horns')
    smile(m, face, [(-.03, 1.688, .2), (-.01, 1.684, .2), (.01, 1.684, .2), (.03, 1.688, .2)], .0038)

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, 1.39, -.01), (.2, .15, .122)),
                 ('cap', (-.2, 1.48, -.01), (.2, 1.48, -.01), .075), ('ell', (0, 1.18, 0), (.105, .1, .095)), ('ell', (0, 1.02, .01), (.145, .1, .12)),
                 ('ell', (0, 1.52, .0), (.11, .06, .09))], tris=1900, relax=2)
    def belly(p): return min(1.25 - p.y, .105 - abs(p.x) - max(0, p.y - 1.15) * .3, p.z + .02 + max(0, .97 - p.y) * 3)
    split_by(body, belly); m.add(body, lambda c, n: 'secondary' if belly(c) > 0 else 'primary', w, tag='body')
    m.add(capsule((0, 1.48, -.01), (0, 1.74, .02), .058, .052, 14), 'primary', m.spine(('chest', 'neck')), tag='neck')
    # Tube from the back of the skull to the upper back.
    pts = [Vector((0, 1.8, -.12)), Vector((0, 1.7, -.2)), Vector((0, 1.58, -.2)), Vector((0, 1.47, -.15))]
    tw = m.env(['chest', 'neck', 'head'], .12)
    m.add(tube(spline(pts, 12), [.03, .036, .038, .038, .038, .038, .038, .038, .038, .036, .034, .03], 12), 'accent', tw, tag='tube')
    for p in (pts[0], pts[-1]): m.add(sphere(p, .045, 12, 8), 'accent', tw(p), tag='tube')
    wt = m.chain('tail', 'hips', TAIL)
    rr = [.1, .105, .1, .092, .084, .077, .07, .064, .06, .058, .058, .062, .068, .072, .07, .055]
    m.add(tube(spline([(0, 1.05, -.05)] + TAIL, 16), rr, 16, up=(1, 0, 0)), 'secondary', wt, tag='tail')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(blob([('cap', sh, el, .05), ('ell', sh + Vector((s * .02, .005, 0)), (.085, .08, .08))], tris=700, relax=2), 'primary', f'upperarm_{S}', tag='arms')
    m.add(capsule(el, wr, .047, .055, 14), 'primary', f'forearm_{S}', tag='arms')
    hand(m, s, S, wr + Vector((s * .01, 0, 0)), .075, 'primary', curl=.3, fingers=3, thumb=.95, spread=1.1)
    for i in range(3):  # bulb fingertips
        z = (1 - i) * .075 * .56 * 1.1; tip = wr + Vector((s * (.01 + .075 * 1.72 + .075 * .7), -.045 - .004 * abs(1 - i), z))
        m.add(sphere(tip, .03, 12, 8), 'primary', f'hand_{S}', tag='hands')
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(blob([('cap', hp, kn, .09), ('ell', lerp(hp, kn, .35) + Vector((s * .005, 0, .015)), (.09, .145, .095))], tris=900, relax=2), 'primary', f'thigh_{S}', tag='legs')
    m.add(capsule(kn, an + Vector((0, .04, 0)), .07, .055, 14), 'primary', f'shin_{S}', tag='legs')
    foot = blob([('ell', (an.x, .07, an.z + .02), (.085, .07, .1)), ('ell', (an.x + s * .035, .05, an.z + .14), (.05, .05, .07)), ('ell', (an.x - s * .035, .05, an.z + .14), (.05, .05, .07)),
                 ('ell', (an.x, .1, an.z - .05), (.06, .06, .06))], tris=800, relax=2)
    cut(foot, (0, 0, 0), (0, 1, 0), keep='above'); m.add(foot, 'primary', f'foot_{S}', tag='feet')

def build():
    m = Model('mewtwo', J, COLORS, COSTUMES, prop='none')
    with m.transform((0, 1.66, 0), 1.2, (0, -.02, 0)): head(m)
    torso(m); m.both(lambda s, S: limbs(m, s, S)); return m

main(globals())
