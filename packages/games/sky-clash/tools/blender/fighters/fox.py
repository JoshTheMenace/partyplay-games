"""Fox McCloud (Melee): lean pilot with a long two-tone muzzle, tall ears, green eyes, white flight jacket over a green
suit, red neckerchief, reflector buckle, silver boots and a bushy white-tipped tail. The blaster rides the prop bone."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#eef0ee', 'secondary': '#4f7f3c', 'accent': '#d8352b', 'trim': '#6b4a2e', 'metal': '#aeb8c4', 'emissive': '#5fd6ff',
          'skin': '#d98838', 'light': '#fbf4e8', 'hair': '#5c341f', 'dark': '#221c22', 'eye': '#3aa45a', 'eye-white': '#ffffff'}
COSTUMES = [('Red Team', {'primary': '#e04a3c', 'secondary': '#40363a', 'accent': '#f4f0e6', 'emissive': '#ffb13d'}),
            ('Blue Team', {'primary': '#3f7fe0', 'secondary': '#2f3c5c', 'accent': '#f2d23c', 'emissive': '#8af0ff'}),
            ('Green Team', {'primary': '#58b855', 'secondary': '#2f4d2c', 'accent': '#f4f0e6', 'emissive': '#b8ff6a'})]
J = humanoid(hip=.84, spine=.95, chest=1.08, neck=1.3, head=1.37, arm_y=1.22, shoulder=.07, arm=.2, elbow=.46, wrist=.7,
             leg=.1, leg_y=.8, knee=.45, ankle=.1, clav_y=1.21)

HERO = {'root_loc': (0, -.02, 0), 'hips': (0, -20, 0), 'spine': (6, -6, 0), 'chest': (4, -8, 0), 'head': (-6, -10, -4),
        'upperarm_R': (0, 62, 20), 'forearm_R': (0, 12, 0), 'hand_R': (0, 0, 0),
        'upperarm_L': (0, 20, -50), 'forearm_L': (0, -110, 0), 'hand_L': (0, 0, -20),
        'thigh_L': (-38, 0, 12), 'shin_L': (58, 0, 0), 'foot_L': (-12, 0, 0), 'thigh_R': (22, 0, -10), 'shin_R': (42, 0, 0), 'foot_R': (18, 0, 0),
        'extra_tail_0': (-10, 55, 0), 'extra_tail_1': (0, 20, -10), 'extra_tail_2': (10, 10, -10)}
PORTRAIT = {'pose': {**IDLE, 'head': (-4, -12, 0)}, 'shoulders': .35}

def head(m):
    skull = blob([('ell', (0, 1.545, -.02), (.158, .158, .158)), ('ell', (0, 1.5, .03), (.135, .11, .13)),
                  ('cap', (0, 1.49, .06), (0, 1.468, .25), .066, {'stiff': 4}), ('ell', (0, 1.435, .13), (.085, .052, .12)),
                  ('ell', (.1, 1.47, .06), (.07, .07, .07)), ('ell', (-.1, 1.47, .06), (.07, .07, .07))], tris=2000, relax=3)
    def white(p): return min(1.484 - p.y + .03 * p.z, p.z + .03)  # lower muzzle and cheeks
    split_by(skull, white); face = Surf(skull)
    m.add(skull, lambda c, n: 'light' if white(c) > 0 else 'skin', 'head', tag='head')
    m.add(sphere((0, 1.485, .325), (.034, .026, .026), 14, 10, rot=(-10, 0, 0)), 'dark', 'head', tag='nose')
    for s in (1, -1):
        eye(m, face, (s * .066, 1.565, 0), .04, .048, s, tilt=14, depth=.5, iris=.7, pupil=.46, look=(-s * .1, 0), lid=(.22, 16), lash=.2,
            brow=dict(lift=.35, slant=22, thick=.4, width=1.15, arch=.1, mat='skin', gap=.004))
        smile(m, face, [(s * .02, 1.438, .3), (s * .055, 1.44, .26), (s * .085, 1.452, .19), (s * .105, 1.47, .13)], .006)
        # Cheek ruffs: three soft spikes sweeping back.
        for i, (y, dz, L) in enumerate(((1.49, 0, .12), (1.45, -.01, .13), (1.41, -.03, .09))):
            b = Vector((s * .12, y, .06 + dz)); m.add(spike(b, b + Vector((s * .07, -.01, -.03)), b + Vector((s * L, -.03 - .02 * i, -.07)), .04, sq=(1, .5), up=(0, 0, 1), n=6, seg=7), 'light', 'head', tag='ruffs')
        # Tall ears on one-bone springs.
        base, tip = Vector((s * .095, 1.66, -.035)), Vector((s * .165, 1.93, -.07)); w = m.chain(f'ear{"L" if s > 0 else "R"}', 'head', [base, tip])
        outer = tube(bez(base, lerp(base, tip, .5) + Vector((s * .01, 0, 0)), tip, 7), [.068, .064, .056, .044, .03, .016, .002], 12, up=(0, 0, 1), ends=(True, False), sq=(1, .42))
        inner = tube(bez(base + Vector((0, .02, .018)), lerp(base, tip, .5) + Vector((0, 0, .02)), tip + Vector((0, -.03, .012)), 6), [.046, .042, .034, .024, .012, .002], 10, up=(0, 0, 1), ends=(True, False), sq=(1, .3))
        m.add(outer, 'skin', w, tag='ears'); m.add(inner, 'hair', w, tag='ears')
    for x, h in ((0, .1), (.05, .07), (-.05, .07)):  # forehead tuft
        b = Vector((x, 1.67, .04)); m.add(spike(b, b + Vector((x * .5, .04, .05)), b + Vector((x * 1.4, h * .6, .12)), .03, sq=(1, .6)), 'skin', 'head', over=True, tag='tuft')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, .85, 0), (.16, .1, .12)), ('ell', (0, .97, 0), (.15, .12, .115)), ('ell', (0, 1.1, .01), (.19, .13, .13)),
                 ('cap', (-.15, 1.2, -.01), (.15, 1.2, -.01), .08), ('ell', (0, 1.14, .05), (.15, .09, .1))], tris=1500, relax=2)
    def jacket(p): return min(p.y - .92, max(abs(p.x) - .02 - (p.y - .92) * .28, -p.z - .02))
    shell = layer(body, jacket, .014, .014, relax=1, tris=1000); trim(body, lambda p: min(jacket(p), p.y - .96))
    m.add(body, 'secondary', w, tag='suit'); m.add(shell, 'primary', w, tag='jacket')
    m.add(lathe((0, 1.18, -.01), (0, 1.3, -.02), [(0, 0), (0, .14), (.03, .15), (.1, .128), (.12, .1), (.121, 0)], 20, sq=(1, .9)), 'primary', 'chest', tag='collar')
    m.add(capsule((0, 1.22, -.01), (0, 1.4, .0), .082, .078, 14), 'skin', 'neck', tag='neck')
    m.add(blob([('ell', (0, 1.2, .07), (.06, .08, .04)), ('ell', (0, 1.3, .05), (.075, .05, .05))], tris=300, relax=1), 'light', m.spine(('chest', 'neck')), tag='chest fur')
    m.add(torus((0, 1.27, .0), (.1, .09), .03, 20, 6, rot=(-8, 0, 0)), 'accent', 'neck', tag='scarf')
    m.add(sphere((.03, 1.25, .1), (.04, .035, .03), 12, 8), 'accent', 'chest', tag='scarf')
    pts = [(.04, 1.24, .11), (.065, 1.17, .125), (.08, 1.1, .12)]; ws = m.chain('scarf', 'chest', pts)
    m.add(ribbon(pts, [.045, .05, .04], .014, normal=(0, 0, 1)), 'accent', ws, tag='scarf')
    # Belt with the reflector unit and a thigh holster.
    m.add(torus((0, .9, .005), (.165, .128), .03, 24, 6, sq=(.5, 1.2)), 'trim', w, tag='belt')
    m.add(rbox((0, .9, .135), (.1, .075, .04), .015), 'metal', 'hips', tag='reflector')
    m.add(sphere((0, .9, .158), (.028, .024, .01), 12, 8), 'emissive', 'hips', tag='reflector')
    m.add(rbox((-.17, .7, .02), (.05, .15, .1), .02, rot=(0, 0, 4)), 'trim', 'thigh_R', tag='holster')
    # Bushy tail on a four-bone spring chain, white at the tip.
    pts = [(0, .86, -.12), (0, .78, -.3), (0, .63, -.44), (0, .46, -.5), (0, .3, -.48)]; wt = m.chain('tail', 'hips', pts)
    tail = tube(spline(pts, 14), [.05, .07, .095, .11, .118, .118, .114, .106, .096, .082, .066, .048, .03, .012], 14, up=(1, 0, 0))
    smooth(tail, 2); split_by(tail, lambda p: .43 - p.y)
    m.add(tail, lambda c, n: 'light' if c.y < .43 else 'skin', wt, tag='tail')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(capsule(sh, el, .075, .062, 14), 'primary', f'upperarm_{S}', tag='arms')
    m.add(capsule(el, wr, .062, .056, 14), 'primary', f'forearm_{S}', tag='arms')
    hand(m, s, S, wr + Vector((s * .01, 0, 0)), .062, 'light', curl=.45, cuff=(.05, .062))
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(capsule(hp, kn, .085, .066, 16), 'secondary', f'thigh_{S}', tag='legs')
    m.add(lathe(kn, (an.x, .08, 0), [(-.07, 0), (-.06, .045), (-.02, .07), (.05, .072), (.2, .074), (.3, .082), (.33, .085), (.345, .07), (.35, 0)], 16), 'metal', f'shin_{S}', tag='boots')
    m.add(sphere(kn + Vector((0, .0, .045)), (.068, .075, .045), 14, 10), 'metal', f'shin_{S}', tag='kneepads')
    m.add(torus((an.x, .36, 0), .076, .012, 16, 6), 'dark', f'shin_{S}', tag='boots')
    shoe(m, s, S, an + Vector((0, 0, .02)), .26, .15, .13, 'metal', 'dark', sole=.028, toe=.95, heel=.9, up=.015, tris=560)

def blaster(m):
    g = P(J, 'prop'); x = g.x  # right hand: barrel along -X, sights toward +Z (thumb side)
    m.add(rbox((x - .02, g.y, g.z - .02), (.05, .06, .12), .014, rot=(0, 18, 0)), 'dark', 'prop', tag='blaster')
    m.add(rbox((x - .09, g.y, g.z + .05), (.2, .06, .07), .016), 'metal', 'prop', tag='blaster')
    m.add(cyl((x - .19, g.y, g.z + .05), (x - .3, g.y, g.z + .05), .022, seg=14, bevel=.004), 'dark', 'prop', tag='blaster')
    m.add(torus((x - .3, g.y, g.z + .05), .02, .007, 14, 5, rot=(0, 0, 90)), 'emissive', 'prop', tag='blaster')
    m.add(rbox((x - .06, g.y, g.z + .095), (.07, .025, .03), .008), 'dark', 'prop', tag='blaster')

def build():
    m = Model('fox', J, COLORS, COSTUMES, prop='move')
    with m.transform((0, 1.4, 0), 1.1, (0, -.035, 0)): head(m)
    torso(m); m.both(lambda s, S: limbs(m, s, S)); blaster(m); return m

main(globals())
