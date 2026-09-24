"""Jigglypuff (Melee): a soft pink balloon with huge teal eyes, pointed ears with black insides, a curled forehead tuft,
a tiny mouth, stubby arm nubs and small pointed feet. Every bone sits inside the ball (round style, like Kirby)."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#ffb4d0', 'secondary': '#f59ac0', 'dark': '#221a2c', 'eye': '#1f9dc6', 'eye-white': '#ffffff', 'accent': '#e2587a'}
COSTUMES = [('Blue Bow', {'primary': '#bcc8ff', 'secondary': '#9fb0f4', 'eye': '#3a5fd8', 'accent': '#6a6ad8'}),
            ('Green Headband', {'primary': '#bdeec4', 'secondary': '#9ddca8', 'eye': '#28995a', 'accent': '#3f9a5a'}),
            ('Crown', {'primary': '#ffe29a', 'secondary': '#f6cc72', 'eye': '#c9761c', 'accent': '#d86a3a'})]
R = .55
J = skeleton({'root': (0, 0, 0), 'hips': (0, .26, 0), 'spine': (0, .38, 0), 'chest': (0, .5, 0), 'neck': (0, .6, 0), 'head': (0, .66, 0),
              'shoulder_L': (.2, .5, 0), 'upperarm_L': (.4, .5, .02), 'forearm_L': (.5, .49, .03), 'hand_L': (.58, .48, .04),
              'shoulder_R': (-.2, .5, 0), 'upperarm_R': (-.4, .5, .02), 'forearm_R': (-.5, .49, .03), 'hand_R': (-.58, .48, .04), 'prop': (-.62, .47, .04),
              'thigh_L': (.2, .2, .04), 'shin_L': (.22, .13, .08), 'foot_L': (.22, .07, .12),
              'thigh_R': (-.2, .2, .04), 'shin_R': (-.22, .13, .08), 'foot_R': (-.22, .07, .12)})
IDLE = {'sym': {'upperarm': (0, -15, -30), 'forearm': (0, -10, -10), 'thigh': (0, 0, 4), 'foot': (0, 0, -4)}, 'head': (-3, 0, 0)}
HERO = {'root_loc': (0, .14, 0), 'hips': (0, -20, 0), 'chest': (-6, 0, -6), 'head': (-8, -8, 4),
        'upperarm_L': (0, -45, 40), 'forearm_L': (0, -20, 20), 'upperarm_R': (0, 50, -30), 'forearm_R': (0, 20, -20),
        'thigh_L': (-12, 0, 6), 'thigh_R': (10, 0, -6), 'foot_R': (12, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'head': (-6, -10, 0)}, 'shoulders': 1.4, 'fill': .86}

def body(m):
    w = m.spine(('hips', 'spine', 'chest', 'neck', 'head'), spans=[(.12, .5), (.26, .72), (.37, .84), (.42, 1.06)])
    c = Vector((0, R, 0))  # a true sphere, a touch wider at the hips like a balloon settling
    ball = bend(sphere(c, (R * 1.01, R, R * .98), 56, 34), lambda p: Vector((p.x * (1 + .04 * smooth01((c.y - p.y) / R + .2)), p.y, p.z * (1 + .03 * smooth01((c.y - p.y) / R + .2)))))
    face = Surf(ball); m.add(ball, 'primary', w, tag='body')
    for s in (1, -1):  # huge teal eyes: mostly iris, thick lash rim, big shine
        eye(m, face, (s * .215, .6, 0), .165, .185, s, tilt=-4, depth=.42, sink=.55, iris=.84, pupil=.42, look=(-s * .08, .05), lash=.13, bone=w(Vector((s * .215, .6, .5))))
    smile(m, face, [(-.05, .37, .5), (-.02, .352, .5), (.02, .352, .5), (.05, .37, .5)], .01, mat='dark')
    for s, S in ((1, 'L'), (-1, 'R')):  # broad cat-like ears: pink outer shell, black triangular inner
        a = math.radians(38); d = Vector((s * math.sin(a + .12), math.cos(a + .12), .05)).normalized(); sd = Vector((d.y, -d.x, 0)).normalized()
        base = c + Vector((s * math.sin(a), math.cos(a), .1)).normalized() * (R - .07); L = .4
        def ear(k, v0, v1, z, W=.34):
            def f(u, v):
                v = v0 + (v1 - v0) * v; x = (u - .5) * 2; wd = W * k * max(.03, (1 - v) ** .95) * (1 - .1 * v)
                return base + d * (v * L) + sd * x * wd / 2 + Vector((0, 0, z - .045 * (1 - x * x) * (1 - v) * k))
            return f
        we = m.chain(f'ear{S}', 'head', [base, base + d * L])
        m.add(subd(sheet(ear(1, -.15, 1, 0), 8, 9, .045), 1), 'primary', we, over=True, tag='ears')
        m.add(subd(sheet(ear(.64, .12, .84, .03), 5, 6, .014), 1), 'dark', we, over=True, tag='ears')
    # Forehead tuft: a thick lock that sweeps up and curls over toward the fighter's right, on a two-bone spring.
    top = Vector((0, 2 * R, 0)); pts = []
    for k in range(14):
        t = k / 13; ang = math.pi * (.15 + 1.7 * t); rr = .15 * (1 - .72 * t)
        pts.append(Vector((-.06 - rr * math.cos(ang) * 1.0, 2 * R - .05 + .1 + rr * math.sin(ang) * 1.0, .27 + .12 * t)))
    pts = [Vector((.03, 2 * R - .1, .2)), Vector((.06, 2 * R - .01, .23))] + pts
    wc = m.chain('curl', 'head', [pts[1], pts[8], pts[-1]])
    m.add(tube(pts, [.07 * (1 - .8 * (k / (len(pts) - 1)) ** 1.1) for k in range(len(pts))], 12, sq=(1, .7), up=(0, 0, 1), ends=(True, True)), 'primary', wc, over=True, tag='tuft')

def limbs(m, s, S):
    arm = blob([('ell', (s * .63, .5, .07), (.11, .08, .085), (0, 0, s * -22)), ('ell', (s * .5, .52, .04), (.085, .085, .085))], tris=600, relax=2)
    m.add(arm, 'primary', m.env([f'upperarm_{S}', f'forearm_{S}', f'hand_{S}'], .06), tag='arms')
    foot = blob([('ell', (s * .22, .06, .2), (.1, .07, .15), (0, s * -12, 0)), ('ell', (s * .2, .1, .08), (.09, .07, .1))], tris=700, relax=2)
    cut(foot, (0, 0, 0), (0, 1, 0), keep='above'); m.add(foot, 'secondary', f'foot_{S}', tag='feet')

def build():
    m = Model('jigglypuff', J, COLORS, COSTUMES, prop='none')
    body(m); m.both(lambda s, S: limbs(m, s, S)); return m

main(globals())
